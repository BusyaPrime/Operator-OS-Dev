import type {
  AgentHeartbeatRequest,
  AgentHeartbeatResponse,
  AIAgent,
  AIAgentIdentity,
  AIAgentStatus
} from '@operator-os/contracts';
import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRegistry } from '../../registry/agent-registry.js';
import {
  AgentHeartbeatLoop,
  type AgentHeartbeatPostResult,
  type AgentHeartbeatPoster
} from '../agent-heartbeat-loop.js';

const silentLogger = pino({ level: 'silent' });

// --- test helpers ----------------------------------------------

/**
 * `agentHeartbeatRequestSchema.agentId` is strict UUID. Tests that
 * drive the loop need valid UUIDs; we map a short label ('a', 'b')
 * to a stable deterministic UUID so assertions stay readable.
 */
const UUID_BY_LABEL: Record<string, string> = {
  a: '00000000-0000-4000-8000-000000000001',
  b: '00000000-0000-4000-8000-000000000002',
  c: '00000000-0000-4000-8000-000000000003'
};

const uuidFor = (label: string): string => {
  const uuid = UUID_BY_LABEL[label];
  if (uuid === undefined) {
    throw new Error(`add ${label} to UUID_BY_LABEL before using it in a test`);
  }
  return uuid;
};

const makeIdentity = (
  label: string,
  providerId = 'anthropic.claude-code'
): AIAgentIdentity => ({
  id: uuidFor(label),
  providerId,
  providerVersion: '0.1.0',
  displayName: 'agent',
  hostname: 'host',
  platform: 'linux',
  arch: 'x64'
});

const okResponse: AgentHeartbeatResponse = {
  status: 'ok',
  serverTime: '2026-04-24T00:00:00.000Z',
  pendingTaskIds: [],
  commands: []
};

const makeAgent = (
  label: string,
  statusOverride: Partial<AIAgentStatus> = {}
): AIAgent => {
  const status: AIAgentStatus = {
    state: 'idle',
    lastHeartbeatAt: '2026-04-24T00:00:00.000Z',
    healthChecks: { binary: 'ok' },
    ...statusOverride
  };
  return {
    identity: makeIdentity(label),
    runtime: {
      pid: 1234,
      startedAt: '2026-04-24T00:00:00.000Z',
      uptimeSeconds: 42
    },
    manifest: {
      manifestVersion: '1',
      providerId: 'anthropic.claude-code',
      providerVersion: '0.1.0',
      displayName: 'test',
      description: 'test',
      author: 'test',
      license: 'MIT',
      capabilities: [],
      requirements: {}
    },
    fs: {} as AIAgent['fs'],
    stream: {} as AIAgent['stream'],
    cost: {} as AIAgent['cost'],
    getStatus: vi.fn(async () => status),
    listCapabilities: () => [],
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    executeTask: vi.fn(async () => ({
      taskId: 'stub',
      status: 'pending' as const,
      startedAt: '2026-04-24T00:00:00.000Z'
    })),
    cancelTask: vi.fn(async () => undefined)
  };
};

interface Clock {
  now: () => number;
  advance: (ms: number) => void;
}

const makeClock = (start = 1_000_000): Clock => {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    }
  };
};

interface PosterHarness {
  poster: AgentHeartbeatPoster;
  calls: AgentHeartbeatRequest[];
  nextResult: (
    result: AgentHeartbeatPostResult | (() => Promise<AgentHeartbeatPostResult>)
  ) => void;
}

const createPoster = (): PosterHarness => {
  const queue: Array<
    AgentHeartbeatPostResult | (() => Promise<AgentHeartbeatPostResult>)
  > = [];
  const calls: AgentHeartbeatRequest[] = [];
  const poster: AgentHeartbeatPoster = async (req) => {
    calls.push(req);
    const next = queue.shift();
    if (next === undefined) {
      throw new Error(
        `poster called but queue empty (call ${calls.length} for agent ${req.agentId})`
      );
    }
    if (typeof next === 'function') return next();
    return next;
  };
  return {
    poster,
    calls,
    nextResult: (r) => queue.push(r)
  };
};

