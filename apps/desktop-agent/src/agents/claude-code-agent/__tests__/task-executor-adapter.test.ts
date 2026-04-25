import type {
  AIAgentTaskInput,
  StreamConfig
} from '@operator-os/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { TaskAssignInput } from '../../../providers/control-channel-ws.js';
import {
  CapturingStreamProvider,
  createClaudeCodeAgentExecutor,
  type ExecutableAgent
} from '../task-executor-adapter.js';

const TASK_UUID = '12345678-1234-4234-8234-123456789012';

const buildInput = (
  overrides: Partial<TaskAssignInput> = {}
): TaskAssignInput => ({
  taskId: TASK_UUID,
  prompt: 'sum two numbers',
  capabilities: ['code-generation'],
  metadata: {
    userId: 'u-1',
    createdAt: '2026-04-25T13:00:00.000Z',
    expireAt: '2026-05-25T13:00:00.000Z'
  },
  ...overrides
});

interface AgentDriver {
  agent: ExecutableAgent;
  /** Captured input from executeTask. */
  capturedInput?: AIAgentTaskInput;
  /** Setter for the simulated work the agent performs. */
  setWork(fn: (config: StreamConfig) => Promise<void>): void;
}

const buildFakeAgent = (provider: CapturingStreamProvider): AgentDriver => {
  let work: ((config: StreamConfig) => Promise<void>) | undefined;
  let settlePromise: Promise<void> = Promise.resolve();
  let capturedInput: AIAgentTaskInput | undefined;

  const agent: ExecutableAgent = {
    executeTask: vi.fn(async (input: AIAgentTaskInput) => {
      capturedInput = input;
      // Simulate the agent calling streamProvider.createStream + emitting.
      settlePromise = (async () => {
        const stream = provider.createStream({
          taskId: input.taskId,
          userId: 'u-1',
          transport: 'websocket'
        });
        if (work) await work({ taskId: input.taskId, userId: 'u-1', transport: 'websocket' });
        // Note: stream is created but the work fn drives emits using
        // the SAME provider so it picks up the same state.
        return stream;
      })();
      return { taskId: input.taskId, status: 'running', startedAt: new Date().toISOString() };
    }),
    awaitSettled: vi.fn(async () => {
      await settlePromise;
    })
  };

  return {
    agent,
    get capturedInput() {
      return capturedInput;
    },
    setWork(fn) {
      work = fn;
    }
  };
};

describe('createClaudeCodeAgentExecutor', () => {
  it('maps capabilities -> AIAgentTaskType via the default resolver and forwards the prompt', async () => {
    const provider = new CapturingStreamProvider();
    const driver = buildFakeAgent(provider);
    driver.setWork(async (config) => {
      const stream = provider.createStream(config);
      await stream.emitDelta({ type: 'answer', content: 'ok' });
      await stream.emitCompletion({
        status: 'success',
        usage: {
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
          costUsd: 0
        }
      });
      await stream.close('completed');
    });
    const executor = createClaudeCodeAgentExecutor({
      agent: driver.agent,
      streamProvider: provider
    });

    const result = await executor(
      buildInput({ capabilities: ['planning'] }),
      () => undefined
    );

    expect(result.kind).toBe('completed');
    expect(driver.capturedInput).toEqual(
      expect.objectContaining({
        taskId: TASK_UUID,
        type: 'plan', // planning -> plan
        prompt: 'sum two numbers'
      })
    );
  });

  it('forwards stream delta + token + tool-call text to emitProgress', async () => {
    const provider = new CapturingStreamProvider();
    const driver = buildFakeAgent(provider);
    driver.setWork(async (config) => {
      const stream = provider.createStream(config);
      await stream.emitDelta({ type: 'answer', content: 'hello ' });
      await stream.emitToken('world');
      await stream.emitToolCall({
        toolName: 'bash',
        arguments: { cmd: 'ls' },
        status: 'completed'
      });
      await stream.emitCompletion({
        status: 'success',
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0
        }
      });
      await stream.close('completed');
    });
    const progressCalls: string[] = [];
    const executor = createClaudeCodeAgentExecutor({
      agent: driver.agent,
      streamProvider: provider
    });

    const result = await executor(buildInput(), (text) =>
      progressCalls.push(text)
    );

    expect(result.kind).toBe('completed');
    expect(progressCalls[0]).toBe('hello ');
    expect(progressCalls[1]).toBe('world');
    expect(progressCalls[2]).toContain('"tool":"bash"');
    if (result.kind === 'completed') {
      expect(result.output).toContain('hello ');
      expect(result.output).toContain('world');
    }
  });

  it('returns kind=failed when the captured stream emits an error', async () => {
    const provider = new CapturingStreamProvider();
    const driver = buildFakeAgent(provider);
    driver.setWork(async (config) => {
      const stream = provider.createStream(config);
      await stream.emitError({
        code: 'CLAUDE_EXIT_NONZERO',
        message: 'subprocess exited with code 1',
        fatal: true
      });
      await stream.close('error');
    });
    const executor = createClaudeCodeAgentExecutor({
      agent: driver.agent,
      streamProvider: provider
    });

    const result = await executor(buildInput(), () => undefined);

    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error.code).toBe('CLAUDE_EXIT_NONZERO');
      expect(result.error.message).toContain('subprocess');
    }
  });

  it('returns kind=failed when completion.status is failed', async () => {
    const provider = new CapturingStreamProvider();
    const driver = buildFakeAgent(provider);
    driver.setWork(async (config) => {
      const stream = provider.createStream(config);
      await stream.emitCompletion({
        status: 'failed',
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0
        }
      });
      await stream.close('completed');
    });
    const executor = createClaudeCodeAgentExecutor({
      agent: driver.agent,
      streamProvider: provider
    });

    const result = await executor(buildInput(), () => undefined);

    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error.code).toBe('AGENT_COMPLETION_FAILED');
    }
  });

  it('returns kind=failed when agent.executeTask itself throws', async () => {
    const provider = new CapturingStreamProvider();
    const agent: ExecutableAgent = {
      executeTask: vi.fn().mockRejectedValue(new Error('binary not found')),
      awaitSettled: vi.fn().mockResolvedValue(undefined)
    };
    const executor = createClaudeCodeAgentExecutor({
      agent,
      streamProvider: provider
    });

    const result = await executor(buildInput(), () => undefined);

    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error.code).toBe('AGENT_EXECUTE_THROW');
      expect(result.error.message).toContain('binary not found');
    }
  });

  it('detaches capture state on every settle path so providers do not leak', async () => {
    const provider = new CapturingStreamProvider();
    const driver = buildFakeAgent(provider);
    driver.setWork(async (config) => {
      const stream = provider.createStream(config);
      await stream.emitCompletion({
        status: 'success',
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0
        }
      });
      await stream.close('completed');
    });
    const executor = createClaudeCodeAgentExecutor({
      agent: driver.agent,
      streamProvider: provider
    });

    await executor(buildInput(), () => undefined);

    // Round 2: same provider, fresh task, fresh state. If the
    // previous round had leaked, the second round's capture would
    // still see the first round's terminal completion. Verify by
    // running the second task without emitting anything — it should
    // come back 'completed' with empty output (no leaked completion
    // from round 1).
    driver.setWork(async () => {
      // intentionally no emits
    });
    const result2 = await executor(
      buildInput({ capabilities: [] }),
      () => undefined
    );
    expect(result2.kind).toBe('completed');
    if (result2.kind === 'completed') {
      expect(result2.output).toBe('');
    }
  });
});
