import fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyReply
} from 'fastify';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TaskRecord } from '@operator-os/contracts';

import { createIdempotencyCache } from '../../services/idempotency-cache.js';
import {
  createTaskEventBus,
  type TaskEventBus
} from '../../services/task-event-bus.js';
import type { FirestoreOperatorRepository } from '../../integrations/firestore.js';
import { registerTaskRoutes } from '../tasks.js';

const TASK_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = 'test-user-1';

const passthroughGuard = async (
  request: FastifyRequest,
  _reply: FastifyReply
) => {
  (request as unknown as { currentUser: { operatorId: string } }).currentUser =
    { operatorId: USER };
};

const denyGuard = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  await reply.code(401).send({ code: 'unauthorized', message: 'no' });
};

interface BuildOptions {
  task?: TaskRecord;
  bus?: TaskEventBus | null;
  guard?: 'allow' | 'deny';
  heartbeatMs?: number;
}

const baseTask = (overrides: Partial<TaskRecord> = {}): TaskRecord => ({
  taskId: TASK_UUID,
  userId: USER,
  status: 'executing',
  prompt: 'do it',
  agentType: 'auto',
  capabilities: [],
  idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  assignedAgentId: null,
  createdAt: '2026-04-25T08:00:00.000Z',
  updatedAt: '2026-04-25T08:00:01.000Z',
  startedAt: '2026-04-25T08:00:01.000Z',
  completedAt: null,
  expireAt: '2026-05-25T08:00:00.000Z',
  output: null,
  outputDeltas: [],
  error: null,
  ...overrides
});

interface BuiltApp {
  app: FastifyInstance;
  bus: TaskEventBus | undefined;
  repository: { getTask: ReturnType<typeof vi.fn> };
  port: number;
}

const builtApps: BuiltApp[] = [];

afterEach(async () => {
  while (builtApps.length > 0) {
    const built = builtApps.pop();
    if (built) {
      try {
        await built.app.close();
      } catch {
        /* swallow */
      }
    }
  }
});

const buildApp = async (opts: BuildOptions = {}): Promise<BuiltApp> => {
  const app = fastify({ logger: false });
  const bus = opts.bus === undefined ? createTaskEventBus() : opts.bus;
  const repository = {
    getTask: vi.fn().mockResolvedValue(opts.task)
  };
  const guard = opts.guard === 'deny' ? denyGuard : passthroughGuard;

  await registerTaskRoutes(app, {
    repository: repository as unknown as FirestoreOperatorRepository,
    idempotencyCache: createIdempotencyCache(),
    userGuard: guard,
    apiBaseUrl: 'https://api.example.com',
    taskEventBus: bus ?? undefined,
    sseHeartbeatMs: opts.heartbeatMs ?? 25_000
  });
  await app.ready();
  await app.listen({ host: '127.0.0.1', port: 0 });
  const port = (app.server.address() as AddressInfo).port;
  const built: BuiltApp = {
    app,
    bus: bus ?? undefined,
    repository,
    port
  };
  builtApps.push(built);
  return built;
};

interface SseResult {
  statusCode: number;
  body: string;
  bodyJson?: unknown;
  contentType: string;
}

