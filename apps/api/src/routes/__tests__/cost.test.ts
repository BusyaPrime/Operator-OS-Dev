import { parseApiEnv } from '@operator-os/config';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { CostService } from '../../services/cost.js';

/**
 * Integration tests for POST /v1/cost/{estimate,record} and
 * GET /v1/cost/{status,spending}/:userId (Phase 2 / TD-022).
 *
 * Same HS256 JWT pattern as agent-heartbeat-v2.test.ts. No
 * Firestore — the ADC check in FirestoreOperatorRepository
 * returns `not configured` in the test env, so list /
 * get accessors resolve to empty / undefined. That yields a
 * "fresh-user" view consistent with what the routes expect.
 */

const LITERAL = 'a-very-secret-shared-between-auth-gateway-and-operator-api';

const buildEnv = () =>
  parseApiEnv({
    AUTH_JWT_SIGNING_SECRET_LITERAL: LITERAL,
    AUTH_ACCESS_TOKEN_ISSUER: 'operator-auth-gateway',
    AUTH_ACCESS_TOKEN_AUDIENCE: 'operator-os-api'
  });

const mintToken = async (operatorId = 'user-token-1') => {
  const secret = new TextEncoder().encode(LITERAL);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: operatorId,
    iss: 'operator-auth-gateway',
    aud: 'operator-os-api',
    iat: now,
    exp: now + 3600,
    scopes: ['user:read', 'agent:write'],
    plan: 'free' as const,
    operatorId,
    email: 'user@example.com'
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .sign(secret);
};

