import { z } from 'zod';

import { isoTimestampSchema } from '../common.js';

/**
 * Phase 4.0 agent productionization — registration + lifecycle
 * schemas. See ADR "Agent Productionization — Auth, Online
 * Status, Startup, Legacy Sunset (Phase 4.0)" in
 * docs/DECISIONS.md for the architectural rationale.
 *
 * Wire contract for the six new endpoints under `/v1/agent/*`:
 *
 *   POST  /v1/agent/register       — user JWT → mint agent token
 *   POST  /v1/agent/rotate-token   — agent token → new token
 *   DELETE /v1/agent/:id           — user JWT → revoke
 *   GET   /v1/agent/list           — user JWT → list owned agents
 *   GET   /v1/agent/:id/status     — user JWT → single agent status
 *   GET   /v1/agent/latest-version — public → release pointer
 *
 * The full agent record persisted in Firestore (with the
 * bcrypt token hashes) is `AgentRecord`; the slimmed-down
 * shape mobile sees over the wire is `AgentSummary`. Token
 * hashes never cross the API surface.
 */

/**
 * Capability names a registering agent may declare. Mirrors
 * the existing `AgentCapability` union from `capabilities.ts`
 * but lifted into a zod schema so the registration request
 * gets runtime validation. Keep the two in sync — when a
 * capability lands in the union, mirror it here.
 */
export const agentCapabilitySchema = z.enum([
  'code-generation',
  'code-review',
  'planning',
  'file-read',
  'file-write',
  'shell-execution',
  'web-fetch',
  'image-understanding',
  'image-generation',
  'long-context',
  'extended-context',
  'multimodal',
  'streaming',
  'tool-use',
  'vision',
  'voice-input',
  'voice-output'
]);

export type AgentCapabilityName = z.infer<typeof agentCapabilitySchema>;

/**
 * The agent's ASCII machine label. Matches what the user types
 * during the one-time `pnpm --filter desktop-agent register`
 * flow: hostname, "Akmal's MBP", "studio-pc", etc. Limit
 * 100 chars to keep mobile UI rendering predictable.
 */
const machineNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(
    /^[\x20-\x7E]+$/u,
    'machine name must be printable ASCII (no control chars or non-Latin)'
  );

const agentIdSchema = z.string().uuid();

/**
 * POST /v1/agent/register request body. The client (one-time
 * CLI) generates a fresh UUID for `agentId` so both sides
 * agree on the identity before the bcrypt hash is computed.
 * The user JWT in the Authorization header binds the agent
 * to a user via `request.authSession.currentUser.operatorId`
 * inside the route handler.
 */
export const agentRegisterRequestSchema = z.object({
  agentId: agentIdSchema,
  machineName: machineNameSchema,
  capabilities: z
    .array(agentCapabilitySchema)
    .min(1, 'agent must declare at least one capability')
    .max(20, 'too many capabilities — agents typically declare 3-5')
});

export type AgentRegisterRequest = z.infer<typeof agentRegisterRequestSchema>;

/**
 * POST /v1/agent/register response body. `agentToken` is the
 * raw 32-byte random base64url token; this is the ONE moment
 * the value crosses the wire. The agent is expected to write
 * it to Windows Credential Manager before the response is
 * dropped.
 *
 * `tokenIssuedAt` is the iat-equivalent so the agent can
 * compute its own age; the rotation hint policy (30 days OR
 * 100K uses) is enforced server-side via the
 * `X-Token-Rotation-Recommended` response header.
 */
export const agentRegisterResponseSchema = z.object({
  agentId: agentIdSchema,
  agentToken: z.string().min(1),
  tokenIssuedAt: isoTimestampSchema
});

export type AgentRegisterResponse = z.infer<typeof agentRegisterResponseSchema>;

/**
 * POST /v1/agent/rotate-token request body. Empty by design —
 * the current agent token in `Authorization: Bearer <token>`
 * implicitly identifies the agent. We don't accept the agent
 * ID in the body because that opens an authorization-confusion
 * vector (caller could specify a different agent's id while
 * holding their own token).
 */
export const agentRotateTokenRequestSchema = z.object({});
export type AgentRotateTokenRequest = z.infer<
  typeof agentRotateTokenRequestSchema
>;

/**
 * POST /v1/agent/rotate-token response body. The new token
 * supersedes the old immediately; the old token stays valid
 * for the 24h overlap window per ADR-025 amendment 1, after
 * which the cleanup job clears `previousTokenHash`.
 *
 * `previousTokenExpiresAt` is the deadline the agent sees and
 * uses to schedule the inevitable next rotation if it forgets
 * to discard the old token.
 */
export const agentRotateTokenResponseSchema = z.object({
  agentId: agentIdSchema,
  agentToken: z.string().min(1),
  tokenIssuedAt: isoTimestampSchema,
  previousTokenExpiresAt: isoTimestampSchema
});

export type AgentRotateTokenResponse = z.infer<
  typeof agentRotateTokenResponseSchema
>;

/**
 * Online-status trichotomy from ADR-025 D2. Computed
 * server-side from `lastHeartbeatAt` and the agent's RTT
 * histogram (Phase 4.0 Part 5 emits the RTT data on the WS).
 */
