import { parseAuthGatewayEnv } from '@operator-os/config';
import { decodeJwt } from 'jose';
import { describe, expect, it, vi } from 'vitest';

import { buildServer } from '../app.js';
import type { RefreshService } from '../services/refresh-service.js';
import type { SigninService } from '../services/signin-service.js';
import type { SignoutService } from '../services/signout-service.js';

// Stubs reused from the auth-routes test pattern. Keeps the
// auth-gateway boot self-contained so we never touch Google /
// Firestore. Single mock surface = the three injectable services.
const buildStubSignin = (): SigninService =>
  ({ name: 'signin-stub', signin: vi.fn() }) as unknown as SigninService;
const buildStubRefresh = (): RefreshService =>
  ({ name: 'refresh-stub', refresh: vi.fn() }) as unknown as RefreshService;
const buildStubSignout = (): SignoutService =>
  ({
    name: 'signout-stub',
    signout: vi.fn().mockResolvedValue({ revoked: true })
  }) as unknown as SignoutService;

const baseInjections = {
  signinService: buildStubSignin(),
  refreshService: buildStubRefresh(),
  signoutService: buildStubSignout()
};

const buildEnv = (overrides: Record<string, string> = {}) =>
  parseAuthGatewayEnv({
    AUTH_JWT_SIGNING_SECRET_LITERAL: 'dev-mint-test-secret-32bytes-long!!',
    ...overrides
  });

describe('POST /v1/dev/mint-test-token — gating', () => {
  it('returns 404 when AUTH_DEV_MINT_ENABLED is unset (default)', async () => {
    const app = buildServer(buildEnv(), baseInjections);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/dev/mint-test-token',
      payload: { userId: 'smoke-test-user' }
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('returns 404 when AUTH_DEV_MINT_ENABLED=false', async () => {
    const app = buildServer(
      buildEnv({ AUTH_DEV_MINT_ENABLED: 'false' }),
      baseInjections
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/dev/mint-test-token',
      payload: { userId: 'smoke-test-user' }
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('does not leak the route via OPTIONS / HEAD when disabled', async () => {
    const app = buildServer(buildEnv(), baseInjections);

    const head = await app.inject({
      method: 'HEAD',
      url: '/v1/dev/mint-test-token'
    });
    const options = await app.inject({
      method: 'OPTIONS',
      url: '/v1/dev/mint-test-token'
    });

    expect(head.statusCode).toBe(404);
    expect(options.statusCode).toBe(404);
    await app.close();
  });
});

describe('POST /v1/dev/mint-test-token — enabled', () => {
  it('mints an operator-HS256 access token with the requested userId in subject + claims', async () => {
    const app = buildServer(
      buildEnv({ AUTH_DEV_MINT_ENABLED: 'true' }),
      baseInjections
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/dev/mint-test-token',
      payload: { userId: 'smoke-test-user-1' }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      accessToken: string;
      expiresAt: string;
      expiresInSeconds: number;
      userId: string;
      warning: string;
    };
    expect(body.userId).toBe('smoke-test-user-1');
    expect(body.expiresInSeconds).toBe(3600); // default TTL
    expect(body.warning).toMatch(/Disable AUTH_DEV_MINT_ENABLED/);
    expect(body.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);

    const claims = decodeJwt(body.accessToken);
    expect(claims.sub).toBe('smoke-test-user-1');
    expect(claims.operatorId).toBe('smoke-test-user-1');
    expect(claims.aud).toBe('operator-os-api');
    expect(claims.iss).toBe('operator-auth-gateway');
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    await app.close();
  });

  it('honours expiresInSeconds override and reflects it in claims', async () => {
    const app = buildServer(
      buildEnv({ AUTH_DEV_MINT_ENABLED: 'true' }),
      baseInjections
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/dev/mint-test-token',
      payload: { userId: 'smoke-test-user-2', expiresInSeconds: 600 }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      accessToken: string;
      expiresInSeconds: number;
    };
    expect(body.expiresInSeconds).toBe(600);

    const claims = decodeJwt(body.accessToken);
    const ttl = (claims.exp ?? 0) - (claims.iat ?? 0);
    expect(ttl).toBe(600);
    await app.close();
  });

  it('caps expiresInSeconds at 24h via Zod schema', async () => {
    const app = buildServer(
      buildEnv({ AUTH_DEV_MINT_ENABLED: 'true' }),
      baseInjections
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/dev/mint-test-token',
      payload: { userId: 'smoke-test-user-3', expiresInSeconds: 86_401 }
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('rejects empty / missing userId via Zod schema', async () => {
    const app = buildServer(
      buildEnv({ AUTH_DEV_MINT_ENABLED: 'true' }),
      baseInjections
    );

    const missing = await app.inject({
      method: 'POST',
      url: '/v1/dev/mint-test-token',
      payload: {}
    });
    const empty = await app.inject({
      method: 'POST',
      url: '/v1/dev/mint-test-token',
      payload: { userId: '' }
    });

    expect(missing.statusCode).toBe(400);
    expect(empty.statusCode).toBe(400);
    await app.close();
  });

  it('mints distinct tokens for distinct userIds (no caching collision)', async () => {
    const app = buildServer(
      buildEnv({ AUTH_DEV_MINT_ENABLED: 'true' }),
      baseInjections
    );

    const r1 = await app.inject({
      method: 'POST',
      url: '/v1/dev/mint-test-token',
      payload: { userId: 'user-a' }
    });
    const r2 = await app.inject({
      method: 'POST',
      url: '/v1/dev/mint-test-token',
      payload: { userId: 'user-b' }
    });

    const t1 = (r1.json() as { accessToken: string }).accessToken;
    const t2 = (r2.json() as { accessToken: string }).accessToken;
    expect(t1).not.toBe(t2);
    expect(decodeJwt(t1).sub).toBe('user-a');
    expect(decodeJwt(t2).sub).toBe('user-b');
    await app.close();
  });
});
