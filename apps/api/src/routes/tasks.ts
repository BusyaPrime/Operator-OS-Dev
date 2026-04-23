import { randomUUID } from 'node:crypto';

import {
  taskListResponseSchema,
  taskStatusResponseSchema,
  taskStatusSchema,
  taskSubmitRequestSchema,
  taskSubmitResponseSchema,
  type TaskRecord
} from '@operator-os/contracts';
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';

import type { FirestoreOperatorRepository } from '../integrations/firestore.js';
import type { IdempotencyCache } from '../services/idempotency-cache.js';

/**
 * Retention window for TaskRecord.expireAt. Per Gate 3.1.A
 * resolution (Option B): 30 days, written at submission time
 * so Firestore TTL fires on `createdAt + 30d`. TD-026's
 * `expireAt` discipline from Phase 2 applied verbatim.
 */
const TASK_RETENTION_DAYS = 30;
const TASK_RETENTION_MS = TASK_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

/** Per-user per-route token bucket. Window is fixed 60s. */
const WINDOW_MS = 60_000;
const POST_LIMIT = 10;
const GET_LIMIT = 60;

export type TaskRateLimitRoute = 'post' | 'get';

export interface TaskRateLimiter {
  tryAccept(
    userId: string,
    route: TaskRateLimitRoute
  ): { ok: true } | { ok: false; retryAfterSeconds: number };
}

interface WindowBucket {
  count: number;
  windowStartMs: number;
}

/**
 * In-memory token bucket keyed by (userId, route). Matches the
 * heartbeat-v2 rate limiter pattern from Phase 2 — single
 * Fastify instance scope, ADR *Agent WebSocket Sessions Are
 * In-Memory* covers the migration plan when multi-instance
 * lands.
 */
export const createTaskRateLimiter = (
  now: () => number = () => Date.now()
): TaskRateLimiter => {
  const state = new Map<string, { post: WindowBucket; get: WindowBucket }>();
  const limitFor = (route: TaskRateLimitRoute): number =>
    route === 'post' ? POST_LIMIT : GET_LIMIT;

  return {
    tryAccept(userId, route) {
      const current = now();
      let entry = state.get(userId);
      if (entry === undefined) {
        entry = {
          post: { count: 0, windowStartMs: current },
          get: { count: 0, windowStartMs: current }
        };
        state.set(userId, entry);
      }
      const bucket = entry[route];
      if (current - bucket.windowStartMs >= WINDOW_MS) {
        bucket.windowStartMs = current;
        bucket.count = 0;
      }
      if (bucket.count >= limitFor(route)) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((bucket.windowStartMs + WINDOW_MS - current) / 1_000)
        );
        return { ok: false, retryAfterSeconds };
      }
      bucket.count += 1;
      return { ok: true };
    }
  };
};

export interface TaskRoutesOptions {
  readonly repository: FirestoreOperatorRepository;
  readonly idempotencyCache: IdempotencyCache;
  readonly userGuard: preHandlerAsyncHookHandler;
  /**
   * Absolute base URL used to build `streamUrl` in
   * TaskSubmitResponse. Typically `config.AGENT_AUDIENCE`.
   */
  readonly apiBaseUrl: string;
  /** Injectable clock (tests pass a controlled now). */
  readonly now?: () => Date;
  readonly rateLimiter?: TaskRateLimiter;
}

const listQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  limit: z.coerce.number().int().optional(),
  cursor: z.string().min(1).optional()
});

const taskIdParamsSchema = z.object({
  taskId: z.string().uuid()
});

interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

const apiError = (
  code: string,
  message: string,
  details?: Record<string, unknown>
): ApiError => ({ code, message, ...(details !== undefined ? { details } : {}) });

