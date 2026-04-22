import { parseAuthGatewayEnv } from '@operator-os/config';
import type {
  RefreshResponse,
  SigninResponse
} from '@operator-os/contracts';
import { describe, expect, it, vi } from 'vitest';

import { buildServer } from '../app.js';
import { IntegrationError } from '../integrations/runtime.js';
import type { RefreshService } from '../services/refresh-service.js';
import type { SigninService } from '../services/signin-service.js';
import type { SignoutService } from '../services/signout-service.js';

const buildStubSignin = (overrides?: Partial<SigninResponse>): SigninService => {
  const response: SigninResponse = {
    accessToken: 'access.stub.token',
    refreshToken: 'refresh-stub-token-base64url',
    accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 86400 * 30 * 1000).toISOString(),
    user: {
      id: 'user-stub-1',
      googleSubject: 'google-sub-stub',
      email: 'founder@example.com',
      displayName: 'Akmal',
      roles: ['owner'],
      plan: 'free',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    },
    ...overrides
  };

  return {
    name: 'signin-service-stub',
    signin: vi.fn().mockResolvedValue(response)
  } as unknown as SigninService;
};

const buildStubRefresh = (
  response: RefreshResponse | Error = {
    accessToken: 'access.refreshed.token',
    refreshToken: 'refresh-rotated-token',
    accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 86400 * 30 * 1000).toISOString()
  }
): RefreshService => {
  const refresh =
    response instanceof Error
      ? vi.fn().mockRejectedValue(response)
      : vi.fn().mockResolvedValue(response);

  return {
    name: 'refresh-service-stub',
    refresh
  } as unknown as RefreshService;
};

const buildStubSignout = (): SignoutService =>
  ({
    name: 'signout-service-stub',
    signout: vi.fn().mockResolvedValue({ revoked: true })
  }) as unknown as SignoutService;

describe('POST /v1/auth/signin', () => {
  it('returns access + refresh tokens for a valid Google ID token request', async () => {
    const app = buildServer(parseAuthGatewayEnv({}), {
      signinService: buildStubSignin(),
      refreshService: buildStubRefresh(),
      signoutService: buildStubSignout()
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/signin',
      payload: {
        provider: 'google',
        idToken:
          'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzdHViLXN1YmplY3QifQ.stub-signature'
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accessToken).toBe('access.stub.token');
    expect(body.user.email).toBe('founder@example.com');

    await app.close();
  });

  it('rejects a request without idToken with 400', async () => {
    const app = buildServer(parseAuthGatewayEnv({}), {
      signinService: buildStubSignin(),
      refreshService: buildStubRefresh(),
      signoutService: buildStubSignout()
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/signin',
      payload: { provider: 'google' }
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });
});

describe('POST /v1/auth/refresh', () => {
  it('returns new access + refresh tokens when the stub service accepts', async () => {
    const stub = buildStubRefresh();
    const app = buildServer(parseAuthGatewayEnv({}), {
      signinService: buildStubSignin(),
      refreshService: stub,
      signoutService: buildStubSignout()
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: 'existing-refresh-token' }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accessToken).toBe('access.refreshed.token');
    expect(body.refreshToken).toBe('refresh-rotated-token');
    expect(stub.refresh).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'existing-refresh-token' })
    );

    await app.close();
  });

  it('rejects a request without refreshToken with 400', async () => {
    const app = buildServer(parseAuthGatewayEnv({}), {
      signinService: buildStubSignin(),
      refreshService: buildStubRefresh(),
      signoutService: buildStubSignout()
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: {}
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('surfaces IntegrationError 401 when the refresh service rejects the token', async () => {
    const rejection = new IntegrationError({
      code: 'invalid_config',
      dependency: 'refresh-service',
      message:
        'Refresh token was already rotated; treat this as a potential token reuse and sign in again.',
      statusCode: 401,
      details: { reason: 'rotated' }
    });

    const app = buildServer(parseAuthGatewayEnv({}), {
      signinService: buildStubSignin(),
      refreshService: buildStubRefresh(rejection),
      signoutService: buildStubSignout()
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: 'already-rotated-token' }
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.details.reason).toBe('rotated');

    await app.close();
  });
});

describe('POST /v1/auth/signout', () => {
  it('returns 204 when the stub revokes the token', async () => {
    const stub = buildStubSignout();
    const app = buildServer(parseAuthGatewayEnv({}), {
      signinService: buildStubSignin(),
      refreshService: buildStubRefresh(),
      signoutService: stub
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/signout',
      payload: { refreshToken: 'existing-refresh-token' }
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(stub.signout).toHaveBeenCalledWith({
      refreshToken: 'existing-refresh-token'
    });

    await app.close();
  });

  it('rejects a request without refreshToken with 400', async () => {
    const app = buildServer(parseAuthGatewayEnv({}), {
      signinService: buildStubSignin(),
      refreshService: buildStubRefresh(),
      signoutService: buildStubSignout()
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/signout',
      payload: {}
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
