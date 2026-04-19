import { BigQuery } from '@google-cloud/bigquery';
import type { ApiEnv } from '@operator-os/config';
import type {
  Alert,
  Command,
  CostSnapshot,
  Session
} from '@operator-os/contracts';
import type { FastifyBaseLogger } from 'fastify';

import {
  buildConfiguredCheck,
  buildNotConfiguredCheck,
  detectApplicationDefaultCredentials
} from './runtime.js';

export class BigQueryAnalyticsWriter {
  readonly name = 'bigquery';

  #adcStatus = detectApplicationDefaultCredentials();
  #client?: BigQuery;
  #config: ApiEnv;
  #logger: FastifyBaseLogger;

  constructor(config: ApiEnv, logger: FastifyBaseLogger) {
    this.#config = config;
    this.#logger = logger;
  }

  describeReadiness() {
    if (!this.#adcStatus.available) {
      return buildNotConfiguredCheck('bigquery', this.#adcStatus.message, {
        dataset: this.#config.BIGQUERY_DATASET
      });
    }

    return buildConfiguredCheck(
      'bigquery',
      'BigQuery analytics writer is configured for typed control-plane events.',
      {
        dataset: this.#config.BIGQUERY_DATASET
      }
    );
  }

  writeCostSnapshot(snapshot: CostSnapshot) {
    return this.#insert('cost_snapshots', {
      ...snapshot,
      ingestedAt: new Date().toISOString()
    });
  }

  writeAlertEvent(alert: Alert) {
    return this.#insert('alert_events', {
      ...alert,
      ingestedAt: new Date().toISOString()
    });
  }

  writeSessionEvent(session: Session) {
    return this.#insert('session_events', {
      ...session,
      ingestedAt: new Date().toISOString()
    });
  }

  writeCommandEvent(command: Command) {
    return this.#insert('command_events', {
      ...command,
      ingestedAt: new Date().toISOString()
    });
  }

  async #insert(tableName: string, row: Record<string, unknown>) {
    if (!this.#adcStatus.available) {
      return false;
    }

    try {
      await this.#getClient()
        .dataset(this.#config.BIGQUERY_DATASET)
        .table(tableName)
        .insert([row]);
      return true;
    } catch (error) {
      this.#logger.warn({ err: error, tableName }, 'bigquery insert failed');
      return false;
    }
  }

  #getClient() {
    this.#client ??= new BigQuery({
      projectId: this.#config.GOOGLE_CLOUD_PROJECT
    });

    return this.#client;
  }
}
