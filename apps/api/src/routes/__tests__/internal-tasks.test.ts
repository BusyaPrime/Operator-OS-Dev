import fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import {
  registerInternalPubsubRoutes,
  type DispatchHandler,
  type OidcPreHandler
} from '../internal-tasks.js';
import type { TaskDispatchPublisher } from '../../services/task-dispatch-publisher.js';

const VALID_TASK_UUID = '55555555-5555-4555-8555-555555555555';

type GuardKind = 'allow' | 'deny401' | 'deny403';

const buildGuard = (kind: GuardKind): OidcPreHandler => async (_request, reply) => {
  if (kind === 'allow') return;
  const status = kind === 'deny401' ? 401 : 403;
  await reply.code(status).send({
    code: kind === 'deny401' ? 'unauthorized' : 'forbidden',
    message: 'guard denied'
  });
};

const buildApp = async (
  opts: { guard?: GuardKind; dispatch?: DispatchHandler } = {}
) => {
  const app = fastify({ logger: false });
  const oidcGuard = buildGuard(opts.guard ?? 'allow');
  const dispatch: DispatchHandler =
    opts.dispatch ??
    (async () => ({ kind: 'no-match', willRetry: false }));
  const publisher = {} as unknown as TaskDispatchPublisher;

  await registerInternalPubsubRoutes(app, {
    oidcGuard,
    publisher,
    dispatch
  });
  return { app, dispatch };
};

const encodePubsubEnvelope = (payload: unknown, messageId = 'msg-1') => ({
  message: {
    data: Buffer.from(JSON.stringify(payload)).toString('base64'),
    messageId,
    publishTime: '2026-04-24T06:00:00.000Z'
  },
  subscription:
    'projects/operator-os-dev/subscriptions/task-dispatch-api-dev'
});

describe('POST /v1/internal/pubsub/task-dispatch', () => {
  it('returns 401 when OIDC guard denies with 401', async () => {
    const { app } = await buildApp({ guard: 'deny401' });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/internal/pubsub/task-dispatch',
      payload: encodePubsubEnvelope({
        taskId: VALID_TASK_UUID,
        attempt: 1
      })
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 403 when OIDC guard denies with 403', async () => {
    const { app } = await buildApp({ guard: 'deny403' });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/internal/pubsub/task-dispatch',
      payload: encodePubsubEnvelope({
        taskId: VALID_TASK_UUID,
        attempt: 1
      })
    });
    expect(response.statusCode).toBe(403);
  });

  it('returns 204 and invokes dispatch on a valid envelope', async () => {
    const dispatch = vi.fn(
      async () =>
        ({ kind: 'assigned', agentSessionId: 'sess-1' }) as const
    );
    const { app } = await buildApp({ dispatch });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/internal/pubsub/task-dispatch',
      payload: encodePubsubEnvelope({
        taskId: VALID_TASK_UUID,
        attempt: 1
      })
    });
    expect(response.statusCode).toBe(204);
    expect(dispatch).toHaveBeenCalledWith({
      taskId: VALID_TASK_UUID,
      attempt: 1
    });
  });

  it('returns 500 on malformed Pub/Sub envelope', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/internal/pubsub/task-dispatch',
      payload: { not: 'a pubsub envelope' }
    });
    expect(response.statusCode).toBe(500);
  });

  it('returns 500 when inner payload has a non-UUID taskId', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/internal/pubsub/task-dispatch',
      payload: encodePubsubEnvelope({ taskId: 'not-a-uuid', attempt: 1 })
    });
    expect(response.statusCode).toBe(500);
  });

  it('is pass-through on redelivery (dispatch invoked twice for same payload)', async () => {
    const dispatch = vi.fn(
      async () =>
        ({
          kind: 'no-match',
          willRetry: true,
          nextAttempt: 2
        }) as const
    );
    const { app } = await buildApp({ dispatch });
    const payload = encodePubsubEnvelope({
      taskId: VALID_TASK_UUID,
      attempt: 1
    });

    await app.inject({
      method: 'POST',
      url: '/v1/internal/pubsub/task-dispatch',
      payload
    });
    await app.inject({
      method: 'POST',
      url: '/v1/internal/pubsub/task-dispatch',
      payload
    });

    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});

describe('POST /v1/internal/pubsub/task-dlq', () => {
  it('returns 204 on a valid DLQ envelope', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/internal/pubsub/task-dlq',
      payload: encodePubsubEnvelope({
        taskId: VALID_TASK_UUID,
        reason: 'exhausted max attempts',
        attempts: 5,
        failedAt: '2026-04-24T06:00:00.000Z'
      })
    });
    expect(response.statusCode).toBe(204);
  });

  it('returns 500 on a DLQ envelope with a non-UUID taskId', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/internal/pubsub/task-dlq',
      payload: encodePubsubEnvelope({
        taskId: 'not-a-uuid',
        reason: 'bad',
        attempts: 5,
        failedAt: '2026-04-24T06:00:00.000Z'
      })
    });
    expect(response.statusCode).toBe(500);
  });
});

describe('POST /v1/internal/tasks/retry-dispatch', () => {
  it('returns 401 when OIDC guard denies', async () => {
    const { app } = await buildApp({ guard: 'deny401' });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/internal/tasks/retry-dispatch',
      payload: { taskId: VALID_TASK_UUID, attempt: 2 }
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 204 and invokes dispatch with the retry attempt count', async () => {
    const dispatch = vi.fn(
      async () =>
        ({
          kind: 'no-match',
          willRetry: true,
          nextAttempt: 3
        }) as const
    );
    const { app } = await buildApp({ dispatch });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/internal/tasks/retry-dispatch',
      payload: { taskId: VALID_TASK_UUID, attempt: 2 }
    });
    expect(response.statusCode).toBe(204);
    expect(dispatch).toHaveBeenCalledWith({
      taskId: VALID_TASK_UUID,
      attempt: 2
    });
  });

  it('returns 500 on an invalid retry-dispatch body', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/internal/tasks/retry-dispatch',
      payload: { taskId: 'not-a-uuid', attempt: 0 }
    });
    expect(response.statusCode).toBe(500);
  });
});
