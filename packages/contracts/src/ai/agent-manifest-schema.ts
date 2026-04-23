import { z } from 'zod';

/**
 * Runtime mirror of the `AgentCapability` union from `capabilities.ts`.
 * This enum is the trust boundary — agents declare capabilities at WS
 * hello time and the router consumes these names for subset matching
 * against task requirements. Keep in lock-step with the TS union: any
 * new capability added to `AgentCapability` must be added here too,
 * otherwise an agent that advertises it will fail runtime validation
 * and be excluded from dispatch.
 */
export const agentCapabilityEnum = z.enum([
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
]);

/**
 * Runtime mirror of `CapabilityDescriptor` (capabilities.ts:33). Providers
 * supply the capability name, its implementation semver, and optional
 * free-form caveats. Version is required (manifests without a version
 * are rejected).
 */
export const capabilityDescriptorSchema = z.object({
  capability: agentCapabilityEnum,
  version: z.string().min(1),
  limitations: z.string().optional()
});

/**
 * Lenient runtime schema for `AgentManifest` (agent-manifest.ts:13).
 *
 * Hard-asserts only the `capabilities` array — the router + dispatch
 * path is the ONLY Phase 3.2 consumer of the manifest, and it only
 * reads capabilities. Other manifest fields (providerId, author,
 * signature, pricing, requirements, …) are accepted via `.passthrough()`
 * so agents that ship a complete manifest are not rejected by the
 * router.
 *
 * Phase 3.3 (or a later hardening pass) should add a strict mode that
 * validates the full manifest on WS hello, including signature
 * verification for third-party providers.
 */
export const agentManifestSchema = z
  .object({
    capabilities: z.array(capabilityDescriptorSchema)
  })
  .passthrough();
