import {
  AIAgentError,
  type AIAgent,
  type AIAgentIdentity,
  type AIAgentRuntime,
  type AIAgentState,
  type AIAgentStatus,
  type AIAgentTaskHandle,
  type AIAgentTaskInput,
  type AIAgentUsage,
  type AgentCapability,
  type AgentManifest,
  type AIResponseStream,
  type CostProvider,
  type FileSystemProvider,
  type StreamProvider
} from '@operator-os/contracts';
import { execa } from 'execa';
import type { Logger } from 'pino';

import type { SpawnFn, SpawnResult, SubprocessHandle } from './spawn-types.js';

export interface ClaudeCodeAgentOptions {
  readonly identity: AIAgentIdentity;
  readonly manifest: AgentManifest;
  readonly fs: FileSystemProvider;
  readonly stream: StreamProvider;
  readonly cost: CostProvider;
  readonly logger: Logger;
  /** User whose budget is debited and who owns the stream. */
  readonly userId: string;
  /** Path to the `claude` binary. Default: `'claude'` (resolved via PATH). */
  readonly binaryPath?: string;
  /** Model passed to `--model`. Default `'claude-sonnet-4-5'`. */
  readonly model?: string;
  /**
   * Injectable spawn factory. Default delegates to execa. Tests
   * pass in a factory that returns a controllable deferred
   * SubprocessHandle.
   */
  readonly spawnFn?: SpawnFn;
  /**
   * Milliseconds between SIGTERM and SIGKILL during cancel. The
   * child gets a graceful window; only escalates if it ignores
   * SIGTERM. Default 5000.
   */
  readonly cancelGraceMs?: number;
}

interface ActiveTask {
  readonly taskId: string;
  readonly subprocess: SubprocessHandle;
  readonly startedAt: string;
  readonly stream: AIResponseStream;
  /** Set by cancelTask so the post-spawn handler treats the exit as a user cancel. */
  cancelRequested: boolean;
}

const defaultExecaSpawn: SpawnFn = (binary, args, options) =>
  execa(binary, [...args], options) as unknown as SubprocessHandle;

const CANCEL_GRACE_DEFAULT_MS = 5_000;
const DEFAULT_MODEL = 'claude-sonnet-4-5';
/** Rough heuristic — 1 token ≈ 4 chars for English prose. Good enough for pre-spawn estimates. */
const CHARS_PER_TOKEN = 4;
/** Fallback expected completion when the caller doesn't cap maxTokens. */
const DEFAULT_EXPECTED_COMPLETION_TOKENS = 1_000;

export class ClaudeCodeAgent implements AIAgent {
  readonly identity: AIAgentIdentity;
  readonly manifest: AgentManifest;
  readonly fs: FileSystemProvider;
  readonly stream: StreamProvider;
  readonly cost: CostProvider;

  #logger: Logger;
  #userId: string;
  #binaryPath: string;
  #model: string;
  #spawnFn: SpawnFn;
  #cancelGraceMs: number;

  #state: AIAgentState = 'offline';
  #startedAt?: Date;
  #activeTask?: ActiveTask;
  #healthChecks: Record<string, 'ok' | 'warn' | 'fail'> = {};
  #lastHeartbeatAt = new Date().toISOString();

