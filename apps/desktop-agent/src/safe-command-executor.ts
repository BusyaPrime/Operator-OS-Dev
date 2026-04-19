import type { Command } from '@operator-os/contracts';
import type { Logger } from 'pino';

import type { DesktopAgentEnv } from '@operator-os/config';

export class SafeCommandExecutor {
  #config: DesktopAgentEnv;
  #logger: Logger;

  constructor(config: DesktopAgentEnv, logger: Logger) {
    this.#config = config;
    this.#logger = logger;
  }

  async handle(command: Command) {
    if (!this.#config.ENABLE_COMMAND_EXECUTION) {
      this.#logger.warn(
        { command },
        'command execution is disabled; stub recorded the command without touching the OS'
      );
      return;
    }

    this.#logger.warn(
      { command },
      'command execution toggle is enabled, but bootstrap intentionally does not run hidden or destructive OS actions'
    );
  }
}
