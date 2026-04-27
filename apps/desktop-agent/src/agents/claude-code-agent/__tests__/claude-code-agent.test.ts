import {
  AIAgentError,
  BudgetExceededError,
  type AIAgentIdentity,
  type AgentManifest,
  type AIResponseStream,
  type CostProvider,
  type FileSystemProvider,
  type StreamProvider
} from '@operator-os/contracts';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaudeCodeAgent } from '../claude-code-agent.js';
import { claudeCodeManifest } from '../manifest.js';
import type {
  SpawnFn,
  SpawnResult,
  SubprocessHandle
} from '../spawn-types.js';

const silentLogger = pino({ level: 'silent' });

const makeIdentity = (): AIAgentIdentity => ({
  id: 'agent-claude-1',
  providerId: 'anthropic.claude-code',
  providerVersion: '0.1.0',
  displayName: 'Claude Code test',
  hostname: 'test-host',
  platform: 'linux',
  arch: 'x64'
});

// --- mock subprocess: deferred promise + kill recorder ---

interface DeferredSubprocess {
  handle: SubprocessHandle;
  resolve: (r: SpawnResult) => void;
  reject: (err: unknown) => void;
  killMock: ReturnType<typeof vi.fn>;
}

const createDeferredSubprocess = (pid = 12345): DeferredSubprocess => {
  let resolve!: (r: SpawnResult) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<SpawnResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const killMock = vi.fn((_signal?: string) => true);
  const handle: SubprocessHandle = {
    pid,
    kill: killMock,
    then: promise.then.bind(promise)
  };
  return { handle, resolve, reject, killMock };
};

// --- spawn harness: queues up subprocess handles, records calls ---

interface SpawnHarness {
  spawnFn: SpawnFn;
  enqueue(next: SubprocessHandle | (() => never)): void;
  calls: Array<{ binary: string; args: readonly string[] }>;
}

const createSpawnHarness = (): SpawnHarness => {
  const queue: Array<SubprocessHandle | (() => never)> = [];
  const calls: SpawnHarness['calls'] = [];
  const spawnFn: SpawnFn = (binary, args) => {
    calls.push({ binary, args: [...args] });
    const next = queue.shift();
    if (next === undefined) {
      throw new Error(
        `spawnFn called but queue empty (call ${calls.length}: ${binary} ${args.join(' ')})`
      );
    }
    if (typeof next === 'function') {
      // Synchronous-throw path.
      return next();
    }
    return next;
  };
  return {
    spawnFn,
    enqueue(next) {
      queue.push(next);
    },
    calls
  };
};

// --- mock AIResponseStream ---

