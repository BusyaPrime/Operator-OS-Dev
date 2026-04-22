import type { AgentManifest } from '@operator-os/contracts';

/**
 * Static manifest for the first-party Claude Code agent.
 *
 * Ships as a TS module under the agent's own folder (SPEC § 27.5
 * allows first-party manifests to be code-loaded; disk-based
 * signed manifests are for third-party providers). The
 * `ManifestLoader` picks this up through the
 * `providerShortName → AgentManifest` map wired into
 * `DesktopRuntime`.
 *
 * The `providerVersion` tracks the *wrapper* version (how we
 * drive the Claude Code CLI), not the CLI itself. The CLI's own
 * version shows up at runtime through the AIAgent identity.
 */
export const claudeCodeManifest: AgentManifest = {
  manifestVersion: '1',
  providerId: 'anthropic.claude-code',
  providerVersion: '0.1.0',
  displayName: 'Claude Code',
  description:
    "Anthropic's agentic coding CLI. Wraps the `claude` binary; " +
    'streams tokens, tool calls, and progress events back to the ' +
    'control surface via the StreamProvider, with FS access gated ' +
    'by the FileSystemProvider scope.',
  author: 'Operator-OS',
  homepage: 'https://www.anthropic.com/claude-code',
  license: 'MIT',
  capabilities: [
    { capability: 'code-generation', version: '1.0.0' },
    { capability: 'code-review', version: '1.0.0' },
    { capability: 'planning', version: '1.0.0' },
    { capability: 'file-read', version: '1.0.0' },
    { capability: 'file-write', version: '1.0.0' },
    { capability: 'shell-execution', version: '1.0.0' },
    { capability: 'tool-use', version: '1.0.0' },
    { capability: 'streaming', version: '1.0.0' },
    { capability: 'long-context', version: '1.0.0' },
    { capability: 'extended-context', version: '1.0.0' }
  ],
  requirements: {
    minNodeVersion: '20.0.0',
    requiredBinaries: [
      {
        name: 'claude',
        discoveryHint: 'Install via `npm i -g @anthropic-ai/claude-code`'
      }
    ]
  },
  pricing: {
    model: 'byok',
    details:
      'Requires an Anthropic API key or an active Claude subscription ' +
      '(Pro / Team / Enterprise). The Desktop Agent never holds the ' +
      'key — it inherits the CLI login on the host.'
  }
  // No signature — first-party agent shipped with Operator-OS.
};
