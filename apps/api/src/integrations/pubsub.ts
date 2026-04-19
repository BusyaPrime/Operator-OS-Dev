import { PubSub } from '@google-cloud/pubsub';
import type { ApiEnv } from '@operator-os/config';
import {
  alertEventMessageSchema,
  agentEventMessageSchema,
  budgetEventMessageSchema,
  sessionEventMessageSchema,
  type Alert,
  type CostSnapshot,
  type DeviceState,
  type Session
} from '@operator-os/contracts';
import type { FastifyBaseLogger } from 'fastify';

import {
  buildConfiguredCheck,
  buildNotConfiguredCheck,
  detectApplicationDefaultCredentials
} from './runtime.js';

interface PublishResult {
  messageId?: string;
  mode: 'pubsub' | 'record-only';
  published: boolean;
  reason?: string;
}

export class PubSubPublisher {
  readonly name = 'pubsub';

  #adcStatus = detectApplicationDefaultCredentials();
  #client?: PubSub;
  #config: ApiEnv;
  #logger: FastifyBaseLogger;

  constructor(config: ApiEnv, logger: FastifyBaseLogger) {
    this.#config = config;
    this.#logger = logger;
  }

  describeReadiness() {
    if (!this.#adcStatus.available) {
      return buildNotConfiguredCheck('pubsub', this.#adcStatus.message, {
        topics: [
          this.#config.AGENT_EVENTS_TOPIC,
          this.#config.OPERATOR_ALERTS_TOPIC,
          this.#config.BUDGET_EVENTS_TOPIC,
          this.#config.SESSION_EVENTS_TOPIC
        ]
      });
    }

    return buildConfiguredCheck('pubsub', 'Pub/Sub publishers are initialized.', {
      topics: [
        this.#config.AGENT_EVENTS_TOPIC,
        this.#config.OPERATOR_ALERTS_TOPIC,
        this.#config.BUDGET_EVENTS_TOPIC,
        this.#config.SESSION_EVENTS_TOPIC
      ]
    });
  }

  publishAgentEvent(device: DeviceState) {
    return this.#publishJson(this.#config.AGENT_EVENTS_TOPIC, {
      topic: 'agent-events',
      publishedAt: new Date().toISOString(),
      device,
      metadata: {
        origin: 'api'
      }
    });
  }

  publishAlertEvent(alert: Alert) {
    return this.#publishJson(this.#config.OPERATOR_ALERTS_TOPIC, {
      topic: 'operator-alerts',
      publishedAt: new Date().toISOString(),
      alert,
      metadata: {
        origin: 'api'
      }
    });
  }

  publishBudgetEvent(snapshot: CostSnapshot) {
    return this.#publishJson(this.#config.BUDGET_EVENTS_TOPIC, {
      topic: 'budget-events',
      publishedAt: new Date().toISOString(),
      snapshot,
      metadata: {
        origin: 'api'
      }
    });
  }

  publishSessionEvent(session: Session) {
    return this.#publishJson(this.#config.SESSION_EVENTS_TOPIC, {
      topic: 'session-events',
      publishedAt: new Date().toISOString(),
      session,
      metadata: {
        origin: 'api'
      }
    });
  }

  async #publishJson(topicName: string, payload: unknown): Promise<PublishResult> {
    if (!this.#adcStatus.available) {
      return {
        published: false,
        mode: 'record-only',
        reason: this.#adcStatus.message
      };
    }

    const parsedPayload =
      topicName === this.#config.AGENT_EVENTS_TOPIC
        ? agentEventMessageSchema.parse(payload)
        : topicName === this.#config.OPERATOR_ALERTS_TOPIC
          ? alertEventMessageSchema.parse(payload)
          : topicName === this.#config.BUDGET_EVENTS_TOPIC
            ? budgetEventMessageSchema.parse(payload)
            : sessionEventMessageSchema.parse(payload);

    try {
      const messageId = await this.#getClient()
        .topic(topicName)
        .publishMessage({ json: parsedPayload as Record<string, unknown> });

      return {
        published: true,
        mode: 'pubsub',
        messageId
      };
    } catch (error) {
      this.#logger.warn({ err: error, topicName }, 'pubsub publish failed');

      return {
        published: false,
        mode: 'record-only',
        reason:
          'Pub/Sub publish failed, so the event was retained only in API-side control flow.'
      };
    }
  }

  #getClient() {
    this.#client ??= new PubSub({
      projectId: this.#config.GOOGLE_CLOUD_PROJECT
    });

    return this.#client;
  }
}
