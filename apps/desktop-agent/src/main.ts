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

const controlChannelUrl = process.env.CONTROL_CHANNEL_URL;
const controlChannelToken = process.env.CONTROL_CHANNEL_TOKEN;
const controlChannel =
  controlChannelUrl && controlChannelToken
    ? new ControlChannelWs({
        url: controlChannelUrl,
        authToken: controlChannelToken,
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
      executor: executorSetup.mode
    },
    'starting Phase 3.2 control channel'
  );
  controlChannel.start();
}

// path import keeps the dependency declared even when scoping is
// trivial today; future hardening (per-task allowedRoots based on
// task metadata) hooks in here.
void path;