  constructor(options: ClaudeCodeAgentOptions) {
    this.identity = options.identity;
    this.manifest = options.manifest;
    this.fs = options.fs;
    this.stream = options.stream;
    this.cost = options.cost;
    this.#logger = options.logger.child({
      component: 'claude-code-agent',
      agentId: options.identity.id
    });
    this.#userId = options.userId;
    this.#binaryPath = options.binaryPath ?? 'claude';
    this.#model = options.model ?? DEFAULT_MODEL;
    this.#spawnFn = options.spawnFn ?? defaultExecaSpawn;
    this.#cancelGraceMs = options.cancelGraceMs ?? CANCEL_GRACE_DEFAULT_MS;
  }

  get runtime(): AIAgentRuntime {
    const startedAt = this.#startedAt ?? new Date();
    return {
      pid: process.pid,
      startedAt: startedAt.toISOString(),
      uptimeSeconds: this.#startedAt
        ? Math.floor((Date.now() - this.#startedAt.getTime()) / 1000)
        : 0
    };
  }

  async getStatus(): Promise<AIAgentStatus> {
    return {
      state: this.#state,
      currentTaskId: this.#activeTask?.taskId,
      lastHeartbeatAt: this.#lastHeartbeatAt,
      healthChecks: { ...this.#healthChecks }
    };
  }

  listCapabilities(): readonly AgentCapability[] {
    return this.manifest.capabilities.map((c) => c.capability);
  }

  async start(): Promise<void> {
    if (this.#state !== 'offline') return;

    try {
      await this.#spawnFn(this.#binaryPath, ['--version']);
      this.#state = 'idle';
      this.#startedAt = new Date();
      this.#healthChecks.binary = 'ok';
      this.#lastHeartbeatAt = new Date().toISOString();
      this.#logger.info(
        { binaryPath: this.#binaryPath, model: this.#model },
        'claude-code agent started'
      );
    } catch (err) {
      this.#state = 'degraded';
      this.#healthChecks.binary = 'fail';
      this.#logger.error(
        { err, binaryPath: this.#binaryPath },
        'claude binary not discoverable'
      );
      throw new AIAgentError(
        'CLAUDE_BINARY_UNAVAILABLE',
        `Claude Code binary not found at '${this.#binaryPath}'. ` +
          'Install via `npm i -g @anthropic-ai/claude-code`.',
        {
          retriable: false,
          cause: err instanceof Error ? err : undefined,
          details: { binaryPath: this.#binaryPath }
        }
      );
    }
  }

  async stop(reason: 'user' | 'shutdown' | 'error'): Promise<void> {
    if (this.#activeTask) {
      await this.cancelTask(this.#activeTask.taskId);
    }
    this.#state = 'offline';
    this.#startedAt = undefined;
    this.#healthChecks = {};
    this.#logger.info({ reason }, 'claude-code agent stopped');
  }

  async executeTask(input: AIAgentTaskInput): Promise<AIAgentTaskHandle> {
    if (this.#state === 'offline') {
      throw new AIAgentError(
        'AGENT_NOT_STARTED',
        'ClaudeCodeAgent.start() must resolve before executeTask.',
        { retriable: false, details: { agentId: this.identity.id } }
      );
    }
    if (this.#activeTask) {
      throw new AIAgentError(
        'AGENT_BUSY',
        `Agent is already running task '${this.#activeTask.taskId}'.`,
        {
          retriable: true,
          details: {
            agentId: this.identity.id,
            activeTaskId: this.#activeTask.taskId
          }
        }
      );
    }

    const startedAt = new Date().toISOString();

    const estimate = await this.cost.estimateCost({
      providerId: this.identity.providerId,
      model: this.#model,
      promptTokens: Math.ceil(input.prompt.length / CHARS_PER_TOKEN),
      expectedCompletionTokens:
        input.constraints?.maxTokens ?? DEFAULT_EXPECTED_COMPLETION_TOKENS
    });
    await this.cost.enforceBudget(this.#userId, estimate.costUsd);

    const responseStream = this.stream.createStream({
      taskId: input.taskId,
      userId: this.#userId,
      transport: 'websocket'
    });

    const args = this.#buildCliArgs(input);
    const subprocess = this.#spawnFn(this.#binaryPath, args);

    this.#activeTask = {
      taskId: input.taskId,
      subprocess,
      startedAt,
      stream: responseStream,
      cancelRequested: false
    };
    this.#state = 'busy';
    this.#lastHeartbeatAt = startedAt;

    // Fire-and-forget the resolution handler; it finalises the
    // stream + activeTask state when the subprocess settles.
    void this.#driveTask(input, startedAt);

    return {
      taskId: input.taskId,
      status: 'running',
      startedAt
    };
  }

  async cancelTask(taskId: string): Promise<void> {
    const active = this.#activeTask;
    if (!active || active.taskId !== taskId) {
      this.#logger.debug(
        { taskId, hasActive: Boolean(active) },
        'cancelTask: no matching active task'
      );
      return;
    }

    active.cancelRequested = true;
    this.#logger.info({ taskId }, 'cancel requested — sending SIGTERM');
    try {
      active.subprocess.kill('SIGTERM');
    } catch (err) {
      this.#logger.warn({ err, taskId }, 'SIGTERM throw (ignored)');
    }

    // Escalate if the child hasn't exited within the grace window.
    // We intentionally don't await — the outer call resolves as
    // soon as SIGTERM is delivered. #driveTask still observes the
    // final exit and updates state accordingly.
    const graceTimer = setTimeout(() => {
      if (this.#activeTask?.taskId === taskId) {
        this.#logger.warn({ taskId }, 'cancel grace expired — SIGKILL');
        try {
          active.subprocess.kill('SIGKILL');
        } catch (err) {
          this.#logger.warn({ err, taskId }, 'SIGKILL throw (ignored)');
        }
      }
    }, this.#cancelGraceMs);
    // Don't block node exit on this timer.
    if (typeof graceTimer.unref === 'function') graceTimer.unref();
  }

  // ---------- internals ----------

  #buildCliArgs(input: AIAgentTaskInput): readonly string[] {
    const args: string[] = [
      '-p',
      input.prompt,
      '--model',
      this.#model,
      '--output-format',
      'json'
    ];
    if (input.constraints?.maxTokens !== undefined) {
      args.push('--max-tokens', String(input.constraints.maxTokens));
    }
    return args;
  }

  async #driveTask(
    input: AIAgentTaskInput,
    startedAt: string
  ): Promise<void> {
    const active = this.#activeTask;
    if (!active) {
      // Shouldn't happen — executeTask sets it synchronously before
      // scheduling this — but defend against re-entry races.
      this.#logger.warn(
        { taskId: input.taskId },
        'driveTask scheduled but no active task — aborting'
      );
      return;
    }

    const { stream: responseStream, subprocess } = active;
    let closeReason: 'completed' | 'cancelled' | 'error' = 'completed';
    let finalUsage: AIAgentUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0
    };

    await responseStream.emitProgress({
      stage: 'spawning',
      percent: 0,
      message: `spawning ${this.#binaryPath}`
    });

    try {
      const result = await subprocess;
      if (active.cancelRequested) {
        closeReason = 'cancelled';
        this.#logger.info(
          { taskId: input.taskId, exitCode: result.exitCode },
          'task exited after cancel'
        );
        await responseStream.emitCompletion({
          status: 'partial',
          usage: finalUsage
        });
      } else if (result.exitCode !== 0) {
        closeReason = 'error';
        this.#logger.warn(
          { taskId: input.taskId, exitCode: result.exitCode, stderr: result.stderr },
          'claude exited non-zero'
        );
        await responseStream.emitError({
          code: 'CLAUDE_EXIT_NONZERO',
          message:
            `claude exited with code ${result.exitCode}: ` +
            (result.stderr?.slice(0, 500) ?? ''),
          fatal: true
        });
      } else {
        const parsed = this.#parseResult(result);
        finalUsage = parsed.usage;
        await responseStream.emitDelta({
          type: 'answer',
          content: parsed.text
        });
        await responseStream.emitCompletion({
          status: 'success',
          usage: finalUsage
        });
      }
    } catch (err) {
      if (active.cancelRequested) {
        closeReason = 'cancelled';
        this.#logger.info(
          { taskId: input.taskId, err },
          'subprocess rejected after cancel'
        );
        await responseStream.emitCompletion({
          status: 'partial',
          usage: finalUsage
        });
      } else {
        closeReason = 'error';
        this.#logger.error(
          { taskId: input.taskId, err },
          'subprocess rejected unexpectedly'
        );
        await responseStream.emitError({
          code: 'CLAUDE_SPAWN_FAILED',
          message: err instanceof Error ? err.message : String(err),
          fatal: true
        });
      }
    } finally {
      // Record whatever usage we were able to observe. ApiCostProvider
      // is currently a TD-022 stub; once real endpoints land this is
      // where spending shows up.
      try {
        await this.cost.recordUsage({
          userId: this.#userId,
          taskId: input.taskId,
          providerId: this.identity.providerId,
          model: this.#model,
          usage: finalUsage,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        this.#logger.warn(
          { err, taskId: input.taskId },
          'recordUsage threw — continuing shutdown'
        );
      }

      try {
        await responseStream.close(closeReason);
      } catch (err) {
        this.#logger.warn(
          { err, taskId: input.taskId },
          'stream.close threw — continuing'
        );
      }

      // Only clear if still pointing at our task — avoids races if
      // a stop+start cycle happened mid-task.
      if (this.#activeTask?.taskId === input.taskId) {
        this.#activeTask = undefined;
        this.#state = 'idle';
        this.#lastHeartbeatAt = new Date().toISOString();
      }
      this.#logger.info(
        { taskId: input.taskId, closeReason, startedAt },
        'task settled'
      );
    }
  }

  #parseResult(result: SpawnResult): { text: string; usage: AIAgentUsage } {
    // `claude -p ... --output-format json` prints a single JSON
    // document to stdout. Shape (as of CLI v1.0.x):
    //   { "result": "...", "total_cost_usd": 0.01,
    //     "usage": { "input_tokens": N, "output_tokens": N } }
    // We're defensive: extra fields are ignored, missing fields
    // fall back to zeros so a schema drift doesn't nuke a task.
    try {
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
      const usage = (parsed.usage ?? {}) as Record<string, unknown>;
      const promptTokens = Number(usage.input_tokens ?? 0);
      const completionTokens = Number(usage.output_tokens ?? 0);
      return {
        text: typeof parsed.result === 'string' ? parsed.result : '',
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          costUsd: Number(parsed.total_cost_usd ?? 0)
        }
      };
    } catch (err) {
      this.#logger.warn(
        { err, stdoutLen: result.stdout?.length ?? 0 },
        'claude stdout not valid JSON — returning raw text with zero usage'
      );
      return {
        text: result.stdout ?? '',
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0
        }
      };
    }
  }
}
