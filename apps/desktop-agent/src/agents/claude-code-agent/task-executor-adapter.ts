import type {
  AIAgent,
  AIAgentTaskInput,
  AIAgentTaskType,
  AIResponseStream,
  StreamCompletion,
  StreamConfig,
  StreamDelta,
  StreamError,
  StreamListener,
  StreamProgress,
  StreamProvider,
  StreamSubscription,
  StreamToolCall
} from '@operator-os/contracts';

import type {
  TaskAssignInput,
  TaskExecutionResult,
  TaskExecutor
} from '../../providers/control-channel-ws.js';

/**
 * Per-task capture surface registered by the adapter immediately
 * before invoking `agent.executeTask`. The CapturingStreamProvider
 * looks up this state by `taskId` when the agent calls
 * `streamProvider.createStream(...)`.
 */
interface CaptureState {
  /** Forward to ControlChannelWs.emitProgress. */
  readonly onText: (text: string) => void;
  /** Captured terminal completion (if the agent emitted one). */
  completion?: StreamCompletion;
  /** Captured terminal error (if the agent emitted one). */
  error?: StreamError;
  /** Reason from the agent's `close()` call. */
  closeReason?: 'completed' | 'cancelled' | 'error';
}

/**
 * StreamProvider that captures emit calls instead of sending them
 * over a transport. Used by the Phase 3.3 adapter so the
 * ClaudeCodeAgent's response stream is bridged into
 * ControlChannelWs's `emitProgress` callback rather than the
 * Phase 1.4 per-task WebSocket.
 *
 * One provider serves any number of concurrent tasks; per-task
 * capture state is registered via `attach(taskId, state)` and
 * removed via `detach(taskId)` by the executor closure.
 */
export class CapturingStreamProvider implements StreamProvider {
  readonly #states = new Map<string, CaptureState>();

  attach(taskId: string, state: CaptureState): void {
    this.#states.set(taskId, state);
  }

  detach(taskId: string): void {
    this.#states.delete(taskId);
  }

  createStream(config: StreamConfig): AIResponseStream {
    const state = this.#states.get(config.taskId);
    if (state === undefined) {
      // Defensive fallback — the agent created a stream for a task
      // the adapter never attached state for. Emit a no-op stream so
      // the agent doesn't crash; the adapter logs upstream.
      return new NoopResponseStream(config.taskId);
    }
    return new CapturingResponseStream(config.taskId, state);
  }
}

class CapturingResponseStream implements AIResponseStream {
  readonly taskId: string;
  readonly #state: CaptureState;
  readonly #listeners: Set<StreamListener> = new Set();

  constructor(taskId: string, state: CaptureState) {
    this.taskId = taskId;
    this.#state = state;
  }

  async emitToken(token: string): Promise<void> {
    this.#state.onText(token);
    this.#emit({ type: 'token', token });
  }

  async emitDelta(delta: StreamDelta): Promise<void> {
    this.#state.onText(delta.content);
    this.#emit({ type: 'delta', delta });
  }

  async emitToolCall(call: StreamToolCall): Promise<void> {
    // Forward tool-call as a structured JSON line so the api +
    // mobile can render it later. Phase 3.3 mobile renders the raw
    // text; richer rendering is Phase 4.
    this.#state.onText(
      JSON.stringify({ tool: call.toolName, status: call.status })
    );
    this.#emit({ type: 'tool-call', call });
  }

  async emitProgress(progress: StreamProgress): Promise<void> {
    if (progress.message) {
      this.#state.onText(progress.message);
    }
    this.#emit({ type: 'progress', progress });
  }

  async emitError(error: StreamError): Promise<void> {
    this.#state.error = error;
    this.#emit({ type: 'error', error });
  }

  async emitCompletion(completion: StreamCompletion): Promise<void> {
    this.#state.completion = completion;
    this.#emit({ type: 'completion', completion });
  }

  subscribe(listener: StreamListener): StreamSubscription {
    this.#listeners.add(listener);
    return {
      unsubscribe: () => {
        this.#listeners.delete(listener);
      }
    };
  }

  async close(reason: 'completed' | 'cancelled' | 'error'): Promise<void> {
    this.#state.closeReason = reason;
  }

  #emit(event: Parameters<StreamListener>[0]): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch {
        /* swallow — one bad listener must not affect peers */
      }
    }
  }
}

