import { z } from 'zod';

import { isoTimestampSchema } from '../common.js';

import {
  taskErrorSchema,
  taskOutputDeltaSchema,
  taskStatusSchema
} from './task.js';

/**
 * Wire format for SSE frame `data:` payloads on
 * `GET /v1/tasks/:taskId/stream`. Single source of truth shared
 * between the api (Fastify SSE handler in `apps/api/src/routes/
 * tasks.ts`) and the mobile client (`apps/mobile/src/screens/
 * task-stream-helpers.ts`). Phase 3.3 c17.
 *
 * Discriminated by `kind`. Five variants:
 *
 *   delta     — streaming output fragment. Carries the full
 *               TaskOutputDelta so the client can render seq +
 *               timestamp without re-deriving them.
 *   status    — terminal-aware status transition observed on
 *               the task. `seq` lets the SSE handler tag the
 *               frame with a Last-Event-ID-resumable id.
 *   completed — terminal success. `output` is the full assembled
 *               response. `seq` is the highest emitted seq, so
 *               reconnecting clients can ask for
 *               `Last-Event-ID > seq` and skip the replay.
 *   failed    — terminal failure. `error` mirrors TaskError.
 *   heartbeat — keep-alive frame (Cloud Run 60-min boundary).
 *               Emitted as `kind:'heartbeat'` so internal
 *               subscribers can observe liveness too; the SSE
 *               handler also writes it as a comment frame for
 *               EventSource clients to discard naturally.
 *
 * SCHEMA-SHAPE NOTE (Phase 3.3 c17 decision):
 *   This file lifts the wire format that Phase 3.3 c1-c4 already
 *   shipped (and that Phase 3.3 c14-c15 already parses on mobile)
 *   into shared contracts. An alternative shape with a `payload`
 *   wrapper + flattened error fields was considered and rejected
 *   — refactoring the live wire format would require touching
 *   the api emit, mobile parse, and ~50 tests with no behavioural
 *   benefit. The single-source-of-truth goal is achieved either
 *   way; this version keeps the diff surgical.
 */
export const taskStreamEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('delta'),
    delta: taskOutputDeltaSchema
  }),
  z.object({
    kind: z.literal('status'),
    status: taskStatusSchema,
    seq: z.number().int().nonnegative()
  }),
  z.object({
    kind: z.literal('completed'),
    output: z.string(),
    seq: z.number().int().nonnegative()
  }),
  z.object({
    kind: z.literal('failed'),
    error: taskErrorSchema,
    seq: z.number().int().nonnegative()
  }),
  z.object({
    kind: z.literal('heartbeat'),
    timestamp: isoTimestampSchema
  })
]);

export type TaskStreamEvent = z.infer<typeof taskStreamEventSchema>;

/**
 * Convenience parser for the mobile client. Server emits valid
 * frames by construction (writeFrame in tasks.ts); the safeParse
 * lets the client gracefully drop a malformed frame instead of
 * crashing the render loop. Returns the parsed event or undefined.
 */
export const safeParseTaskStreamEvent = (
  raw: unknown
): TaskStreamEvent | undefined => {
  const result = taskStreamEventSchema.safeParse(raw);
  return result.success ? result.data : undefined;
};
