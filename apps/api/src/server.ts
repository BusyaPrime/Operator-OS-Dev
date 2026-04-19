import 'dotenv/config';

import { parseApiEnv } from '@operator-os/config';

import { buildServer } from './app.js';

const config = parseApiEnv(process.env);
const app = buildServer(config);

let shuttingDown = false;

const shutdown = async (signal: string) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.info({ signal }, 'graceful shutdown started');

  try {
    await app.close();
    app.log.info({ signal }, 'graceful shutdown finished');
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error, signal }, 'graceful shutdown failed');
    process.exit(1);
  }
};

const start = async () => {
  try {
    await app.listen({
      host: config.HOST,
      port: config.PORT
    });
  } catch (error) {
    app.log.error({ err: error }, 'failed to start api');
    process.exit(1);
  }
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

void start();
