import 'dotenv/config';

import os from 'node:os';
import path from 'node:path';

import { ClaudeCodeAgent } from './agents/claude-code-agent/claude-code-agent.js';
import { claudeCodeManifest } from './agents/claude-code-agent/manifest.js';
import {
  CapturingStreamProvider,
  createClaudeCodeAgentExecutor
} from './agents/claude-code-agent/task-executor-adapter.js';
import {
  buildEchoStubCapabilities,
  buildEchoStubManifest,
  createEchoStubExecutor
} from './agents/echo-stub-agent/index.js';
import {
  AGENT_TOKEN_TARGET,
  DpapiCredentialStore
} from './auth/credential-store.js';
import { FatalAuthHandler } from './auth/fatal-auth-handler.js';
import { TokenRotator } from './auth/token-rotator.js';
import { getDesktopAgentConfig } from './config.js';
import { createLogger } from './logger.js';
import {
  ControlChannelWs,
  type TaskExecutor
} from './providers/control-channel-ws.js';
import { ApiCostProvider } from './providers/api-cost-provider.js';
import { NodeFileSystemProvider } from './providers/node-filesystem-provider.js';
import { DesktopRuntime } from './runtime.js';

const config = getDesktopAgentConfig();
const logger = createLogger(config);
const runtime = new DesktopRuntime(config, logger);

// ---------------------------------------------------------------------------
// Phase 3.3 control-channel executor selection.
//
// `DESKTOP_AGENT_EXECUTOR` env var picks which `TaskExecutor` the
// Phase 3.2 ControlChannelWs uses for inbound `task-assign` frames:
//
//   'claude-code'  — real ClaudeCodeAgent + CapturingStreamProvider
//                    (production default; spawns the `claude` CLI)
//   'echo-stub'    — Phase 3.2 echo executor (returns 'echo: <prompt>',
//                    no API cost; useful for dev/test/offline)
//   undefined      — defaults to 'claude-code' (fail-safe to real)
//
// If the requested executor is 'claude-code' but agent.start() fails
// (e.g. the `claude` binary is not installed), we log a warning and
// gracefully fall back to the echo-stub so the rest of DesktopRuntime
// stays operational. The fallback is intentional per Phase 3.3 hard
// constraint #3: the echo stub is preserved as a safety net.
// ---------------------------------------------------------------------------

interface ExecutorSetup {
  readonly mode: 'claude-code' | 'echo-stub';
  readonly executor: TaskExecutor;
  readonly manifest: Record<string, unknown>;
  readonly supportedCapabilities: ReadonlySet<string>;
  readonly claudeCodeAgent?: ClaudeCodeAgent;
}

const buildEchoStubSetup = (): ExecutorSetup => ({
  mode: 'echo-stub',
  executor: createEchoStubExecutor(),
  manifest: buildEchoStubManifest(),
  supportedCapabilities: buildEchoStubCapabilities()
});

const buildClaudeCodeSetup = async (): Promise<ExecutorSetup> => {
  const fs = new NodeFileSystemProvider(
    {
      allowedRoots: [process.cwd()],
      readOnly: false
    },
    logger
  );
  const cost = new ApiCostProvider(logger);
  const streamProvider = new CapturingStreamProvider();
  const agent = new ClaudeCodeAgent({
    identity: {
      id: config.AGENT_ID,
      providerId: claudeCodeManifest.providerId,
      providerVersion: claudeCodeManifest.providerVersion,
      displayName: claudeCodeManifest.displayName,
      hostname: os.hostname(),
      platform: process.platform as 'win32' | 'darwin' | 'linux',
      arch: process.arch
    },
    manifest: claudeCodeManifest,
    fs,
    stream: streamProvider,
    cost,
    logger,
    userId: config.AGENT_ID
  });
  await agent.start();
  return {
    mode: 'claude-code',
    executor: createClaudeCodeAgentExecutor({ agent, streamProvider }),
    manifest: claudeCodeManifest as unknown as Record<string, unknown>,
    supportedCapabilities: new Set(
      claudeCodeManifest.capabilities.map((c) => c.capability)
    ),
    claudeCodeAgent: agent
  };
};

const requestedMode = (process.env.DESKTOP_AGENT_EXECUTOR ?? 'claude-code') as
  | 'claude-code'
  | 'echo-stub';

let executorSetup: ExecutorSetup;
if (requestedMode === 'echo-stub') {
  executorSetup = buildEchoStubSetup();
  logger.info(
    { source: 'main', mode: executorSetup.mode },
    'control-channel executor: echo-stub (DESKTOP_AGENT_EXECUTOR=echo-stub)'
  );
} else {
  try {
    executorSetup = await buildClaudeCodeSetup();
    logger.info(
      { source: 'main', mode: executorSetup.mode },
      'control-channel executor: real ClaudeCodeAgent — agent.start() succeeded'
    );
  } catch (err) {
    executorSetup = buildEchoStubSetup();
    logger.warn(
      { err, source: 'main', requestedMode },
      'ClaudeCodeAgent.start() failed (binary missing? install via `npm i -g @anthropic-ai/claude-code`) — falling back to echo-stub for this session'
    );
  }
}

