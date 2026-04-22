import type {
  AgentHeartbeatRequest,
  AIAgent,
  AIAgentStatus
} from '@operator-os/contracts';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseDesktopAgentEnv } from '@operator-os/config';

import {
  DesktopRuntime,
  type AgentFactory,
  type DesktopRuntimeOptions
} from '../runtime.js';
import type {
  AgentHeartbeatPostResult,
  AgentHeartbeatPoster
} from '../heartbeat/agent-heartbeat-loop.js';

const silentLogger = pino({ level: 'silent' });

/**
 * Factory that produces an AIAgent fake whose lifecycle hooks
 * are vi.fn() so boot / shutdown assertions are straightforward.
 * The factory closes over `captured` so the test can inspect
 * the agent it constructed.
 */
interface FakeAgentHarness {
  factory: AgentFactory;
  agents: AIAgent[];
  startMocks: ReturnType<typeof vi.fn>[];
  stopMocks: ReturnType<typeof vi.fn>[];
}

const createFakeAgentHarness = (
  overrides: {
    onStart?: () => Promise<void>;
    status?: Partial<AIAgentStatus>;
  } = {}
): FakeAgentHarness => {
  const agents: AIAgent[] = [];
  const startMocks: ReturnType<typeof vi.fn>[] = [];
  const stopMocks: ReturnType<typeof vi.fn>[] = [];
  const factory: AgentFactory = (ctx) => {
    const start = vi.fn(async () => {
      if (overrides.onStart) await overrides.onStart();
    });
    const stop = vi.fn(async () => undefined);
    const agent: AIAgent = {
      identity: ctx.identity,
      runtime: {
        pid: 1234,
        startedAt: new Date().toISOString(),
        uptimeSeconds: 0
      },
      manifest: ctx.manifest,
      fs: ctx.fs,
      stream: ctx.stream,
      cost: ctx.cost,
      getStatus: async (): Promise<AIAgentStatus> => ({
        state: 'idle',
        lastHeartbeatAt: new Date().toISOString(),
        healthChecks: { binary: 'ok' },
        ...overrides.status
      }),
      listCapabilities: () => [],
      start,
      stop,
      executeTask: vi.fn(async () => ({
        taskId: 'stub',
        status: 'pending' as const,
        startedAt: new Date().toISOString()
      })),
      cancelTask: vi.fn(async () => undefined)
    };
    agents.push(agent);
    startMocks.push(start);
    stopMocks.push(stop);
    return agent;
  };
  return { factory, agents, startMocks, stopMocks };
};

const createRecordingPoster = (): {
  poster: AgentHeartbeatPoster;
  calls: AgentHeartbeatRequest[];
  enqueue: (r: AgentHeartbeatPostResult) => void;
} => {
  const calls: AgentHeartbeatRequest[] = [];
  const queue: AgentHeartbeatPostResult[] = [];
  const poster: AgentHeartbeatPoster = async (req) => {
    calls.push(req);
    const next = queue.shift();
    if (next === undefined) {
      return {
        status: 200,
        body: {
          status: 'ok' as const,
          serverTime: '2026-04-24T00:00:00.000Z',
          pendingTaskIds: [],
          commands: []
        }
      };
    }
    return next;
  };
  return { poster, calls, enqueue: (r) => queue.push(r) };
};

const makeConfig = (over: Record<string, string | undefined> = {}) =>
  parseDesktopAgentEnv({
    API_BASE_URL: 'http://localhost:8080',
    HEARTBEAT_INTERVAL_MS: '60000', // large — tests drive tick() directly
    FS_ALLOWED_ROOTS: process.cwd(),
    ENABLED_AGENTS: 'claude-code',
    ...over
  });

