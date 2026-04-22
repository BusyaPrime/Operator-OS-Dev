import { randomUUID } from 'node:crypto';
import os from 'node:os';

import type {
  AgentManifest,
  AIAgent,
  AIAgentIdentity,
  CostProvider,
  FileSystemProvider,
  StreamProvider
} from '@operator-os/contracts';
import type { Logger } from 'pino';

import type { DesktopAgentEnv } from '@operator-os/config';

import { ClaudeCodeAgent } from './agents/claude-code-agent/claude-code-agent.js';
import { claudeCodeManifest } from './agents/claude-code-agent/manifest.js';
import { DesktopApiClient } from './api-client.js';
import { CommandPoller } from './command-poller.js';
import { ExportManager } from './export-manager.js';
import {
  AgentHeartbeatLoop,
  type AgentHeartbeatPoster
} from './heartbeat/agent-heartbeat-loop.js';
import { HeartbeatLoop } from './heartbeat-loop.js';
import { Notifier } from './notifier.js';
import { ApiCostProvider } from './providers/api-cost-provider.js';
import { NodeFileSystemProvider } from './providers/node-filesystem-provider.js';
import { WebSocketStreamProvider } from './providers/websocket-stream-provider.js';
import { AgentRegistry } from './registry/agent-registry.js';
import { ManifestLoader } from './registry/manifest-loader.js';
import { SafeCommandExecutor } from './safe-command-executor.js';
import { SessionManager } from './session-manager.js';

/**
 * Arguments passed to every AgentFactory. Each enabled agent
 * receives its own provider instances so policy drift (e.g. a
 * stricter FS scope for a review agent) is a per-provider
 * swap, not a runtime-wide change.
 */
export interface AgentFactoryContext {
  readonly identity: AIAgentIdentity;
  readonly manifest: AgentManifest;
  readonly fs: FileSystemProvider;
  readonly stream: StreamProvider;
  readonly cost: CostProvider;
  readonly logger: Logger;
  readonly userId: string;
}

/**
 * Produces a concrete `AIAgent` from the shared DI-context.
 * Tests inject fakes; production defaults build first-party
 * agents (currently only Claude Code).
 */
export type AgentFactory = (ctx: AgentFactoryContext) => AIAgent;

export interface DesktopRuntimeOptions {
  /**
   * Provider shortName → factory. Overrides / extends the
   * first-party map. Unknown shortNames in
   * `config.ENABLED_AGENTS` are logged and skipped.
   */
  readonly agentFactories?: Record<string, AgentFactory>;
  /**
   * Custom manifest sources, keyed by provider shortName. Merges
   * on top of first-party defaults. Useful for tests that want
   * to exercise a fake provider without inventing a manifest on
   * the fly.
   */
  readonly manifestSources?: ReadonlyMap<string, AgentManifest>;
  /** Injectable heartbeat poster (tests; default uses fetch). */
  readonly heartbeatPoster?: AgentHeartbeatPoster;
}

const FIRST_PARTY_MANIFESTS: ReadonlyMap<string, AgentManifest> = new Map([
  ['claude-code', claudeCodeManifest]
]);

const FIRST_PARTY_FACTORIES: Record<string, AgentFactory> = {
  'claude-code': (ctx) =>
    new ClaudeCodeAgent({
      identity: ctx.identity,
      manifest: ctx.manifest,
      fs: ctx.fs,
      stream: ctx.stream,
      cost: ctx.cost,
      logger: ctx.logger,
      userId: ctx.userId
    })
};

const normalisePlatform = (): 'win32' | 'darwin' | 'linux' => {
  const p = process.platform;
  if (p === 'win32' || p === 'darwin' || p === 'linux') return p;
  // Unsupported platforms don't exist in the AIAgentIdentity
  // union. Surface this up front rather than silently mislabel.
  throw new Error(`Unsupported host platform: ${p}`);
};

