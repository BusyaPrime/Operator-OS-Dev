import {
  commandPollResponseSchema,
  commandQueuePayloadSchema,
  commandSchema,
  mutationReceiptSchema,
  type Command
} from '@operator-os/contracts';
import type { FastifyBaseLogger } from 'fastify';

import type { BigQueryAnalyticsWriter } from '../integrations/bigquery.js';
import type { FirestoreOperatorRepository } from '../integrations/firestore.js';
import type { GcsStorageService } from '../integrations/storage.js';
import type { TasksQueueClient } from '../integrations/tasks.js';
import { createAnalyticsEvent } from './service-utils.js';

export class CommandsService {
  readonly name = 'commands';

  #analyticsWriter: BigQueryAnalyticsWriter;
  #logger: FastifyBaseLogger;
  #pendingCommands = new Map<string, Command[]>();
  #repository: FirestoreOperatorRepository;
  #storageService: GcsStorageService;
  #tasksQueue: TasksQueueClient;

  constructor(options: {
    analyticsWriter: BigQueryAnalyticsWriter;
    logger: FastifyBaseLogger;
    repository: FirestoreOperatorRepository;
    storageService: GcsStorageService;
    tasksQueue: TasksQueueClient;
  }) {
    this.#analyticsWriter = options.analyticsWriter;
    this.#logger = options.logger;
    this.#repository = options.repository;
    this.#storageService = options.storageService;
    this.#tasksQueue = options.tasksQueue;
  }

  describeReadiness() {
    const tasksStatus = this.#tasksQueue.describeReadiness().status;

    return {
      name: 'commands',
      status: tasksStatus === 'ok' ? 'ok' : 'degraded',
      message:
        tasksStatus === 'ok'
          ? 'Command intake and dispatch pipeline is wired to Cloud Tasks.'
          : 'Command intake works, but queue delivery is still in a controlled fallback mode until Cloud Tasks targets are configured.'
    } as const;
  }

  async dispatchCommand(command: unknown) {
    const parsedCommand = commandSchema.parse(command);
    const queuedCommand =
      parsedCommand.approvalRequired || parsedCommand.status !== 'pending'
        ? parsedCommand
        : { ...parsedCommand, status: 'approved' as const };

    await this.#repository.appendAuditEvent(
      createAnalyticsEvent('agent', 'command.received', parsedCommand.id, {
        deviceId: parsedCommand.deviceId,
        approvalRequired: parsedCommand.approvalRequired,
        type: parsedCommand.type
      })
    );
    await this.#storageService.uploadJson(
      'artifacts',
      `commands/${parsedCommand.id}.json`,
      queuedCommand
    );
    await this.#analyticsWriter.writeCommandEvent(queuedCommand);

    if (queuedCommand.approvalRequired) {
      const queueResult = await this.#tasksQueue.enqueueApproval({
        queue: 'approvals',
        requestedAt: new Date().toISOString(),
        commandId: queuedCommand.id,
        operatorId: queuedCommand.operatorId,
        metadata: {
          deviceId: queuedCommand.deviceId,
          type: queuedCommand.type
        }
      });

      return mutationReceiptSchema.parse({
        operation: 'command.dispatch',
        accepted: true,
        resourceId: queuedCommand.id,
        dataSource:
          queueResult.mode === 'cloud-tasks' ? 'live' : 'api-controlled-fallback',
        message:
          queueResult.mode === 'cloud-tasks'
            ? 'Approval request queued successfully.'
            : 'Approval request recorded, but Cloud Tasks dispatch is still in controlled fallback mode.',
        timestamp: new Date().toISOString()
      });
    }

    const deviceQueue = this.#pendingCommands.get(queuedCommand.deviceId) ?? [];
    deviceQueue.push(queuedCommand);
    this.#pendingCommands.set(queuedCommand.deviceId, deviceQueue);

    const queueResult = await this.#tasksQueue.enqueueCommand(
      commandQueuePayloadSchema.parse({
        queue: 'commands',
        requestedAt: new Date().toISOString(),
        command: queuedCommand
      })
    );

    return mutationReceiptSchema.parse({
      operation: 'command.dispatch',
      accepted: true,
      resourceId: queuedCommand.id,
      dataSource:
        queueResult.mode === 'cloud-tasks' ? 'live' : 'api-controlled-fallback',
      message:
        queueResult.mode === 'cloud-tasks'
          ? 'Command accepted and queued for delivery.'
          : 'Command accepted and retained in API fallback memory until Cloud Tasks delivery is configured.',
      timestamp: new Date().toISOString()
    });
  }

  async pollCommands(deviceId: string) {
    const commands = this.#pendingCommands.get(deviceId) ?? [];
    this.#pendingCommands.set(deviceId, []);

    this.#logger.info(
      { deviceId, commandCount: commands.length },
      'agent command poll completed'
    );

    return commandPollResponseSchema.parse({
      deviceId,
      commands,
      generatedAt: new Date().toISOString(),
      dataSource: 'api-controlled-fallback',
      fallbackReason:
        'The queue-to-agent handoff is still held in API memory until the durable worker path is finalized.'
    });
  }
}
