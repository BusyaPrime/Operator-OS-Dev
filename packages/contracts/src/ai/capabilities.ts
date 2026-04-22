/**
 * Narrow union of declarable capabilities an AI agent supports.
 * Core code branches on this union via exhaustiveness checks,
 * not on vendor string. New vendors advertise via this enum;
 * the list grows as the agent ecosystem expands.
 */
export type AgentCapability =
  | 'code-generation'
  | 'code-review'
  | 'planning'
  | 'file-read'
  | 'file-write'
  | 'shell-execution'
  | 'web-fetch'
  | 'image-understanding'
  | 'image-generation'
  /** Context window > 32k tokens. */
  | 'long-context'
  /** Context window > 200k tokens. */
  | 'extended-context'
  | 'multimodal'
  | 'streaming'
  | 'tool-use'
  | 'vision'
  | 'voice-input'
  | 'voice-output';

/**
 * A capability as declared by a specific agent, with version
 * and free-form caveats. Providers may ship a subset of a
 * capability with known limitations.
 */
export interface CapabilityDescriptor {
  readonly capability: AgentCapability;
  /** Semver of the capability implementation in the provider. */
  readonly version: string;
  /** Human-readable notes, e.g. "no Python 3.12 support". */
  readonly limitations?: string;
}
