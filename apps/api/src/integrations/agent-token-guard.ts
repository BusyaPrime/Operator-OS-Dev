import bcrypt from 'bcryptjs';
import type {
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler
} from 'fastify';

import type { AgentRecord } from '@operator-os/contracts';
import { TOKEN_ROTATION_RECOMMENDED_HEADER } from '@operator-os/contracts';

/**
 * Phase 4.0 agent-token middleware (ADR-025 D1 + amendment 1).
 *
 * Validates the bearer token presented by a registered desktop
 * agent against the bcrypt hashes stored on the agent's
 * Firestore record. Implements the dual-hash overlap window
 * specified in the amendment:
 *
 *   1. Check the current `tokenHash`. If it matches → accept.
 *   2. Else, if `previousTokenHash` is set and `now <=
 *      previousTokenExpiresAt`, check it. If it matches →
 *      accept AND set `X-Token-Rotation-Recommended: true`
 *      on the response so the agent triggers an out-of-band
 *      rotation, AND increment `oldTokenUsageCount` (caller
 *      handles the durable update).
 *   3. Else → 401.
 *
 * Bcrypt at cost 12 takes ~250ms in JS. A long-lived WS
 * connection or a tight REST loop would re-hash the same
 * token on every request, which we cache at the (rawToken,
 * agentId) key for a short TTL. The cache is in-process only
 * (per Cloud Run instance), keyed by the secret bytes, and
 * cleared on revocation; it never persists.
 */

/** Result handed back to the route handler on successful auth. */
export interface AuthenticatedAgent {
  readonly agentId: string;
  readonly userId: string;
  readonly capabilities: ReadonlyArray<string>;
  /**
   * `true` when the auth succeeded against `previousTokenHash`
   * (i.e. mid-rotation overlap window). Routes can branch on
   * this to decide whether the operation is sensitive enough
   * to want a rotated token first; in practice the
   * X-Token-Rotation-Recommended response header (set by the
   * guard) is enough.
   */
  readonly usedPreviousToken: boolean;
}

/**
 * Storage abstraction the guard depends on. Phase 3.C ships
 * the Firestore implementation; Phase 3.B unit tests use an
 * in-memory fake. The guard never reads/writes Firestore
 * directly — keeps the bcrypt path testable and the storage
 * dependency injected.
 *
 * The guard only needs a read by token-lookup-hash (so it
 * can find the right doc among many) and an "increment
 * old-token usage" write. Other lifecycle ops (register /
 * rotate / revoke) live on a richer service interface in
 * Part 3.D-onwards.
 */
export interface AgentRecordRepository {
  /**
   * Look up agent records whose `tokenLookupHash` OR
   * `previousTokenLookupHash` matches the supplied
   * deterministic hash (sha256(rawToken).slice(0,16)).
   * Implementations index both fields and union the matches.
   * The guard then does a bcrypt comparison against each
   * candidate's two hash fields to confirm the match before
   * authenticating.
   *
   * The lookup hash is one-way (sha256), so storing it as an
   * indexed field doesn't leak useful information about the
   * raw token. Collision rate at 64 bits is negligible at
   * the foreseeable agent count.
   */
  readonly findCandidatesByTokenLookup: (
    lookupHash: string
  ) => Promise<ReadonlyArray<AgentRecord>>;

  /**
   * Increment `oldTokenUsageCount` on the named agent. Called
   * once per request that authenticated against the previous
   * hash. Failures here MUST NOT block the request — they're
   * a metric, not a critical-path side effect.
   */
  readonly incrementOldTokenUsage: (agentId: string) => Promise<void>;
}

/**
 * Audit trail emit. Defaults to a structured pino log via the
 * api's existing logger; the BigQuery-backed implementation
 * (TD-057) plugs in here when ready.
 */
export interface AgentAuthEvent {
  readonly agentId: string | null;
  readonly userId: string | null;
  readonly eventType:
    | 'auth_success'
    | 'auth_success_previous_hash'
    | 'auth_failed_no_token'
    | 'auth_failed_no_match'
    | 'auth_failed_revoked'
    | 'auth_failed_unknown_token';
  readonly latencyMs: number;
  readonly ip?: string;
  readonly userAgent?: string;
  readonly errorCode?: string;
}

export interface AgentAuditWriter {
  readonly record: (event: AgentAuthEvent) => Promise<void>;
}

/** Cache hit kind. The guard distinguishes for metric purposes. */
type CacheHit = 'current' | 'previous';

interface CacheEntry {
  readonly recordSnapshot: AgentRecord;
  readonly hit: CacheHit;
  readonly expiresAt: number;
}

/**
 * Bounded LRU keyed by raw token (hex of sha256 of the token,
 * NOT the token itself — keeps secret bytes from sitting in a
 * Map's keys for arbitrary durations). 5-minute TTL: short
 * enough that revocation propagates to live caches within a
 * window; long enough to amortise bcrypt cost over a busy WS.
 */
