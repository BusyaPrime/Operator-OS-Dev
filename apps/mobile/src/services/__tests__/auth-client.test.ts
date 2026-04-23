import type { SigninResponse } from '@operator-os/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuthClient, AuthClientError } from '../auth-client.js';

const gatewayBaseUrl = 'https://gateway.test';

const validSigninResponse: SigninResponse = {
  accessToken: 'at-abc',
  refreshToken: 'rt-abc',
  accessTokenExpiresAt: '2026-04-24T01:00:00.000Z',
  refreshTokenExpiresAt: '2026-05-24T00:00:00.000Z',
  user: {
    id: 'user-1',
    googleSubject: 'google-sub-1',
    email: 'user@example.com',
    displayName: 'Test User',
    roles: ['owner'],
    plan: 'free',
    createdAt: '2026-04-24T00:00:00.000Z',
    updatedAt: '2026-04-24T00:00:00.000Z'
  }
};

const validRefreshResponse = {
  accessToken: 'at-new',
  refreshToken: 'rt-new',
  accessTokenExpiresAt: '2026-04-24T02:00:00.000Z',
  refreshTokenExpiresAt: '2026-05-24T00:00:00.000Z'
};

const makeResponse = (
  status: number,
  body: unknown,
  init: { bodyJsonThrows?: boolean } = {}
): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: init.bodyJsonThrows
      ? () => Promise.reject(new Error('not json'))
      : () => Promise.resolve(body)
  }) as unknown as Response;

describe('authClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  const build = () =>
    createAuthClient({ gatewayBaseUrl, fetchFn: fetchMock as unknown as typeof fetch });

  describe('signin()', () => {
    it('POSTs { idToken } to /v1/auth/signin and parses the response', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(200, validSigninResponse));
      const client = build();
      const result = await client.signin('id-token-value');

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://gateway.test/v1/auth/signin');
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
      expect(JSON.parse(init.body as string)).toEqual({ idToken: 'id-token-value' });
      expect(result.accessToken).toBe('at-abc');
      expect(result.user.email).toBe('user@example.com');
    });

    it('maps 400 → AuthClientError code=bad-request', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(400, { error: 'bad' }));
      const client = build();
      await expect(client.signin('t')).rejects.toMatchObject({
        code: 'bad-request',
        status: 400
      });
    });

    it('maps 401 → AuthClientError code=invalid-credentials', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(401, {}));
      const client = build();
      await expect(client.signin('t')).rejects.toMatchObject({
        code: 'invalid-credentials'
      });
    });

    it('maps 500 → AuthClientError code=server', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(503, {}));
      const client = build();
      await expect(client.signin('t')).rejects.toMatchObject({
        code: 'server',
        status: 503
      });
    });

    it('maps a thrown network error → code=network', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      const client = build();
      await expect(client.signin('t')).rejects.toMatchObject({ code: 'network' });
    });

    it('maps an AbortError → code=timeout', async () => {
      const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
      fetchMock.mockRejectedValueOnce(abortError);
      const client = build();
      await expect(client.signin('t')).rejects.toMatchObject({ code: 'timeout' });
    });

    it('rejects on malformed 2xx bodies (schema drift)', async () => {
      fetchMock.mockResolvedValueOnce(
        makeResponse(200, { accessToken: 'only' })
      );
      const client = build();
      const err = await client
        .signin('t')
        .catch((e: unknown) => e as AuthClientError);
      expect(err).toBeInstanceOf(AuthClientError);
      expect((err as AuthClientError).code).toBe('malformed-response');
    });
  });

  describe('refresh()', () => {
    it('POSTs { refreshToken } to /v1/auth/refresh and parses response', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(200, validRefreshResponse));
      const client = build();
      const result = await client.refresh('rt-old');
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://gateway.test/v1/auth/refresh');
      expect(JSON.parse(init.body as string)).toEqual({ refreshToken: 'rt-old' });
      expect(result.accessToken).toBe('at-new');
      expect(result.refreshToken).toBe('rt-new');
    });

    it('401 on refresh surfaces as invalid-credentials — caller forces sign-out', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(401, {}));
      const client = build();
      await expect(client.refresh('rt-bad')).rejects.toMatchObject({
        code: 'invalid-credentials'
      });
    });
  });

  describe('signout()', () => {
    it('POSTs { refreshToken } to /v1/auth/signout and resolves on 204', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(204, null));
      const client = build();
      await expect(client.signout('rt-abc')).resolves.toBeUndefined();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://gateway.test/v1/auth/signout');
      expect(JSON.parse(init.body as string)).toEqual({ refreshToken: 'rt-abc' });
    });

    it('treats 401 as success — server already forgot the token', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(401, {}));
      const client = build();
      await expect(client.signout('rt-abc')).resolves.toBeUndefined();
    });

    it('rejects 5xx as server error so caller can retry', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(503, {}));
      const client = build();
      await expect(client.signout('rt-abc')).rejects.toMatchObject({
        code: 'server'
      });
    });
  });

  describe('gatewayBaseUrl normalisation', () => {
    it('strips a trailing slash so paths join cleanly', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(204, null));
      const client = createAuthClient({
        gatewayBaseUrl: 'https://gateway.test/',
        fetchFn: fetchMock as unknown as typeof fetch
      });
      await client.signout('rt');
      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://gateway.test/v1/auth/signout'
      );
    });
  });
});
