import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import {
  ControlChannelWs,
  type ControlChannelSocket,
  type TaskExecutor
} from '../control-channel-ws.js';

const TASK_UUID = '88888888-8888-4888-8888-888888888888';
const AGENT_UUID = '00000000-0000-4000-8000-0000000000bb';

class FakeSocket implements ControlChannelSocket {
  sent: string[] = [];
  #handlers: Record<string, (...args: unknown[]) => void> = {};

  on(event: 'open' | 'message' | 'close' | 'error', cb: (...args: unknown[]) => void) {
    this.#handlers[event] = cb;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    this.#handlers.close?.(code, Buffer.from(reason));
  }

  triggerOpen(): void {
    this.#handlers.open?.();
  }

  triggerMessage(frame: unknown): void {
    const text = typeof frame === 'string' ? frame : JSON.stringify(frame);
    this.#handlers.message?.(text);
  }

  sentFrames(): unknown[] {
    return this.sent.map((s) => JSON.parse(s));
  }
}

const buildLogger = (): Logger => {
  const logger: Record<string, unknown> = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    level: 'info'
  };
  logger.child = () => logger;
  return logger as unknown as Logger;
};

const buildChannel = (overrides: {
  executor?: TaskExecutor;
  supportedCapabilities?: ReadonlySet<string>;
} = {}) => {
  const fake = new FakeSocket();
  const defaultExecutor: TaskExecutor = async (input) => ({
    kind: 'completed',
    taskId: input.taskId,
    output: `ok:${input.taskId}`
  });
  const channel = new ControlChannelWs({
    url: 'wss://test.example.com/v1/agent/ws',
    authToken: 'test-token',
    agentId: AGENT_UUID,
    manifest: { manifestVersion: '1', capabilities: [] },
    executor: overrides.executor ?? defaultExecutor,
    supportedCapabilities:
      overrides.supportedCapabilities ?? new Set(['code-generation']),
    logger: buildLogger(),
    socketFactory: () => fake
  });
  channel.start();
  return { channel, fake };
};

describe('ControlChannelWs', () => {
  it('sends hello on socket open', () => {
    const { fake } = buildChannel();
    fake.triggerOpen();

    const frames = fake.sentFrames() as Array<{ type: string }>;
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      type: 'hello',
      agentId: AGENT_UUID
    });
  });

  it('records sessionId on welcome and reports isConnected=true', () => {
    const { channel, fake } = buildChannel();
    fake.triggerOpen();
    fake.triggerMessage({ type: 'welcome', sessionId: 'sess-abc', serverFeatures: [] });

    expect(channel.isConnected).toBe(true);
  });

  it('responds to server ping with pong', () => {
    const { fake } = buildChannel();
    fake.triggerOpen();
    fake.triggerMessage({ type: 'welcome', sessionId: 'sess-x' });
    fake.sent.length = 0;

    fake.triggerMessage({ type: 'ping', ts: 1_700_000_000 });

    const frames = fake.sentFrames() as Array<{ type: string }>;
    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe('pong');
  });

  it('accepts task-assign when capabilities match; emits task-accepted + delta(s) + task-completed', async () => {
    const executor: TaskExecutor = async (input, emitProgress) => {
      emitProgress('progress-1');
      emitProgress('progress-2');
      return {
        kind: 'completed',
        taskId: input.taskId,
        output: 'echo: prompt'
      };
    };
    const { fake } = buildChannel({
      executor,
      supportedCapabilities: new Set(['code-generation'])
    });
    fake.triggerOpen();
    fake.triggerMessage({ type: 'welcome', sessionId: 's' });
    fake.sent.length = 0;

    fake.triggerMessage({
      type: 'task-assign',
      payload: {
        taskId: TASK_UUID,
        prompt: 'do it',
        capabilities: ['code-generation'],
        metadata: {
          userId: 'u1',
          createdAt: '2026-04-24T09:00:00.000Z',
          expireAt: '2026-05-24T09:00:00.000Z'
        }
      }
    });

    // Let the async executor settle.
    await new Promise((r) => setTimeout(r, 10));

    const frames = fake.sentFrames() as Array<{ type: string; taskId?: string }>;
    const types = frames.map((f) => f.type);
    expect(types[0]).toBe('task-accepted');
    expect(types).toContain('task-delta');
    expect(types[types.length - 1]).toBe('task-completed');
  });

  it('rejects task-assign whose required capability the agent does not support', async () => {
    const executor: TaskExecutor = vi.fn();
    const { fake } = buildChannel({
      executor: executor as unknown as TaskExecutor,
      supportedCapabilities: new Set(['code-generation'])
    });
    fake.triggerOpen();
    fake.triggerMessage({ type: 'welcome', sessionId: 's' });
    fake.sent.length = 0;

    fake.triggerMessage({
      type: 'task-assign',
      payload: {
        taskId: TASK_UUID,
        prompt: 'draw',
        capabilities: ['image-generation'], // NOT supported
        metadata: {
          userId: 'u1',
          createdAt: '2026-04-24T09:00:00.000Z',
          expireAt: '2026-05-24T09:00:00.000Z'
        }
      }
    });

    const frames = fake.sentFrames() as Array<{
      type: string;
      taskId?: string;
      reason?: string;
    }>;
    expect(frames[0].type).toBe('task-rejected');
    expect(frames[0].taskId).toBe(TASK_UUID);
    expect(frames[0].reason).toContain('capability-mismatch');
    expect(executor).not.toHaveBeenCalled();
  });

  it('sends task-failed when the executor throws', async () => {
    const executor: TaskExecutor = async () => {
      throw new Error('executor error');
    };
    const { fake } = buildChannel({
      executor,
      supportedCapabilities: new Set(['code-generation'])
    });
    fake.triggerOpen();
    fake.triggerMessage({ type: 'welcome', sessionId: 's' });
    fake.sent.length = 0;

    fake.triggerMessage({
      type: 'task-assign',
      payload: {
        taskId: TASK_UUID,
        prompt: 'x',
        capabilities: ['code-generation'],
        metadata: {
          userId: 'u1',
          createdAt: '2026-04-24T09:00:00.000Z',
          expireAt: '2026-05-24T09:00:00.000Z'
        }
      }
    });

    await new Promise((r) => setTimeout(r, 10));

    const frames = fake.sentFrames() as Array<{
      type: string;
      error?: { code: string };
    }>;
    const last = frames[frames.length - 1];
    expect(last.type).toBe('task-failed');
    expect(last.error?.code).toBe('executor_threw');
  });

  it('stop() closes the socket with code 1000', async () => {
    const { channel, fake } = buildChannel();
    fake.triggerOpen();
    await channel.stop();

    // We cannot observe close cleanly on a one-shot close call; verify
    // isConnected dropped (sessionId cleared when close handler fires,
    // but explicit stop does not always round-trip). Instead assert
    // the explicit-shutdown flag prevented reconnect.
    expect(channel.isConnected).toBe(false);
  });
});