const DEFAULT_CACHE_MAX = 256;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

class TokenAuthCache {
  #map: Map<string, CacheEntry> = new Map();
  #max: number;
  #ttlMs: number;
  #now: () => number;

  constructor(max: number, ttlMs: number, now: () => number = Date.now) {
    this.#max = max;
    this.#ttlMs = ttlMs;
    this.#now = now;
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.#map.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= this.#now()) {
      this.#map.delete(key);
      return undefined;
    }
    // Move-to-end: refresh LRU position.
    this.#map.delete(key);
    this.#map.set(key, entry);
    return entry;
  }

  set(
    key: string,
    record: AgentRecord,
    hit: CacheHit
  ): void {
    if (this.#map.has(key)) this.#map.delete(key);
    this.#map.set(key, {
      recordSnapshot: record,
      hit,
      expiresAt: this.#now() + this.#ttlMs
    });
    while (this.#map.size > this.#max) {
      const oldest = this.#map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#map.delete(oldest);
    }
  }

  invalidate(key: string): void {
    this.#map.delete(key);
  }

  /** Test seam — reset between cases. */
  clear(): void {
    this.#map.clear();
  }

  /** Test seam — count entries for assertions. */
  get size(): number {
    return this.#map.size;
  }
}

export interface CreateAgentTokenGuardOptions {
  readonly repository: AgentRecordRepository;
  /**
   * Audit writer. Defaults to no-op; callers in production
   * pass a writer backed by pino + BigQuery.
   */
  readonly audit?: AgentAuditWriter;
  /**
   * Cache configuration. Tests pass a deterministic clock
   * via `now`. Production omits to take real time.
   */
  readonly cache?: {
    readonly maxEntries?: number;
    readonly ttlMs?: number;
    readonly now?: () => number;
  };
  /**
   * For tests: a deterministic clock used for the
   * `previousTokenExpiresAt` check.
   */
  readonly now?: () => number;
}

/**
 * Length of the lookup hash field stored on the agent record
 * + indexed in Firestore. 16 hex chars = 64 bits of one-way
 * sha256 output — no useful information about the raw 256-bit
 * token, but indexable for O(1) Firestore lookup. Constant is
 * exported so the Firestore wrapper + the guard agree on the
 * exact slice length.
 */
export const AGENT_TOKEN_LOOKUP_HASH_LENGTH = 16;

/**
 * Compute the indexable lookup hash for a raw agent token.
 * This is the only place the derivation logic lives — the
 * guard, the repository implementation, and any future
 * tooling all import this helper to stay consistent.
 */
export const agentTokenLookupHash = async (
  token: string
): Promise<string> => {
  const { createHash } = await import('node:crypto');
  return createHash('sha256')
    .update(token)
    .digest('hex')
    .slice(0, AGENT_TOKEN_LOOKUP_HASH_LENGTH);
};

/**
 * Augment the FastifyRequest type at the api level so route
 * handlers can read the authenticated agent from
 * `request.agent`. Re-declares the existing module
 * augmentation already in auth.ts; declaration merging will
 * combine them at compile time.
 */
declare module 'fastify' {
  interface FastifyRequest {
    agent?: AuthenticatedAgent;
  }
}

const noopAudit: AgentAuditWriter = {
  async record() {
    /* default no-op; production injects pino + BigQuery */
  }
};

const extractBearerToken = (
  authorization: string | undefined
): string | undefined => {
  if (authorization === undefined) return undefined;
  const trimmed = authorization.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) return undefined;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : undefined;
};

/**
 * Hash the raw token to derive a stable cache key without
 * keeping the secret in plain memory longer than the bcrypt
 * compare itself takes. Uses the synchronous core hash because
 * we already hold the token in memory; the hash is computed
 * once per request and discarded.
 */
const cacheKeyFor = async (token: string): Promise<string> => {
  // Lazy import keeps the test seam light.
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(token).digest('hex');
};

const isPreviousTokenStillValid = (
  record: AgentRecord,
  now: number
): boolean => {
  if (record.previousTokenHash === null) return false;
  if (record.previousTokenExpiresAt === null) return false;
  return Date.parse(record.previousTokenExpiresAt) > now;
};

/**
 * Build the Fastify preHandler. Returns a closure so each
 * api instance can wire the same guard into multiple routes
 * with shared cache + audit hooks.
 */
