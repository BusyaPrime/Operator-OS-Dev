import { randomBytes } from 'node:crypto';

import bcrypt from 'bcryptjs';
import {
  agentLatestVersionResponseSchema,
  agentListResponseSchema,
  agentRegisterRequestSchema,
  agentRegisterResponseSchema,
  agentRotateTokenResponseSchema,
  agentStatusResponseSchema,
  type AgentRecord,
  type AgentSummary
} from '@operator-os/contracts';
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';

import {
  agentTokenLookupHash,
  type AgentAuditWriter
} from '../integrations/agent-token-guard.js';
import {
  AgentsCollectionUnavailableError,
  projectAgentSummary,
  type AgentLifecycleRepository
} from '../integrations/firestore-agent-repository.js';

/**
 * Phase 4.0 Part 3.D-G — agent registration + lifecycle routes.
 *
 * Wire surface (per ADR-025):
 *
 *   POST   /v1/agent/register        user JWT → mint token
 *   POST   /v1/agent/rotate-token    agent token → new token
 *   GET    /v1/agent/list            user JWT → owned agents
 *   GET    /v1/agent/:id/status      user JWT → single agent
 *   DELETE /v1/agent/:id             user JWT → revoke
 *   GET    /v1/agent/latest-version  public → release pointer
 *
 * Each route lands in its own commit (3.D-3.G). The file
 * starts with just `register` and grows route-by-route to
 * keep the diff diff-able.
 */

/** Token length: 32 bytes random → ~43 chars base64url. */
const TOKEN_BYTE_LENGTH = 32;
/** Server-side bcrypt cost — OWASP 2026 recommended floor. */
const BCRYPT_COST = 12;

export interface AgentRegistrationRoutesOptions {
  readonly lifecycleRepository: AgentLifecycleRepository;
  readonly audit: AgentAuditWriter;
  /** Guard that authenticates a user JWT and attaches request.authSession. */
  readonly userGuard: preHandlerAsyncHookHandler;
  /** Guard that authenticates the agent's own token. */
  readonly agentTokenGuard: preHandlerAsyncHookHandler;
  /**
   * Optional cache invalidator. The agentTokenGuard caches
   * (token, recordSnapshot) pairs to amortise bcrypt cost; a
   * rotation or revocation that doesn't tell the cache about
   * the change leaves stale snapshots that would let the next
   * request authenticate against the old hash. Routes call
   * this after every successful rotateToken / markRevoked
   * write so the cache stays coherent. Optional because the
   * per-route unit tests use a no-cache stub guard.
   */
  readonly invalidateAgentTokenCache?: (agentId: string) => void;
  /**
   * Phase 4.0 stub returns this string as the latest agent
   * version, with downloadUrl + signature null. TD-059 lands
   * the real signed-update pipeline.
   */
  readonly currentAgentVersion: string;
  /**
   * Test seam — deterministic clock. Production uses Date.
   */
  readonly now?: () => Date;
  /**
   * Test seam — deterministic token bytes. Production uses
   * `crypto.randomBytes(32).toString('base64url')`.
   */
  readonly generateRawToken?: () => string;
}

