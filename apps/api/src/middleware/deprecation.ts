import type {
  FastifyBaseLogger,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler
} from 'fastify';

/**
 * Phase 4.0 Part 8 — legacy-endpoint deprecation surface.
 *
 * ADR-025 D4 lists three endpoints that the always-on agent
 * (Phase 4.0) replaces with the WS control channel:
 *
 *   - POST /v1/agent/heartbeat        (device-state heartbeat)
 *   - POST /v1/agent/heartbeat/agent  (agent-centric heartbeat)
 *   - GET  /v1/agent/commands         (long-poll command bus)
 *
 * They keep responding to keep pre-4.0 desktop builds alive
 * during the rollout, but every response now carries the RFC-
 * spec'd deprecation surface so clients can self-detect:
 *
 *   - `Deprecation: @<unix-seconds>`     (RFC 9745 §2)
 *   - `Sunset: <HTTP-date>`              (RFC 8594 §3)
 *   - `Link: <doc>; rel="deprecation"`   (RFC 8288)
 *   - `Link: <doc>; rel="sunset"`        (RFC 8288)
 *
 * Each call also emits a structured pino INFO at
 * `source: 'legacy-endpoint-usage'` so Cloud Logging can
 * count + alert on residual traffic. Once the count drops to
 * zero for two consecutive weeks (and the sunset date has
 * passed), the routes themselves get deleted in a Phase 4.x
 * follow-up.
 *
 * Dates baked in:
 *   - Deprecation @ 2026-04-29 (Phase 4.0 Part 8 ship date)
 *   - Sunset      @ 2026-05-25 (~26 days later — aggressive
 *                                window because every pre-4.0
 *                                caller is internal and we own
 *                                the full migration path).
 */

/** Timestamp the routes were marked deprecated. ISO date → ms. */
export const LEGACY_ENDPOINT_DEPRECATION_AT = Date.parse(
  '2026-04-29T00:00:00.000Z'
);

/** Timestamp the routes will stop responding (HTTP 410 Gone). */
export const LEGACY_ENDPOINT_SUNSET_AT = Date.parse(
  '2026-05-25T00:00:00.000Z'
);

/**
 * Default migration doc URL surfaced in Link headers. Points
 * at the docs path; once a docs site exists the URL flips to
 * the rendered page without changing client behaviour
 * (clients are expected to follow `rel="deprecation"` and
 * resolve the eventual canonical URL).
 */
export const DEFAULT_MIGRATION_DOC_URL =
  'https://docs.operator-os.dev/migration/v4';

export interface ApplyDeprecationHeadersOptions {
  readonly migrationDocUrl?: string;
  readonly deprecationAt?: number;
  readonly sunsetAt?: number;
}

/**
 * Set the three deprecation-related headers on a Fastify
 * reply. Idempotent: calling twice produces the same headers.
 *
 * Why a single helper rather than a Fastify plugin: the
 * deprecation surface only applies to three named routes —
 * scope creep into "every route advertises sunset" would be
 * actively misleading. Explicit per-route opt-in keeps the
 * blast radius visible.
 */
export const applyDeprecationHeaders = (
  reply: FastifyReply,
  options: ApplyDeprecationHeadersOptions = {}
): void => {
  const docUrl = options.migrationDocUrl ?? DEFAULT_MIGRATION_DOC_URL;
  const deprecationAt =
    options.deprecationAt ?? LEGACY_ENDPOINT_DEPRECATION_AT;
  const sunsetAt = options.sunsetAt ?? LEGACY_ENDPOINT_SUNSET_AT;

  // RFC 9745: Deprecation header value is `@<unix-seconds>`.
  reply.header(
    'Deprecation',
    `@${Math.floor(deprecationAt / 1000)}`
  );
  // RFC 8594: Sunset is an HTTP-date (RFC 7231 §7.1.1.1) —
  // Date.toUTCString() emits the IMF-fixdate format.
  reply.header('Sunset', new Date(sunsetAt).toUTCString());
  // RFC 8288: combine multiple Link values with commas.
  reply.header(
    'Link',
    `<${docUrl}>; rel="deprecation"; type="text/html", ` +
      `<${docUrl}>; rel="sunset"; type="text/html"`
  );
};

/**
 * Emit a structured log line for one legacy-endpoint hit.
 * Cloud Logging picks this up via the `source:
 * legacy-endpoint-usage` selector; ops counts the matches per
 * day to know when the residual traffic has gone silent and
 * the routes can be deleted.
 *
 * Deliberately at INFO level (not WARN) — these calls are
 * expected during the migration window, not anomalies.
 */
export const recordLegacyEndpointUsage = (
  logger: FastifyBaseLogger,
  request: FastifyRequest,
  endpoint: string
): void => {
  const userAgent =
    typeof request.headers['user-agent'] === 'string'
      ? request.headers['user-agent']
      : undefined;
  const userId =
    request.authSession?.currentUser?.operatorId ?? null;
  logger.info(
    {
      source: 'legacy-endpoint-usage',
      endpoint,
      userId,
      ip: request.ip,
      userAgent,
      deprecationAt: LEGACY_ENDPOINT_DEPRECATION_AT,
      sunsetAt: LEGACY_ENDPOINT_SUNSET_AT
    },
    'legacy endpoint accessed (deprecated; will sunset)'
  );
};

export interface CreateDeprecationPreHandlerOptions
  extends ApplyDeprecationHeadersOptions {
  readonly logger: FastifyBaseLogger;
  readonly endpoint: string;
}

/**
 * Build a Fastify preHandler that sets the deprecation
 * headers + records the usage event. Routes wire it after
 * the auth guard so `request.authSession` is populated when
 * we read `operatorId`.
 */
export const createDeprecationPreHandler = (
  options: CreateDeprecationPreHandlerOptions
): preHandlerAsyncHookHandler => {
  const { logger, endpoint, ...headerOptions } = options;
  return async function deprecationPreHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    applyDeprecationHeaders(reply, headerOptions);
    recordLegacyEndpointUsage(logger, request, endpoint);
  };
};
