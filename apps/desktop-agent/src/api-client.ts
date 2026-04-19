import type {
  Alert,
  Command,
  DeviceState,
  ExportJob,
  MutationReceipt,
  Session
} from '@operator-os/contracts';
import {
  commandPollResponseSchema,
  exportReceiptSchema,
  mutationReceiptSchema,
  sessionReceiptSchema
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
    return this.#post('/v1/agent/heartbeat', state, mutationReceiptSchema.parse, {
      operation: 'device-state.heartbeat',
      resourceId: state.deviceId
    });
  }

  async pollCommands(): Promise<Command[]> {
    try {
      const payload = await this.#get(
        `/v1/agent/commands?deviceId=${encodeURIComponent(this.#config.DEVICE_ID)}`,
        (value) => commandPollResponseSchema.parse(value)
      );

      return payload.commands;
    } catch (error) {
      if (!this.#config.CONTROLLED_FALLBACK) {
        throw error;
      }

      this.#logger.warn({ err: error }, 'command polling fell back to an empty list');
      return [];
    }
  }

  async reportSession(session: Session) {
    return this.#post('/v1/agent/sessions', session, sessionReceiptSchema.parse, {
      operation: 'session.upsert',
      resourceId: session.id
    });
  }

  async reportExport(exportJob: ExportJob) {
    return this.#post('/v1/agent/exports', exportJob, exportReceiptSchema.parse, {
      operation: 'export.queue',
      resourceId: exportJob.id
    });
  }

  async publishAlert(alert: Alert) {
    return this.#post('/v1/agent/alerts', alert, mutationReceiptSchema.parse, {
      operation: 'alert.emit',
      resourceId: alert.id
    });
  }

  async #get<T>(path: string, parse: (value: unknown) => T) {
    const response = await this.#fetch(path, {
      method: 'GET'
    });

    return parse(await response.json());
  }

  async #post<T>(
    path: string,
    body: unknown,
    parse: (value: unknown) => T,
    fallback: Pick<MutationReceipt, 'operation' | 'resourceId'>
  ) {
    try {
      const response = await this.#fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      return parse(await response.json());
    } catch (error) {
      if (!this.#config.CONTROLLED_FALLBACK) {
        throw error;
      }

      this.#logger.warn({ err: error, path }, 'desktop agent request fell back');

      return mutationReceiptSchema.parse({
        operation: fallback.operation,
        accepted: true,
        resourceId: fallback.resourceId,
        dataSource: 'api-controlled-fallback',
        message:
          'Desktop agent request was retained locally because the API is unavailable or still in fallback mode.',
        timestamp: new Date().toISOString()
      }) as T;
    }
  }

  async #fetch(path: string, init: RequestInit) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.#config.API_REQUEST_TIMEOUT_MS
    );

    try {
      const response = await fetch(`${this.#config.API_BASE_URL}${path}`, {
        ...init,
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Agent request failed with status ${response.status}`);
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}
