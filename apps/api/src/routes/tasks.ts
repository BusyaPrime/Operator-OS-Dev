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
import type { TaskDispatchPublisher } from '../services/task-dispatch-publisher.js';
import type {
  TaskEventBus,
  TaskStreamEvent
} from '../services/task-event-bus.js';

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
  /**
   * Phase 3.2 dispatch trigger. When present, POST /v1/tasks publishes
   * {taskId, attempt=1} to the task-dispatch Pub/Sub topic after a
   * successful recordTask. Absent in Phase 3.1 tests and in dev envs
   * without ADC — POST returns 201 and the dispatch pipeline is
   * record-only.
   */
  readonly dispatchPublisher?: TaskDispatchPublisher;

  /**
   * Phase 3.3 SSE streaming. When present,
   * `GET /v1/tasks/:taskId/stream` opens a `text/event-stream`
   * response and forwards live events from this bus to the client.
   * Absent in Phase 3.1 / 3.2 tests — handler returns 503 with a
   * 'stream_unavailable' code when the bus is not wired.
   */
  readonly taskEventBus?: TaskEventBus;

  /**
   * SSE heartbeat interval (ms). Default 25_000 (25s) — under
   * Cloud Run's 60-min request limit while typical edge proxies
   * close idle streams at ~30s. Tests pass shorter intervals
   * (e.g. 10ms) to drive the heartbeat path quickly.
   */
  readonly sseHeartbeatMs?: number;
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

      // Phase 3.2 dispatch trigger. Fire-and-forget against Pub/Sub;
      // a failure here is logged but does NOT fail the POST — Phase
      // 3.1 persistence already succeeded, and the task can be
      // re-dispatched by a reconciliation job (future TD) without
      // user intervention.
      if (options.dispatchPublisher) {
        const dispatchResult = await options.dispatchPublisher.publishDispatchTask({
          taskId,
          attempt: 1
        });
        if (!dispatchResult.published) {
          app.log.warn(
            {
              taskId,
              mode: dispatchResult.mode,
              reason: dispatchResult.reason
            },
            'task-dispatch publish failed; task will need manual re-dispatch'
          );
        }
      }

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

  // GET /v1/tasks/:taskId/stream — Phase 3.3 SSE handler.
  //
  // Auth: userGuard (preHandler) — same Bearer token Phase 3.1 GETs
  //       expect. Ownership: getTask(taskId, userId) -> 404 on
  //       miss/mismatch (Phase 3.1 enumeration-proof pattern).
  //
  // Frames (text/event-stream):
  //   id: <seq>
  //   event: delta | status | completed | failed
  //   data: <TaskStreamEvent JSON>
  //   <blank line>
  // Comment frames (`: heartbeat <ts>`) every `sseHeartbeatMs` keep
  // the connection alive under Cloud Run / edge proxies. Clients
  // that respect the SSE spec discard comments.
  //
  // Reconnection: clients re-send `Last-Event-ID: <seq>`. The
  // handler replays Firestore `outputDeltas[seq > Last-Event-ID]`
  // before subscribing live, so a network blip does not lose
  // tokens. (TD-042 caches this replay path for hot reconnects.)
  app.get<{ Params: { taskId: string } }>(
    '/v1/tasks/:taskId/stream',
    { preHandler: options.userGuard },
    async (request, reply) => {
      const userId = request.currentUser?.operatorId;
      if (!userId) {
        reply.status(401);
        return apiError(
          'unauthorized',
          'User identity not available in request context'
        );
      }

      const params = taskIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        reply.status(400);
        return apiError('invalid_taskid', 'taskId must be a UUID', {
          issues: params.error.issues
        });
      }
      const { taskId } = params.data;

      // Ownership + existence (Phase 3.1 enumeration-proof: any miss
      // returns 404, never 403, so we don't leak existence of
      // someone else's task).
      const task = await options.repository.getTask(taskId, userId);
      if (task === undefined) {
        reply.status(404);
        return apiError('not_found', 'Task not found');
      }

      if (options.taskEventBus === undefined) {
        // Bus not wired (test/dev mode). Honest 503.
        reply.status(503);
        return apiError(
          'stream_unavailable',
          'Task event bus is not configured on this api instance.'
        );
      }
      const bus = options.taskEventBus;

      const heartbeatMs = options.sseHeartbeatMs ?? 25_000;
      const lastEventIdHeaderRaw = request.headers['last-event-id'];
      const lastEventIdHeader = Array.isArray(lastEventIdHeaderRaw)
        ? lastEventIdHeaderRaw[0]
        : lastEventIdHeaderRaw;
      const lastEventIdParsed =
        typeof lastEventIdHeader === 'string'
          ? Number.parseInt(lastEventIdHeader, 10)
          : Number.NaN;
      const replayFrom = Number.isFinite(lastEventIdParsed)
        ? lastEventIdParsed
        : 0;

      // Hijack the reply so Fastify does not auto-serialize a JSON
      // body. From here we own the raw Node response.
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });

      let isClosed = false;
      const writeQueue: Array<() => void> = [];
      let isDraining = false;

      const flushQueue = (): void => {
        while (writeQueue.length > 0 && !isClosed && !isDraining) {
          const next = writeQueue.shift();
          next?.();
        }
      };

      const enqueueOrWrite = (work: () => void): void => {
        if (isClosed) return;
        if (isDraining) {
          writeQueue.push(work);
          return;
        }
        work();
        if (raw.writableNeedDrain) {
          isDraining = true;
          raw.once('drain', () => {
            isDraining = false;
            flushQueue();
          });
        }
      };

      const writeFrame = (event: TaskStreamEvent, id: number): void => {
        enqueueOrWrite(() => {
          if (isClosed) return;
          const payload = `id: ${id}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
          try {
            raw.write(payload);
          } catch {
            // Connection died mid-write; cleanup runs via 'close'.
          }
        });
      };

      const writeHeartbeat = (timestamp: string): void => {
        enqueueOrWrite(() => {
          if (isClosed) return;
          try {
            raw.write(`: heartbeat ${timestamp}\n\n`);
          } catch {
            /* swallow */
          }
        });
      };

      // 1. Replay missed deltas. On first connect (no Last-Event-ID
      //    header), replayFrom = 0 → entire history streams as
      //    catchup so the client renders previously-emitted output.
      let lastSeq = 0;
      for (const delta of task.outputDeltas) {
        if (delta.seq > replayFrom) {
          writeFrame({ kind: 'delta', delta }, delta.seq);
        }
        if (delta.seq > lastSeq) lastSeq = delta.seq;
      }

      // 2. Send current status snapshot.
      lastSeq += 1;
      writeFrame({ kind: 'status', status: task.status, seq: lastSeq }, lastSeq);

      // 3. If task is already in a terminal state, emit the terminal
      //    event and close — no live subscription needed.
      if (
        task.status === 'completed' ||
        task.status === 'failed' ||
        task.status === 'cancelled'
      ) {
        lastSeq += 1;
        if (task.status === 'failed' && task.error !== null) {
          writeFrame(
            { kind: 'failed', error: task.error, seq: lastSeq },
            lastSeq
          );
        } else {
          writeFrame(
            {
              kind: 'completed',
              output: task.output ?? '',
              seq: lastSeq
            },
            lastSeq
          );
        }
        isClosed = true;
        try {
          raw.end();
        } catch {
          /* swallow */
        }
        return reply;
      }

      // 4. Subscribe to live events.
      const unsubscribe = bus.subscribe(taskId, (event) => {
        if (isClosed) return;
        if (event.kind === 'heartbeat') {
          writeHeartbeat(event.timestamp);
          return;
        }
        const id =
          event.kind === 'delta' ? event.delta.seq : event.seq;
        writeFrame(event, id);
        if (event.kind === 'completed' || event.kind === 'failed') {
          isClosed = true;
          try {
            raw.end();
          } catch {
            /* swallow */
          }
        }
      });

      // 5. Heartbeat ticker. unref() so the timer does not pin the
      //    event loop during shutdown.
      const heartbeatTimer = setInterval(() => {
        if (isClosed) return;
        writeHeartbeat(new Date().toISOString());
      }, heartbeatMs);
      if (typeof heartbeatTimer.unref === 'function') {
        heartbeatTimer.unref();
      }

      // 6. Cleanup on client disconnect.
      const cleanup = (): void => {
        if (isClosed) return;
        isClosed = true;
        clearInterval(heartbeatTimer);
        unsubscribe();
        try {
          raw.end();
        } catch {
          /* swallow */
        }
      };
      raw.on('close', cleanup);
      raw.on('error', cleanup);

      return reply;
    }
  );
};
