import type {
  FastifyBaseLogger,
  FastifyReply,
  FastifyRequest
} from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_MIGRATION_DOC_URL,
  LEGACY_ENDPOINT_DEPRECATION_AT,
  LEGACY_ENDPOINT_SUNSET_AT,
  applyDeprecationHeaders,
  createDeprecationPreHandler,
  recordLegacyEndpointUsage
} from '../deprecation.js';

/**
 * Build a minimal mock reply that records every header set so
 * the assertions can read the headers back without a real
 * Fastify instance. Each `header(k, v)` call lands in the map.
 */
const buildReply = (): {
  reply: FastifyReply;
  headers: Map<string, string>;
} => {
  const headers = new Map<string, string>();
  const reply = {
    header(key: string, value: string): FastifyReply {
      headers.set(key, value);
      return reply;
    }
  } as unknown as FastifyReply;
  return { reply, headers };
};

const buildLogger = (): {
  logger: FastifyBaseLogger;
  info: ReturnType<typeof vi.fn>;
} => {
  const info = vi.fn();
  const stub: Record<string, unknown> = {
    info,
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    level: 'info',
    child(): unknown {
      return stub;
    }
  };
  return { logger: stub as unknown as FastifyBaseLogger, info };
};

const buildRequest = (overrides: {
  headers?: Record<string, string>;
  ip?: string;
  operatorId?: string | null;
} = {}): FastifyRequest => ({
  headers: overrides.headers ?? { 'user-agent': 'OperatorAgent/1.0' },
  ip: overrides.ip ?? '203.0.113.42',
  authSession:
    overrides.operatorId === null
      ? undefined
      : {
          currentUser: {
            operatorId: overrides.operatorId ?? 'user-akmal'
          }
        }
} as unknown as FastifyRequest);

describe('applyDeprecationHeaders', () => {
  it('sets Deprecation, Sunset, and Link headers with default values', () => {
    const { reply, headers } = buildReply();

    applyDeprecationHeaders(reply);

    expect(headers.get('Deprecation')).toBe(
      `@${Math.floor(LEGACY_ENDPOINT_DEPRECATION_AT / 1000)}`
    );
    expect(headers.get('Sunset')).toBe(
      new Date(LEGACY_ENDPOINT_SUNSET_AT).toUTCString()
    );
    const linkValue = headers.get('Link');
    expect(linkValue).toContain(`<${DEFAULT_MIGRATION_DOC_URL}>`);
    expect(linkValue).toContain('rel="deprecation"');
    expect(linkValue).toContain('rel="sunset"');
    expect(linkValue).toContain('type="text/html"');
  });

  it('honors custom migrationDocUrl + deprecationAt + sunsetAt overrides', () => {
    const { reply, headers } = buildReply();
    const customUrl = 'https://example.test/migration';
    const customDeprecationAt = Date.parse('2026-01-01T00:00:00.000Z');
    const customSunsetAt = Date.parse('2026-12-31T23:59:59.000Z');

    applyDeprecationHeaders(reply, {
      migrationDocUrl: customUrl,
      deprecationAt: customDeprecationAt,
      sunsetAt: customSunsetAt
    });

    expect(headers.get('Deprecation')).toBe(
      `@${Math.floor(customDeprecationAt / 1000)}`
    );
    expect(headers.get('Sunset')).toBe(new Date(customSunsetAt).toUTCString());
    expect(headers.get('Link')).toContain(`<${customUrl}>`);
  });

  it('Sunset header parses back to the same timestamp (round-trip safe)', () => {
    const { reply, headers } = buildReply();

    applyDeprecationHeaders(reply);

    const sunset = headers.get('Sunset')!;
    expect(Date.parse(sunset)).toBe(LEGACY_ENDPOINT_SUNSET_AT);
  });

  it('Deprecation header survives a second call (idempotent overwrite)', () => {
    const { reply, headers } = buildReply();

    applyDeprecationHeaders(reply);
    const first = headers.get('Deprecation');
    applyDeprecationHeaders(reply);
    const second = headers.get('Deprecation');

    expect(first).toBe(second);
  });
});

describe('recordLegacyEndpointUsage', () => {
  it('emits one structured INFO line with endpoint + identity + sunset metadata', () => {
    const { logger, info } = buildLogger();
    const request = buildRequest({
      headers: { 'user-agent': 'curl/8.5.0' },
      ip: '198.51.100.10',
      operatorId: 'user-akmal'
    });

    recordLegacyEndpointUsage(logger, request, 'POST /v1/agent/heartbeat');

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'legacy-endpoint-usage',
        endpoint: 'POST /v1/agent/heartbeat',
        userId: 'user-akmal',
        ip: '198.51.100.10',
        userAgent: 'curl/8.5.0',
        deprecationAt: LEGACY_ENDPOINT_DEPRECATION_AT,
        sunsetAt: LEGACY_ENDPOINT_SUNSET_AT
      }),
      expect.stringContaining('legacy endpoint accessed')
    );
  });

  it('uses null userId when authSession is absent (pre-auth scenario)', () => {
    const { logger, info } = buildLogger();
    const request = buildRequest({ operatorId: null });

    recordLegacyEndpointUsage(
      logger,
      request,
      'GET /v1/agent/commands'
    );

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null }),
      expect.any(String)
    );
  });

  it('treats a missing user-agent header as undefined, not "[object Object]"', () => {
    const { logger, info } = buildLogger();
    const request = buildRequest({ headers: {} });

    recordLegacyEndpointUsage(logger, request, 'GET /v1/agent/commands');

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ userAgent: undefined }),
      expect.any(String)
    );
  });
});

describe('createDeprecationPreHandler', () => {
  it('runs applyDeprecationHeaders + recordLegacyEndpointUsage in sequence', async () => {
    const { logger, info } = buildLogger();
    const { reply, headers } = buildReply();
    const request = buildRequest();

    const preHandler = createDeprecationPreHandler({
      logger,
      endpoint: 'POST /v1/agent/heartbeat'
    });

    await preHandler.call({} as never, request, reply, undefined as never);

    expect(headers.has('Deprecation')).toBe(true);
    expect(headers.has('Sunset')).toBe(true);
    expect(headers.has('Link')).toBe(true);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'POST /v1/agent/heartbeat' }),
      expect.any(String)
    );
  });

  it('forwards a custom migrationDocUrl into the Link header', async () => {
    const { logger } = buildLogger();
    const { reply, headers } = buildReply();
    const request = buildRequest();
    const customUrl = 'https://custom.example/migration-v4';

    const preHandler = createDeprecationPreHandler({
      logger,
      endpoint: 'POST /v1/agent/heartbeat/agent',
      migrationDocUrl: customUrl
    });

    await preHandler.call({} as never, request, reply, undefined as never);

    expect(headers.get('Link')).toContain(`<${customUrl}>`);
  });
});
