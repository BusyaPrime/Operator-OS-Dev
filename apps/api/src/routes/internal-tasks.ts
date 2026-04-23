import {
  approvalQueuePayloadSchema,
  commandQueuePayloadSchema,
  exportQueuePayloadSchema
} from '@operator-os/contracts';
import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply
} from 'fastify';
import { z } from 'zod';

import {
  taskDispatchPayloadSchema,
  taskDlqPayloadSchema,
  type TaskDispatchPublisher
} from '../services/task-dispatch-publisher.js';

export const registerInternalTasksRoutes = async (app: FastifyInstance) => {
  app.post('/internal/tasks/commands', async (request, reply) => {
    const payload = commandQueuePayloadSchema.parse(request.body);

    request.log.info(
      {
        queue: payload.queue,
        requestedAt: payload.requestedAt,
        commandId: payload.command.id,
        commandType: payload.command.type,
        deviceId: payload.command.deviceId
      },
      'task_received'
    );

    return reply.code(204).send();
  });

  app.post('/internal/tasks/approvals', async (request, reply) => {
    const payload = approvalQueuePayloadSchema.parse(request.body);

    request.log.info(
      {
        queue: payload.queue,
        requestedAt: payload.requestedAt,
        commandId: payload.commandId,
        operatorId: payload.operatorId
      },
      'task_received'
    );

    return reply.code(204).send();
  });

  app.post('/internal/tasks/exports', async (request, reply) => {
    const payload = exportQueuePayloadSchema.parse(request.body);

    request.log.info(
      {
        queue: payload.queue,
        requestedAt: payload.requestedAt,
        exportJobId: payload.exportJob.id,
        exportType: payload.exportJob.type
      },
      'task_received'
    );

    return reply.code(204).send();
  });
};

// ---------------------------------------------------------------------------
// Phase 3.2 — Pub/Sub + Cloud Tasks internal routes (versioned /v1/ prefix)
// ---------------------------------------------------------------------------

/**
 * Outcome of a dispatch attempt. Narrow union so route handlers can ACK
 * Pub/Sub even on no-match (retry is owned inside the dispatch callback,
 * not by the handler).
 */
export type DispatchOutcome =
  | { readonly kind: 'assigned'; readonly agentSessionId: string }
  | {
      readonly kind: 'no-match';
      readonly willRetry: boolean;
      readonly nextAttempt?: number;
    }
  | { readonly kind: 'failed'; readonly reason: string };

export type DispatchHandler = (params: {
  readonly taskId: string;
  readonly attempt: number;
}) => Promise<DispatchOutcome>;

export type OidcPreHandler = (
  request: FastifyRequest,
  reply: FastifyReply
) => Promise<void>;

export interface InternalPubsubRoutesOptions {
  /** OIDC preHandler enforcing Google SA identity on every route below. */
  readonly oidcGuard: OidcPreHandler;
  /** Publisher for DLQ fan-out + telemetry (held by caller). */
  readonly publisher: TaskDispatchPublisher;
  /** Dispatch logic — router + scheduler composed elsewhere (c9/c11/c13). */
  readonly dispatch: DispatchHandler;
}

/**
 * Pub/Sub push envelope — Google's standard shape for push subscriptions.
 * See https://cloud.google.com/pubsub/docs/push#receive_push
 */
const pubsubEnvelopeSchema = z.object({
  message: z.object({
    data: z.string(),
    messageId: z.string().optional(),
    publishTime: z.string().optional(),
    attributes: z.record(z.string(), z.string()).optional()
  }),
  subscription: z.string().optional()
});

/**
 * Cloud Tasks HTTP target body — we author this payload in c11 when
 * scheduling retries, so it is NOT a Pub/Sub envelope.
 */
const retryDispatchRequestSchema = z.object({
  taskId: z.string().uuid(),
  attempt: z.number().int().min(1)
});

const decodePubsubPayload = <T>(
  envelope: z.infer<typeof pubsubEnvelopeSchema>,
  innerSchema: z.ZodType<T>
): T => {
  const decoded = Buffer.from(envelope.message.data, 'base64').toString('utf8');
  const json = JSON.parse(decoded) as unknown;
  return innerSchema.parse(json);
};

export const registerInternalPubsubRoutes = async (
  app: FastifyInstance,
  options: InternalPubsubRoutesOptions
) => {
  const { oidcGuard, dispatch } = options;

  // Pub/Sub push — main dispatch topic
  app.post(
    '/v1/internal/pubsub/task-dispatch',
    { preHandler: oidcGuard },
    async (request, reply) => {
      try {
        const envelope = pubsubEnvelopeSchema.parse(request.body);
        const payload = decodePubsubPayload(envelope, taskDispatchPayloadSchema);

        const outcome = await dispatch({
          taskId: payload.taskId,
          attempt: payload.attempt
        });

        request.log.info(
          {
            source: 'internal.pubsub.task-dispatch',
            messageId: envelope.message.messageId,
            taskId: payload.taskId,
            attempt: payload.attempt,
            outcome: outcome.kind
          },
          'task_dispatch_received'
        );

        return reply.code(204).send();
      } catch (error) {
        request.log.error(
          { err: error, source: 'internal.pubsub.task-dispatch' },
          'task_dispatch_receive_failed'
        );
        return reply.code(500).send({
          code: 'internal_error',
          message: 'task-dispatch receive failed'
        });
      }
    }
  );

  // Pub/Sub push — DLQ topic
  app.post(
    '/v1/internal/pubsub/task-dlq',
    { preHandler: oidcGuard },
    async (request, reply) => {
      try {
        const envelope = pubsubEnvelopeSchema.parse(request.body);
        const payload = decodePubsubPayload(envelope, taskDlqPayloadSchema);

        request.log.error(
          {
            source: 'internal.pubsub.task-dlq',
            messageId: envelope.message.messageId,
            taskId: payload.taskId,
            reason: payload.reason,
            attempts: payload.attempts,
            failedAt: payload.failedAt
          },
          'task_dispatch_dlq_received'
        );

        return reply.code(204).send();
      } catch (error) {
        request.log.error(
          { err: error, source: 'internal.pubsub.task-dlq' },
          'task_dlq_receive_failed'
        );
        return reply.code(500).send({
          code: 'internal_error',
          message: 'task-dlq receive failed'
        });
      }
    }
  );

  // Cloud Tasks callback — delayed retry
  app.post(
    '/v1/internal/tasks/retry-dispatch',
    { preHandler: oidcGuard },
    async (request, reply) => {
      try {
        const { taskId, attempt } = retryDispatchRequestSchema.parse(
          request.body
        );

        const outcome = await dispatch({ taskId, attempt });

        request.log.info(
          {
            source: 'internal.tasks.retry-dispatch',
            taskId,
            attempt,
            outcome: outcome.kind
          },
          'task_retry_dispatch_received'
        );

        return reply.code(204).send();
      } catch (error) {
        request.log.error(
          { err: error, source: 'internal.tasks.retry-dispatch' },
          'task_retry_dispatch_failed'
        );
        return reply.code(500).send({
          code: 'internal_error',
          message: 'task retry-dispatch failed'
        });
      }
    }
  );
};
