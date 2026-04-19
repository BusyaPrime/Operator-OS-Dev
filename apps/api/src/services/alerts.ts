import { alertSchema, mutationReceiptSchema } from '@operator-os/contracts';
import type { FastifyBaseLogger } from 'fastify';

import type { BigQueryAnalyticsWriter } from '../integrations/bigquery.js';
import type { FirestoreOperatorRepository } from '../integrations/firestore.js';
import type { PubSubPublisher } from '../integrations/pubsub.js';
import { createAnalyticsEvent } from './service-utils.js';

export class AlertsService {
  readonly name = 'alerts';

  #analyticsWriter: BigQueryAnalyticsWriter;
  #logger: FastifyBaseLogger;
  #pubSubPublisher: PubSubPublisher;
  #repository: FirestoreOperatorRepository;

  constructor(options: {
    analyticsWriter: BigQueryAnalyticsWriter;
    logger: FastifyBaseLogger;
    pubSubPublisher: PubSubPublisher;
    repository: FirestoreOperatorRepository;
  }) {
    this.#analyticsWriter = options.analyticsWriter;
    this.#logger = options.logger;
    this.#pubSubPublisher = options.pubSubPublisher;
    this.#repository = options.repository;
  }

  describeReadiness() {
    const pubSubStatus = this.#pubSubPublisher.describeReadiness().status;

    return {
      name: 'alerts',
      status: pubSubStatus === 'ok' ? 'ok' : 'degraded',
      message:
        pubSubStatus === 'ok'
          ? 'Alert persistence and fan-out are configured.'
          : 'Alerts are accepted and recorded, but alert fan-out still falls back until Pub/Sub is reachable.'
    } as const;
  }

  async emitAlert(alert: unknown) {
    const parsedAlert = alertSchema.parse(alert);
    const persistenceResult = await this.#repository.recordAlert(parsedAlert);

    await this.#repository.appendAuditEvent(
      createAnalyticsEvent('alert', 'alert.emit', parsedAlert.id, {
        severity: parsedAlert.severity,
        source: parsedAlert.source
      })
    );
    await this.#pubSubPublisher.publishAlertEvent(parsedAlert);
    await this.#analyticsWriter.writeAlertEvent(parsedAlert);

    this.#logger.warn({ alertId: parsedAlert.id }, 'alert emitted');

    return mutationReceiptSchema.parse({
      ...persistenceResult,
      operation: 'alert.emit',
      resourceId: parsedAlert.id
    });
  }
}
