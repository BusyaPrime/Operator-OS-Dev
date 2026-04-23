import type { PubSub } from '@google-cloud/pubsub';
import { parseApiEnv } from '@operator-os/config';
import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { TaskDispatchPublisher } from '../task-dispatch-publisher.js';

const buildConfig = (overrides: Record<string, string> = {}) =>
  parseApiEnv({
    PUBSUB_TOPIC_TASK_DISPATCH: 'task-dispatch-test',
    PUBSUB_TOPIC_TASK_DLQ: 'task-dispatch-dlq-test',
    GOOGLE_CLOUD_PROJECT: 'operator-os-test',
    ...overrides
  });

const buildLogger = (): FastifyBaseLogger => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn()
  } as Record<string, unknown>;
  logger.child = () => logger;
  return logger as unknown as FastifyBaseLogger;
};

interface FakePubSub {
  client: PubSub;
  topic: ReturnType<typeof vi.fn>;
  publishMessage: ReturnType<typeof vi.fn>;
}

const buildPubSub = (messageId = 'msg-abc'): FakePubSub => {
  const publishMessage = vi.fn().mockResolvedValue(messageId);
  const topic = vi.fn(() => ({ publishMessage }));
  return {
    client: { topic } as unknown as PubSub,
    topic,
    publishMessage
  };
};

describe('TaskDispatchPublisher', () => {
  it('publishDispatchTask sends {taskId, attempt=1} to the dispatch topic', async () => {
    const fake = buildPubSub('msg-123');
    const publisher = new TaskDispatchPublisher(
      buildConfig(),
      buildLogger(),
      fake.client
    );

    const result = await publisher.publishDispatchTask({
      taskId: '11111111-1111-1111-1111-111111111111'
    });

    expect(fake.topic).toHaveBeenCalledWith('task-dispatch-test');
    expect(fake.publishMessage).toHaveBeenCalledWith({
      json: {
        taskId: '11111111-1111-1111-1111-111111111111',
        attempt: 1
      }
    });
    expect(result.published).toBe(true);
    expect(result.mode).toBe('pubsub');
    expect(result.messageId).toBe('msg-123');
  });

  it('publishDispatchTask rejects a non-UUID taskId at the schema boundary', async () => {
    const fake = buildPubSub();
    const publisher = new TaskDispatchPublisher(
      buildConfig(),
      buildLogger(),
      fake.client
    );

    await expect(
      publisher.publishDispatchTask({ taskId: 'not-a-uuid' })
    ).rejects.toThrow();

    expect(fake.publishMessage).not.toHaveBeenCalled();
  });

  it('publishDlq sends {taskId, reason, attempts, failedAt} to the DLQ topic', async () => {
    const fake = buildPubSub('dlq-msg-456');
    const publisher = new TaskDispatchPublisher(
      buildConfig(),
      buildLogger(),
      fake.client
    );

    const failedAt = '2026-04-24T06:30:00.000Z';
    const result = await publisher.publishDlq({
      taskId: '22222222-2222-2222-2222-222222222222',
      reason: 'exhausted max attempts',
      attempts: 5,
      failedAt
    });

    expect(fake.topic).toHaveBeenCalledWith('task-dispatch-dlq-test');
    expect(fake.publishMessage).toHaveBeenCalledWith({
      json: {
        taskId: '22222222-2222-2222-2222-222222222222',
        reason: 'exhausted max attempts',
        attempts: 5,
        failedAt
      }
    });
    expect(result.published).toBe(true);
    expect(result.messageId).toBe('dlq-msg-456');
  });

  it('publishDlq auto-fills failedAt when omitted', async () => {
    const fake = buildPubSub();
    const publisher = new TaskDispatchPublisher(
      buildConfig(),
      buildLogger(),
      fake.client
    );

    await publisher.publishDlq({
      taskId: '33333333-3333-3333-3333-333333333333',
      reason: 'no agents matched',
      attempts: 5
    });

    const firstCallArg = fake.publishMessage.mock.calls[0]?.[0] as {
      json: { failedAt: string };
    };
    expect(firstCallArg.json.failedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
    );
  });

  it('returns mode=record-only when publishMessage throws', async () => {
    const publishMessage = vi
      .fn()
      .mockRejectedValue(new Error('pubsub down'));
    const topic = vi.fn(() => ({ publishMessage }));
    const client = { topic } as unknown as PubSub;
    const logger = buildLogger();
    const publisher = new TaskDispatchPublisher(buildConfig(), logger, client);

    const result = await publisher.publishDispatchTask({
      taskId: '44444444-4444-4444-4444-444444444444'
    });

    expect(result.published).toBe(false);
    expect(result.mode).toBe('record-only');
    expect(result.reason).toContain('Pub/Sub publish failed');
    expect(logger.warn).toHaveBeenCalled();
  });
});
