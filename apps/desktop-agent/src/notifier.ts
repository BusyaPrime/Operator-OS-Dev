import type { Alert } from '@operator-os/contracts';
import type { Logger } from 'pino';

import type { DesktopApiClient } from './api-client.js';

export class Notifier {
  #apiClient: DesktopApiClient;
  #logger: Logger;

  constructor(apiClient: DesktopApiClient, logger: Logger) {
    this.#apiClient = apiClient;
    this.#logger = logger;
  }

  async emitOperationalNotice(message: string) {
    const alert: Alert = {
      id: `alert-${Date.now()}`,
      source: 'desktop-agent',
      severity: 'info',
      status: 'open',
      title: 'Desktop runtime notice',
      message,
      createdAt: new Date().toISOString(),
      metadata: {
        transparentRuntime: true
      }
    };

    this.#logger.info({ alert }, 'operational notice emitted');
    await this.#apiClient.publishAlert(alert);
  }
}
