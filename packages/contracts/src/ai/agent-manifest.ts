import type { CapabilityDescriptor } from './capabilities.js';

/**
 * Declarative description of an AI agent used for registration
 * with the Desktop Agent provider registry (SPEC § 27.5) and
 * for capability discovery by the router and cost engine.
 *
 * Manifests are signed for third-party distributions (see
 * `signature`). First-party agents shipped with Operator-OS may
 * leave the signature unset; the registry rejects unsigned
 * third-party manifests.
 */
export interface AgentManifest {
  /** Schema version of this manifest. Always '1' for now. */
  readonly manifestVersion: '1';
  /** Matches AIAgentIdentity.providerId. */
  readonly providerId: string;
  /** Matches AIAgentIdentity.providerVersion. */
  readonly providerVersion: string;
  /** Human-readable name shown in UI. */
  readonly displayName: string;
  /** Longer description for settings pages / marketplace. */
  readonly description: string;
  readonly author: string;
  readonly homepage?: string;
  /** SPDX license identifier, e.g. 'MIT'. */
  readonly license: string;
  readonly capabilities: readonly CapabilityDescriptor[];
  readonly requirements: AgentRequirements;
  readonly pricing?: AgentPricing;
  readonly signature?: AgentSignature;
}

/** Hard requirements an agent declares for its host environment. */
export interface AgentRequirements {
  /** Semver of minimum Node.js required. */
  readonly minNodeVersion?: string;
  readonly minRamMb?: number;
  readonly requiredPlatform?: readonly ('win32' | 'darwin' | 'linux')[];
  /** Names of env vars that must be set for the agent to boot. */
  readonly requiredEnvVars?: readonly string[];
  /** Binaries the agent must be able to spawn. */
  readonly requiredBinaries?: readonly AgentBinaryRequirement[];
}

/** A binary dependency declared by an agent manifest. */
export interface AgentBinaryRequirement {
  readonly name: string;
  /** Semver of minimum version required. */
  readonly minVersion?: string;
  /** Path hint or command to locate the binary. */
  readonly discoveryHint?: string;
}

/** High-level pricing model the agent uses. */
export interface AgentPricing {
  readonly model: 'free' | 'subscription' | 'usage-based' | 'byok';
  /** Free-form description, e.g. "Anthropic Pro plan required". */
  readonly details?: string;
}

/** Ed25519 signature of the manifest by the provider's publisher. */
export interface AgentSignature {
  readonly algorithm: 'ed25519';
  readonly publicKeyHex: string;
  readonly signatureHex: string;
  /** ISO8601 timestamp when the manifest was signed. */
  readonly signedAt: string;
}
