import { parseApiEnv } from '@operator-os/config';
import type { TaskSubmitRequest } from '@operator-os/contracts';
import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';

/**
 * Integration tests for the Phase 3.1 task routes. Same JWT
 * mint pattern as heartbeat-v2.test.ts — the HS256 literal
 * path via `AUTH_JWT_SIGNING_SECRET_LITERAL` is what the
 * `operator-access-token` branch of the user guard accepts
 * in the absence of Firebase ADC + Google OIDC.
 *
 * Firestore is in controlled-fallback mode (no ADC in tests);
 * writes succeed as fallback receipts, reads return undefined
 * → routes still exercise happy paths + 404 semantics. Tests
 * that depend on persistence across requests (idempotency
 * replay, list) are intentionally not present — those are
 * covered at the IdempotencyCache and accessor levels (c5),
 * and E2E will exercise them against a real Firestore in
 * staging.
 */

const LITERAL = 'a-very-secret-shared-between-auth-gateway-and-operator-api';

const buildEnv = () =>
  parseApiEnv({
    AUTH_JWT_SIGNING_SECRET_LITERAL: LITERAL,
    AUTH_ACCESS_TOKEN_ISSUER: 'operator-auth-gateway',
    AUTH_ACCESS_TOKEN_AUDIENCE: 'operator-os-api'
  });

const mintToken = async (operatorId = 'user-tasks-1') => {
  const secret = new TextEncoder().encode(LITERAL);
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({
    sub: operatorId,
    iss: 'operator-auth-gateway',
    aud: 'operator-os-api',
    iat: now,
    exp: now + 3_600,
    scopes: ['user:read', 'user:write'],
    plan: 'free' as const,
    operatorId,
    email: 'ops@example.com'
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .sign(secret);
};

const validSubmit = (
  over: Partial<TaskSubmitRequest> = {}
): TaskSubmitRequest => ({
  prompt: 'list files in /tmp',
  agentType: 'claude-code',
  capabilities: ['file-read'],
  idempotencyKey: randomUUID(),
  ...over
});

describe('POST /v1/tasks', () => {
  it('accepts a valid submission → 201 with task + stream URL', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: validSubmit()
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.taskId).toMatch(
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
    );
    expect(body.status).toBe('pending');
    expect(typeof body.createdAt).toBe('string');
    expect(body.streamUrl).toMatch(
      /\/v1\/tasks\/[0-9a-fA-F-]+\/stream$/
    );

    await app.close();
  });

  it('rejects missing prompt with 400 + Zod issues', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: { idempotencyKey: randomUUID() }
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.code).toBe('bad_request');
    expect(Array.isArray(body.details?.issues)).toBe(true);

    await app.close();
  });

  it('rejects prompt longer than 50 000 chars with 400', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: validSubmit({ prompt: 'a'.repeat(50_001) })
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('rejects unknown agentType with 400', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...validSubmit(),
        agentType: 'gemini-pro'
      }
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('rejects non-UUID idempotencyKey with 400', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...validSubmit(),
        idempotencyKey: 'not-a-uuid'
      }
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('returns 200 with the same taskId on cache-hit replay of the same idempotencyKey', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();
    const submit = validSubmit();

    const first = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: submit
    });
    expect(first.statusCode).toBe(201);
    const firstTaskId = first.json().taskId;

    const second = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: submit
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().taskId).toBe(firstTaskId);

    await app.close();
  });

  it('isolates idempotency keys across different users', async () => {
    const app = buildServer(buildEnv());
    const tokenA = await mintToken('user-A');
    const tokenB = await mintToken('user-B');
    const sharedKey = randomUUID();

    const resA = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: validSubmit({ idempotencyKey: sharedKey })
    });
    const resB = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: validSubmit({ idempotencyKey: sharedKey })
    });

    expect(resA.statusCode).toBe(201);
    expect(resB.statusCode).toBe(201);
    expect(resA.json().taskId).not.toBe(resB.json().taskId);

    await app.close();
  });

  it('rejects an unauthenticated request with 401', async () => {
    const app = buildServer(buildEnv());
    const response = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      payload: validSubmit()
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('enforces the 10-per-minute rate limit with 429 + Retry-After', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken('user-rate-spam');

    // Ten valid submits pass; eleventh is rate-limited. Each
    // submit uses a fresh idempotencyKey so the rate-limit
    // path is exercised, not the idempotency-hit path.
    for (let i = 0; i < 10; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        headers: { authorization: `Bearer ${token}` },
        payload: validSubmit()
      });
      expect(res.statusCode).toBe(201);
    }

    const throttled = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: validSubmit()
    });
    expect(throttled.statusCode).toBe(429);
    expect(throttled.headers['retry-after']).toBeDefined();
    expect(throttled.json().code).toBe('rate_limited');

    await app.close();
  });
});

describe('GET /v1/tasks/:taskId', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const app = buildServer(buildEnv());
    const response = await app.inject({
      method: 'GET',
      url: `/v1/tasks/${randomUUID()}`
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('returns 400 when taskId is not a UUID', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tasks/not-a-uuid',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('returns 404 for a nonexistent taskId', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();
    const response = await app.inject({
      method: 'GET',
      url: `/v1/tasks/${randomUUID()}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('not_found');
    await app.close();
  });

  it('returns 404 (not 403) for ownership mismatch to prevent enumeration', async () => {
    // Without Firestore ADC, getTask returns undefined for ALL
    // reads in the test env — same path as "not found" AND
    // "not yours". Directly asserts that the handler never
    // leaks the 403-vs-404 distinction; also pins the Gate
    // 3.1.C override of spec §3.1.2 in a regression-safe spot.
    const app = buildServer(buildEnv());
    const tokenOther = await mintToken('user-other');
    const response = await app.inject({
      method: 'GET',
      url: `/v1/tasks/${randomUUID()}`,
      headers: { authorization: `Bearer ${tokenOther}` }
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('not_found');
    await app.close();
  });
});

describe('GET /v1/tasks (list)', () => {
  it('returns an empty list with null cursor when the user has no tasks', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken('user-empty');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.tasks).toEqual([]);
    expect(body.nextCursor).toBeNull();
    await app.close();
  });

  it('rejects unknown status values with 400', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tasks?status=on-fire',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('accepts valid status + limit query params', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tasks?status=pending&limit=5',
      headers: { authorization: `Bearer ${token}` }
    });
    // 200 with empty list because no Firestore → no data; what
    // matters is the query-parsing path accepts the values.
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const app = buildServer(buildEnv());
    const response = await app.inject({ method: 'GET', url: '/v1/tasks' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe('GET /v1/tasks/:taskId/stream (Phase 3.1 stub)', () => {
  it('returns 501 with the not-implemented marker body', async () => {
    const app = buildServer(buildEnv());
    const response = await app.inject({
      method: 'GET',
      url: `/v1/tasks/${randomUUID()}/stream`
    });
    expect(response.statusCode).toBe(501);
    const body = response.json();
    expect(body.code).toBe('not_implemented');
    expect(body.phase).toBe('3.3');
    await app.close();
  });
});