// ---------------------------------------------------------------------------
// Phase 4.0 Part 4 wiring — agent-side token management.
//
// Composition order:
//
//   1. DpapiCredentialStore reads the per-machine token
//      from `%APPDATA%/OperatorOS/.credentials/...` (Part 4.A).
//      Only constructed when CONTROL_CHANNEL_URL is set; legacy
//      CONTROL_CHANNEL_TOKEN env path stays as a fallback for
//      dev / one-off testing.
//
//   2. FatalAuthHandler subscribes to TokenAuthSignals
//      .onUnauthorized; on first 401 it logs structured
//      fatal + exits with code 87 (Part 4.F). The Phase 4.0
//      Part 6 install script's Scheduled Task XML knows
//      about this code.
//
//   3. TokenRotator watches for X-Token-Rotation-Recommended
//      observations from the REST + WS paths. Every rotation
//      writes the new token back to the CredentialStore so
//      the next REST/WS call picks it up automatically
//      (Part 4.C + 4.D + 4.E).
//
//   4. ControlChannelWs reads its bearer token via a fresh
//      tokenProvider closure that hits the CredentialStore on
//      every connect / reconnect.
//
// All four components share the SAME `TokenAuthSignals` value
// built by `fatalHandler.attachTo(rotator.triggerRotation)`.
// ---------------------------------------------------------------------------

const controlChannelUrl = process.env.CONTROL_CHANNEL_URL;
const legacyControlChannelToken = process.env.CONTROL_CHANNEL_TOKEN;
const apiBaseUrl = config.API_BASE_URL;

const credentialStore = new DpapiCredentialStore();
const fatalAuthHandler = new FatalAuthHandler({ logger });

let tokenRotator: TokenRotator | undefined;
let storedAgentToken: string | null = null;

if (controlChannelUrl !== undefined) {
  try {
    storedAgentToken = await credentialStore.getToken(AGENT_TOKEN_TARGET);
  } catch (err) {
    logger.warn(
      { err, source: 'main' },
      'credential store read failed at startup; falling back to env var if set'
    );
  }
}

const authSignals = fatalAuthHandler.attachTo(() => {
  tokenRotator?.triggerRotation();
});

if (storedAgentToken !== null) {
  tokenRotator = new TokenRotator({
    apiBaseUrl,
    credentialStore,
    authSignals,
    logger,
    fetch: globalThis.fetch
  });
}

const controlChannel = controlChannelUrl
  ? new ControlChannelWs({
      url: controlChannelUrl,
      // Production: tokenProvider reads from the credential
      // store on every (re)connect. Backward-compat fallback:
      // the legacy CONTROL_CHANNEL_TOKEN env var if no token
      // is in the store.
      ...(storedAgentToken !== null
        ? {
            tokenProvider: () =>
              credentialStore.getToken(AGENT_TOKEN_TARGET),
            authSignals
          }
        : legacyControlChannelToken
          ? { authToken: legacyControlChannelToken }
          : { tokenProvider: async () => null, authSignals }),
      agentId: config.AGENT_ID,
      manifest: executorSetup.manifest,
      executor: executorSetup.executor,
      supportedCapabilities: executorSetup.supportedCapabilities,
      logger
    })
  : undefined;

let shuttingDown = false;

const shutdown = async (signal: string) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ signal }, 'desktop runtime shutdown requested');

  try {
    await tokenRotator?.stop();
    await controlChannel?.stop();
    if (executorSetup.claudeCodeAgent) {
      await executorSetup.claudeCodeAgent.stop('shutdown');
    }
    await runtime.stop();
    process.exit(0);
  } catch (error) {
    logger.error({ err: error, signal }, 'desktop runtime shutdown failed');
    process.exit(1);
  }
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

void runtime.start().catch((err) => {
  logger.error({ err }, 'desktop runtime failed to start');
  process.exit(1);
});

if (controlChannel) {
  logger.info(
    {
      source: 'main',
      url: controlChannelUrl,
      executor: executorSetup.mode,
      authMode: storedAgentToken !== null ? 'credential-store' : 'legacy-env'
    },
    'starting Phase 3.2 control channel'
  );
  controlChannel.start();
}

if (tokenRotator) {
  logger.info(
    { source: 'main', apiBaseUrl },
    'starting Phase 4.0 token rotator (periodic safety net)'
  );
  tokenRotator.start();
}

// path import keeps the dependency declared even when scoping is
// trivial today; future hardening (per-task allowedRoots based on
// task metadata) hooks in here.
void path;