describe('DesktopRuntime bootstrap (Phase 1.4)', () => {
  let heartbeat: ReturnType<typeof createRecordingPoster>;

  beforeEach(() => {
    heartbeat = createRecordingPoster();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const build = (
    optionsOver: Partial<DesktopRuntimeOptions> = {},
    envOver: Record<string, string | undefined> = {}
  ): {
    runtime: DesktopRuntime;
    harness: FakeAgentHarness;
  } => {
    const harness = createFakeAgentHarness();
    const runtime = new DesktopRuntime(makeConfig(envOver), silentLogger, {
      agentFactories: { 'claude-code': harness.factory },
      heartbeatPoster: heartbeat.poster,
      ...optionsOver
    });
    return { runtime, harness };
  };

  describe('construction', () => {
    it('registers one agent per shortName in ENABLED_AGENTS', () => {
      const { runtime } = build({}, { ENABLED_AGENTS: 'claude-code' });
      expect(runtime.agents).toHaveLength(1);
      expect(runtime.agents[0].identity.providerId).toBe(
        'anthropic.claude-code'
      );
    });

    it('skips unknown shortNames without crashing', () => {
      const { runtime } = build(
        {},
        { ENABLED_AGENTS: 'claude-code,gemini-cli' }
      );
      expect(runtime.agents).toHaveLength(1);
      expect(runtime.agents[0].identity.providerId).toBe(
        'anthropic.claude-code'
      );
    });

    it('assigns a unique UUID per agent identity', () => {
      const { runtime } = build({}, { ENABLED_AGENTS: 'claude-code' });
      const id = runtime.agents[0].identity.id;
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it('agents are accessible via agentRegistry.list()', () => {
      const { runtime } = build();
      const registered = runtime.agentRegistry.list();
      expect(registered).toHaveLength(1);
      expect(registered[0]).toBe(runtime.agents[0]);
    });

    it('exposes the agent heartbeat loop for observers', () => {
      const { runtime } = build();
      expect(runtime.agentHeartbeatLoop).toBeDefined();
    });
  });

  describe('start()', () => {
    it('calls agent.start() for every registered agent', async () => {
      const { runtime, harness } = build();
      await runtime.start();
      expect(harness.startMocks).toHaveLength(1);
      expect(harness.startMocks[0]).toHaveBeenCalledOnce();
      await runtime.stop();
    });

    it('continues booting when an individual agent.start() throws', async () => {
      const badHarness = createFakeAgentHarness({
        onStart: async () => {
          throw new Error('no binary');
        }
      });
      const runtime = new DesktopRuntime(makeConfig(), silentLogger, {
        agentFactories: { 'claude-code': badHarness.factory },
        heartbeatPoster: heartbeat.poster
      });

      // Must resolve — error tolerance is load-bearing for the
      // boot path; a missing external binary must not crash the
      // whole Desktop Agent.
      await expect(runtime.start()).resolves.toBeUndefined();
      await runtime.stop();
    });

    it('posts an agent heartbeat when the loop tick() runs post-start', async () => {
      const { runtime } = build();
      await runtime.start();
      await runtime.agentHeartbeatLoop.tick();
      expect(heartbeat.calls.length).toBeGreaterThanOrEqual(1);
      await runtime.stop();
    });
  });

  describe('stop()', () => {
    it('calls stop() on every registered agent', async () => {
      const { runtime, harness } = build();
      await runtime.start();
      await runtime.stop();
      expect(harness.stopMocks[0]).toHaveBeenCalledOnce();
      expect(harness.stopMocks[0]).toHaveBeenCalledWith('shutdown');
    });

    it('continues shutdown when an agent.stop() throws', async () => {
      const harness = createFakeAgentHarness();
      // Swap the agent's stop mock for one that throws once the
      // factory has produced it.
      const runtime = new DesktopRuntime(makeConfig(), silentLogger, {
        agentFactories: { 'claude-code': harness.factory },
        heartbeatPoster: heartbeat.poster
      });
      await runtime.start();
      harness.stopMocks[0].mockImplementationOnce(async () => {
        throw new Error('stop failed');
      });
      await expect(runtime.stop()).resolves.toBeUndefined();
    });

    it('halts the heartbeat loop — no further posts after stop', async () => {
      const { runtime } = build();
      await runtime.start();
      await runtime.agentHeartbeatLoop.tick();
      const postsDuringStart = heartbeat.calls.length;
      await runtime.stop();
      // tick() post-stop is still allowed (public test helper),
      // but the internal interval timer is cleared — no
      // background post should have landed in the tight window.
      expect(heartbeat.calls.length).toBe(postsDuringStart);
    });
  });
});