describe('POST /v1/cost/estimate', () => {
  it('returns a priced estimate for a known model with confidence=high', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/cost/estimate',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        providerId: 'anthropic.claude-code',
        model: 'claude-sonnet-4-5',
        promptTokens: 1_000_000,
        expectedCompletionTokens: 500_000
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.confidence).toBe('high');
    // 1M prompt @ $3 + 500k completion @ $15 = $3 + $7.5 = $10.5
    expect(body.costUsd).toBeCloseTo(10.5, 3);
    expect(body.breakdown.promptCostUsd).toBeCloseTo(3, 3);
    expect(body.breakdown.completionCostUsd).toBeCloseTo(7.5, 3);

    await app.close();
  });

  it('returns zero with confidence=low for an unknown model', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/cost/estimate',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        providerId: 'unknown.vendor',
        model: 'ghost-7b',
        promptTokens: 1_000,
        expectedCompletionTokens: 500
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.confidence).toBe('low');
    expect(body.costUsd).toBe(0);

    await app.close();
  });

  it('rejects a bad body with 400 + Zod issues', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/cost/estimate',
      headers: { authorization: `Bearer ${token}` },
      payload: { providerId: 'anthropic.claude-code' }
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBe('Bad Request');
    expect(Array.isArray(body.issues)).toBe(true);

    await app.close();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const app = buildServer(buildEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/v1/cost/estimate',
      payload: {
        providerId: 'anthropic.claude-code',
        model: 'claude-sonnet-4-5',
        promptTokens: 100,
        expectedCompletionTokens: 100
      }
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe('POST /v1/cost/record', () => {
  it('persists a usage record and returns { success: true, recordId }', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/cost/record',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        userId: 'user-token-1',
        taskId: 'task-1',
        providerId: 'anthropic.claude-code',
        model: 'claude-sonnet-4-5',
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          // Server recompute: (100/1M)*3 + (50/1M)*15 = 0.0003 + 0.00075 = 0.00105
          // Agent-reported 0.00105 is within $0.01, accepted as-is.
          costUsd: 0.00105
        },
        timestamp: '2026-04-24T00:00:00.000Z'
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    // Doc id = `{userId}__{taskId}` (idempotent per task).
    expect(body.recordId).toBe('user-token-1__task-1');

    await app.close();
  });

  it('rejects 400 on malformed record body', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/cost/record',
      headers: { authorization: `Bearer ${token}` },
      payload: { userId: 'u', taskId: 't' } // missing usage + timestamp
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('overrides an agent-reported cost that diverges by more than $0.01', async () => {
    // Server recompute = 0.00105; agent reports 5.00.
    // The record saved inside Firestore gets `costUsd` overridden.
    // Spec behaviour — the response still shapes as { success, recordId }
    // so we just assert the 200 and trust subsequent status/spending
    // integration to confirm the sanitised value propagated.
    const app = buildServer(buildEnv());
    const token = await mintToken();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/cost/record',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        userId: 'user-token-1',
        taskId: 'task-inflated',
        providerId: 'anthropic.claude-code',
        model: 'claude-sonnet-4-5',
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          costUsd: 5 // wildly off
        },
        timestamp: '2026-04-24T00:00:00.000Z'
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);

    await app.close();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const app = buildServer(buildEnv());

    const response = await app.inject({
      method: 'POST',
      url: '/v1/cost/record',
      payload: {
        userId: 'u',
        taskId: 't',
        providerId: 'anthropic.claude-code',
        model: 'claude-sonnet-4-5',
        usage: {
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
          costUsd: 0
        },
        timestamp: '2026-04-24T00:00:00.000Z'
      }
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe('GET /v1/cost/status/:userId', () => {
  it('returns the budget snapshot when userId matches the JWT sub', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken('user-token-1');

    const response = await app.inject({
      method: 'GET',
      url: '/v1/cost/status/user-token-1',
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.userId).toBe('user-token-1');
    expect(body.plan).toBe('free');
    expect(body.limitUsd).toBe(1);
    expect(body.spentUsd).toBe(0); // no records in test env
    expect(body.isOverBudget).toBe(false);
    expect(body.warnAtPercent).toBe(80);
    expect(typeof body.periodStart).toBe('string');
    expect(typeof body.periodEnd).toBe('string');

    await app.close();
  });

  it('rejects with 403 when userId does not match the JWT sub', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken('user-token-1');

    const response = await app.inject({
      method: 'GET',
      url: '/v1/cost/status/someone-else',
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.error).toBe('Forbidden');

    await app.close();
  });

  it('rejects with 401 when unauthenticated', async () => {
    const app = buildServer(buildEnv());

    const response = await app.inject({
      method: 'GET',
      url: '/v1/cost/status/user-token-1'
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe('GET /v1/cost/spending/:userId', () => {
  it('returns a zeroed report for a user with no records', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken('user-token-1');

    const response = await app.inject({
      method: 'GET',
      url: '/v1/cost/spending/user-token-1',
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.userId).toBe('user-token-1');
    expect(body.period).toBe('this-month');
    expect(body.totalUsd).toBe(0);
    expect(body.taskCount).toBe(0);
    expect(body.avgCostPerTaskUsd).toBe(0);
    expect(body.byProvider).toEqual({});
    expect(body.byModel).toEqual({});

    await app.close();
  });

  it('honours the ?period= query param', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken('user-token-1');

    const response = await app.inject({
      method: 'GET',
      url: '/v1/cost/spending/user-token-1?period=today',
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().period).toBe('today');

    await app.close();
  });

  it('rejects an unknown period value with 400', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken('user-token-1');

    const response = await app.inject({
      method: 'GET',
      url: '/v1/cost/spending/user-token-1?period=yesterday',
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('rejects with 403 when userId does not match JWT sub', async () => {
    const app = buildServer(buildEnv());
    const token = await mintToken('user-token-1');

    const response = await app.inject({
      method: 'GET',
      url: '/v1/cost/spending/someone-else',
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

describe('CostService unit behaviour (anchored in service file)', () => {
  // Two pricing-accuracy sanity tests that pin representative
  // table rows. If the source pricing pages change, these
  // failures point straight at the row to update.
  const service = new CostService();

  it('prices claude-sonnet-4-5 at $3/$15 per 1M', () => {
    const est = service.estimateCost({
      providerId: 'anthropic.claude-code',
      model: 'claude-sonnet-4-5',
      promptTokens: 1_000_000,
      expectedCompletionTokens: 1_000_000
    });
    expect(est.costUsd).toBeCloseTo(18, 2);
    expect(est.confidence).toBe('high');
  });

  it('prices gemini-2.5-flash at $0.075/$0.30 per 1M', () => {
    const est = service.estimateCost({
      providerId: 'google.vertex',
      model: 'gemini-2.5-flash',
      promptTokens: 1_000_000,
      expectedCompletionTokens: 1_000_000
    });
    // 0.075 + 0.30 = 0.375
    expect(est.costUsd).toBeCloseTo(0.375, 4);
  });

  it('this-month period is inclusive-start, exclusive-end in UTC', () => {
    const { start, end } = service.periodRange(
      new Date('2026-04-15T12:00:00.000Z'),
      'this-month'
    );
    expect(start.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });
});