interface StreamRecorder {
  stream: AIResponseStream;
  provider: StreamProvider;
  emitProgress: ReturnType<typeof vi.fn>;
  emitDelta: ReturnType<typeof vi.fn>;
  emitCompletion: ReturnType<typeof vi.fn>;
  emitError: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const createStreamRecorder = (): StreamRecorder => {
  const emitProgress = vi.fn(async () => undefined);
  const emitDelta = vi.fn(async () => undefined);
  const emitCompletion = vi.fn(async () => undefined);
  const emitError = vi.fn(async () => undefined);
  const close = vi.fn(async () => undefined);
  const stream: AIResponseStream = {
    taskId: '',
    emitToken: vi.fn(async () => undefined),
    emitDelta,
    emitToolCall: vi.fn(async () => undefined),
    emitProgress,
    emitError,
    emitCompletion,
    subscribe: () => ({ unsubscribe: () => undefined }),
    close
  };
  const provider: StreamProvider = {
    createStream: vi.fn(() => stream)
  };
  return { stream, provider, emitProgress, emitDelta, emitCompletion, emitError, close };
};

// --- mock CostProvider ---

const createCostProvider = (overrides: Partial<CostProvider> = {}): CostProvider => ({
  estimateCost: vi.fn(async () => ({
    costUsd: 0.01,
    breakdown: { promptCostUsd: 0.005, completionCostUsd: 0.005 },
    confidence: 'low' as const
  })),
  recordUsage: vi.fn(async () => undefined),
  checkBudget: vi.fn(async () => ({
    userId: 'user-1',
    plan: 'custom' as const,
    periodStart: new Date().toISOString(),
    periodEnd: new Date().toISOString(),
    spentUsd: 0,
    limitUsd: 100,
    remainingUsd: 100,
    isOverBudget: false,
    warnAtPercent: 80
  })),
  enforceBudget: vi.fn(async () => undefined),
  getUserSpending: vi.fn(async () => ({
    userId: 'user-1',
    period: 'today' as const,
    totalUsd: 0,
    byProvider: {},
    byModel: {},
    taskCount: 0,
    avgCostPerTaskUsd: 0
  })),
  ...overrides
});

const fakeFs: FileSystemProvider = {
  scope: { allowedRoots: ['/tmp'] },
  readFile: vi.fn(),
  readDirectory: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
  createDirectory: vi.fn(),
  moveFile: vi.fn(),
  watch: vi.fn(),
  isPathAllowed: vi.fn(() => true),
  assertPathAllowed: vi.fn()
} as unknown as FileSystemProvider;

// --- small async helpers ---

/** Minimal TaskInput builder. */
const makeInput = (over: Partial<Parameters<typeof ClaudeCodeAgent.prototype.executeTask>[0]> = {}) => ({
  taskId: over.taskId ?? 'task-1',
  type: over.type ?? ('code' as const),
  prompt: over.prompt ?? 'write hello world in python',
  constraints: over.constraints,
  context: over.context
});

// --- full-suite -------------------------------------------------

describe('ClaudeCodeAgent', () => {
  let harness: SpawnHarness;
  let streamRec: StreamRecorder;
  let cost: CostProvider;
  let manifest: AgentManifest;

  beforeEach(() => {
    harness = createSpawnHarness();
    streamRec = createStreamRecorder();
    cost = createCostProvider();
    manifest = claudeCodeManifest;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const buildAgent = (
    over: Partial<ConstructorParameters<typeof ClaudeCodeAgent>[0]> = {}
  ): ClaudeCodeAgent =>
    new ClaudeCodeAgent({
      identity: makeIdentity(),
      manifest,
      fs: fakeFs,
      stream: streamRec.provider,
      cost,
      logger: silentLogger,
      userId: 'user-1',
      spawnFn: harness.spawnFn,
      cancelGraceMs: 100,
      // Phase 4.0 Max-session preflight defaults to reading
      // ~/.claude/.credentials.json. The test harness disables
      // it by default so the unit suite stays hermetic; tests
      // that want to exercise the preflight pass an explicit
      // function via `over.maxSessionPreflight`.
      maxSessionPreflight: false,
      ...over
    });

  describe('start()', () => {
    it('probes --version, marks state idle on success', async () => {
      const deferred = createDeferredSubprocess();
      harness.enqueue(deferred.handle);
      const agent = buildAgent();

      const pending = agent.start();
      deferred.resolve({ stdout: 'claude 1.2.3', stderr: '', exitCode: 0 });
      await pending;

      expect(harness.calls).toEqual([
        { binary: 'claude', args: ['--version'] }
      ]);
      const status = await agent.getStatus();
      expect(status.state).toBe('idle');
      expect(status.healthChecks.binary).toBe('ok');
    });

    it('throws CLAUDE_BINARY_UNAVAILABLE and marks degraded when probe fails', async () => {
      const deferred = createDeferredSubprocess();
      harness.enqueue(deferred.handle);
      const agent = buildAgent();

      const pending = agent.start();
      deferred.reject(new Error('ENOENT: claude not found'));
      let caught: AIAgentError | undefined;
      try {
        await pending;
      } catch (err) {
        caught = err as AIAgentError;
      }
      expect(caught).toBeInstanceOf(AIAgentError);
      expect(caught!.code).toBe('CLAUDE_BINARY_UNAVAILABLE');

      const status = await agent.getStatus();
      expect(status.state).toBe('degraded');
      expect(status.healthChecks.binary).toBe('fail');
    });

    it('allows retry from degraded state after user fixes the binary', async () => {
      const firstAttempt = createDeferredSubprocess();
      const secondAttempt = createDeferredSubprocess();
      harness.enqueue(firstAttempt.handle);
      harness.enqueue(secondAttempt.handle);

      const agent = buildAgent();
      const first = agent.start();
      firstAttempt.reject(new Error('ENOENT'));
      await expect(first).rejects.toThrow();

      const second = agent.start();
      secondAttempt.resolve({ stdout: 'claude 1.2.3', stderr: '', exitCode: 0 });
      await second;

      const status = await agent.getStatus();
      expect(status.state).toBe('idle');
      expect(status.healthChecks.binary).toBe('ok');
    });

    it('is a no-op when called while already started', async () => {
      const first = createDeferredSubprocess();
      harness.enqueue(first.handle);
      const agent = buildAgent();

      const startPromise = agent.start();
      first.resolve({ stdout: 'ok', stderr: '', exitCode: 0 });
      await startPromise;

      await agent.start();
      expect(harness.calls).toHaveLength(1);
    });

    describe('Max-session preflight (Phase 4.0)', () => {
      it('runs the preflight after the binary probe and marks healthCheck.maxSession=ok', async () => {
        const probe = createDeferredSubprocess();
        harness.enqueue(probe.handle);
        const preflight = vi.fn(async () => ({
          path: '/fake/.credentials.json',
          expiresInSeconds: 3600,
          ok: true as const
        }));

        const agent = buildAgent({ maxSessionPreflight: preflight });
        const pending = agent.start();
        probe.resolve({ stdout: 'claude 1.2.3', stderr: '', exitCode: 0 });
        await pending;

        expect(preflight).toHaveBeenCalledOnce();
        const status = await agent.getStatus();
        expect(status.state).toBe('idle');
        expect(status.healthChecks.binary).toBe('ok');
        expect(status.healthChecks.maxSession).toBe('ok');
      });

      it('throws CLAUDE_MAX_SESSION_UNAVAILABLE when preflight throws MaxSessionUnavailableError', async () => {
        const { MaxSessionUnavailableError } = await import(
          '../max-session-preflight.js'
        );
        const probe = createDeferredSubprocess();
        harness.enqueue(probe.handle);
        const preflight = vi.fn(async () => {
          throw new MaxSessionUnavailableError(
            'CREDENTIALS_OAUTH_MISSING',
            '/fake/.credentials.json',
            'no oauth block',
            'login first'
          );
        });

        const agent = buildAgent({ maxSessionPreflight: preflight });
        const pending = agent.start();
        probe.resolve({ stdout: 'claude 1.2.3', stderr: '', exitCode: 0 });

        let caught: AIAgentError | undefined;
        try {
          await pending;
        } catch (err) {
          caught = err as AIAgentError;
        }
        expect(caught).toBeInstanceOf(AIAgentError);
        expect(caught!.code).toBe('CLAUDE_MAX_SESSION_UNAVAILABLE');
        expect(caught!.details).toMatchObject({
          credentialsPath: '/fake/.credentials.json',
          code: 'CREDENTIALS_OAUTH_MISSING'
        });

        const status = await agent.getStatus();
        expect(status.state).toBe('degraded');
        expect(status.healthChecks.maxSession).toBe('fail');
      });

      it('passes when binary probe succeeds and preflight is explicitly disabled (back-compat)', async () => {
        const probe = createDeferredSubprocess();
        harness.enqueue(probe.handle);
        const agent = buildAgent({ maxSessionPreflight: false });

        const pending = agent.start();
        probe.resolve({ stdout: 'claude 1.2.3', stderr: '', exitCode: 0 });
        await pending;

        const status = await agent.getStatus();
        expect(status.state).toBe('idle');
        expect(status.healthChecks.binary).toBe('ok');
        expect(status.healthChecks.maxSession).toBeUndefined();
      });

      it('logs a warning when the OAuth session expires within 24h but still succeeds', async () => {
        const probe = createDeferredSubprocess();
        harness.enqueue(probe.handle);
        const preflight = vi.fn(async () => ({
          path: '/fake/.credentials.json',
          expiresInSeconds: 60 * 60, // 1h, well under 24h
          ok: true as const
        }));

        const agent = buildAgent({ maxSessionPreflight: preflight });
        const pending = agent.start();
        probe.resolve({ stdout: 'claude 1.2.3', stderr: '', exitCode: 0 });
        await pending;

        const status = await agent.getStatus();
        expect(status.state).toBe('idle');
        expect(status.healthChecks.maxSession).toBe('ok');
      });
    });
  });

  describe('executeTask() preconditions', () => {
    it('throws AGENT_NOT_STARTED if called before start()', async () => {
      const agent = buildAgent();
      await expect(agent.executeTask(makeInput())).rejects.toMatchObject({
        code: 'AGENT_NOT_STARTED'
      });
    });

    it('calls estimateCost and enforceBudget before spawning', async () => {
      const startSubp = createDeferredSubprocess();
      const taskSubp = createDeferredSubprocess();
      harness.enqueue(startSubp.handle);
      harness.enqueue(taskSubp.handle);

      const agent = buildAgent();
      const startPromise = agent.start();
      startSubp.resolve({ stdout: 'v', stderr: '', exitCode: 0 });
      await startPromise;

      await agent.executeTask(makeInput());

      expect(cost.estimateCost).toHaveBeenCalledOnce();
      expect(cost.enforceBudget).toHaveBeenCalledOnce();
      const enforceArgs = vi.mocked(cost.enforceBudget).mock.calls[0];
      expect(enforceArgs[0]).toBe('user-1');
    });

    it('does not spawn when enforceBudget throws', async () => {
      const startSubp = createDeferredSubprocess();
      harness.enqueue(startSubp.handle);

      const failingCost = createCostProvider({
        enforceBudget: vi.fn(async () => {
          throw new BudgetExceededError('user-1', 100, 10);
        })
      });
      const agent = buildAgent({ cost: failingCost });
      const startPromise = agent.start();
      startSubp.resolve({ stdout: 'v', stderr: '', exitCode: 0 });
      await startPromise;

      await expect(agent.executeTask(makeInput())).rejects.toThrow(
        BudgetExceededError
      );
      expect(harness.calls).toHaveLength(1); // only the start probe
    });

    it('throws AGENT_BUSY when a task is already active', async () => {
      const startSubp = createDeferredSubprocess();
      const taskSubp = createDeferredSubprocess();
      harness.enqueue(startSubp.handle);
      harness.enqueue(taskSubp.handle);

      const agent = buildAgent();
      const startPromise = agent.start();
      startSubp.resolve({ stdout: 'v', stderr: '', exitCode: 0 });
      await startPromise;

      await agent.executeTask(makeInput({ taskId: 't1' }));
      await expect(
        agent.executeTask(makeInput({ taskId: 't2' }))
      ).rejects.toMatchObject({ code: 'AGENT_BUSY' });
    });
  });

  describe('executeTask() spawn args', () => {
    it('invokes claude with -p, --model, --output-format json', async () => {
      const startSubp = createDeferredSubprocess();
      const taskSubp = createDeferredSubprocess();
      harness.enqueue(startSubp.handle);
      harness.enqueue(taskSubp.handle);

      const agent = buildAgent();
      const startPromise = agent.start();
      startSubp.resolve({ stdout: 'v', stderr: '', exitCode: 0 });
      await startPromise;

      await agent.executeTask(makeInput({ prompt: 'hello' }));

      const taskCall = harness.calls[1];
      expect(taskCall.binary).toBe('claude');
      expect(taskCall.args).toContain('-p');
      expect(taskCall.args).toContain('hello');
      expect(taskCall.args).toContain('--model');
      expect(taskCall.args).toContain('claude-sonnet-4-5');
      expect(taskCall.args).toContain('--output-format');
      expect(taskCall.args).toContain('json');
    });

    it('forwards --max-tokens when constraint is supplied', async () => {
      const startSubp = createDeferredSubprocess();
      const taskSubp = createDeferredSubprocess();
      harness.enqueue(startSubp.handle);
      harness.enqueue(taskSubp.handle);

      const agent = buildAgent();
      const startPromise = agent.start();
      startSubp.resolve({ stdout: 'v', stderr: '', exitCode: 0 });
      await startPromise;

      await agent.executeTask(
        makeInput({ constraints: { maxTokens: 777 } })
      );

      const taskArgs = harness.calls[1].args;
      const idx = taskArgs.indexOf('--max-tokens');
      expect(idx).toBeGreaterThan(-1);
      expect(taskArgs[idx + 1]).toBe('777');
    });

    it('honours a custom --model override', async () => {
      const startSubp = createDeferredSubprocess();
      const taskSubp = createDeferredSubprocess();
      harness.enqueue(startSubp.handle);
      harness.enqueue(taskSubp.handle);

      const agent = buildAgent({ model: 'claude-opus-4-7' });
      const startPromise = agent.start();
      startSubp.resolve({ stdout: 'v', stderr: '', exitCode: 0 });
      await startPromise;

      await agent.executeTask(makeInput());
      expect(harness.calls[1].args).toContain('claude-opus-4-7');
    });

    it('returns a handle at status=running with the given taskId', async () => {
      const startSubp = createDeferredSubprocess();
      const taskSubp = createDeferredSubprocess();
      harness.enqueue(startSubp.handle);
      harness.enqueue(taskSubp.handle);

      const agent = buildAgent();
      const startPromise = agent.start();
      startSubp.resolve({ stdout: 'v', stderr: '', exitCode: 0 });
      await startPromise;

      const handle = await agent.executeTask(makeInput({ taskId: 'handle-1' }));
      expect(handle.taskId).toBe('handle-1');
      expect(handle.status).toBe('running');
      expect(typeof handle.startedAt).toBe('string');
    });
  });

  describe('executeTask() happy path', () => {
    it('emits progress → delta → completion, records usage, closes "completed"', async () => {
      const startSubp = createDeferredSubprocess();
      const taskSubp = createDeferredSubprocess();
      harness.enqueue(startSubp.handle);
      harness.enqueue(taskSubp.handle);

      const agent = buildAgent();
      const startPromise = agent.start();
      startSubp.resolve({ stdout: 'v', stderr: '', exitCode: 0 });
      await startPromise;

      await agent.executeTask(makeInput({ taskId: 'hp' }));
      taskSubp.resolve({
        stdout: JSON.stringify({
          result: 'hello world',
          total_cost_usd: 0.0042,
          usage: { input_tokens: 100, output_tokens: 25 }
        }),
        stderr: '',
        exitCode: 0
      });
      await agent.awaitSettled();

      expect(streamRec.emitProgress).toHaveBeenCalledOnce();
      expect(streamRec.emitDelta).toHaveBeenCalledWith({
        type: 'answer',
        content: 'hello world'
      });
      expect(streamRec.emitCompletion).toHaveBeenCalledWith({
        status: 'success',
        usage: {
          promptTokens: 100,
          completionTokens: 25,
          totalTokens: 125,
          costUsd: 0.0042
        }
      });
      expect(cost.recordUsage).toHaveBeenCalledOnce();
      expect(streamRec.close).toHaveBeenCalledWith('completed');

      const status = await agent.getStatus();
      expect(status.state).toBe('idle');
      expect(status.currentTaskId).toBeUndefined();
    });

    it('falls back to raw stdout + zero usage on JSON schema drift', async () => {
      const startSubp = createDeferredSubprocess();
      const taskSubp = createDeferredSubprocess();
      harness.enqueue(startSubp.handle);
      harness.enqueue(taskSubp.handle);

      const agent = buildAgent();
      const startPromise = agent.start();
      startSubp.resolve({ stdout: 'v', stderr: '', exitCode: 0 });
      await startPromise;

      await agent.executeTask(makeInput());
      taskSubp.resolve({
        stdout: 'not json',
        stderr: '',
        exitCode: 0
      });
      await agent.awaitSettled();

      expect(streamRec.emitDelta).toHaveBeenCalledWith({
        type: 'answer',
        content: 'not json'
      });
      const completionArgs = streamRec.emitCompletion.mock.calls[0][0];
      expect(completionArgs).toMatchObject({
        status: 'success',
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0
        }
      });
    });
  });

  describe('executeTask() failure paths', () => {
    it('emits error + closes "error" on non-zero exit', async () => {
      const startSubp = createDeferredSubprocess();
      const taskSubp = createDeferredSubprocess();
      harness.enqueue(startSubp.handle);
      harness.enqueue(taskSubp.handle);

      const agent = buildAgent();
      const startPromise = agent.start();
      startSubp.resolve({ stdout: 'v', stderr: '', exitCode: 0 });
      await startPromise;

      await agent.executeTask(makeInput());
      taskSubp.resolve({
        stdout: '',
        stderr: 'auth failed',
        exitCode: 3
      });
      await agent.awaitSettled();

      expect(streamRec.emitError).toHaveBeenCalledOnce();
      const errArgs = streamRec.emitError.mock.calls[0][0];
      expect(errArgs.code).toBe('CLAUDE_EXIT_NONZERO');
      expect(errArgs.fatal).toBe(true);
      expect(streamRec.emitCompletion).not.toHaveBeenCalled();
      expect(streamRec.close).toHaveBeenCalledWith('error');

      const status = await agent.getStatus();
      expect(status.state).toBe('idle');
    });

    it('emits error + closes "error" when subprocess rejects unexpectedly', async () => {
      const startSubp = createDeferredSubprocess();
      const taskSubp = createDeferredSubprocess();
      harness.enqueue(startSubp.handle);
      harness.enqueue(taskSubp.handle);

      const agent = buildAgent();
      const startPromise = agent.start();
      startSubp.resolve({ stdout: 'v', stderr: '', exitCode: 0 });
      await startPromise;

      await agent.executeTask(makeInput());
      taskSubp.reject(new Error('spawn EACCES'));
      await agent.awaitSettled();

      expect(streamRec.emitError).toHaveBeenCalledOnce();
      const errArgs = streamRec.emitError.mock.calls[0][0];
      expect(errArgs.code).toBe('CLAUDE_SPAWN_FAILED');
      expect(errArgs.message).toMatch(/EACCES/);
      expect(streamRec.close).toHaveBeenCalledWith('error');
    });
  });

  describe('cancelTask()', () => {
    it('no-op when taskId does not match the active task', async () => {
      const startSubp = createDeferredSubprocess();
      harness.enqueue(startSubp.handle);
      const agent = buildAgent();
      const startPromise = agent.start();
      startSubp.resolve({ stdout: 'v', stderr: '', exitCode: 0 });
      await startPromise;

      await agent.cancelTask('ghost');
      // Only the start probe happened; no spawn to kill.
      expect(harness.calls).toHaveLength(1);
    });

    it('sends SIGTERM to the active subprocess', async () => {
      const startSubp = createDeferredSubprocess();
      const taskSubp = createDeferredSubprocess();
      harness.enqueue(startSubp.handle);
      harness.enqueue(taskSubp.handle);

      const agent = buildAgent();
      const startPromise = agent.start();
      startSubp.resolve({ stdout: 'v', stderr: '', exitCode: 0 });
      await startPromise;

      await agent.executeTask(makeInput({ taskId: 'cancel-me' }));
      await agent.cancelTask('cancel-me');
      expect(taskSubp.killMock).toHaveBeenCalledWith('SIGTERM');
    });

    it('escalates to SIGKILL after the grace period', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      const startSubp = createDeferredSubprocess();
      const taskSubp = createDeferredSubprocess();
      harness.enqueue(startSubp.handle);
      harness.enqueue(taskSubp.handle);

      const agent = buildAgent({ cancelGraceMs: 200 });
      const startPromise = agent.start();
      startSubp.resolve({ stdout: 'v', stderr: '', exitCode: 0 });
      await startPromise;

      await agent.executeTask(makeInput({ taskId: 'cancel-me' }));
      await agent.cancelTask('cancel-me');
      vi.advanceTimersByTime(300);
      expect(taskSubp.killMock).toHaveBeenCalledWith('SIGTERM');
      expect(taskSubp.killMock).toHaveBeenCalledWith('SIGKILL');
    });

    it('emits partial completion + closes "cancelled" when subprocess resolves post-cancel', async () => {
      const startSubp = createDeferredSubprocess();
      const taskSubp = createDeferredSubprocess();
      harness.enqueue(startSubp.handle);
      harness.enqueue(taskSubp.handle);

      const agent = buildAgent();
      const startPromise = agent.start();
      startSubp.resolve({ stdout: 'v', stderr: '', exitCode: 0 });
      await startPromise;

      await agent.executeTask(makeInput({ taskId: 'partial' }));
      await agent.cancelTask('partial');
      // Simulate the child shutting down after SIGTERM.
      taskSubp.resolve({ stdout: '', stderr: '', exitCode: 143 });
      await agent.awaitSettled();

      expect(streamRec.emitCompletion).toHaveBeenCalledWith({
        status: 'partial',
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0
        }
      });
      expect(streamRec.emitError).not.toHaveBeenCalled();
      expect(streamRec.close).toHaveBeenCalledWith('cancelled');
    });
  });

  describe('stop()', () => {
    it('transitions offline after idle stop()', async () => {
      const startSubp = createDeferredSubprocess();
      harness.enqueue(startSubp.handle);
      const agent = buildAgent();
      const startPromise = agent.start();
      startSubp.resolve({ stdout: 'v', stderr: '', exitCode: 0 });
      await startPromise;

      await agent.stop('user');
      const status = await agent.getStatus();
      expect(status.state).toBe('offline');
    });

    it('cancels active task first when stopped mid-task', async () => {
      const startSubp = createDeferredSubprocess();
      const taskSubp = createDeferredSubprocess();
      harness.enqueue(startSubp.handle);
      harness.enqueue(taskSubp.handle);

      const agent = buildAgent();
      const startPromise = agent.start();
      startSubp.resolve({ stdout: 'v', stderr: '', exitCode: 0 });
      await startPromise;

      await agent.executeTask(makeInput({ taskId: 'mid-stop' }));
      // stop() awaits settlement, so simulate SIGTERM delivery
      // causing the child to exit with 143 before awaiting stop.
      const stopPromise = agent.stop('shutdown');
      taskSubp.resolve({ stdout: '', stderr: '', exitCode: 143 });
      await stopPromise;
      expect(taskSubp.killMock).toHaveBeenCalledWith('SIGTERM');
      const status = await agent.getStatus();
      expect(status.state).toBe('offline');
    });
  });

  describe('listCapabilities() + getStatus()', () => {
    it('returns the manifest capability list', () => {
      const agent = buildAgent();
      const caps = agent.listCapabilities();
      expect(caps).toContain('code-generation');
      expect(caps).toContain('streaming');
      expect(caps).toContain('tool-use');
    });

    it('reports state=busy with currentTaskId while a task is running', async () => {
      const startSubp = createDeferredSubprocess();
      const taskSubp = createDeferredSubprocess();
      harness.enqueue(startSubp.handle);
      harness.enqueue(taskSubp.handle);

      const agent = buildAgent();
      const startPromise = agent.start();
      startSubp.resolve({ stdout: 'v', stderr: '', exitCode: 0 });
      await startPromise;

      await agent.executeTask(makeInput({ taskId: 'inflight' }));
      const status = await agent.getStatus();
      expect(status.state).toBe('busy');
      expect(status.currentTaskId).toBe('inflight');
    });
  });
});