const fetchSse = (
  port: number,
  taskId: string,
  options: {
    headers?: Record<string, string>;
    waitFor?: (acc: string) => boolean;
    timeoutMs?: number;
    onChunk?: (acc: string) => void;
  } = {}
): Promise<SseResult> => {
  return new Promise((resolve, reject) => {
    let acc = '';
    const finalTimeoutMs = options.timeoutMs ?? 800;

    const req = http.get(
      `http://127.0.0.1:${port}/v1/tasks/${taskId}/stream`,
      { headers: options.headers ?? {} },
      (res) => {
        let finalTimer: NodeJS.Timeout | undefined;
        let resolved = false;

        const finish = () => {
          if (resolved) return;
          resolved = true;
          if (finalTimer) clearTimeout(finalTimer);
          const contentType = (
            res.headers['content-type'] ?? ''
          ) as string;
          const result: SseResult = {
            statusCode: res.statusCode ?? 0,
            body: acc,
            contentType
          };
          if (contentType.includes('application/json')) {
            try {
              result.bodyJson = JSON.parse(acc);
            } catch {
              /* swallow */
            }
          }
          resolve(result);
          try {
            req.destroy();
          } catch {
            /* swallow */
          }
        };

        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          acc += chunk;
          options.onChunk?.(acc);
          if (options.waitFor && options.waitFor(acc)) {
            finish();
          }
        });
        res.on('end', finish);
        res.on('error', (err) => {
          if (!resolved) {
            resolved = true;
            reject(err);
          }
        });
        finalTimer = setTimeout(finish, finalTimeoutMs);
      }
    );
    req.on('error', (err) => reject(err));
  });
};

