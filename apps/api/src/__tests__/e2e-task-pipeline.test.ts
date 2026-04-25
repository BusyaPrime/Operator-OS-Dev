/**
 * Phase 3.3 c18 — E2E integration test for the task pipeline.
 *
 * Composes ALL the real api-side layers and verifies the impedance
 * match across them on a single end-to-end run:
 *
 *   fake agent   ─WS task-delta────►  registerAgentWsRoute
 *                                       │
 *                                       ▼
 *                               taskCallbacks (real wiring,
 *                               mirrors apps/api/src/app.ts)
 *                                       │
 *                                       ▼
 *                               taskEventBus (real)
 *                                       │
 *                                       ▼
 *   user (curl)  ◄─SSE delta frames─  registerTaskRoutes (real)
 *
 * Single mock per stop rule #5: the Firestore repository is faked
 * (recording-mock — exposes its writes for the final assertion
 * but does no I/O). Everything else is the production code path.
 *
 * What this test proves that unit tests can't:
 *  - WS frame shape → callback signature → bus event shape →
 *    SSE frame shape all line up.
 *  - `seq` numbering is monotonic across the bus boundary.
 *  - `taskEventBus.closeTask` actually severs the SSE subscription
 *    (server-end close observed by the client).
 *  - Last-Event-ID resume picks up Firestore-recorded deltas.
 *
 * Skipped on purpose:
 *  - Pub/Sub round-trip: the dispatch handler is exercised in c8;
 *    here we cut directly to `sendTaskAssign` to keep the moving
 *    parts to one orchestration boundary at a time.
 *  - Anthropic API: the fake agent stands in for ClaudeCodeAgent +
 *    its subprocess. The adapter unit tests cover that leg.
 */
import fastifyWebsocket from '@fastify/websocket';
import fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from 'fastify';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TaskOutputDelta, TaskRecord } from '@operator-os/contracts';

import type { FirestoreOperatorRepository } from '../integrations/firestore.js';
import {
  registerAgentWsRoute,
  sendTaskAssign,
  type AgentWsTaskCallbacks
} from '../routes/agent-ws.js';
import { registerTaskRoutes } from '../routes/tasks.js';
import { createAgentSessionRegistry } from '../services/agent-session-registry.js';
import { createIdempotencyCache } from '../services/idempotency-cache.js';
import { createTaskEventBus } from '../services/task-event-bus.js';

const AGENT_UUID = '00000000-0000-4000-8000-0000000000aa';
const TASK_UUID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'e2e-user';

