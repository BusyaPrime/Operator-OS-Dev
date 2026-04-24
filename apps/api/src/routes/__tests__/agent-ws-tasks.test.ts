import fastifyWebsocket from '@fastify/websocket';
import fastify from 'fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { WebSocket as WsWebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentSessionRegistry } from '../../services/agent-session-registry.js';
import {
  registerAgentWsRoute,
  sendTaskAssign,
  type AgentWsTaskCallbacks,
  type TaskAssignPayload
} from '../agent-ws.js';

const AGENT_UUID = '00000000-0000-4000-8000-0000000000aa';
const TASK_UUID = '77777777-7777-4777-8777-777777777777';

const validManifest = (capabilities: unknown[] = []) => ({
  manifestVersion: '1',
  providerId: 'test.provider',
  providerVersion: '0.1.0',
  displayName: 'Test Agent',
  description: 'test',
  author: 'test',
  license: 'MIT',
  capabilities,
  requirements: {}
});

const validHelloFrame = (manifestOverride?: unknown) => ({
  type: 'hello',
  agentId: AGENT_UUID,
  manifest: manifestOverride ?? validManifest()
});

const allowAll = async (_req: FastifyRequest, _reply: FastifyReply) => {
  // no-op = bypass auth for WS-layer tests
};

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

const buildApp = async (callbacks?: AgentWsTaskCallbacks) => {
  const app = fastify({ logger: false });
  await app.register(fastifyWebsocket);
  const registry = createAgentSessionRegistry();
  await registerAgentWsRoute(app, {
    agentGuard: allowAll,
    sessionRegistry: registry,
    taskCallbacks: callbacks,
    pingIntervalMs: 60_000,
    pongTimeoutMs: 120_000,
    helloTimeoutMs: 10_000
  });
  await app.ready();
  return { app, registry };
};

describe('sendTaskAssign', () => {
  it('serialises {type:"task-assign", payload:{…}} to the socket', () => {
    const send = vi.fn();
    const socket = { send } as unknown as WsWebSocket;
    const payload: TaskAssignPayload = {
      taskId: TASK_UUID,
      prompt: 'do the thing',
      capabilities: ['code-generation'],
      metadata: {
        userId: 'u1',
        createdAt: '2026-04-24T07:00:00.000Z',
        expireAt: '2026-05-24T07:00:00.000Z'
      }
    };

    const ok = sendTaskAssign(socket, payload);

    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0]?.[0] as string;
    expect(JSON.parse(sent)).toEqual({ type: 'task-assign', payload });
  });

  it('returns false when socket.send throws (caller re-dispatches)', () => {
    const send = vi.fn().mockImplementation(() => {
      throw new Error('socket closed');
    });
    const socket = { send } as unknown as WsWebSocket;
    const payload: TaskAssignPayload = {
      taskId: TASK_UUID,
      prompt: 'x',
      capabilities: [],
      metadata: {
        userId: 'u',
        createdAt: '2026-04-24T07:00:00.000Z',
        expireAt: '2026-05-24T07:00:00.000Z'
      }
    };

    const ok = sendTaskAssign(socket, payload);

    expect(ok).toBe(false);
  });
});

