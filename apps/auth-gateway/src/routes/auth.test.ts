import { parseAuthGatewayEnv } from '@operator-os/config';
import type { SigninResponse } from '@operator-os/contracts';
import { describe, expect, it, vi } from 'vitest';

import { buildServer } from '../app.js';
import type { SigninService } from '../services/signin-service.js';

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

describe('POST /v1/auth/signin', () => {
  it('returns access + refresh tokens for a valid Google ID token request', async () => {
    const stub = buildStubSignin();
    const app = buildServer(parseAuthGatewayEnv({}), {
      signinService: stub
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/signin',
      payload: { provider: 'google', idToken: 'stub-google-id-token' }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accessToken).toBe('access.stub.token');
    expect(body.refreshToken).toBe('refresh-stub-token-base64url');
    expect(body.user.email).toBe('founder@example.com');

    await app.close();
  });

  it('rejects a request without idToken with 400', async () => {
    const stub = buildStubSignin();
    const app = buildServer(parseAuthGatewayEnv({}), {
      signinService: stub
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/signin',
      payload: { provider: 'google' }
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);

    await app.close();
  });

  it('defaults provider to google when omitted', async () => {
    const stub = buildStubSignin();
    const app = buildServer(parseAuthGatewayEnv({}), {
      signinService: stub
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/signin',
      payload: { idToken: 'stub-google-id-token' }
    });

    expect(response.statusCode).toBe(200);

    await app.close();
  });

  it('forwards the user-agent header to the signin service', async () => {
    const stub = buildStubSignin();
    const app = buildServer(parseAuthGatewayEnv({}), {
      signinService: stub
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/signin',
      headers: {
        'user-agent': 'OperatorOSMobile/0.1 (ios)'
      },
      payload: { idToken: 'stub-google-id-token' }
    });

    expect(response.statusCode).toBe(200);
    expect(stub.signin).toHaveBeenCalledWith(
      expect.objectContaining({ userAgent: 'OperatorOSMobile/0.1 (ios)' })
    );

    await app.close();
  });
});