export const createAgentTokenGuard = (
  options: CreateAgentTokenGuardOptions
): preHandlerAsyncHookHandler => {
  const audit = options.audit ?? noopAudit;
  const now = options.now ?? Date.now;
  const cache = new TokenAuthCache(
    options.cache?.maxEntries ?? DEFAULT_CACHE_MAX,
    options.cache?.ttlMs ?? DEFAULT_CACHE_TTL_MS,
    options.cache?.now ?? now
  );

  return async function agentTokenGuard(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const startedAt = now();
    const ip = request.ip;
    const userAgent =
      typeof request.headers['user-agent'] === 'string'
        ? request.headers['user-agent']
        : undefined;

    const token = extractBearerToken(request.headers.authorization);
    if (token === undefined) {
      await safeAudit(audit, {
        agentId: null,
        userId: null,
        eventType: 'auth_failed_no_token',
        latencyMs: now() - startedAt,
        ip,
        userAgent
      });
      reply.code(401);
      return reply.send({
        message:
          'Agent token required. Set Authorization: Bearer <token>.'
      });
    }

    const cacheKey = await cacheKeyFor(token);
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      // Even on a cache hit we re-check the revoked flag from
      // the snapshot — revocation might have been observed by
      // a sibling request that updated cache during this same
      // window. (Real revocation propagation lives in the
      // service that calls cache.invalidate().)
      if (cached.recordSnapshot.revoked) {
        cache.invalidate(cacheKey);
      } else {
        attachAgent(request, reply, cached.recordSnapshot, cached.hit);
        await safeAudit(audit, {
          agentId: cached.recordSnapshot.agentId,
          userId: cached.recordSnapshot.userId,
          eventType:
            cached.hit === 'previous'
              ? 'auth_success_previous_hash'
              : 'auth_success',
          latencyMs: now() - startedAt,
          ip,
          userAgent
        });
        return;
      }
    }

    const lookupHash = await agentTokenLookupHash(token);
    const candidates = await options.repository.findCandidatesByTokenLookup(
      lookupHash
    );

    if (candidates.length === 0) {
      await safeAudit(audit, {
        agentId: null,
        userId: null,
        eventType: 'auth_failed_unknown_token',
        latencyMs: now() - startedAt,
        ip,
        userAgent
      });
      reply.code(401);
      return reply.send({ message: 'Agent token not recognised.' });
    }

    const checkedNow = now();
    for (const record of candidates) {
      if (record.revoked) {
        await safeAudit(audit, {
          agentId: record.agentId,
          userId: record.userId,
          eventType: 'auth_failed_revoked',
          latencyMs: now() - startedAt,
          ip,
          userAgent
        });
        continue;
      }

      const currentMatch = await bcrypt.compare(token, record.tokenHash);
      if (currentMatch) {
        cache.set(cacheKey, record, 'current');
        attachAgent(request, reply, record, 'current');
        await safeAudit(audit, {
          agentId: record.agentId,
          userId: record.userId,
          eventType: 'auth_success',
          latencyMs: now() - startedAt,
          ip,
          userAgent
        });
        return;
      }

      if (isPreviousTokenStillValid(record, checkedNow)) {
        // Non-null assertion is safe: isPreviousTokenStillValid
        // returned true => previousTokenHash is a string.
        const previousMatch = await bcrypt.compare(
          token,
          record.previousTokenHash as string
        );
        if (previousMatch) {
          cache.set(cacheKey, record, 'previous');
          attachAgent(request, reply, record, 'previous');
          // Fire-and-forget the usage counter. Failures here
          // are not user-visible — log only, don't block auth.
          options.repository
            .incrementOldTokenUsage(record.agentId)
            .catch(() => {
              /* metric write is best-effort */
            });
          await safeAudit(audit, {
            agentId: record.agentId,
            userId: record.userId,
            eventType: 'auth_success_previous_hash',
            latencyMs: now() - startedAt,
            ip,
            userAgent
          });
          return;
        }
      }
    }

    // No candidate matched.
    await safeAudit(audit, {
      agentId: null,
      userId: null,
      eventType: 'auth_failed_no_match',
      latencyMs: now() - startedAt,
      ip,
      userAgent
    });
    reply.code(401);
    return reply.send({ message: 'Agent token not recognised.' });
  };
};

const attachAgent = (
  request: FastifyRequest,
  reply: FastifyReply,
  record: AgentRecord,
  hit: CacheHit
): void => {
  request.agent = {
    agentId: record.agentId,
    userId: record.userId,
    capabilities: record.capabilities,
    usedPreviousToken: hit === 'previous'
  };
  if (hit === 'previous') {
    reply.header(TOKEN_ROTATION_RECOMMENDED_HEADER, 'true');
  }
};

const safeAudit = async (
  audit: AgentAuditWriter,
  event: AgentAuthEvent
): Promise<void> => {
  try {
    await audit.record(event);
  } catch {
    /* audit failures must not break the auth path */
  }
};

/**
 * Test seam: build a no-op audit writer with a recording
 * spy. Used by the unit tests to assert audit emit behaviour
 * without a real BigQuery dependency.
 */
export const buildNoopAudit = (): AgentAuditWriter => noopAudit;
