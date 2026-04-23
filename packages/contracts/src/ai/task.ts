import { z } from 'zod';

import { isoTimestampSchema, metadataSchema } from '../common.js';

/**
 * Task lifecycle — Phase 3.1 surface of the mobile → agent
 * dispatch loop.
 *
 * The eight-variant enum covers the full path from user
 * submission to terminal outcome:
 *
 *   pending    — row exists, not yet published to the dispatch queue
 *   queued     — published (Phase 3.2) but no agent has claimed it
 *   assigned   — an agent acknowledged task-assign; not executing yet
 *   executing  — agent is running the task
 *   streaming  — agent has started emitting partial output (Phase 3.3)
 *   completed  — terminal success
 *   failed     — terminal failure (dispatch exhausted, agent error, …)
 *   cancelled  — user cancel or timeout
 *
 * Fewer states were considered and rejected — distinguishing
 * `queued` from `assigned` lets observability show "in the queue"
 * vs "agent has it", and separating `executing` from `streaming`
 * lets the UI render a different affordance once partial output
 * exists. See ADR "Task Lifecycle As An 8-Variant Enum" for the
 * alternatives (bitmask flags, event-sourced, three-state).
 */
export const taskStatusSchema = z.enum([
  'pending',
  'queued',
  'assigned',
  'executing',
  'streaming',
  'completed',
  'failed',
  'cancelled'
]);

/**
 * Provider selector the client can opt into. `auto` asks the
 * router to pick a matching agent based on `capabilities`.
 * Adding a new provider (codex, gemini-cli, …) lands as a new
 * enum variant + matching AgentFactory on the desktop-agent side.
 */
export const taskAgentTypeSchema = z.enum(['claude-code', 'auto']);

/** Single streaming fragment emitted by the agent during execution. */
export const taskOutputDeltaSchema = z.object({
  seq: z.number().int().nonnegative(),
  delta: z.string(),
  timestamp: isoTimestampSchema
});

/** Terminal-failure error shape persisted on the TaskRecord. */
export const taskErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1)
});

/**
 * Body of POST /v1/tasks. The `idempotencyKey` is the dedup
 * primitive per Phase 3.1 §3.1.5 — clients generate a fresh
 * UUID per logical submission; a replay within 24h of the same
 * (userId, idempotencyKey) pair returns the original taskId.
 */
export const taskSubmitRequestSchema = z.object({
  prompt: z.string().min(1).max(50_000),
  agentType: taskAgentTypeSchema.default('auto'),
  capabilities: z.array(z.string()).default([]),
  idempotencyKey: z.string().uuid(),
  metadata: metadataSchema.optional()
});

/**
 * Full task document as persisted to Firestore. Phase 3.1 writes
 * the identity + timeline + prompt fields; Phase 3.2 writes
 * `assignedAgentId` + dispatch tracking; Phase 3.3 appends to
 * `outputDeltas` and writes `output` / `error` on terminal states.
 *
 * `expireAt` is a server-computed `createdAt + 30 days` (Option
 * B chosen at Gate 3.1.A, per ADR "Task Data Retention Policy").
 * Firestore TTL fires on this field — the value IS the expiry
 * timestamp, not an offset. Docs past `expireAt` are deleted
 * by Google's TTL service within ~24h.
 */
export const taskRecordSchema = z.object({
  taskId: z.string().uuid(),
  userId: z.string().min(1),
  status: taskStatusSchema,
  prompt: z.string().min(1).max(50_000),
  agentType: taskAgentTypeSchema,
  capabilities: z.array(z.string()),
  idempotencyKey: z.string().uuid(),
  assignedAgentId: z.string().uuid().nullable(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  startedAt: isoTimestampSchema.nullable(),
  completedAt: isoTimestampSchema.nullable(),
  expireAt: isoTimestampSchema,
  output: z.string().nullable(),
  outputDeltas: z.array(taskOutputDeltaSchema),
  error: taskErrorSchema.nullable(),
  metadata: metadataSchema.optional()
});

/**
 * POST /v1/tasks response. `streamUrl` is the client-facing path
 * for the SSE endpoint (Phase 3.3 proper impl; Phase 3.1 stubs
 * it with 501). The pick deliberately omits `assignedAgentId`
 * and the full record: the client only needs to know what to
 * poll / stream against.
 */
export const taskSubmitResponseSchema = z.object({
  taskId: z.string().uuid(),
  status: taskStatusSchema,
  createdAt: isoTimestampSchema,
  streamUrl: z.string().min(1)
});

/**
 * GET /v1/tasks/:taskId and GET /v1/tasks list-item shape.
 * Intentionally omits `streamUrl` (client derives it from
 * `taskId`) and `assignedAgentId` (internal routing state the
 * mobile UI doesn't need). Confirmed at Gate 3.1.A.
 */
export const taskStatusResponseSchema = taskRecordSchema.pick({
  taskId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  output: true,
  error: true
});

/** Paginated list response for GET /v1/tasks. */
export const taskListResponseSchema = z.object({
  tasks: z.array(taskStatusResponseSchema),
  nextCursor: z.string().nullable()
});

export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskAgentType = z.infer<typeof taskAgentTypeSchema>;
export type TaskOutputDelta = z.infer<typeof taskOutputDeltaSchema>;
export type TaskError = z.infer<typeof taskErrorSchema>;
export type TaskSubmitRequest = z.infer<typeof taskSubmitRequestSchema>;
export type TaskRecord = z.infer<typeof taskRecordSchema>;
export type TaskSubmitResponse = z.infer<typeof taskSubmitResponseSchema>;
export type TaskStatusResponse = z.infer<typeof taskStatusResponseSchema>;
export type TaskListResponse = z.infer<typeof taskListResponseSchema>;
