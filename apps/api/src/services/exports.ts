import {
  exportQueuePayloadSchema,
  exportReceiptSchema,
  exportJobSchema
} from '@operator-os/contracts';
import type { FastifyBaseLogger } from 'fastify';

import type { FirestoreOperatorRepository } from '../integrations/firestore.js';
import type { GcsStorageService } from '../integrations/storage.js';
import type { TasksQueueClient } from '../integrations/tasks.js';
import { createAnalyticsEvent } from './service-utils.js';

export class ExportsService {
  readonly name = 'exports';

  #logger: FastifyBaseLogger;
  #repository: FirestoreOperatorRepository;
  #storageService: GcsStorageService;
  #tasksQueue: TasksQueueClient;

  constructor(options: {
    logger: FastifyBaseLogger;
    repository: FirestoreOperatorRepository;
    storageService: GcsStorageService;
    tasksQueue: TasksQueueClient;
  }) {
    this.#logger = options.logger;
    this.#repository = options.repository;
    this.#storageService = options.storageService;
    this.#tasksQueue = options.tasksQueue;
  }

  describeReadiness() {
    const tasksStatus = this.#tasksQueue.describeReadiness().status;

    return {
      name: 'exports',
      status: tasksStatus === 'ok' ? 'ok' : 'degraded',
      message:
        tasksStatus === 'ok'
          ? 'Export requests can be recorded and queued.'
          : 'Export requests can be recorded, but worker dispatch remains in a controlled fallback mode.'
    } as const;
  }

  async queueExport(exportJob: unknown) {
    const parsedJob = exportJobSchema.parse(exportJob);
    const queuedAt = new Date().toISOString();

    await this.#storageService.uploadJson(
      'exports',
      `requests/${parsedJob.id}.json`,
      parsedJob
    );
    await this.#repository.appendAuditEvent(
      createAnalyticsEvent('deploy', 'export.requested', parsedJob.id, {
        type: parsedJob.type,
        status: parsedJob.status
      })
    );

    const queueResult = await this.#tasksQueue.enqueueExport(
      exportQueuePayloadSchema.parse({
        queue: 'exports',
        requestedAt: queuedAt,
        exportJob: parsedJob
      })
    );

    this.#logger.info({ exportJobId: parsedJob.id }, 'export queued');

    return exportReceiptSchema.parse({
      operation: 'export.queue',
      accepted: true,
      resourceId: parsedJob.id,
      exportJob: parsedJob,
      dataSource:
        queueResult.mode === 'cloud-tasks' ? 'live' : 'api-controlled-fallback',
      message:
        queueResult.mode === 'cloud-tasks'
          ? 'Export job accepted and queued.'
          : 'Export job accepted, but Cloud Tasks export dispatch is still in controlled fallback mode.',
      timestamp: queuedAt
    });
  }
}
