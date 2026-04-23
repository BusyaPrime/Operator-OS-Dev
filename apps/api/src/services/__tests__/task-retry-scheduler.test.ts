import type { CloudTasksClient } from '@google-cloud/tasks';
import { parseApiEnv } from '@operator-os/config';
import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { TaskRetryScheduler } from '../task-retry-scheduler.js';

const VALID_TASK_UUID = '66666666-6666-4666-8666-666666666666';
const API_URL = 'https://operator-os-api-test.example.com';
const SERVICE_ACCOUNT = 'cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com';

const buildConfig = (overrides: Record<string, string> = {}) =>
  parseApiEnv({
    PUBSUB_PUSH_AUDIENCE: API_URL,
    CLOUD_RUN_SERVICE_ACCOUNT: SERVICE_ACCOUNT,
    TASK_DISPATCH_RETRY_QUEUE: 'task-dispatch-retry-test',
    TASK_DISPATCH_RETRY_QUEUE_LOCATION: 'europe-west4',
    TASK_DISPATCH_RETRY_DELAY_SECONDS: '30',
    GOOGLE_CLOUD_PROJECT: 'operator-os-test',
    ...overrides
  });

const buildLogger = (): FastifyBaseLogger => {
  const logger: Record<string, unknown> = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn()
  };
  logger.child = () => logger;
  return logger as unknown as FastifyBaseLogger;
};

interface FakeTasksClient {
  client: CloudTasksClient;
  queuePath: ReturnType<typeof vi.fn>;
  createTask: ReturnType<typeof vi.fn>;
}

const buildTasksClient = (
  taskName = 'projects/operator-os-test/locations/europe-west4/queues/task-dispatch-retry-test/tasks/t-abc'
): FakeTasksClient => {
  const queuePath = vi.fn(
    (project: string, location: string, queue: string) =>
      `projects/${project}/locations/${location}/queues/${queue}`
  );
  const createTask = vi.fn().mockResolvedValue([{ name: taskName }]);
  return {
    client: { queuePath, createTask } as unknown as CloudTasksClient,
    queuePath,
    createTask
  };
};

describe('TaskRetryScheduler.scheduleRetry', () => {
  it('creates a Cloud Tasks HTTP task with OIDC token + retry body + default delay', async () => {
    const fake = buildTasksClient();
    const scheduler = new TaskRetryScheduler(
      buildConfig(),
      buildLogger(),
      fake.client
    );
    const beforeSec = Math.floor(Date.now() / 1000);

    const result = await scheduler.scheduleRetry({
      taskId: VALID_TASK_UUID,
      attempt: 2
    });

    expect(fake.queuePath).toHaveBeenCalledWith(
      'operator-os-test',
      'europe-west4',
      'task-dispatch-retry-test'
    );
    expect(fake.createTask).toHaveBeenCalledTimes(1);
    const createArg = fake.createTask.mock.calls[0]?.[0];
    expect(createArg.parent).toBe(
      'projects/operator-os-test/locations/europe-west4/queues/task-dispatch-retry-test'
    );
    expect(createArg.task.httpRequest.httpMethod).toBe('POST');
    expect(createArg.task.httpRequest.url).toBe(
      `${API_URL}/v1/internal/tasks/retry-dispatch`
    );
    expect(createArg.task.httpRequest.oidcToken).toEqual({
      serviceAccountEmail: SERVICE_ACCOUNT,
      audience: API_URL
    });
    const body = JSON.parse(
      Buffer.from(createArg.task.httpRequest.body, 'base64').toString('utf8')
    );
    expect(body).toEqual({ taskId: VALID_TASK_UUID, attempt: 2 });
    // default delay = 30s
    expect(createArg.task.scheduleTime.seconds).toBeGreaterThanOrEqual(
      beforeSec + 30
    );
    expect(createArg.task.scheduleTime.seconds).toBeLessThanOrEqual(
      beforeSec + 32
    );
    expect(result.scheduled).toBe(true);
    expect(result.mode).toBe('cloud-tasks');
    expect(result.taskName).toContain('tasks/t-abc');
  });

  it('respects a caller-provided delaySeconds override', async () => {
    const fake = buildTasksClient();
    const scheduler = new TaskRetryScheduler(
      buildConfig(),
      buildLogger(),
      fake.client
    );
    const beforeSec = Math.floor(Date.now() / 1000);

    await scheduler.scheduleRetry({
      taskId: VALID_TASK_UUID,
      attempt: 3,
      delaySeconds: 120
    });

    const createArg = fake.createTask.mock.calls[0]?.[0];
    expect(createArg.task.scheduleTime.seconds).toBeGreaterThanOrEqual(
      beforeSec + 120
    );
    expect(createArg.task.scheduleTime.seconds).toBeLessThanOrEqual(
      beforeSec + 122
    );
  });

  it('uses env-configured default delay when no override is provided', async () => {
    const fake = buildTasksClient();
    const scheduler = new TaskRetryScheduler(
      buildConfig({ TASK_DISPATCH_RETRY_DELAY_SECONDS: '90' }),
      buildLogger(),
      fake.client
    );
    const beforeSec = Math.floor(Date.now() / 1000);

    await scheduler.scheduleRetry({
      taskId: VALID_TASK_UUID,
      attempt: 1
    });

    const createArg = fake.createTask.mock.calls[0]?.[0];
    expect(createArg.task.scheduleTime.seconds).toBeGreaterThanOrEqual(
      beforeSec + 90
    );
    expect(createArg.task.scheduleTime.seconds).toBeLessThanOrEqual(
      beforeSec + 92
    );
  });

  it('returns mode=record-only when createTask throws', async () => {
    const createTask = vi
      .fn()
      .mockRejectedValue(new Error('queue unreachable'));
    const queuePath = vi.fn(
      (project: string, location: string, queue: string) =>
        `projects/${project}/locations/${location}/queues/${queue}`
    );
    const client = { queuePath, createTask } as unknown as CloudTasksClient;
    const logger = buildLogger();
    const scheduler = new TaskRetryScheduler(buildConfig(), logger, client);

    const result = await scheduler.scheduleRetry({
      taskId: VALID_TASK_UUID,
      attempt: 4
    });

    expect(result.scheduled).toBe(false);
    expect(result.mode).toBe('record-only');
    expect(result.reason).toContain('Cloud Tasks scheduling failed');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns mode=record-only without calling createTask when PUBSUB_PUSH_AUDIENCE is unset', async () => {
    const fake = buildTasksClient();
    // Clear the audience so the guard fires early.
    const scheduler = new TaskRetryScheduler(
      buildConfig({ PUBSUB_PUSH_AUDIENCE: '' }),
      buildLogger(),
      fake.client
    );

    const result = await scheduler.scheduleRetry({
      taskId: VALID_TASK_UUID,
      attempt: 1
    });

    expect(result.scheduled).toBe(false);
    expect(result.mode).toBe('record-only');
    expect(result.reason).toContain('PUBSUB_PUSH_AUDIENCE');
    expect(fake.createTask).not.toHaveBeenCalled();
  });
});