describe('agent-ws hello manifest validation (Phase 3.2)', () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    ctx = await buildApp();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('accepts a valid hello → welcome for a manifest with zero capabilities', async () => {
    const socket = await ctx.app.injectWS('/v1/agent/ws');
    socket.send(JSON.stringify(validHelloFrame()));
    const welcome = await recvOne<{ type: string }>(socket);
    expect(welcome.type).toBe('welcome');
    socket.close();
  });

  it('accepts a hello with a valid CapabilityDescriptor', async () => {
    const socket = await ctx.app.injectWS('/v1/agent/ws');
    socket.send(
      JSON.stringify(
        validHelloFrame(
          validManifest([{ capability: 'code-generation', version: '1.0' }])
        )
      )
    );
    const welcome = await recvOne<{ type: string }>(socket);
    expect(welcome.type).toBe('welcome');
    socket.close();
  });

  it('closes 4002 manifest-invalid when a capability is an opaque primitive', async () => {
    const socket = await ctx.app.injectWS('/v1/agent/ws');
    socket.send(
      JSON.stringify(
        validHelloFrame(validManifest(['code-generation'])) // string, not CapabilityDescriptor
      )
    );
    const errorFrame = await recvOne<{ type: string; code: string }>(socket);
    expect(errorFrame.type).toBe('error');
    expect(errorFrame.code).toBe('manifest-invalid');
    await new Promise<void>((resolve) => {
      socket.once('close', (code: number) => {
        expect(code).toBe(4002);
        resolve();
      });
    });
  });

  it('closes 4002 manifest-invalid when capability name is unknown enum value', async () => {
    const socket = await ctx.app.injectWS('/v1/agent/ws');
    socket.send(
      JSON.stringify(
        validHelloFrame(
          validManifest([
            { capability: 'not-in-the-enum', version: '1.0' }
          ])
        )
      )
    );
    const errorFrame = await recvOne<{ type: string; code: string }>(socket);
    expect(errorFrame.code).toBe('manifest-invalid');
  });
});

describe('agent-ws task-accepted / task-rejected callback dispatch', () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>;
  let onTaskAccepted: ReturnType<typeof vi.fn>;
  let onTaskRejected: ReturnType<typeof vi.fn>;

  const completeHello = async (app: typeof ctx.app) => {
    const socket = await app.injectWS('/v1/agent/ws');
    socket.send(JSON.stringify(validHelloFrame()));
    await recvOne(socket); // consume welcome
    return socket;
  };

  beforeEach(async () => {
    onTaskAccepted = vi.fn();
    onTaskRejected = vi.fn();
    ctx = await buildApp({ onTaskAccepted, onTaskRejected });
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('invokes onTaskAccepted with {sessionId, agentId, taskId}', async () => {
    const socket = await completeHello(ctx.app);
    socket.send(JSON.stringify({ type: 'task-accepted', taskId: TASK_UUID }));

    await new Promise((r) => setTimeout(r, 30));

    expect(onTaskAccepted).toHaveBeenCalledTimes(1);
    const call = onTaskAccepted.mock.calls[0]?.[0];
    expect(call.taskId).toBe(TASK_UUID);
    expect(call.agentId).toBe(AGENT_UUID);
    expect(typeof call.sessionId).toBe('string');
    socket.close();
  });

  it('invokes onTaskRejected with reason', async () => {
    const socket = await completeHello(ctx.app);
    socket.send(
      JSON.stringify({
        type: 'task-rejected',
        taskId: TASK_UUID,
        reason: 'agent busy'
      })
    );

    await new Promise((r) => setTimeout(r, 30));

    expect(onTaskRejected).toHaveBeenCalledTimes(1);
    const call = onTaskRejected.mock.calls[0]?.[0];
    expect(call.taskId).toBe(TASK_UUID);
    expect(call.reason).toBe('agent busy');
    socket.close();
  });

  it('accepts task-rejected without a reason', async () => {
    const socket = await completeHello(ctx.app);
    socket.send(JSON.stringify({ type: 'task-rejected', taskId: TASK_UUID }));

    await new Promise((r) => setTimeout(r, 30));

    expect(onTaskRejected).toHaveBeenCalledTimes(1);
    const call = onTaskRejected.mock.calls[0]?.[0];
    expect(call.reason).toBeUndefined();
    socket.close();
  });

  it('does not crash the WS when onTaskAccepted throws', async () => {
    const throwingOnAccepted = vi.fn().mockRejectedValue(
      new Error('callback failure')
    );
    const localApp = await buildApp({
      onTaskAccepted: throwingOnAccepted
    });
    const socket = await completeHello(localApp.app);
    socket.send(JSON.stringify({ type: 'task-accepted', taskId: TASK_UUID }));

    // If the callback throw collapsed the WS, this next frame would
    // also fail. Send a heartbeat-ping and wait a tick — no crash
    // signal = pass.
    socket.send(JSON.stringify({ type: 'heartbeat-ping' }));
    await new Promise((r) => setTimeout(r, 30));

    expect(throwingOnAccepted).toHaveBeenCalled();
    socket.close();
    await localApp.app.close();
  });
});