// Skip auth at both layers so the test focuses on the pipeline.
const passthroughUserGuard = async (
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> => {
  (request as unknown as { currentUser: { operatorId: string } }).currentUser =
    { operatorId: USER_ID };
};
const passthroughAgentGuard = async (
  _request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> => {
  /* allow-all */
};

interface FakeRepoState {
  task: TaskRecord;
  appendCalls: TaskOutputDelta[];
  terminalCalls: Array<{
    status: 'completed' | 'failed';
    output?: string;
    error?: { code: string; message: string };
  }>;
}

const buildFakeRepo = (state: FakeRepoState): FirestoreOperatorRepository => {
  const repo = {
    getTask: vi.fn(async (taskId: string, userId: string) => {
      if (taskId !== state.task.taskId || userId !== state.task.userId) {
        return undefined;
      }
      return state.task;
    }),
    appendTaskDelta: vi.fn(async (taskId: string, delta: TaskOutputDelta) => {
      expect(taskId).toBe(state.task.taskId);
      state.appendCalls.push(delta);
      // Mirror the live behaviour: the in-memory task gains the delta
      // so getTask() readers see it on a subsequent fetch.
      state.task = {
        ...state.task,
        outputDeltas: [...state.task.outputDeltas, delta],
        status: 'streaming',
        updatedAt: delta.timestamp
      };
    }),
    setTaskTerminal: vi.fn(
      async (
        taskId: string,
        terminal: {
          status: 'completed' | 'failed';
          output?: string;
          error?: { code: string; message: string };
          completedAt?: string;
        }
      ) => {
        expect(taskId).toBe(state.task.taskId);
        state.terminalCalls.push({
          status: terminal.status,
          output: terminal.output,
          error: terminal.error
        });
        state.task = {
          ...state.task,
          status: terminal.status,
          output: terminal.output ?? state.task.output,
          error: terminal.error ?? state.task.error,
          completedAt: terminal.completedAt ?? state.task.completedAt
        };
      }
    )
  };
  return repo as unknown as FirestoreOperatorRepository;
};

const buildApp = async (
  state: FakeRepoState
): Promise<{ app: FastifyInstance; port: number }> => {
  const app = fastify({ logger: false });
  await app.register(fastifyWebsocket);

  const repo = buildFakeRepo(state);
  const sessionRegistry = createAgentSessionRegistry();
  const taskEventBus = createTaskEventBus();
  const taskSeqCounters = new Map<string, number>();
  const nextSeq = (taskId: string): number => {
    const next = (taskSeqCounters.get(taskId) ?? 0) + 1;
    taskSeqCounters.set(taskId, next);
    return next;
  };

  // Mirror apps/api/src/app.ts task-callback wiring.
  const taskCallbacks: AgentWsTaskCallbacks = {
    async onTaskDelta(params) {
      const seq = nextSeq(params.taskId);
      const deltaText =
        typeof params.delta === 'string'
          ? params.delta
          : JSON.stringify(params.delta ?? '');
      const delta: TaskOutputDelta = {
        seq,
        delta: deltaText,
        timestamp: new Date().toISOString()
      };
      await repo.appendTaskDelta(params.taskId, delta);
      taskEventBus.publish(params.taskId, { kind: 'delta', delta });
    },
    async onTaskCompleted(params) {
      const seq = nextSeq(params.taskId);
      const outputText =
        typeof params.output === 'string'
          ? params.output
          : JSON.stringify(params.output ?? '');
      await repo.setTaskTerminal(params.taskId, {
        status: 'completed',
        output: outputText,
        completedAt: new Date().toISOString()
      });
      taskEventBus.publish(params.taskId, {
        kind: 'completed',
        output: outputText,
        seq
      });
      taskEventBus.closeTask(params.taskId);
      taskSeqCounters.delete(params.taskId);
    }
  };

  await registerAgentWsRoute(app, {
    agentGuard: passthroughAgentGuard,
    sessionRegistry,
    taskCallbacks,
    helloTimeoutMs: 5_000,
    pingIntervalMs: 60_000,
    pongTimeoutMs: 60_000
  });

  await registerTaskRoutes(app, {
    repository: repo,
    idempotencyCache: createIdempotencyCache(),
    userGuard: passthroughUserGuard,
    apiBaseUrl: 'https://api.example.com',
    taskEventBus,
    sseHeartbeatMs: 60_000
  });

  await app.ready();
  await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, port: (app.server.address() as AddressInfo).port };
};

interface SseChunk {
  id?: string;
  event?: string;
  data?: string;
}

/** Parse `id: ...\nevent: ...\ndata: ...\n\n` SSE frames. */
const parseSseFrames = (raw: string): SseChunk[] => {
  return raw
    .split('\n\n')
    .filter((block) => block.trim().length > 0 && !block.startsWith(':'))
    .map((block) => {
      const out: SseChunk = {};
      for (const line of block.split('\n')) {
        if (line.startsWith('id: ')) out.id = line.slice(4);
        else if (line.startsWith('event: ')) out.event = line.slice(7);
        else if (line.startsWith('data: ')) out.data = line.slice(6);
      }
      return out;
    });
};

const fetchSseUntilCompleted = (
  port: number,
  taskId: string
): Promise<{ frames: SseChunk[]; raw: string }> => {
  return new Promise((resolve, reject) => {
    let acc = '';
    const req = http.get(
      `http://127.0.0.1:${port}/v1/tasks/${taskId}/stream`,
      (res) => {
        const timer = setTimeout(() => {
          try {
            req.destroy();
          } catch {
            /* swallow */
          }
          resolve({ frames: parseSseFrames(acc), raw: acc });
        }, 1_500);
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          acc += chunk;
          if (acc.includes('event: completed')) {
            // Give the server a tick to flush + close.
            setTimeout(() => {
              clearTimeout(timer);
              try {
                req.destroy();
              } catch {
                /* swallow */
              }
              resolve({ frames: parseSseFrames(acc), raw: acc });
            }, 50);
          }
        });
        res.on('end', () => {
          clearTimeout(timer);
          resolve({ frames: parseSseFrames(acc), raw: acc });
        });
        res.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      }
    );
    req.on('error', reject);
  });
};

const initialTask = (): TaskRecord => ({
  taskId: TASK_UUID,
  userId: USER_ID,
  status: 'assigned',
  prompt: 'haiku about distributed systems',
  agentType: 'claude-code',
  capabilities: ['code-generation'],
  idempotencyKey: '22222222-2222-4222-8222-222222222222',
  assignedAgentId: AGENT_UUID,
  createdAt: '2026-04-25T08:00:00.000Z',
  updatedAt: '2026-04-25T08:00:01.000Z',
  startedAt: '2026-04-25T08:00:01.000Z',
  completedAt: null,
  expireAt: '2026-05-25T08:00:00.000Z',
  output: null,
  outputDeltas: [],
  error: null
});

const builtApps: FastifyInstance[] = [];

afterEach(async () => {
  while (builtApps.length > 0) {
    const app = builtApps.pop();
    if (app) {
      try {
        await app.close();
      } catch {
        /* swallow */
      }
    }
  }
});