interface RouteApiError {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

const routeError = (
  code: string,
  message: string,
  details?: Record<string, unknown>
): RouteApiError => ({
  code,
  message,
  ...(details !== undefined ? { details } : {})
});

const defaultGenerateRawToken = (): string =>
  randomBytes(TOKEN_BYTE_LENGTH).toString('base64url');

const projectListResponse = (
  records: ReadonlyArray<AgentRecord>,
  now: Date
): { agents: AgentSummary[] } => ({
  agents: records.map((record) => projectAgentSummary(record, now.getTime()))
});

export const registerAgentRegistrationRoutes = async (
  app: FastifyInstance,
  options: AgentRegistrationRoutesOptions
): Promise<void> => {
  const now = options.now ?? (() => new Date());
  const generateRawToken =
    options.generateRawToken ?? defaultGenerateRawToken;
  // Suppress lint warnings for currently-unused options that
  // the next route commits will pick up. They're here in the
  // interface so 3.D, 3.E, 3.F, 3.G can share one wiring point.

  // POST /v1/agent/register — bind a desktop agent identity to
  // the authenticated user, mint the opaque token, and persist
  // the bcrypt hash. The raw token crosses the wire ONCE in
  // the response body; the agent stores it in Windows
  // Credential Manager and never echoes it back.
  app.post(
    '/v1/agent/register',
    { preHandler: options.userGuard },
    async (request, reply) => {
      const userId = request.authSession?.currentUser?.operatorId;
      if (userId === undefined || userId.length === 0) {
        reply.status(401);
        return routeError(
          'unauthorized',
          'Authenticated session required'
        );
      }

      const parsed = agentRegisterRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        return routeError(
          'bad_request',
          'agentRegisterRequestSchema validation failed',
          { issues: parsed.error.issues }
        );
      }

      const { agentId, machineName, capabilities } = parsed.data;
      const rawToken = generateRawToken();
      const tokenHash = await bcrypt.hash(rawToken, BCRYPT_COST);
      const tokenLookupHash = await agentTokenLookupHash(rawToken);
      const issuedAt = now();
      const issuedAtIso = issuedAt.toISOString();

      const record: AgentRecord = {
        agentId,
        userId,
        machineName,
        capabilities,
        tokenHash,
        tokenLookupHash,
        tokenIssuedAt: issuedAtIso,
        tokenLastRotatedAt: null,
        tokenUseCount: 0,
        previousTokenHash: null,
        previousTokenLookupHash: null,
        previousTokenExpiresAt: null,
        oldTokenUsageCount: 0,
        online: false,
        lastConnectAt: null,
        lastDisconnectAt: null,
        lastHeartbeatAt: null,
        createdAt: issuedAtIso,
        updatedAt: issuedAtIso,
        revoked: false,
        revokedAt: null,
        revokedReason: null
      };

      try {
        await options.lifecycleRepository.create(record);
      } catch (err) {
        if (
          err instanceof AgentsCollectionUnavailableError &&
          err.code === 'AGENT_ID_TAKEN'
        ) {
          reply.status(409);
          return routeError(
            'agent_id_taken',
            `Agent ${agentId} is already registered`
          );
        }
        if (err instanceof AgentsCollectionUnavailableError) {
          reply.status(503);
          return routeError(
            'agents_collection_unavailable',
            err.message,
            { code: err.code }
          );
        }
        request.log.error({ err, agentId, userId }, 'agent register failed');
        reply.status(503);
        return routeError(
          'agents_collection_unavailable',
          'Agent record could not be persisted'
        );
      }

      // Best-effort audit. Audit failures must not break the
      // registration path — the bcrypt hash is already in
      // Firestore, we just couldn't log the event.
      try {
        await options.audit.record({
          agentId,
          userId,
          eventType: 'agent_registered',
          latencyMs: Date.now() - issuedAt.getTime(),
          ip: request.ip,
          userAgent:
            typeof request.headers['user-agent'] === 'string'
              ? request.headers['user-agent']
              : undefined
        });
      } catch {
        /* swallowed — see comment above */
      }

      const response = {
        agentId,
        agentToken: rawToken,
        tokenIssuedAt: issuedAtIso
      };
      const validated = agentRegisterResponseSchema.parse(response);
      reply.status(201);
      return validated;
    }
  );