export const agentOnlineStateSchema = z.enum([
  'online',
  'degraded',
  'offline'
]);

export type AgentOnlineState = z.infer<typeof agentOnlineStateSchema>;

/**
 * Slimmed agent record returned over the wire. The Firestore
 * document carries more (bcrypt hashes, audit metadata) but
 * those never reach the client.
 */
export const agentSummarySchema = z.object({
  agentId: agentIdSchema,
  machineName: machineNameSchema,
  capabilities: z.array(agentCapabilitySchema),
  onlineState: agentOnlineStateSchema,
  lastHeartbeatAt: isoTimestampSchema.nullable(),
  lastConnectAt: isoTimestampSchema.nullable(),
  lastDisconnectAt: isoTimestampSchema.nullable(),
  createdAt: isoTimestampSchema,
  /**
   * Counter for how many times the previous (rotated-out)
   * token was accepted since the last rotation. A non-zero
   * value with `previousTokenExpiresAt` close to expiry is
   * the operator signal that the agent is stuck on a stale
   * token — see ADR-025 amendment 1.
   */
  oldTokenUsageCount: z.number().int().nonnegative()
});

export type AgentSummary = z.infer<typeof agentSummarySchema>;

/**
 * GET /v1/agent/list response. Future paging hook: when an
 * organisation grows past ~100 agents we'll add a cursor
 * field; today we deliver the full set in one shot.
 */
export const agentListResponseSchema = z.object({
  agents: z.array(agentSummarySchema)
});

export type AgentListResponse = z.infer<typeof agentListResponseSchema>;

/**
 * GET /v1/agent/:id/status response. Same payload shape as a
 * single AgentSummary; the route exists separately so mobile
 * can poll a single agent without re-fetching the whole list.
 */
export const agentStatusResponseSchema = agentSummarySchema;
export type AgentStatusResponse = z.infer<typeof agentStatusResponseSchema>;

/**
 * DELETE /v1/agent/:id response. Body is empty (204 No
 * Content) on success — the schema is defined for symmetry
 * with the others and so route tests can assert "no
 * unexpected body".
 */
export const agentRevokeResponseSchema = z.object({}).strict();
export type AgentRevokeResponse = z.infer<typeof agentRevokeResponseSchema>;

/**
 * GET /v1/agent/latest-version response. Phase 4.0 ships a
 * stub: `downloadUrl` and `signature` are null until TD-059
 * lands the signed-update pipeline. The agent's update loop
 * (Phase 4.0 Part 6) treats null `downloadUrl` as "no update
 * available" and skips download.
 */
export const agentLatestVersionResponseSchema = z.object({
  version: z.string().min(1),
  downloadUrl: z.string().url().nullable(),
  signature: z.string().nullable(),
  releaseNotes: z.string()
});

export type AgentLatestVersionResponse = z.infer<
  typeof agentLatestVersionResponseSchema
>;

/**
 * Server-side response header signalling the agent that the
 * presented (previous) token has rotated and the agent should
 * call `POST /v1/agent/rotate-token` immediately. The agent
 * is expected to read this from REST responses AND the WS
 * upgrade response. Lowercase per HTTP-header convention; the
 * comparison should be case-insensitive on the client.
 */
export const TOKEN_ROTATION_RECOMMENDED_HEADER =
  'x-token-rotation-recommended';

/**
 * Internal Firestore record shape. Not exported on the api's
 * outer surface — useful for typed Firestore reads/writes
 * inside the api code. Mobile never receives this shape.
 *
 * `tokenHash` and `previousTokenHash` are bcrypt hashes; the
 * raw tokens are never stored, only the hashes.
 *
 * `tokenLookupHash` and `previousTokenLookupHash` are
 * sha256(rawToken).slice(0,16) — the indexable fields the
 * agentTokenGuard uses to narrow the candidate set during
 * auth. Indexable because they're deterministic; safe
 * because they're a one-way hash of a 256-bit secret. They
 * MUST be coherent with their bcrypt counterparts: when
 * `tokenHash` is rotated, both `tokenLookupHash` and
 * `tokenHash` are written in the same Firestore update.
 */
export const agentRecordSchema = z.object({
  agentId: agentIdSchema,
  userId: z.string().min(1),
  machineName: machineNameSchema,
  capabilities: z.array(agentCapabilitySchema),
  tokenHash: z.string().min(1),
  tokenLookupHash: z.string().length(16),
  tokenIssuedAt: isoTimestampSchema,
  tokenLastRotatedAt: isoTimestampSchema.nullable(),
  tokenUseCount: z.number().int().nonnegative(),
  previousTokenHash: z.string().min(1).nullable(),
  previousTokenLookupHash: z.string().length(16).nullable(),
  previousTokenExpiresAt: isoTimestampSchema.nullable(),
  oldTokenUsageCount: z.number().int().nonnegative(),
  online: z.boolean(),
  lastConnectAt: isoTimestampSchema.nullable(),
  lastDisconnectAt: isoTimestampSchema.nullable(),
  lastHeartbeatAt: isoTimestampSchema.nullable(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  revoked: z.boolean(),
  revokedAt: isoTimestampSchema.nullable(),
  revokedReason: z.string().nullable()
});

export type AgentRecord = z.infer<typeof agentRecordSchema>;
