import { PubSub } from '@google-cloud/pubsub';
import type { ApiEnv } from '@operator-os/config';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';

import {
  buildConfiguredCheck,
  buildNotConfiguredCheck,
  detectApplicationDefaultCredentials
} from '../integrations/runtime.js';

export const taskDispatchPayloadSchema = z.object({
  taskId: z.string().uuid(),
  attempt: z.number().int().min(1).default(1)
});
export type TaskDispatchPayload = z.infer<typeof taskDispatchPayloadSchema>;

export const taskDlqPayloadSchema = z.object({
  taskId: z.string().uuid(),
  reason: z.string().min(1),
  attempts: z.number().int().min(1),
  failedAt: z.string().datetime()
});
export type TaskDlqPayload = z.infer<typeof taskDlqPayloadSchema>;

export interface PublishResult {
  readonly messageId?: string;
  readonly mode: 'pubsub' | 'record-only';
  readonly published: boolean;
  readonly reason?: string;
}

export class TaskDispatchPublisher {
  readonly name = 'task-dispatch-publisher';

  #adcStatus = detectApplicationDefaultCredentials();
  #client?: PubSub;
  #config: ApiEnv;
  #logger: FastifyBaseLogger;

  constructor(config: ApiEnv, logger: FastifyBaseLogger, client?: PubSub) {
    this.#config = config;
    this.#logger = logger;
    this.#client = client;
  }

  describeReadiness() {
    const topics = [
      this.#config.PUBSUB_TOPIC_TASK_DISPATCH,
      this.#config.PUBSUB_TOPIC_TASK_DLQ
    ];

    if (!this.#adcStatus.available) {
      return buildNotConfiguredCheck(
        'task-dispatch-publisher',
        this.#adcStatus.message,
        { topics }
      );
    }

    return buildConfiguredCheck(
      'task-dispatch-publisher',
      'Task dispatch publisher is initialized.',
      { topics }
    );
  }

  async publishDispatchTask(params: {
    taskId: string;
    attempt?: number;
  }): Promise<PublishResult> {
    const payload = taskDispatchPayloadSchema.parse(params);
    return this.#publishJson(
      this.#config.PUBSUB_TOPIC_TASK_DISPATCH,
      payload
    );
  }

  async publishDlq(params: {
    taskId: string;
    reason: string;
    attempts: number;
    failedAt?: string;
  }): Promise<PublishResult> {
    const payload = taskDlqPayloadSchema.parse({
      taskId: params.taskId,
      reason: params.reason,
      attempts: params.attempts,
      failedAt: params.failedAt ?? new Date().toISOString()
    });
    return this.#publishJson(this.#config.PUBSUB_TOPIC_TASK_DLQ, payload);
  }

  async #publishJson(
    topicName: string,
    payload: unknown
  ): Promise<PublishResult> {
    if (!this.#adcStatus.available && !this.#client) {
      return {
        published: false,
        mode: 'record-only',
        reason: this.#adcStatus.message
      };
    }

    try {
      const messageId = await this.#getClient()
        .topic(topicName)
        .publishMessage({ json: payload as Record<string, unknown> });

      return {
        published: true,
        mode: 'pubsub',
        messageId
      };
    } catch (error) {
      this.#logger.warn(
        { err: error, topicName },
        'task-dispatch pubsub publish failed'
      );

      return {
        published: false,
        mode: 'record-only',
        reason:
          'Pub/Sub publish failed, so the dispatch event was retained only in API-side control flow.'
      };
    }
  }

  #getClient(): PubSub {
    this.#client ??= new PubSub({
      projectId: this.#config.GOOGLE_CLOUD_PROJECT
    });
    return this.#client;
  }
}
