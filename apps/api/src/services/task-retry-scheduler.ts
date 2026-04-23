import { CloudTasksClient } from '@google-cloud/tasks';
import type { ApiEnv } from '@operator-os/config';
import type { FastifyBaseLogger } from 'fastify';

import {
  buildConfiguredCheck,
  buildNotConfiguredCheck,
  detectApplicationDefaultCredentials
} from '../integrations/runtime.js';

export interface RetryScheduleResult {
  readonly scheduled: boolean;
  readonly taskName?: string;
  readonly mode: 'cloud-tasks' | 'record-only';
  readonly reason?: string;
}

/**
 * Schedules delayed retry dispatch via Cloud Tasks. The scheduled task is
 * an HTTP target pointing at the api's own /v1/internal/tasks/retry-dispatch
 * endpoint, authenticated by a Google-issued OIDC ID token (service account
 * = CLOUD_RUN_SERVICE_ACCOUNT; audience = PUBSUB_PUSH_AUDIENCE, which is
 * the same audience the internal routes verify).
 *
 * Mirrors the `record-only` fallback pattern from integrations/tasks.ts
 * so the api boots and passes readiness even when ADC is not available
 * (tests, local dev).
 */
export class TaskRetryScheduler {
  readonly name = 'task-retry-scheduler';

  #adcStatus = detectApplicationDefaultCredentials();
  #client?: CloudTasksClient;
  #config: ApiEnv;
  #logger: FastifyBaseLogger;

  constructor(
    config: ApiEnv,
    logger: FastifyBaseLogger,
    client?: CloudTasksClient
  ) {
    this.#config = config;
    this.#logger = logger;
    this.#client = client;
  }

  describeReadiness() {
    const meta = {
      queue: this.#config.TASK_DISPATCH_RETRY_QUEUE,
      location: this.#config.TASK_DISPATCH_RETRY_QUEUE_LOCATION
    };

    if (!this.#adcStatus.available) {
      return buildNotConfiguredCheck(
        'task-retry-scheduler',
        this.#adcStatus.message,
        meta
      );
    }

    if (!this.#config.PUBSUB_PUSH_AUDIENCE) {
      return buildNotConfiguredCheck(
        'task-retry-scheduler',
        'PUBSUB_PUSH_AUDIENCE is not set; retry scheduler cannot issue OIDC-authenticated tasks.',
        meta
      );
    }

    return buildConfiguredCheck(
      'task-retry-scheduler',
      'Task-dispatch retry scheduler is configured.',
      {
        ...meta,
        audience: this.#config.PUBSUB_PUSH_AUDIENCE,
        serviceAccount: this.#config.CLOUD_RUN_SERVICE_ACCOUNT
      }
    );
  }

  async scheduleRetry(params: {
    taskId: string;
    attempt: number;
    delaySeconds?: number;
  }): Promise<RetryScheduleResult> {
    const audience = this.#config.PUBSUB_PUSH_AUDIENCE;
    if (!audience) {
      return {
        scheduled: false,
        mode: 'record-only',
        reason:
          'PUBSUB_PUSH_AUDIENCE not configured; cannot mint OIDC token for retry target.'
      };
    }

    if (!this.#adcStatus.available && !this.#client) {
      return {
        scheduled: false,
        mode: 'record-only',
        reason: this.#adcStatus.message
      };
    }

    const delaySeconds =
      params.delaySeconds ?? this.#config.TASK_DISPATCH_RETRY_DELAY_SECONDS;
    const scheduleTime = {
      seconds: Math.floor(Date.now() / 1000) + delaySeconds
    };

    try {
      const client = this.#getClient();
      const parent = client.queuePath(
        this.#config.GOOGLE_CLOUD_PROJECT,
        this.#config.TASK_DISPATCH_RETRY_QUEUE_LOCATION,
        this.#config.TASK_DISPATCH_RETRY_QUEUE
      );

      const [response] = await client.createTask({
        parent,
        task: {
          httpRequest: {
            httpMethod: 'POST',
            url: `${audience}/v1/internal/tasks/retry-dispatch`,
            headers: { 'Content-Type': 'application/json' },
            body: Buffer.from(
              JSON.stringify({
                taskId: params.taskId,
                attempt: params.attempt
              })
            ).toString('base64'),
            oidcToken: {
              serviceAccountEmail: this.#config.CLOUD_RUN_SERVICE_ACCOUNT,
              audience
            }
          },
          scheduleTime
        }
      });

      return {
        scheduled: true,
        mode: 'cloud-tasks',
        taskName: response.name ?? undefined
      };
    } catch (error) {
      this.#logger.warn(
        { err: error, taskId: params.taskId, attempt: params.attempt },
        'cloud tasks retry schedule failed'
      );

      return {
        scheduled: false,
        mode: 'record-only',
        reason:
          'Cloud Tasks scheduling failed; retry was not enqueued and the dispatch pipeline must reconsider this task on next trigger.'
      };
    }
  }

  #getClient(): CloudTasksClient {
    this.#client ??= new CloudTasksClient();
    return this.#client;
  }
}
