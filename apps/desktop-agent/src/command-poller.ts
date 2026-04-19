import type { Command } from '@operator-os/contracts';
import type { Logger } from 'pino';

import type { DesktopAgentEnv } from '@operator-os/config';

import type { DesktopApiClient } from './api-client.js';

export class CommandPoller {
  #apiClient: DesktopApiClient;
  #config: DesktopAgentEnv;
  #logger: Logger;
  #timer?: NodeJS.Timeout;

  constructor(config: DesktopAgentEnv, apiClient: DesktopApiClient, logger: Logger) {
    this.#apiClient = apiClient;
    this.#config = config;
    this.#logger = logger;
  }

  start(onCommand: (command: Command) => Promise<void>) {
    this.#logger.info(
      { intervalMs: this.#config.COMMAND_POLL_INTERVAL_MS },
      'starting command polling loop'
    );

    this.#timer = setInterval(() => {
      void this.tick(onCommand);
    }, this.#config.COMMAND_POLL_INTERVAL_MS);
  }

  stop() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  async tick(onCommand: (command: Command) => Promise<void>) {
    const commands = await this.#apiClient.pollCommands();

    for (const command of commands) {
      await onCommand(command);
    }
  }
}