class NoopResponseStream implements AIResponseStream {
  readonly taskId: string;
  constructor(taskId: string) {
    this.taskId = taskId;
  }
  async emitToken(): Promise<void> {}
  async emitDelta(): Promise<void> {}
  async emitToolCall(): Promise<void> {}
  async emitProgress(): Promise<void> {}
  async emitError(): Promise<void> {}
  async emitCompletion(): Promise<void> {}
  subscribe(): StreamSubscription {
    return { unsubscribe: () => undefined };
  }
  async close(): Promise<void> {}
}

/**
 * Minimal subset of the AIAgent surface the adapter uses. Lets
 * tests inject a fake without constructing the full
 * ClaudeCodeAgent + execa + cost machinery.
 */
export interface ExecutableAgent {
  executeTask(input: AIAgentTaskInput): Promise<unknown>;
  awaitSettled(): Promise<void>;
}

export interface CreateClaudeCodeAgentExecutorOptions {
  readonly agent: ExecutableAgent;
  readonly streamProvider: CapturingStreamProvider;
  /**
   * Map task.capabilities to an AIAgentTaskType. Default picks the
   * first matching strategy; tests may override for determinism.
   */
  readonly resolveTaskType?: (input: TaskAssignInput) => AIAgentTaskType;
}

const DEFAULT_TASK_TYPE_RESOLVER = (
  input: TaskAssignInput
): AIAgentTaskType => {
  const caps = new Set(input.capabilities);
  if (caps.has('planning')) return 'plan';
  if (caps.has('code-review')) return 'review';
  if (caps.has('code-generation')) return 'code';
  if (caps.has('tool-use')) return 'tool-use';
  return 'answer';
};

/**
 * Bridge `AIAgent.executeTask` to the `TaskExecutor` shape that
 * `ControlChannelWs` expects. Captures the agent's stream output
 * via `CapturingStreamProvider` and forwards each text fragment to
 * the executor's `emitProgress`. Returns:
 *
 *  - `{kind: 'completed', output}` if the captured `StreamCompletion`
 *    is `success` or `partial` (and no `StreamError` arrived).
 *  - `{kind: 'failed', error}` if a `StreamError` was captured, or
 *    if `executeTask` itself threw, or if the close reason was
 *    `'error'`.
 *
 * Cancellation propagation: if the control-channel decides to
 * cancel, callers can invoke `agent.cancelTask(taskId)` externally;
 * the adapter awaits `agent.awaitSettled()` either way and reports
 * the captured terminal state.
 */
export const createClaudeCodeAgentExecutor = (
  options: CreateClaudeCodeAgentExecutorOptions
): TaskExecutor => {
  const resolveType = options.resolveTaskType ?? DEFAULT_TASK_TYPE_RESOLVER;

  return async (input, emitProgress): Promise<TaskExecutionResult> => {
    let aggregatedOutput = '';
    const state: CaptureState = {
      onText: (text) => {
        aggregatedOutput += text;
        emitProgress(text);
      }
    };
    options.streamProvider.attach(input.taskId, state);

    try {
      const agentInput: AIAgentTaskInput = {
        taskId: input.taskId,
        type: resolveType(input),
        prompt: input.prompt,
        context: {
          metadata: { userId: input.metadata.userId }
        }
      };
      await options.agent.executeTask(agentInput);
      await options.agent.awaitSettled();

      // Decide outcome. Priority order:
      //   1. Explicit error → failed
      //   2. closeReason === 'error' → failed
      //   3. completion.status === 'failed' → failed
      //   4. otherwise → completed (output may be empty for partial)
      if (state.error) {
        return {
          kind: 'failed',
          taskId: input.taskId,
          error: { code: state.error.code, message: state.error.message }
        };
      }
      if (state.closeReason === 'error') {
        return {
          kind: 'failed',
          taskId: input.taskId,
          error: {
            code: 'AGENT_STREAM_CLOSED_ERROR',
            message: 'Agent closed its stream with reason=error.'
          }
        };
      }
      if (state.completion?.status === 'failed') {
        return {
          kind: 'failed',
          taskId: input.taskId,
          error: {
            code: 'AGENT_COMPLETION_FAILED',
            message: 'Agent emitted completion with status=failed.'
          }
        };
      }
      return {
        kind: 'completed',
        taskId: input.taskId,
        output: aggregatedOutput
      };
    } catch (err) {
      return {
        kind: 'failed',
        taskId: input.taskId,
        error: {
          code: 'AGENT_EXECUTE_THROW',
          message: err instanceof Error ? err.message : String(err)
        }
      };
    } finally {
      options.streamProvider.detach(input.taskId);
    }
  };
};