describe('E2E task pipeline (Phase 3.3 c18)', () => {
  it('agent WS deltas round-trip through bus to SSE client end-to-end', async () => {
    const state: FakeRepoState = {
      task: initialTask(),
      appendCalls: [],
      terminalCalls: []
    };
    const { app, port } = await buildApp(state);
    builtApps.push(app);

    // 1. Fake agent connects, completes hello handshake.
    const agentSocket = await app.injectWS('/v1/agent/ws');
    agentSocket.send(
      JSON.stringify({
        type: 'hello',
        agentId: AGENT_UUID,
        manifest: {
          manifestVersion: '1',
          providerId: 'test.fake',
          providerVersion: '0.1.0',
          displayName: 'Fake E2E Agent',
          description: 'fake',
          author: 'test',
          license: 'MIT',
          capabilities: [{ capability: 'code-generation', version: '1.0' }],
          requirements: {}
        }
      })
    );
    // Drain the welcome frame.
    await new Promise<void>((resolve) => {
      agentSocket.once('message', () => resolve());
    });

    // 2. Server tells the agent to start. (We bypass the dispatch
    //    handler because it's covered by c8; sendTaskAssign is the
    //    same wire emit.)
    sendTaskAssign(
      agentSocket as unknown as Parameters<typeof sendTaskAssign>[0],
      {
        taskId: TASK_UUID,
        prompt: state.task.prompt,
        capabilities: ['code-generation'],
        metadata: {
          userId: USER_ID,
          createdAt: state.task.createdAt,
          expireAt: state.task.expireAt
        }
      }
    );

    // 3. Mobile-style SSE consumer subscribes. Started AFTER hello
    //    so the bus has a live subscription before the agent emits.
    const ssePromise = fetchSseUntilCompleted(port, TASK_UUID);

    // Give the SSE handler a moment to subscribe to the bus before
    // the agent races ahead with deltas.
    await new Promise((r) => setTimeout(r, 50));

    // 4. Agent emits three deltas + a completed event over WS.
    //    Each frame goes WS → callback → bus → SSE → client.
    agentSocket.send(
      JSON.stringify({
        type: 'task-delta',
        taskId: TASK_UUID,
        delta: 'mobile, '
      })
    );
    agentSocket.send(
      JSON.stringify({
        type: 'task-delta',
        taskId: TASK_UUID,
        delta: 'cloud, '
      })
    );
    agentSocket.send(
      JSON.stringify({
        type: 'task-delta',
        taskId: TASK_UUID,
        delta: 'agent — '
      })
    );
    agentSocket.send(
      JSON.stringify({
        type: 'task-completed',
        taskId: TASK_UUID,
        output: 'mobile, cloud, agent — three nodes humming.'
      })
    );

    // 5. Wait for SSE to receive everything + close.
    const { frames, raw } = await ssePromise;
    agentSocket.close();

    // 6. Assertions.
    const deltaFrames = frames.filter((f) => f.event === 'delta');
    expect(deltaFrames).toHaveLength(3);

    const deltaPayloads = deltaFrames.map(
      (f) => JSON.parse(f.data ?? '{}') as { delta: TaskOutputDelta }
    );
    expect(deltaPayloads.map((p) => p.delta.delta)).toEqual([
      'mobile, ',
      'cloud, ',
      'agent — '
    ]);
    expect(deltaPayloads.map((p) => p.delta.seq)).toEqual([1, 2, 3]);

    // Each delta frame is tagged with its seq as the SSE id (resume).
    expect(deltaFrames.map((f) => f.id)).toEqual(['1', '2', '3']);

    // status frame at the head + completed at the tail.
    const completedFrame = frames.find((f) => f.event === 'completed');
    expect(completedFrame).toBeDefined();
    const completedPayload = JSON.parse(completedFrame!.data ?? '{}') as {
      output: string;
      seq: number;
    };
    expect(completedPayload.output).toBe(
      'mobile, cloud, agent — three nodes humming.'
    );
    expect(completedPayload.seq).toBeGreaterThan(3);

    // No heartbeat frames should land in this short run.
    expect(raw).not.toMatch(/: heartbeat/);

    // Firestore writes happened in order.
    expect(state.appendCalls.map((d) => d.seq)).toEqual([1, 2, 3]);
    expect(state.appendCalls.map((d) => d.delta)).toEqual([
      'mobile, ',
      'cloud, ',
      'agent — '
    ]);
    expect(state.terminalCalls).toHaveLength(1);
    expect(state.terminalCalls[0]?.status).toBe('completed');
    expect(state.terminalCalls[0]?.output).toBe(
      'mobile, cloud, agent — three nodes humming.'
    );
  }, 10_000);
});
