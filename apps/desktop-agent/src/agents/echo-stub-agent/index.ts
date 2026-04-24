import type {
  TaskAssignInput,
  TaskExecutionResult,
  TaskExecutor
} from '../../providers/control-channel-ws.js';

/**
 * Phase 3.2 echo stub. Returns `echo: <prompt>` as the terminal
 * output, emitting two task-delta progress fragments in between so
 * end-to-end streaming works against the real WS frame shape. Phase
 * 3.3 replaces this with ClaudeCodeAgent.executeTask.
 *
 * Intentionally has no external dependencies — stop rule #7 holds.
 */

export interface EchoStubOptions {
  /**
   * Capabilities this stub advertises to the server. Defaults to the
   * full AgentCapability union so the server-side router can test
   * against arbitrary task.capabilities without having to know which
   * specific capabilities the stub supports. Tests override to force
   * capability-mismatch rejection paths.
   */
  readonly capabilities?: readonly string[];
  /** Injectable clock for deterministic tests. */
  readonly now?: () => string;
}

const DEFAULT_CAPABILITIES: readonly string[] = [
  'code-generation',
  'code-review',
  'planning',
  'file-read',
  'file-write',
  'shell-execution',
  'web-fetch',
  'image-understanding',
  'image-generation',
  'long-context',
  'extended-context',
  'multimodal',
  'streaming',
  'tool-use',
  'vision',
  'voice-input',
  'voice-output'
];

/**
 * Manifest shape ControlChannelWs sends at hello. Matches the server
 * runtime agentManifestSchema (loose on non-capability fields).
 */
export const buildEchoStubManifest = (
  options: EchoStubOptions = {}
): Record<string, unknown> => {
  const capabilities = options.capabilities ?? DEFAULT_CAPABILITIES;
  return {
    manifestVersion: '1',
    providerId: 'operator-os.echo-stub',
    providerVersion: '0.1.0',
    displayName: 'Echo Stub Agent',
    description:
      'Phase 3.2 echo-stub — returns echo: <prompt>. Replaced by ClaudeCodeAgent in Phase 3.3.',
    author: 'operator-os',
    license: 'MIT',
    capabilities: capabilities.map((capability) => ({
      capability,
      version: '0.1.0'
    })),
    requirements: {}
  };
};

/** Capabilities as a Set — ControlChannelWs expects this shape. */
export const buildEchoStubCapabilities = (
  options: EchoStubOptions = {}
): ReadonlySet<string> =>
  new Set(options.capabilities ?? DEFAULT_CAPABILITIES);

/**
 * Create the echo-stub TaskExecutor. Two progress fragments +
 * terminal completion with `echo: <prompt>`.
 */
export const createEchoStubExecutor = (): TaskExecutor => {
  return async (
    input: TaskAssignInput,
    emitProgress: (delta: string) => void
  ): Promise<TaskExecutionResult> => {
    emitProgress(`echo-stub received taskId=${input.taskId}`);
    // Yield once so emitProgress actually hits the wire before
    // completion on the same tick.
    await Promise.resolve();
    emitProgress(`echo-stub producing output (prompt length ${input.prompt.length})`);
    return {
      kind: 'completed',
      taskId: input.taskId,
      output: `echo: ${input.prompt}`
    };
  };
};
