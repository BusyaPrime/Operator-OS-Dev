import type {
  Alert,
  Command,
  DeviceState,
  ExportJob,
  Session
} from '@operator-os/contracts';
import type { Logger } from 'pino';

import type { DesktopAgentEnv } from '@operator-os/config';

export class DesktopApiClient {
  #config: DesktopAgentEnv;
  #logger: Logger;

  constructor(config: DesktopAgentEnv, logger: Logger) {
    this.#config = config;
    this.#logger = logger;
  }

  async postHeartbeat(state: DeviceState) {
    this.#logger.info(
      {
        apiBaseUrl: this.#config.API_BASE_URL,
        state
      },
      'heartbeat stub emitted'
    );
  }

  async pollCommands(): Promise<Command[]> {
    this.#logger.debug(
      {
        apiBaseUrl: this.#config.API_BASE_URL
      },
      'command poll stub executed'
    );

    return [];
  }

  async reportSession(session: Session) {
    this.#logger.info({ session }, 'session stub reported');
  }

  async reportExport(exportJob: ExportJob) {
    this.#logger.info({ exportJob }, 'export job stub reported');
  }

  async publishAlert(alert: Alert) {
    this.#logger.warn({ alert }, 'notifier stub emitted alert');
  }
}
