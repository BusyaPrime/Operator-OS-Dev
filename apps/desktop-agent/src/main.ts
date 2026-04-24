import 'dotenv/config';

import {
  createEchoStubExecutor,
  buildEchoStubManifest,
  buildEchoStubCapabilities
} from './agents/echo-stub-agent/index.js';
import { getDesktopAgentConfig } from './config.js';
import { createLogger } from './logger.js';
import { ControlChannelWs } from './providers/control-channel-ws.js';
import { DesktopRuntime } from './runtime.js';

const config = getDesktopAgentConfig();
const logger = createLogger(config);
const runtime = new DesktopRuntime(config, logger);

// Phase 3.2 control channel. Gated on CONTROL_CHANNEL_URL +
// CONTROL_CHANNEL_TOKEN env vars being set — if absent, the desktop
// runtime starts normally and the control channel does not attempt
// to connect. Full wire-up against the real agent-auth flow lands in
// Phase 3.3 (tracked as TD-037).
const controlChannelUrl = process.env.CONTROL_CHANNEL_URL;
const controlChannelToken = process.env.CONTROL_CHANNEL_TOKEN;
const controlChannel =
  controlChannelUrl && controlChannelToken
    ? new ControlChannelWs({
        url: controlChannelUrl,
        authToken: controlChannelToken,
        agentId: config.AGENT_ID,
        manifest: buildEchoStubManifest(),
        executor: createEchoStubExecutor(),
        supportedCapabilities: buildEchoStubCapabilities(),
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
    { source: 'main', url: controlChannelUrl },
    'starting Phase 3.2 control channel'
  );
  controlChannel.start();
}
