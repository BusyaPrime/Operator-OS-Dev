import type { Logger } from 'pino';

import type { DesktopAgentEnv } from '@operator-os/config';

import { DesktopApiClient } from './api-client.js';
import { CommandPoller } from './command-poller.js';
import { ExportManager } from './export-manager.js';
import { HeartbeatLoop } from './heartbeat-loop.js';
import { Notifier } from './notifier.js';
import { SafeCommandExecutor } from './safe-command-executor.js';
import { SessionManager } from './session-manager.js';

export class DesktopRuntime {
  #apiClient: DesktopApiClient;
  #commandExecutor: SafeCommandExecutor;
  #commandPoller: CommandPoller;
  #exportManager: ExportManager;
  #heartbeatLoop: HeartbeatLoop;
  #logger: Logger;
  #notifier: Notifier;
  #sessionManager: SessionManager;

  constructor(config: DesktopAgentEnv, logger: Logger) {
    this.#logger = logger;
    this.#apiClient = new DesktopApiClient(config, logger);
    this.#heartbeatLoop = new HeartbeatLoop(config, this.#apiClient, logger);
    this.#commandPoller = new CommandPoller(config, this.#apiClient, logger);
    this.#commandExecutor = new SafeCommandExecutor(config, logger);
    this.#sessionManager = new SessionManager(config, this.#apiClient, logger);
    this.#exportManager = new ExportManager(config, this.#apiClient, logger);
    this.#notifier = new Notifier(this.#apiClient, logger);
  }

  start() {
    this.#logger.info('desktop runtime bootstrap starting');
    this.#heartbeatLoop.start();
    this.#commandPoller.start(async (command) => {
      await this.#commandExecutor.handle(command);
    });
  }

  async stop() {
    this.#logger.info('desktop runtime bootstrap stopping');
    this.#heartbeatLoop.stop();
    this.#commandPoller.stop();
    await this.#notifier.emitOperationalNotice(
      'Desktop runtime stopped cleanly during bootstrap.'
    );
  }

  get sessionManager() {
    return this.#sessionManager;
  }

  get exportManager() {
    return this.#exportManager;
  }
}
