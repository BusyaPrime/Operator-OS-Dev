import { parseApiEnv } from '@operator-os/config';
import { SignJWT } from 'jose';
import type { AgentHeartbeatRequest } from '@operator-os/contracts';
import { describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import {
  DEFAULT_MIGRATION_DOC_URL,
  LEGACY_ENDPOINT_DEPRECATION_AT,
  LEGACY_ENDPOINT_SUNSET_AT
} from '../../middleware/deprecation.js';

/**
 * Phase 4.0 Part 8 — verifies the three deprecated endpoints
 * surface RFC 9745 / RFC 8594 / RFC 8288 headers on every
 * response, including failures (auth-rejected requests still
 * carry the headers because Fastify doesn't run preHandlers
 * after the auth guard 401s — so we test the SUCCESS path).
 *
 * Auth: same HS256 JWT path the existing v2 heartbeat tests
 * use (`agent-heartbeat-v2.test.ts`). The agent guard's
 * Firebase + Google-OIDC paths fail fast in the test env
 * (no ADC); the operator-access-token branch validates with
 * the literal secret.
 */

const LITERAL =
  'a-very-secret-shared-between-auth-gateway-and-operator-api';

const buildEnv = () =>
  parseApiEnv({
    AUTH_JWT_SIGNING_SECRET_LITERAL: LITERAL,
    AUTH_ACCESS_TOKEN_ISSUER: 'operator-auth-gateway',
    AUTH_ACCESS_TOKEN_AUDIENCE: 'operator-os-api'
  });

const mintToken = async (operatorId = 'agent-uuid-1') => {
  const secret = new TextEncoder().encode(LITERAL);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: operatorId,
    iss: 'operator-auth-gateway',
    aud: 'operator-os-api',
    iat: now,
    exp: now + 3600,
    scopes: ['agent:write'],
    plan: 'free' as const,
    operatorId,
    email: 'agent@example.com'
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .sign(secret);
};

const validV2Body: AgentHeartbeatRequest = {
  agentId: '00000000-0000-4000-8000-000000000001',
  providerId: 'anthropic.claude-code',
  providerVersion: '0.1.0',
  platform: 'linux',
  hostname: 'test-host',
  state: 'idle',
  uptimeSeconds: 42,
  activeTaskCount: 0,
  healthChecks: { binary: 'ok' },
  timestamp: '2026-04-24T00:00:00.000Z'
};

const expectedDeprecationHeaderValue = `@${Math.floor(
  LEGACY_ENDPOINT_DEPRECATION_AT / 1000
)}`;

const expectedSunsetHeaderValue = new Date(
  LEGACY_ENDPOINT_SUNSET_AT
).toUTCString();

describe('Phase 4.0 Part 8 — deprecation headers on legacy endpoints', () => {
  it('POST /v1/agent/heartbeat/agent returns Deprecation + Sunset + Link headers on 200', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/heartbeat/agent',
      headers: { authorization: `Bearer ${token}` },
      payload: validV2Body
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.deprecation).toBe(expectedDeprecationHeaderValue);
    expect(response.headers.sunset).toBe(expectedSunsetHeaderValue);
    const link = response.headers.link;
    expect(link).toBeDefined();
    expect(link).toContain(`<${DEFAULT_MIGRATION_DOC_URL}>`);
    expect(link).toContain('rel="deprecation"');
    expect(link).toContain('rel="sunset"');

    await app.close();
  });

  it('GET /v1/agent/commands returns Deprecation + Sunset + Link headers', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/agent/commands?deviceId=device-1',
      headers: { authorization: `Bearer ${token}` }
    });

    // 200 in dev (commandsService falls back to empty list when
    // Firestore is unreachable). The deprecation surface is the
    // assertion target here, not the body.
    expect(response.statusCode).toBeLessThan(500);
    expect(response.headers.deprecation).toBe(expectedDeprecationHeaderValue);
    expect(response.headers.sunset).toBe(expectedSunsetHeaderValue);
    expect(response.headers.link).toContain(`<${DEFAULT_MIGRATION_DOC_URL}>`);

    await app.close();
  });

  it('Sunset header parses back to the documented sunset date', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/heartbeat/agent',
      headers: { authorization: `Bearer ${token}` },
      payload: validV2Body
    });

    const parsed = Date.parse(response.headers.sunset as string);
    expect(parsed).toBe(LEGACY_ENDPOINT_SUNSET_AT);

    await app.close();
  });

  it('a non-deprecated /v1/agent/* route does NOT carry deprecation headers', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();

    // /v1/agent/sessions is NOT in the D4 deprecation set —
    // verifies the deprecation surface is scoped, not blanket.
    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId: 'sess-1', userId: 'user-1' }
    });

    // Status may be 200/400/4xx depending on schema validation;
    // header assertion is the test target.
    expect(response.headers.deprecation).toBeUndefined();
    expect(response.headers.sunset).toBeUndefined();

    await app.close();
  });
});
