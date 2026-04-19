import type { Logger } from 'pino';

import type { DesktopAgentEnv } from '@operator-os/config';

import type { DesktopApiClient } from './api-client.js';
import { createDeviceStateSnapshot } from './device-state.js';

export class HeartbeatLoop {
  #apiClient: DesktopApiClient;
  #config: DesktopAgentEnv;
  #logger: Logger;
  #timer?: NodeJS.Timeout;

  constructor(config: DesktopAgentEnv, apiClient: DesktopApiClient, logger: Logger) {
    this.#apiClient = apiClient;
    this.#config = config;
    this.#logger = logger;
  }

  start() {
    this.#logger.info(
      { intervalMs: this.#config.HEARTBEAT_INTERVAL_MS },
      'starting heartbeat loop'
    );

    this.#timer = setInterval(() => {
      void this.tick();
    }, this.#config.HEARTBEAT_INTERVAL_MS);

    void this.tick();
  }

  stop() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  async tick() {
    const snapshot = createDeviceStateSnapshot(this.#config, 'ready');
    await this.#apiClient.postHeartbeat(snapshot);
  }
}