describe('GET /v1/tasks/:taskId/stream — Phase 3.3 SSE handler', () => {
  it('returns 401 when userGuard denies', async () => {
    const { port } = await buildApp({ guard: 'deny' });
    const result = await fetchSse(port, TASK_UUID, {
      timeoutMs: 200
    });
    expect(result.statusCode).toBe(401);
  });

  it('returns 404 when the task does not exist or is not owned', async () => {
    const { port, repository } = await buildApp({ task: undefined });
    const result = await fetchSse(port, TASK_UUID, {
      timeoutMs: 200
    });
    expect(result.statusCode).toBe(404);
    expect(repository.getTask).toHaveBeenCalledWith(TASK_UUID, USER);
  });

  it('returns 503 when taskEventBus is not configured', async () => {
    const { port } = await buildApp({
      task: baseTask(),
      bus: null
    });
    const result = await fetchSse(port, TASK_UUID, { timeoutMs: 200 });
    expect(result.statusCode).toBe(503);
    expect(result.contentType).toContain('application/json');
    const json = result.bodyJson as { code: string };
    expect(json.code).toBe('stream_unavailable');
  });

  it('emits status frame on initial connection (no Last-Event-ID)', async () => {
    const { port } = await buildApp({
      task: baseTask({ status: 'executing' }),
      heartbeatMs: 60_000
    });
    const result = await fetchSse(port, TASK_UUID, {
      waitFor: (acc) => acc.includes('event: status'),
      timeoutMs: 500
    });
    expect(result.statusCode).toBe(200);
    expect(result.contentType).toContain('text/event-stream');
    expect(result.body).toMatch(/event: status\ndata: \{[^\n]*"status":"executing"/);
  });

  it('forwards live delta from bus to subscriber as SSE delta frame', async () => {
    const { bus, port } = await buildApp({
      task: baseTask({ status: 'streaming' }),
      heartbeatMs: 60_000
    });
    const liveBus = bus!;

    // Kick off the request, publish after the initial status frame.
    const promise = fetchSse(port, TASK_UUID, {
      waitFor: (acc) => acc.includes('"delta":"hello"'),
      timeoutMs: 800,
      onChunk: (acc) => {
        if (
          acc.includes('event: status') &&
          !acc.includes('"delta":"hello"')
        ) {
          liveBus.publish(TASK_UUID, {
            kind: 'delta',
            delta: {
              seq: 5,
              delta: 'hello',
              timestamp: '2026-04-25T08:00:02.000Z'
            }
          });
        }
      }
    });
    const result = await promise;
    expect(result.statusCode).toBe(200);
    expect(result.body).toMatch(/event: delta\ndata: \{[^\n]*"delta":"hello"/);
    expect(result.body).toMatch(/^id: 5$/m);
  });

  it('replays outputDeltas[seq > Last-Event-ID] before live subscription', async () => {
    const { port } = await buildApp({
      task: baseTask({
        status: 'streaming',
        outputDeltas: [
          { seq: 1, delta: 'a', timestamp: '2026-04-25T08:00:01Z' },
          { seq: 2, delta: 'b', timestamp: '2026-04-25T08:00:02Z' },
          { seq: 3, delta: 'c', timestamp: '2026-04-25T08:00:03Z' }
        ]
      }),
      heartbeatMs: 60_000
    });
    const result = await fetchSse(port, TASK_UUID, {
      headers: { 'Last-Event-ID': '1' },
      waitFor: (acc) =>
        acc.includes('"delta":"c"') && acc.includes('event: status'),
      timeoutMs: 500
    });
    expect(result.statusCode).toBe(200);
    expect(result.body).not.toMatch(/"delta":"a"/);
    expect(result.body).toMatch(/"delta":"b"/);
    expect(result.body).toMatch(/"delta":"c"/);
  });

  it('emits terminal completed event and closes immediately when task is already completed', async () => {
    const { port } = await buildApp({
      task: baseTask({
        status: 'completed',
        output: 'final-output',
        outputDeltas: []
      }),
      heartbeatMs: 60_000
    });
    const result = await fetchSse(port, TASK_UUID, { timeoutMs: 500 });
    expect(result.statusCode).toBe(200);
    expect(result.body).toMatch(/event: status\ndata: \{[^\n]*"status":"completed"/);
    expect(result.body).toMatch(/event: completed\ndata: \{[^\n]*"output":"final-output"/);
  });

  it('emits heartbeat comment frames at the configured interval', async () => {
    const { port } = await buildApp({
      task: baseTask({ status: 'executing' }),
      heartbeatMs: 50
    });
    const result = await fetchSse(port, TASK_UUID, {
      waitFor: (acc) => /:\s+heartbeat/.test(acc),
      timeoutMs: 600
    });
    expect(result.statusCode).toBe(200);
    expect(result.body).toMatch(/^: heartbeat /m);
  });

  it('handles a burst of 1000 deltas without dropping frames or crashing (NOTE 2 backpressure)', async () => {
    const { bus, port } = await buildApp({
      task: baseTask({ status: 'streaming' }),
      heartbeatMs: 60_000
    });
    const liveBus = bus!;
    const BURST = 1000;
    let burstFired = false;

    const result = await fetchSse(port, TASK_UUID, {
      timeoutMs: 4000,
      waitFor: (acc) => acc.includes(`"delta":"d${BURST - 1}"`),
      onChunk: (acc) => {
        if (!burstFired && acc.includes('event: status')) {
          burstFired = true;
          // Tight loop — synchronous publish of 1000 events. Exercises
          // the writeQueue + 'drain' flush path. Each delta is small;
          // total is ~80KB which exceeds the typical ~64KB kernel
          // buffer, so at least one drain cycle is exercised.
          for (let i = 0; i < BURST; i += 1) {
            liveBus.publish(TASK_UUID, {
              kind: 'delta',
              delta: {
                seq: i,
                delta: `d${i}`,
                timestamp: '2026-04-25T08:00:10.000Z'
              }
            });
          }
        }
      }
    });
    expect(result.statusCode).toBe(200);

    // Count the number of `event: delta` frames received. Expect all
    // BURST were delivered (no crash, no silent drops).
    const matches = result.body.match(/event: delta/g) ?? [];
    expect(matches.length).toBe(BURST);

    // Spot-check sequence integrity at boundaries.
    expect(result.body).toMatch(/"delta":"d0"/);
    expect(result.body).toMatch(/"delta":"d999"/);
  });

  it('cleans up the subscription when the client closes the connection', async () => {
    const { bus, port } = await buildApp({
      task: baseTask({ status: 'streaming' }),
      heartbeatMs: 60_000
    });
    const liveBus = bus!;

    // Open a stream, wait for status, then immediately abort.
    await fetchSse(port, TASK_UUID, {
      waitFor: (acc) => acc.includes('event: status'),
      timeoutMs: 300
    });

    // Give the server a moment to handle the 'close' event.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(liveBus.subscriberCount(TASK_UUID)).toBe(0);
  });
});
