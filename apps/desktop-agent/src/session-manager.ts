import type { Session } from '@operator-os/contracts';
import type { Logger } from 'pino';

import type { DesktopAgentEnv } from '@operator-os/config';

import type { DesktopApiClient } from './api-client.js';

export class SessionManager {
  #apiClient: DesktopApiClient;
  #config: DesktopAgentEnv;
  #logger: Logger;

  constructor(config: DesktopAgentEnv, apiClient: DesktopApiClient, logger: Logger) {
    this.#apiClient = apiClient;
    this.#config = config;
    this.#logger = logger;
  }

  async openVisibleSession(): Promise<Session> {
    const session: Session = {
      id: `session-${Date.now()}`,
      deviceId: this.#config.DEVICE_ID,
      operatorId: 'bootstrap-operator',
      status: 'pending',
      mode: 'trusted',
      visibility: 'visible',
      createdAt: new Date().toISOString()
    };

    this.#logger.info({ session }, 'visible session stub created');
    await this.#apiClient.reportSession(session);

    return session;
  }

  async closeVisibleSession(session: Session) {
    const closedSession: Session = {
      ...session,
      status: 'ended',
      endedAt: new Date().toISOString()
    };

    this.#logger.info({ session: closedSession }, 'visible session stub closed');
    await this.#apiClient.reportSession(closedSession);

    return closedSession;
  }
}