  // POST /v1/agent/rotate-token — overlap-window rotation per
  // ADR-025 amendment 1. Authenticated by the agent's CURRENT
  // token (not the user JWT — agents drive their own
  // rotation lifecycle). Old token stays valid for 24h after
  // the call so a fleet of long-lived WS connections doesn't
  // see a transient 401 across the rotation boundary.
  app.post(
    '/v1/agent/rotate-token',
    { preHandler: options.agentTokenGuard },
    async (request, reply) => {
      const startedAt = Date.now();
      const agent = request.agent;
      if (agent === undefined) {
        // The guard ran but didn't attach an agent — should
        // never happen given the preHandler contract, but
        // defending in depth keeps the type narrowing honest.
        reply.status(401);
        return routeError(
          'unauthorized',
          'Agent token required for rotation'
        );
      }

      // Refuse to nest rotations: if the caller authenticated
      // with the previous (already-rotated-once) token, that
      // means a rotation is already in flight (or the agent's
      // last rotation didn't propagate to its credential
      // store). Forcing a re-rotation here would just churn.
      if (agent.usedPreviousToken) {
        reply.status(409);
        return routeError(
          'rotation_already_in_progress',
          'Token is already mid-rotation. Persist the most recent rotate-token response and retry once.'
        );
      }

      const newRawToken = generateRawToken();
      const newTokenHash = await bcrypt.hash(newRawToken, BCRYPT_COST);
      const newTokenLookupHash = await agentTokenLookupHash(newRawToken);
      const issuedAt = now();
      // Overlap window per ADR-025 amendment 1: 24h.
      const overlapExpiresAt = new Date(
        issuedAt.getTime() + 24 * 60 * 60 * 1000
      );

      try {
        const updated = await options.lifecycleRepository.rotateToken(
          agent.agentId,
          newTokenHash,
          newTokenLookupHash,
          overlapExpiresAt
        );

        // Cache invalidation BEFORE audit. The cache holds a
        // stale (rawToken → recordSnapshot) entry from the
        // pre-rotation state that would falsely authenticate
        // the old token as `hit: 'current'` instead of
        // `hit: 'previous'`. Calling invalidate here ensures
        // the next auth re-derives the correct hit type from
        // the freshly-persisted record.
        try {
          options.invalidateAgentTokenCache?.(updated.agentId);
        } catch {
          /* swallowed — cache is purely a perf optimisation */
        }

        try {
          await options.audit.record({
            agentId: updated.agentId,
            userId: updated.userId,
            eventType: 'token_rotated',
            latencyMs: Date.now() - startedAt,
            ip: request.ip,
            userAgent:
              typeof request.headers['user-agent'] === 'string'
                ? request.headers['user-agent']
                : undefined
          });
        } catch {
          /* swallowed — audit is best-effort */
        }

        const response = {
          agentId: updated.agentId,
          agentToken: newRawToken,
          tokenIssuedAt: updated.tokenIssuedAt,
          previousTokenExpiresAt:
            updated.previousTokenExpiresAt ?? overlapExpiresAt.toISOString()
        };
        return agentRotateTokenResponseSchema.parse(response);
      } catch (err) {
        if (err instanceof AgentsCollectionUnavailableError) {
          if (err.code === 'AGENT_NOT_FOUND') {
            reply.status(404);
            return routeError('agent_not_found', err.message);
          }
          if (err.code === 'AGENT_REVOKED') {
            reply.status(403);
            return routeError('agent_revoked', err.message);
          }
          reply.status(503);
          return routeError(
            'agents_collection_unavailable',
            err.message,
            { code: err.code }
          );
        }
        request.log.error(
          { err, agentId: agent.agentId },
          'token rotation failed'
        );
        reply.status(503);
        return routeError(
          'agents_collection_unavailable',
          'Token rotation failed'
        );
      }
    }
  );

  // GET /v1/agent/list — return every agent owned by the
  // authenticated user. Mobile polls this periodically to
  // refresh its devices view (Phase 4.0 Part 7); the
  // real-time updates come via the SSE fan-out in Part 7
  // once TD-058 lands.
  app.get(
    '/v1/agent/list',
    { preHandler: options.userGuard },
    async (request, reply) => {
      const userId = request.authSession?.currentUser?.operatorId;
      if (userId === undefined || userId.length === 0) {
        reply.status(401);
        return routeError(
          'unauthorized',
          'Authenticated session required'
        );
      }

      const records = await options.lifecycleRepository.listForUser(userId);
      const projected = projectListResponse(records, now());
      return agentListResponseSchema.parse(projected);
    }
  );