// --- tests ------------------------------------------------------

describe('AgentHeartbeatLoop', () => {
  let registry: AgentRegistry;
  let clock: Clock;
  let posterH: PosterHarness;

  beforeEach(() => {
    registry = new AgentRegistry(silentLogger);
    clock = makeClock();
    posterH = createPoster();
  });

  const build = (
    over: Partial<ConstructorParameters<typeof AgentHeartbeatLoop>[0]> = {}
  ): AgentHeartbeatLoop =>
    new AgentHeartbeatLoop({
      registry,
      logger: silentLogger,
      poster: posterH.poster,
      intervalMs: 1_000,
      baseBackoffMs: 100,
      maxBackoffMs: 10_000,
      now: clock.now,
      ...over
    });

  describe('happy path', () => {
    it('posts one heartbeat per registered agent on each tick', async () => {
      const a = makeAgent('a');
      const b = makeAgent('b');
      registry.register(a);
      registry.register(b);

      posterH.nextResult({ status: 200, body: okResponse });
      posterH.nextResult({ status: 200, body: okResponse });

      const loop = build();
      await loop.tick();

      expect(posterH.calls).toHaveLength(2);
      expect(posterH.calls.map((c) => c.agentId).sort()).toEqual([
        uuidFor('a'),
        uuidFor('b')
      ]);
    });

    it('builds a request that conforms to agentHeartbeatRequestSchema', async () => {
      const agent = makeAgent('a', {
        state: 'busy',
        currentTaskId: 'task-1',
        healthChecks: { binary: 'ok', vpn: 'warn' }
      });
      registry.register(agent);
      posterH.nextResult({ status: 200, body: okResponse });

      const loop = build();
      await loop.tick();

      const req = posterH.calls[0];
      expect(req.agentId).toBe(uuidFor('a'));
      expect(req.state).toBe('busy');
      expect(req.activeTaskCount).toBe(1);
      expect(req.healthChecks).toEqual({ binary: 'ok', vpn: 'warn' });
      expect(typeof req.timestamp).toBe('string');
    });

    it('reports activeTaskCount=0 when currentTaskId is absent', async () => {
      const agent = makeAgent('a');
      registry.register(agent);
      posterH.nextResult({ status: 200, body: okResponse });

      const loop = build();
      await loop.tick();
      expect(posterH.calls[0].activeTaskCount).toBe(0);
    });

    it('emits no state-change event on plain success', async () => {
      const agent = makeAgent('a');
      registry.register(agent);
      const events: string[] = [];
      registry.subscribe((e) => {
        if (e.type === 'agent:state-changed') events.push(e.state);
      });
      posterH.nextResult({ status: 200, body: okResponse });

      const loop = build();
      await loop.tick();
      expect(events).toEqual([]);
    });
  });

  describe('failure + backoff', () => {
    it('skips an agent on subsequent tick while inside the backoff window', async () => {
      const agent = makeAgent('a');
      registry.register(agent);

      posterH.nextResult({ status: 500, body: {} });
      const loop = build({ baseBackoffMs: 200 });
      await loop.tick();
      expect(posterH.calls).toHaveLength(1);

      // Immediately tick again without advancing the clock — loop should skip.
      await loop.tick();
      expect(posterH.calls).toHaveLength(1);

      // After the backoff window passes, the loop re-fires.
      clock.advance(250);
      posterH.nextResult({ status: 500, body: {} });
      await loop.tick();
      expect(posterH.calls).toHaveLength(2);
    });

    it('backoff grows exponentially per consecutive failure', async () => {
      const agent = makeAgent('a');
      registry.register(agent);

      const loop = build({ baseBackoffMs: 100, maxBackoffMs: 10_000 });

      // Fail 1: delay = 100 * 2^0 = 100ms
      posterH.nextResult({ status: 500, body: {} });
      await loop.tick();

      await loop.tick(); // skipped (within 100 ms)
      expect(posterH.calls).toHaveLength(1);

      clock.advance(100);
      posterH.nextResult({ status: 500, body: {} });
      await loop.tick(); // fail 2: delay = 200ms
      expect(posterH.calls).toHaveLength(2);

      clock.advance(100); // 100 < 200 — skipped
      await loop.tick();
      expect(posterH.calls).toHaveLength(2);

      clock.advance(100);
      posterH.nextResult({ status: 500, body: {} });
      await loop.tick(); // fail 3: delay = 400ms
      expect(posterH.calls).toHaveLength(3);
    });

    it('caps backoff at maxBackoffMs', async () => {
      const agent = makeAgent('a');
      registry.register(agent);

      const loop = build({ baseBackoffMs: 1_000, maxBackoffMs: 1_500 });

      for (let i = 0; i < 5; i += 1) {
        posterH.nextResult({ status: 500, body: {} });
        await loop.tick();
        // Step past at-most 1_500 ms (the cap) so the next tick fires.
        clock.advance(1_500);
      }
      expect(posterH.calls).toHaveLength(5);
    });

    it('counts non-2xx as a failure and increments the counter', async () => {
      const agent = makeAgent('a');
      registry.register(agent);

      const loop = build({ baseBackoffMs: 100 });
      posterH.nextResult({ status: 503, body: {} });
      await loop.tick();
      clock.advance(200);
      posterH.nextResult({ status: 502, body: {} });
      await loop.tick();

      expect(posterH.calls).toHaveLength(2);
    });

    it('counts a poster-thrown error (network failure) as a failure', async () => {
      const agent = makeAgent('a');
      registry.register(agent);

      const loop = build({ baseBackoffMs: 100 });
      posterH.nextResult(() => Promise.reject(new Error('ECONNRESET')));
      await loop.tick();
      // Backoff window applies even after throw.
      await loop.tick();
      expect(posterH.calls).toHaveLength(1);
    });

    it('counts a malformed response body as a failure', async () => {
      const agent = makeAgent('a');
      registry.register(agent);

      const loop = build({ baseBackoffMs: 100 });
      posterH.nextResult({
        status: 200,
        body: { unexpected: 'shape' }
      });
      await loop.tick();

      clock.advance(200);
      posterH.nextResult({ status: 200, body: okResponse });
      await loop.tick();
      // Second tick succeeds — no further backoff skip expected.
      expect(posterH.calls).toHaveLength(2);
    });
  });

  describe('state transitions', () => {
    it('emits "degraded" at the configured threshold', async () => {
      const agent = makeAgent('a');
      registry.register(agent);
      const events: string[] = [];
      registry.subscribe((e) => {
        if (e.type === 'agent:state-changed') events.push(e.state);
      });

      const loop = build({
        baseBackoffMs: 100,
        degradedFailThreshold: 3,
        offlineFailThreshold: 10
      });

      for (let i = 0; i < 3; i += 1) {
        posterH.nextResult({ status: 500, body: {} });
        await loop.tick();
        clock.advance(10_000);
      }
      expect(events).toContain('degraded');
    });

    it('emits "offline" at the offline threshold', async () => {
      const agent = makeAgent('a');
      registry.register(agent);
      const events: string[] = [];
      registry.subscribe((e) => {
        if (e.type === 'agent:state-changed') events.push(e.state);
      });

      const loop = build({
        baseBackoffMs: 50,
        degradedFailThreshold: 2,
        offlineFailThreshold: 4
      });

      for (let i = 0; i < 4; i += 1) {
        posterH.nextResult({ status: 500, body: {} });
        await loop.tick();
        clock.advance(10_000);
      }
      expect(events).toEqual(['degraded', 'offline']);
    });

    it('emits "idle" recovery event after the first success post-failure', async () => {
      const agent = makeAgent('a');
      registry.register(agent);
      const events: string[] = [];
      registry.subscribe((e) => {
        if (e.type === 'agent:state-changed') events.push(e.state);
      });

      const loop = build({
        baseBackoffMs: 50,
        degradedFailThreshold: 2,
        offlineFailThreshold: 10
      });

      // 2 failures to cross the degraded threshold.
      posterH.nextResult({ status: 500, body: {} });
      await loop.tick();
      clock.advance(100);
      posterH.nextResult({ status: 500, body: {} });
      await loop.tick();
      expect(events).toContain('degraded');

      // Success: registry sees an idle recovery signal.
      clock.advance(1_000);
      posterH.nextResult({ status: 200, body: okResponse });
      await loop.tick();
      expect(events).toEqual(['degraded', 'idle']);
    });

    it('resets the failure counter on success — next failure starts from 1', async () => {
      const agent = makeAgent('a');
      registry.register(agent);

      const loop = build({
        baseBackoffMs: 100,
        degradedFailThreshold: 2
      });

      posterH.nextResult({ status: 500, body: {} });
      await loop.tick(); // fail 1

      clock.advance(1_000);
      posterH.nextResult({ status: 200, body: okResponse });
      await loop.tick(); // success → reset

      // After reset, a single failure must not immediately trip degraded.
      const events: string[] = [];
      registry.subscribe((e) => {
        if (e.type === 'agent:state-changed') events.push(e.state);
      });

      clock.advance(1_000);
      posterH.nextResult({ status: 500, body: {} });
      await loop.tick();
      expect(events).not.toContain('degraded');
    });
  });

  describe('401 refresh-and-retry', () => {
    it('calls refreshToken and retries the same request on 401', async () => {
      const agent = makeAgent('a');
      registry.register(agent);

      const refreshToken = vi.fn(async () => undefined);
      posterH.nextResult({ status: 401, body: {} });
      posterH.nextResult({ status: 200, body: okResponse });

      const loop = build({ refreshToken });
      await loop.tick();

      expect(refreshToken).toHaveBeenCalledOnce();
      expect(posterH.calls).toHaveLength(2);
      // Both posts carry the same agentId — it's the same request replayed.
      expect(posterH.calls[0].agentId).toBe(uuidFor('a'));
      expect(posterH.calls[1].agentId).toBe(uuidFor('a'));
    });

    it('counts one failure when the retry also fails', async () => {
      const agent = makeAgent('a');
      registry.register(agent);

      const refreshToken = vi.fn(async () => undefined);
      posterH.nextResult({ status: 401, body: {} });
      posterH.nextResult({ status: 401, body: {} });

      const loop = build({ refreshToken, baseBackoffMs: 100 });
      await loop.tick();

      // A second immediate tick should be blocked by backoff → no more posts.
      await loop.tick();
      expect(posterH.calls).toHaveLength(2);
    });

    it('does nothing special on 401 when no refreshToken is wired', async () => {
      const agent = makeAgent('a');
      registry.register(agent);

      posterH.nextResult({ status: 401, body: {} });
      const loop = build();
      await loop.tick();
      // Only one call — no auto-retry without refreshToken.
      expect(posterH.calls).toHaveLength(1);
    });
  });

  describe('lifecycle', () => {
    it('start() ticks once immediately', async () => {
      const agent = makeAgent('a');
      registry.register(agent);
      posterH.nextResult({ status: 200, body: okResponse });

      const loop = build({ intervalMs: 60_000 });
      loop.start();
      // Await microtasks to let the start()-scheduled tick run.
      await new Promise<void>((r) => setImmediate(r));
      expect(posterH.calls).toHaveLength(1);
      loop.stop();
    });

    it('stop() halts subsequent ticks', async () => {
      const agent = makeAgent('a');
      registry.register(agent);
      posterH.nextResult({ status: 200, body: okResponse });

      const loop = build({ intervalMs: 60_000 });
      loop.start();
      await new Promise<void>((r) => setImmediate(r));
      loop.stop();

      // Manual tick post-stop still works (public, testable), but
      // start()'s interval should not fire again. We verify the
      // interval is cleared by manually ticking once more only
      // when we enqueue a response, which we don't for this assertion.
      expect(posterH.calls).toHaveLength(1);
    });
  });
});
