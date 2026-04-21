import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it } from 'vitest';

import type { FirestoreOperatorRepository } from '../integrations/firestore.js';
import type { GcsStorageService } from '../integrations/storage.js';
import type { TasksQueueClient } from '../integrations/tasks.js';
import { ExportsService } from './exports.js';

const noopLogger = {} as unknown as FastifyBaseLogger;

const buildService = (
  tasksQueue: TasksQueueClient = {} as unknown as TasksQueueClient
) =>
  new ExportsService({
    logger: noopLogger,
    repository: {} as unknown as FirestoreOperatorRepository,
    storageService: {} as unknown as GcsStorageService,
    tasksQueue
  });

describe('ExportsService.describeReadiness', () => {
  it('returns degraded with a worker-pending message', () => {
    const readiness = buildService().describeReadiness();

    expect(readiness.name).toBe('exports');
    expect(readiness.status).toBe('degraded');
    expect(readiness.message).toMatch(
      /durable worker consumer is not implemented/i
    );
  });

  it('does not consult the tasks queue when describing readiness', () => {
    const throwing = {
      describeReadiness: () => {
        throw new Error('tasks queue must not drive exports readiness');
      }
    } as unknown as TasksQueueClient;

    expect(() => buildService(throwing).describeReadiness()).not.toThrow();
  });
});
