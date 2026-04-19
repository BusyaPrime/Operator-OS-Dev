import { CloudTasksClient } from '@google-cloud/tasks';
import type { ApiEnv } from '@operator-os/config';
import {
  approvalQueuePayloadSchema,
  commandQueuePayloadSchema,
  exportQueuePayloadSchema,
  type ApprovalQueuePayload,
  type CommandQueuePayload,
  type ExportQueuePayload
} from '@operator-os/contracts';
import type { FastifyBaseLogger } from 'fastify';

import {
  buildConfiguredCheck,
  buildNotConfiguredCheck,
  detectApplicationDefaultCredentials
} from './runtime.js';

interface QueueResult {
  mode: 'cloud-tasks' | 'record-only';
  queued: boolean;
  reason?: string;
  taskName?: string;
}

export class TasksQueueClient {
  readonly name = 'tasks';

  #adcStatus = detectApplicationDefaultCredentials();
  #client?: CloudTasksClient;
  #config: ApiEnv;
  #logger: FastifyBaseLogger;

  constructor(config: ApiEnv, logger: FastifyBaseLogger) {
    this.#config = config;
    this.#logger = logger;
  }

  describeReadiness() {
    if (!this.#adcStatus.available) {
      return buildNotConfiguredCheck('tasks', this.#adcStatus.message, {
        location: this.#config.CLOUD_TASKS_LOCATION
      });
    }

    if (!this.#config.TASKS_TARGET_BASE_URL) {
      return buildNotConfiguredCheck(
        'tasks',
        'Cloud Tasks target URLs are not configured yet. Set TASKS_TARGET_BASE_URL to enable dispatch.',
        {
          location: this.#config.CLOUD_TASKS_LOCATION
        }
      );
    }

    return buildConfiguredCheck(
      'tasks',
      'Cloud Tasks queues are configured for command, approval, and export dispatch.',
      {
        location: this.#config.CLOUD_TASKS_LOCATION,
        targetBaseUrl: this.#config.TASKS_TARGET_BASE_URL
      }
    );
  }

  enqueueCommand(payload: CommandQueuePayload) {
    return this.#enqueue(
      this.#config.COMMANDS_QUEUE,
      '/internal/tasks/commands',
      commandQueuePayloadSchema.parse(payload)
    );
  }

  enqueueApproval(payload: ApprovalQueuePayload) {
    return this.#enqueue(
      this.#config.APPROVALS_QUEUE,
      '/internal/tasks/approvals',
      approvalQueuePayloadSchema.parse(payload)
    );
  }

  enqueueExport(payload: ExportQueuePayload) {
    return this.#enqueue(
      this.#config.EXPORTS_QUEUE,
      '/internal/tasks/exports',
      exportQueuePayloadSchema.parse(payload)
    );
  }

  async #enqueue(
    queueName: string,
    targetPath: string,
    payload: CommandQueuePayload | ApprovalQueuePayload | ExportQueuePayload
  ): Promise<QueueResult> {
    if (!this.#adcStatus.available || !this.#config.TASKS_TARGET_BASE_URL) {
      return {
        queued: false,
        mode: 'record-only',
        reason: !this.#adcStatus.available
          ? this.#adcStatus.message
          : 'TASKS_TARGET_BASE_URL is not configured yet.'
      };
    }

    try {
      const parent = this.#getClient().queuePath(
        this.#config.GOOGLE_CLOUD_PROJECT,
        this.#config.CLOUD_TASKS_LOCATION,
        queueName
      );

      const [response] = await this.#getClient().createTask({
        parent,
        task: {
          httpRequest: {
            httpMethod: 'POST',
            url: `${this.#config.TASKS_TARGET_BASE_URL}${targetPath}`,
            headers: {
              'Content-Type': 'application/json'
            },
            body: Buffer.from(JSON.stringify(payload)).toString('base64')
          }
        }
      });

      return {
        queued: true,
        mode: 'cloud-tasks',
        taskName: response.name ?? undefined
      };
    } catch (error) {
      this.#logger.warn({ err: error, queueName }, 'cloud tasks enqueue failed');

      return {
        queued: false,
        mode: 'record-only',
        reason:
          'Cloud Tasks enqueue failed, so the request remains recorded-only until the queue target is repaired.'
      };
    }
  }

  #getClient() {
    this.#client ??= new CloudTasksClient();
    return this.#client;
  }
}
