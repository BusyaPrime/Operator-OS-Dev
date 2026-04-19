import type { ExportJob } from '@operator-os/contracts';
import type { Logger } from 'pino';

import type { DesktopAgentEnv } from '@operator-os/config';

import type { DesktopApiClient } from './api-client.js';

export class ExportManager {
  #apiClient: DesktopApiClient;
  #config: DesktopAgentEnv;
  #logger: Logger;

  constructor(config: DesktopAgentEnv, apiClient: DesktopApiClient, logger: Logger) {
    this.#apiClient = apiClient;
    this.#config = config;
    this.#logger = logger;
  }

  async queueExport(type: ExportJob['type']) {
    const exportJob: ExportJob = {
      id: `export-${Date.now()}`,
      type,
      status: 'queued',
      deviceId: this.#config.DEVICE_ID,
      destinationBucket: this.#config.EXPORTS_BUCKET,
      requestedAt: new Date().toISOString(),
      metadata: {
        runtime: 'desktop-agent'
      }
    };

    this.#logger.info({ exportJob }, 'export stub queued');
    await this.#apiClient.reportExport(exportJob);

    return exportJob;
  }
}
