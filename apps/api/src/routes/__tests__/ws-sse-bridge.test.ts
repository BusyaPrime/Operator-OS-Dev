import fastifyWebsocket from '@fastify/websocket';
import fastify from 'fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentSessionRegistry } from '../../services/agent-session-registry.js';
import {
  registerAgentWsRoute,
  type AgentWsTaskCallbacks
} from '../agent-ws.js';
import {
  createTaskEventBus,
  type TaskEventBus,
  type TaskStreamEvent
} from '../../services/task-event-bus.js';

const AGENT_UUID = '00000000-0000-4000-8000-0000000000cc';
const TASK_UUID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const validHelloFrame = () => ({
  type: 'hello',
  agentId: AGENT_UUID,
  manifest: {
    manifestVersion: '1',
    providerId: 'test.provider',
    providerVersion: '0.1.0',
    displayName: 'Test',
    description: 'test',
    author: 'test',
    license: 'MIT',
    capabilities: [],
    requirements: {}
  }
});

const recvOne = <T = unknown>(socket: {
  once(event: 'message', cb: (data: unknown) => void): void;
}): Promise<T> =>
  new Promise<T>((resolve) => {
    socket.once('message', (data: unknown) => {
      const text =
        typeof data === 'string'
          ? data
          : (data as { toString(): string }).toString();
      resolve(JSON.parse(text) as T);
    });
  });

const allowGuard = async (
  _request: FastifyRequest,
  _reply: FastifyReply
) => {
  // pass-through
};

interface BuiltApp {
  app: Awaited<ReturnType<typeof fastify>>;
  bus: TaskEventBus;
  repository: {
    appendTaskDelta: ReturnType<typeof vi.fn>;
    updateTask: ReturnType<typeof vi.fn>;
    setTaskTerminal: ReturnType<typeof vi.fn>;
  };
  scheduler: { scheduleRetry: ReturnType<typeof vi.fn> };
}

const buildApp = async (): Promise<BuiltApp> => {
  const app = fastify({ logger: false });
  await app.register(fastifyWebsocket);

  const registry = createAgentSessionRegistry();
  const bus = createTaskEventBus();
  const repository = {
    appendTaskDelta: vi.fn().mockResolvedValue({ appended: true }),
    updateTask: vi.fn().mockResolvedValue({ updated: true }),
    setTaskTerminal: vi.fn().mockResolvedValue({ updated: true })
  };
  const scheduler = {
    scheduleRetry: vi
      .fn()
      .mockResolvedValue({ scheduled: true, mode: 'cloud-tasks' })
  };

  // Mini composition mirroring app.ts taskCallbacks (Phase 3.3 c5).
  const seqCounters = new Map<string, number>();
  const nextSeq = (taskId: string): number => {
    const next = (seqCounters.get(taskId) ?? 0) + 1;
    seqCounters.set(taskId, next);
    return next;
  };

  const taskCallbacks: AgentWsTaskCallbacks = {
    async onTaskAccepted(params) {
      const seq = nextSeq(params.taskId);
      bus.publish(params.taskId, {
        kind: 'status',
        status: 'executing',
        seq
      });
      await repository.updateTask(params.taskId, { status: 'executing' });
    },
    async onTaskRejected(params) {
      const reason = params.reason ?? '';
      if (reason.includes('already-executing')) {
        // NOTE 3 — no-op, intentionally do not re-queue or schedule retry.
        return;
      }
      await repository.updateTask(params.taskId, {
        status: 'queued',
        assignedAgentId: null
      });
      await scheduler.scheduleRetry({
        taskId: params.taskId,
        attempt: 1
      });
    },
    async onTaskDelta(params) {
      const seq = nextSeq(params.taskId);
      const deltaText =
        typeof params.delta === 'string'
          ? params.delta
          : JSON.stringify(params.delta ?? '');
      const delta = {
        seq,
        delta: deltaText,
        timestamp: '2026-04-25T08:00:00.000Z'
      };
      await repository.appendTaskDelta(params.taskId, delta);
      bus.publish(params.taskId, { kind: 'delta', delta });
    },
    async onTaskCompleted(params) {
      const seq = nextSeq(params.taskId);
      const outputText =
        typeof params.output === 'string'
          ? params.output
          : JSON.stringify(params.output ?? '');
      await repository.setTaskTerminal(params.taskId, {
        status: 'completed',
        output: outputText
      });
      bus.publish(params.taskId, {
        kind: 'completed',
        output: outputText,
        seq
      });
      bus.closeTask(params.taskId);
    },
    async onTaskFailed(params) {
      const seq = nextSeq(params.taskId);
      const error =
        params.error &&
        typeof params.error === 'object' &&
        'code' in (params.error as object)
          ? (params.error as { code: string; message: string })
          : {
              code: 'agent_error',
              message:
                typeof params.error === 'string'
                  ? params.error
                  : 'unknown'
            };
      await repository.setTaskTerminal(params.taskId, {
        status: 'failed',
        error
      });
      bus.publish(params.taskId, { kind: 'failed', error, seq });
      bus.closeTask(params.taskId);
    }
  };

  await registerAgentWsRoute(app, {
    agentGuard: allowGuard,
    sessionRegistry: registry,
    taskCallbacks,
    pingIntervalMs: 60_000,
    pongTimeoutMs: 120_000,
    helloTimeoutMs: 10_000
  });
  await app.ready();
  return { app, bus, repository, scheduler };
};

