import { parseApiEnv } from '@operator-os/config';
import { SignJWT } from 'jose';
import type { AgentHeartbeatRequest } from '@operator-os/contracts';
import { describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';

/**
 * Integration tests for POST /v1/agent/heartbeat/agent (TD-024).
 *
 * Auth: mints real HS256 JWTs using the literal signing secret.
 * The agent guard's Firebase + Google-OIDC paths fail fast in a
 * test env (no ADC), so the operator-access-token branch
 * resolves with the same secret the tests use to sign.
 */

const LITERAL = 'a-very-secret-shared-between-auth-gateway-and-operator-api';

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

const validBody: AgentHeartbeatRequest = {
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

describe('POST /v1/agent/heartbeat/agent', () => {
  it('accepts a valid heartbeat and returns the v2 response shape', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/heartbeat/agent',
      headers: { authorization: `Bearer ${token}` },
      payload: validBody
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(typeof body.serverTime).toBe('string');
    expect(Array.isArray(body.pendingTaskIds)).toBe(true);
    expect(Array.isArray(body.commands)).toBe(true);
    expect(body.pendingTaskIds).toEqual([]);
    expect(body.commands).toEqual([]);

    await app.close();
  });

  it('rejects requests without a bearer token with 401', async () => {
    const app = buildServer(buildEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/heartbeat/agent',
      payload: validBody
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('rejects requests with a malformed bearer with 401', async () => {
    const app = buildServer(buildEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/heartbeat/agent',
      headers: { authorization: 'Bearer not.a.jwt.token' },
      payload: validBody
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('rejects requests with a non-UUID agentId as a 400 Zod issue', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/heartbeat/agent',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...validBody, agentId: 'not-a-uuid' }
    });

    // Zod throws a ZodError which Fastify maps to 500 via our
    // error handler unless we explicitly catch — verify status
    // reflects a validation failure, not an auth issue.
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    await app.close();
  });

  it('rejects a missing healthChecks field (Zod drift guard)', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();

    const { healthChecks: _drop, ...withoutHealth } = validBody;
    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/heartbeat/agent',
      headers: { authorization: `Bearer ${token}` },
      payload: withoutHealth
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    await app.close();
  });

  it('rejects a second heartbeat from the same agent inside the 5s window with 429', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();

    const first = await app.inject({
      method: 'POST',
      url: '/v1/agent/heartbeat/agent',
      headers: { authorization: `Bearer ${token}` },
      payload: validBody
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/agent/heartbeat/agent',
      headers: { authorization: `Bearer ${token}` },
      payload: validBody
    });
    expect(second.statusCode).toBe(429);
    const body = second.json();
    expect(body.error).toBe('Too Many Requests');

    await app.close();
  });

  it('allows a second heartbeat from a DIFFERENT agent inside the 5s window', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();

    const first = await app.inject({
      method: 'POST',
      url: '/v1/agent/heartbeat/agent',
      headers: { authorization: `Bearer ${token}` },
      payload: validBody
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/agent/heartbeat/agent',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...validBody,
        agentId: '00000000-0000-4000-8000-000000000099'
      }
    });
    expect(second.statusCode).toBe(200);

    await app.close();
  });

  it('does not mutate the existing /v1/agent/heartbeat (deviceState) behaviour', async () => {
    // Negative sanity: posting agent-shape payload to the OLD
    // endpoint should STILL fail, proving the two endpoints
    // accept different shapes. The old endpoint uses .parse()
    // which routes through the generic 500 error handler, so
    // we only assert "any non-2xx" — the precise code isn't the
    // point; the point is that the old endpoint does not
    // silently accept the new shape.
    const app = buildServer(buildEnv());
    const token = await mintToken();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/heartbeat',
      headers: { authorization: `Bearer ${token}` },
      payload: validBody
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);

    await app.close();
  });
});