export const registerTaskRoutes = async (
  app: FastifyInstance,
  options: TaskRoutesOptions
): Promise<void> => {
  const now = options.now ?? (() => new Date());
  const rateLimiter = options.rateLimiter ?? createTaskRateLimiter();
  const apiBase = options.apiBaseUrl.replace(/\/$/, '');
  const buildStreamUrl = (taskId: string): string =>
    `${apiBase}/v1/tasks/${taskId}/stream`;

  // POST /v1/tasks — submit a task.
  app.post(
    '/v1/tasks',
    { preHandler: options.userGuard },
    async (request, reply) => {
      const userId = request.authSession?.currentUser?.operatorId;
      if (userId === undefined || userId.length === 0) {
        reply.status(401);
        return apiError('unauthorized', 'Authenticated session required');
      }

      const rate = rateLimiter.tryAccept(userId, 'post');
      if (!rate.ok) {
        reply.status(429);
        reply.header('Retry-After', String(rate.retryAfterSeconds));
        return apiError(
          'rate_limited',
          `Too many task submissions; retry in ${rate.retryAfterSeconds}s`,
          { retryAfterSeconds: rate.retryAfterSeconds }
        );
      }

      const parsed = taskSubmitRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        return apiError(
          'bad_request',
          'taskSubmitRequestSchema validation failed',
          { issues: parsed.error.issues }
        );
      }
      const submit = parsed.data;

      // Idempotency, layer 1: in-memory cache.
      const hit = options.idempotencyCache.lookup(userId, submit.idempotencyKey);
      if (hit.hit) {
        reply.status(200);
        return taskSubmitResponseSchema.parse({
          taskId: hit.record.taskId,
          status: hit.record.status,
          createdAt: hit.record.createdAt,
          streamUrl: buildStreamUrl(hit.record.taskId)
        });
      }

      // Idempotency, layer 2: Firestore rebuild path. Handles
      // cold-start cache miss after a restart. Only "recent"
      // (<24h) matches replay; older rows fall through to a
      // fresh taskId per Gate 3.1.A clarification.
      const existing = await options.repository.findTaskByIdempotencyKey(
        userId,
        submit.idempotencyKey
      );
      if (existing !== undefined) {
        const ageMs = now().getTime() - Date.parse(existing.createdAt);
        if (ageMs < DAY_MS) {
          options.idempotencyCache.remember(userId, submit.idempotencyKey, {
            taskId: existing.taskId,
            status: existing.status,
            createdAt: existing.createdAt
          });
          reply.status(200);
          return taskSubmitResponseSchema.parse({
            taskId: existing.taskId,
            status: existing.status,
            createdAt: existing.createdAt,
            streamUrl: buildStreamUrl(existing.taskId)
          });
        }
      }

      // Fresh submission.
      const taskId = randomUUID();
      const nowDate = now();
      const createdAt = nowDate.toISOString();
      const expireAt = new Date(
        nowDate.getTime() + TASK_RETENTION_MS
      ).toISOString();

      const record: TaskRecord = {
        taskId,
        userId,
        status: 'pending',
        prompt: submit.prompt,
        agentType: submit.agentType,
        capabilities: submit.capabilities,
        idempotencyKey: submit.idempotencyKey,
        assignedAgentId: null,
        createdAt,
        updatedAt: createdAt,
        startedAt: null,
        completedAt: null,
        expireAt,
        output: null,
        outputDeltas: [],
        error: null,
        metadata: submit.metadata
      };

      try {
        await options.repository.recordTask(record);
      } catch (err) {
        app.log.warn({ err, taskId }, 'recordTask threw; returning 503');
        reply.status(503);
        return apiError(
          'firestore_unavailable',
          'Task could not be durably recorded'
        );
      }
      // Matches Phase 2 semantics (heartbeat-v2 / cost): a
      // `dataSource: 'api-controlled-fallback'` receipt is
      // accepted silently. ADC-absent is the dev + test path;
      // production with properly-configured ADC writes with
      // dataSource 'live'. A real Firestore outage throws and
      // lands in the catch above. Strict dataSource==='live'
      // gating rejected because it would make the test
      // pattern require a full mock repository seam, which is
      // disproportionate to the failure mode it guards.

      options.idempotencyCache.remember(userId, submit.idempotencyKey, {
        taskId,
        status: 'pending',
        createdAt
      });

      // Privacy: no prompt/output in logs. Only metadata + ids.
      // Gate 3.1.A Red Flag #1 / Option B retention posture.
      app.log.info(
        {
          userId,
          taskId,
          agentType: submit.agentType,
          capabilityCount: submit.capabilities.length,
          promptLength: submit.prompt.length,
          route: 'POST /v1/tasks',
          outcome: 201
        },
        'task submitted'
      );

      reply.status(201);
      return taskSubmitResponseSchema.parse({
        taskId,
        status: 'pending',
        createdAt,
        streamUrl: buildStreamUrl(taskId)
      });
    }
  );

  // GET /v1/tasks/:taskId — single-task status.
  // Per Gate 3.1.C directive: ownership mismatch returns 404
  // (not 403) so the response cannot be used to enumerate
  // other users' taskIds. The accessor `getTask(taskId, userId)`
  // returns undefined for both "not found" and "not yours",
  // centralising the rule at the repository layer.
  app.get<{ Params: { taskId: string } }>(
    '/v1/tasks/:taskId',
    { preHandler: options.userGuard },
    async (request, reply) => {
      const userId = request.authSession?.currentUser?.operatorId;
      if (userId === undefined || userId.length === 0) {
        reply.status(401);
        return apiError('unauthorized', 'Authenticated session required');
      }

      const rate = rateLimiter.tryAccept(userId, 'get');
      if (!rate.ok) {
        reply.status(429);
        reply.header('Retry-After', String(rate.retryAfterSeconds));
        return apiError(
          'rate_limited',
          `Too many requests; retry in ${rate.retryAfterSeconds}s`,
          { retryAfterSeconds: rate.retryAfterSeconds }
        );
      }

      const paramsParsed = taskIdParamsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        reply.status(400);
        return apiError('bad_request', 'taskId must be a valid UUID', {
          issues: paramsParsed.error.issues
        });
      }
      const { taskId } = paramsParsed.data;

      const task = await options.repository.getTask(taskId, userId);
      if (task === undefined) {
        reply.status(404);
        return apiError('not_found', 'Task not found');
      }

      reply.status(200);
      return taskStatusResponseSchema.parse({
        taskId: task.taskId,
        status: task.status,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        output: task.output,
        error: task.error
      });
    }
  );

  // GET /v1/tasks — paginated list of the caller's tasks.
  app.get<{
    Querystring: Record<string, string | undefined>;
  }>(
    '/v1/tasks',
    { preHandler: options.userGuard },
    async (request, reply) => {
      const userId = request.authSession?.currentUser?.operatorId;
      if (userId === undefined || userId.length === 0) {
        reply.status(401);
        return apiError('unauthorized', 'Authenticated session required');
      }

      const rate = rateLimiter.tryAccept(userId, 'get');
      if (!rate.ok) {
        reply.status(429);
        reply.header('Retry-After', String(rate.retryAfterSeconds));
        return apiError(
          'rate_limited',
          `Too many requests; retry in ${rate.retryAfterSeconds}s`,
          { retryAfterSeconds: rate.retryAfterSeconds }
        );
      }

      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        reply.status(400);
        return apiError('bad_request', 'Query validation failed', {
          issues: parsed.error.issues
        });
      }

      const { status, limit, cursor } = parsed.data;
      const result = await options.repository.listTasksForUser(userId, {
        status,
        limit,
        cursor
      });

      reply.status(200);
      return taskListResponseSchema.parse(result);
    }
  );

  // GET /v1/tasks/:taskId/stream — Phase 3.1 stub.
  // No auth check: the stub does not read or emit task data.
  // Phase 3.3 will replace this handler with the real SSE
  // implementation (token in query param, snapshot listener on
  // the task document, etc.).
  app.get<{ Params: { taskId: string } }>(
    '/v1/tasks/:taskId/stream',
    async (_request, reply) => {
      reply.status(501);
      return { code: 'not_implemented', phase: '3.3' };
    }
  );
};
