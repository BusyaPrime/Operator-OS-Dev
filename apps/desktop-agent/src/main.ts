import 'dotenv/config';

import { getDesktopAgentConfig } from './config.js';
import { createLogger } from './logger.js';
import { DesktopRuntime } from './runtime.js';

const config = getDesktopAgentConfig();
const logger = createLogger(config);
const runtime = new DesktopRuntime(config, logger);

let shuttingDown = false;

const shutdown = async (signal: string) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ signal }, 'desktop runtime shutdown requested');

  try {
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

runtime.start();
