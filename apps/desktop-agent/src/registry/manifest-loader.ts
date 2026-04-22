import type { AgentManifest } from '@operator-os/contracts';

import type { Logger } from 'pino';

/**
 * Strategy for loading `AgentManifest` values for the agents
 * listed in `config.enabledAgents`.
 *
 * Phase 1.4 scope: in-memory map keyed by provider short-name
 * (e.g. `'claude-code'` → the static manifest bundled with
 * `ClaudeCodeAgent`). First-party agents ship their manifest as
 * a TS module under `src/agents/<name>/manifest.ts`; the
 * `ManifestLoader` reads from a provided registry rather than
 * touching disk.
 *
 * Disk-based loading (signed `provider.manifest.json` files
 * under `~/.operator-os/providers/`) per SPEC § 27.5 is Week 3
 * work; this class's shape already supports that extension — a
 * future subclass can override `load()` without the caller
 * noticing.
 */
export class ManifestLoader {
  #sources: Map<string, AgentManifest>;
  #logger: Logger;

  constructor(
    sources: ReadonlyMap<string, AgentManifest>,
    logger: Logger
  ) {
    this.#sources = new Map(sources);
    this.#logger = logger.child({ component: 'manifest-loader' });
  }

  /**
   * Resolve a manifest for a short provider name (as it appears
   * in `config.enabledAgents`). Throws if not known.
   */
  load(providerShortName: string): AgentManifest {
    const manifest = this.#sources.get(providerShortName);
    if (manifest === undefined) {
      this.#logger.error(
        {
          providerShortName,
          knownProviders: [...this.#sources.keys()]
        },
        'manifest not found'
      );
      throw new Error(
        `ManifestLoader: no manifest registered for '${providerShortName}'.` +
          ` Known providers: [${[...this.#sources.keys()].join(', ')}]`
      );
    }
    return manifest;
  }

  /**
   * List provider short-names that have a manifest registered.
   */
  availableProviders(): readonly string[] {
    return [...this.#sources.keys()];
  }
}