  // GET /v1/agent/:id/status — return the slim status
  // projection for one specific agent. Same auth as /list;
  // 404 if the agent doesn't exist OR belongs to a different
  // user (we don't leak existence cross-user).
  app.get(
    '/v1/agent/:agentId/status',
    { preHandler: options.userGuard },
    async (request, reply) => {
      const userId = request.authSession?.currentUser?.operatorId;
      if (userId === undefined || userId.length === 0) {
        reply.status(401);
        return routeError(
          'unauthorized',
          'Authenticated session required'
        );
      }

      const params = request.params as { agentId?: string };
      const agentId = params.agentId;
      if (typeof agentId !== 'string' || agentId.length === 0) {
        reply.status(400);
        return routeError('bad_request', 'agentId path param is required');
      }

      const record = await options.lifecycleRepository.getById(agentId);
      if (record === undefined || record.userId !== userId) {
        // Cross-user lookup — pretend the agent doesn't
        // exist. This is the same pattern as
        // FirestoreOperatorRepository.getTask which returns
        // undefined on ownership mismatch so the route can
        // 404 without leaking that someone else has the id.
        reply.status(404);
        return routeError('agent_not_found', `Agent ${agentId} not found`);
      }

      return agentStatusResponseSchema.parse(
        projectAgentSummary(record, now().getTime())
      );
    }
  );

  // DELETE /v1/agent/:agentId — revoke. Owner-only; the
  // agent's existing WS connection (if any) gets disconnected
  // by the next failed auth check in the guard's cache TTL
  // window. The revoke is a Firestore field flip: tokenHash
  // stays so audit forensics can correlate post-revoke
  // attempts to the token they were using.
  app.delete(
    '/v1/agent/:agentId',
    { preHandler: options.userGuard },
    async (request, reply) => {
      const userId = request.authSession?.currentUser?.operatorId;
      if (userId === undefined || userId.length === 0) {
        reply.status(401);
        return routeError(
          'unauthorized',
          'Authenticated session required'
        );
      }

      const params = request.params as { agentId?: string };
      const agentId = params.agentId;
      if (typeof agentId !== 'string' || agentId.length === 0) {
        reply.status(400);
        return routeError('bad_request', 'agentId path param is required');
      }

      const existing = await options.lifecycleRepository.getById(agentId);
      if (existing === undefined || existing.userId !== userId) {
        reply.status(404);
        return routeError('agent_not_found', `Agent ${agentId} not found`);
      }

      const startedAt = Date.now();
      try {
        await options.lifecycleRepository.markRevoked(
          agentId,
          'user-initiated revoke from /v1/agent/:agentId DELETE'
        );

        // Cache invalidation: the guard's LRU still holds a
        // pre-revocation snapshot that would let the next
        // auth pass before the snapshot's TTL expires. Force
        // re-evaluation here so the revoke takes effect on
        // the very next request.
        try {
          options.invalidateAgentTokenCache?.(agentId);
        } catch {
          /* swallowed */
        }

        try {
          await options.audit.record({
            agentId,
            userId,
            eventType: 'agent_revoked',
            latencyMs: Date.now() - startedAt,
            ip: request.ip,
            userAgent:
              typeof request.headers['user-agent'] === 'string'
                ? request.headers['user-agent']
                : undefined
          });
        } catch {
          /* swallowed — audit is best-effort */
        }

        reply.status(204);
        return reply.send();
      } catch (err) {
        if (err instanceof AgentsCollectionUnavailableError) {
          if (err.code === 'AGENT_NOT_FOUND') {
            reply.status(404);
            return routeError('agent_not_found', err.message);
          }
          reply.status(503);
          return routeError(
            'agents_collection_unavailable',
            err.message,
            { code: err.code }
          );
        }
        request.log.error(
          { err, agentId, userId },
          'agent revoke failed'
        );
        reply.status(503);
        return routeError(
          'agents_collection_unavailable',
          'Agent revoke failed'
        );
      }
    }
  );

  // GET /v1/agent/latest-version — public endpoint the
  // desktop agent's update loop hits daily. Phase 4.0 ships
  // a stub: downloadUrl + signature both null, so the
  // agent-side update logic is a no-op. The real signed-
  // update pipeline is TD-059 (deferred past Phase 4.0).
  app.get('/v1/agent/latest-version', async () => {
    const response = {
      version: options.currentAgentVersion,
      downloadUrl: null,
      signature: null,
      releaseNotes:
        'Phase 4.0 ships with self-update disabled. See TD-059 for the signed-update pipeline.'
    };
    return agentLatestVersionResponseSchema.parse(response);
  });
};
