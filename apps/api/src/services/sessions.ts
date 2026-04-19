import { mutationReceiptSchema, sessionSchema } from '@operator-os/contracts';
import type { FastifyBaseLogger } from 'fastify';

import type { BigQueryAnalyticsWriter } from '../integrations/bigquery.js';
import type { FirestoreOperatorRepository } from '../integrations/firestore.js';
import type { PubSubPublisher } from '../integrations/pubsub.js';
import { createAnalyticsEvent } from './service-utils.js';

export class SessionsService {
  readonly name = 'sessions';

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
      name: 'sessions',
      status: pubSubStatus === 'ok' ? 'ok' : 'degraded',
      message:
        pubSubStatus === 'ok'
          ? 'Visible session persistence and event fan-out are configured.'
          : 'Visible session persistence works, but event fan-out still falls back until Pub/Sub is fully reachable.'
    } as const;
  }

  async recordSession(session: unknown) {
    const parsedSession = sessionSchema.parse(session);
    const persistenceResult = await this.#repository.recordSession(parsedSession);

    await this.#repository.appendAuditEvent(
      createAnalyticsEvent('session', 'session.upsert', parsedSession.id, {
        deviceId: parsedSession.deviceId,
        status: parsedSession.status
      })
    );
    await this.#pubSubPublisher.publishSessionEvent(parsedSession);
    await this.#analyticsWriter.writeSessionEvent(parsedSession);

    this.#logger.info({ sessionId: parsedSession.id }, 'session recorded');

    return mutationReceiptSchema.parse({
      ...persistenceResult,
      operation: 'session.upsert',
      resourceId: parsedSession.id
    });
  }
}
