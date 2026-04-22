/**
 * Narrow subprocess abstraction used by ClaudeCodeAgent.
 *
 * `execa()` v9 naturally satisfies this shape, but tests inject
 * a fake `SpawnFn` that returns a controllable deferred handle.
 * Keeping the surface tiny means the fake stays small and we
 * don't couple the agent to execa internals (e.g. the verbose
 * `ResultPromise` generics).
 */
export interface SpawnResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Signals the agent sends — superset of what node allows but narrowed on purpose. */
export type SpawnSignal = 'SIGTERM' | 'SIGKILL';

/**
 * PromiseLike<SpawnResult> plus a kill method. execa's subprocess
 * has more (stdout stream, ipc, etc.) but we only need these two.
 */
export interface SubprocessHandle extends PromiseLike<SpawnResult> {
  readonly pid?: number;
  kill(signal?: SpawnSignal): boolean;
}

export interface SpawnOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export type SpawnFn = (
  binary: string,
  args: readonly string[],
  options?: SpawnOptions
) => SubprocessHandle;