const deriveWsUrl = (apiBaseUrl: string): string => {
  const ws = apiBaseUrl.replace(/^http(s?):\/\//, 'ws$1://');
  return `${ws.replace(/\/$/, '')}/v1/agent/ws`;
};

const defaultHeartbeatPoster =
  (apiBaseUrl: string, timeoutMs: number, logger: Logger): AgentHeartbeatPoster =>
  async (request) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(
        `${apiBaseUrl.replace(/\/$/, '')}/v1/agent/heartbeat/agent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: controller.signal
        }
      );
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // 204 / non-JSON bodies — leave body as null; the loop
        // will zod-reject it and count as a failure.
      }
      return { status: response.status, body };
    } catch (err) {
      logger.debug(
        { err },
        'agent-heartbeat poster network error (bubbling to loop)'
      );
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

export class DesktopRuntime {
  #apiClient: DesktopApiClient;
  #commandExecutor: SafeCommandExecutor;
  #commandPoller: CommandPoller;
  #exportManager: ExportManager;
  #heartbeatLoop: HeartbeatLoop;
  #logger: Logger;
  #notifier: Notifier;
  #sessionManager: SessionManager;

  // --- Phase 1.4 additions ---
  #agentRegistry: AgentRegistry;
  #manifestLoader: ManifestLoader;
  #agents: AIAgent[] = [];
  #agentHeartbeatLoop: AgentHeartbeatLoop;

  constructor(
    config: DesktopAgentEnv,
    logger: Logger,
    options: DesktopRuntimeOptions = {}
  ) {
    this.#logger = logger;
    this.#apiClient = new DesktopApiClient(config, logger);
    this.#heartbeatLoop = new HeartbeatLoop(config, this.#apiClient, logger);
    this.#commandPoller = new CommandPoller(config, this.#apiClient, logger);
    this.#commandExecutor = new SafeCommandExecutor(config, logger);
    this.#sessionManager = new SessionManager(config, this.#apiClient, logger);
    this.#exportManager = new ExportManager(config, this.#apiClient, logger);
    this.#notifier = new Notifier(this.#apiClient, logger);

    // Universal AI provider registry + agents.
    this.#agentRegistry = new AgentRegistry(logger);

    const manifestSources = new Map<string, AgentManifest>(
      FIRST_PARTY_MANIFESTS
    );
    if (options.manifestSources) {
      for (const [k, v] of options.manifestSources) manifestSources.set(k, v);
    }
    this.#manifestLoader = new ManifestLoader(manifestSources, logger);

    const factories: Record<string, AgentFactory> = {
      ...FIRST_PARTY_FACTORIES,
      ...(options.agentFactories ?? {})
    };

    this.#agents = this.#buildAgents(config, logger, factories);

    const poster =
      options.heartbeatPoster ??
      defaultHeartbeatPoster(
        config.API_BASE_URL,
        config.API_REQUEST_TIMEOUT_MS,
        logger
      );

    this.#agentHeartbeatLoop = new AgentHeartbeatLoop({
      registry: this.#agentRegistry,
      logger,
      poster,
      intervalMs: config.HEARTBEAT_INTERVAL_MS
    });
  }

  async start(): Promise<void> {
    this.#logger.info('desktop runtime bootstrap starting');
    this.#heartbeatLoop.start();
    this.#commandPoller.start(async (command) => {
      await this.#commandExecutor.handle(command);
    });

    for (const agent of this.#agents) {
      try {
        await agent.start();
      } catch (err) {
        this.#logger.warn(
          {
            err,
            agentId: agent.identity.id,
            providerId: agent.identity.providerId
          },
          'agent failed to start — skipping; other agents continue'
        );
        // Keep the agent in the registry so the heartbeat loop
        // reports its 'degraded' state to observers. A later
        // start() retry can transition it back to idle.
      }
    }

    this.#agentHeartbeatLoop.start();
  }

  async stop(): Promise<void> {
    this.#logger.info('desktop runtime bootstrap stopping');
    this.#agentHeartbeatLoop.stop();
    this.#heartbeatLoop.stop();
    this.#commandPoller.stop();

    for (const agent of this.#agents) {
      try {
        await agent.stop('shutdown');
      } catch (err) {
        this.#logger.warn(
          { err, agentId: agent.identity.id },
          'agent stop threw — continuing shutdown'
        );
      }
    }

    await this.#notifier.emitOperationalNotice(
      'Desktop runtime stopped cleanly during bootstrap.'
    );
  }

  get sessionManager() {
    return this.#sessionManager;
  }

  get exportManager() {
    return this.#exportManager;
  }

  /** Agents registered and ready for routing. Read-only snapshot. */
  get agents(): readonly AIAgent[] {
    return [...this.#agents];
  }

  /** Registry for subscribers (UI, telemetry). Read-only handle. */
  get agentRegistry(): AgentRegistry {
    return this.#agentRegistry;
  }

  /** Heartbeat loop instance — exposed so tests can drive `tick()` directly. */
  get agentHeartbeatLoop(): AgentHeartbeatLoop {
    return this.#agentHeartbeatLoop;
  }

  // ---------- internals ----------

  #buildAgents(
    config: DesktopAgentEnv,
    logger: Logger,
    factories: Record<string, AgentFactory>
  ): AIAgent[] {
    const built: AIAgent[] = [];
    const platform = normalisePlatform();
    const hostname = os.hostname();
    const streamUrl = deriveWsUrl(config.API_BASE_URL);

    for (const shortName of config.ENABLED_AGENTS) {
      const factory = factories[shortName];
      if (factory === undefined) {
        logger.warn(
          { shortName, knownFactories: Object.keys(factories) },
          'enabled agent has no factory — skipping'
        );
        continue;
      }

      let manifest: AgentManifest;
      try {
        manifest = this.#manifestLoader.load(shortName);
      } catch (err) {
        logger.error(
          { err, shortName },
          'manifest load failed — skipping this agent'
        );
        continue;
      }

      const fs = new NodeFileSystemProvider(
        {
          allowedRoots: config.FS_ALLOWED_ROOTS,
          readOnly: config.FS_READ_ONLY,
          maxFileSizeBytes: config.FS_MAX_FILE_SIZE_BYTES,
          maxTotalWriteBytes: config.FS_MAX_TOTAL_WRITE_BYTES
        },
        logger
      );
      const stream = new WebSocketStreamProvider(
        {
          url: streamUrl,
          // Auth flow not yet wired into desktop-agent (TD). The
          // stream provider sends whatever is in the bearer —
          // empty today, real token once the gateway integration
          // lands. Until then, the api-side endpoint itself is
          // also pending (TD-017), so empty-token failures stay
          // behind the same gate as the endpoint's existence.
          accessToken: ''
        },
        logger
      );
      const cost = new ApiCostProvider(logger);

      const identity: AIAgentIdentity = {
        id: randomUUID(),
        providerId: manifest.providerId,
        providerVersion: manifest.providerVersion,
        displayName: manifest.displayName,
        hostname,
        platform,
        arch: process.arch
      };

      const agent = factory({
        identity,
        manifest,
        fs,
        stream,
        cost,
        logger,
        userId: config.AGENT_USER_ID
      });

      built.push(agent);
      this.#agentRegistry.register(agent);
      logger.info(
        {
          agentId: identity.id,
          providerId: identity.providerId,
          shortName
        },
        'agent registered'
      );
    }

    return built;
  }
}