const completeHello = async (app: BuiltApp['app']) => {
  const socket = await app.injectWS('/v1/agent/ws');
  socket.send(JSON.stringify(validHelloFrame()));
  await recvOne(socket); // consume welcome
  return socket;
};

describe('WS task-channel callbacks → event bus bridge', () => {
  let ctx: BuiltApp;

  beforeEach(async () => {
    ctx = await buildApp();
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('forwards task-delta to subscribers and persists via appendTaskDelta', async () => {
    const events: TaskStreamEvent[] = [];
    ctx.bus.subscribe(TASK_UUID, (e) => events.push(e));

    const socket = await completeHello(ctx.app);
    socket.send(
      JSON.stringify({
        type: 'task-delta',
        taskId: TASK_UUID,
        delta: 'partial-output'
      })
    );

    await new Promise((r) => setTimeout(r, 30));

    expect(ctx.repository.appendTaskDelta).toHaveBeenCalledOnce();
    expect(ctx.repository.appendTaskDelta).toHaveBeenCalledWith(
      TASK_UUID,
      expect.objectContaining({ seq: 1, delta: 'partial-output' })
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'delta',
      delta: { seq: 1, delta: 'partial-output' }
    });

    socket.close();
  });

  it('forwards task-completed: emits terminal event, closes the bus, drops subscribers', async () => {
    const events: TaskStreamEvent[] = [];
    ctx.bus.subscribe(TASK_UUID, (e) => events.push(e));

    const socket = await completeHello(ctx.app);
    socket.send(
      JSON.stringify({
        type: 'task-completed',
        taskId: TASK_UUID,
        output: 'final answer'
      })
    );

    await new Promise((r) => setTimeout(r, 30));

    expect(ctx.repository.setTaskTerminal).toHaveBeenCalledWith(
      TASK_UUID,
      expect.objectContaining({ status: 'completed', output: 'final answer' })
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'completed',
      output: 'final answer'
    });
    // Bus closed → subscriber count must be 0 even though we never
    // explicitly unsubscribed.
    expect(ctx.bus.subscriberCount(TASK_UUID)).toBe(0);

    socket.close();
  });

  it('forwards task-failed with structured error and closes the bus', async () => {
    const events: TaskStreamEvent[] = [];
    ctx.bus.subscribe(TASK_UUID, (e) => events.push(e));

    const socket = await completeHello(ctx.app);
    socket.send(
      JSON.stringify({
        type: 'task-failed',
        taskId: TASK_UUID,
        error: { code: 'rate_limit', message: 'Anthropic rate limit hit' }
      })
    );

    await new Promise((r) => setTimeout(r, 30));

    expect(ctx.repository.setTaskTerminal).toHaveBeenCalledWith(
      TASK_UUID,
      expect.objectContaining({
        status: 'failed',
        error: { code: 'rate_limit', message: 'Anthropic rate limit hit' }
      })
    );
    expect(events[0]).toMatchObject({
      kind: 'failed',
      error: { code: 'rate_limit', message: 'Anthropic rate limit hit' }
    });
    expect(ctx.bus.subscriberCount(TASK_UUID)).toBe(0);

    socket.close();
  });

  it('NOTE 3: task-rejected with already-executing reason is a no-op (no Firestore write, no scheduleRetry)', async () => {
    const socket = await completeHello(ctx.app);
    socket.send(
      JSON.stringify({
        type: 'task-rejected',
        taskId: TASK_UUID,
        reason: 'capability-mismatch: code-generation already-executing'
      })
    );

    await new Promise((r) => setTimeout(r, 30));

    expect(ctx.repository.updateTask).not.toHaveBeenCalled();
    expect(ctx.scheduler.scheduleRetry).not.toHaveBeenCalled();

    socket.close();
  });

  it('task-rejected with non-already-executing reason re-queues and schedules retry', async () => {
    const socket = await completeHello(ctx.app);
    socket.send(
      JSON.stringify({
        type: 'task-rejected',
        taskId: TASK_UUID,
        reason: 'agent busy with other task'
      })
    );

    await new Promise((r) => setTimeout(r, 30));

    expect(ctx.repository.updateTask).toHaveBeenCalledWith(
      TASK_UUID,
      expect.objectContaining({ status: 'queued', assignedAgentId: null })
    );
    expect(ctx.scheduler.scheduleRetry).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: TASK_UUID, attempt: 1 })
    );

    socket.close();
  });

  it('multi-subscriber fan-out: every active subscriber receives the delta', async () => {
    const a: TaskStreamEvent[] = [];
    const b: TaskStreamEvent[] = [];
    ctx.bus.subscribe(TASK_UUID, (e) => a.push(e));
    ctx.bus.subscribe(TASK_UUID, (e) => b.push(e));

    const socket = await completeHello(ctx.app);
    socket.send(
      JSON.stringify({
        type: 'task-delta',
        taskId: TASK_UUID,
        delta: 'shared'
      })
    );

    await new Promise((r) => setTimeout(r, 30));

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]).toEqual(b[0]);

    socket.close();
  });
});
