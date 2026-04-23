import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TokenStorage } from '../../auth/token-storage.js';

import {
  AuthClientError,
  type AuthClient
} from '../auth-client.js';
import {
  createAuthenticatedFetch,
  type AuthenticatedFetchAuthStore
} from '../authenticated-api-client.js';

interface StoreSnapshot {
  accessToken?: string;
  accessTokenExpiresAt?: string;
}

interface Harness {
  fetchMock: ReturnType<typeof vi.fn>;
  authStore: {
    snapshot: StoreSnapshot;
    getState: () => StoreSnapshot;
    applyRefreshedTokens: ReturnType<typeof vi.fn>;
    forceSignOut: ReturnType<typeof vi.fn>;
  };
  authClient: {
    refresh: ReturnType<typeof vi.fn>;
    signin: ReturnType<typeof vi.fn>;
    signout: ReturnType<typeof vi.fn>;
  };
  tokenStorage: {
    readRefreshToken: ReturnType<typeof vi.fn>;
    writeRefreshToken: ReturnType<typeof vi.fn>;
    clearRefreshToken: ReturnType<typeof vi.fn>;
  };
  now: number;
}

const buildHarness = (init: StoreSnapshot = {}): Harness => {
  const fetchMock = vi.fn();
  const snapshot: StoreSnapshot = { ...init };
  const authStore = {
    snapshot,
    getState: () => snapshot,
    applyRefreshedTokens: vi.fn((at: string, exp: string) => {
      snapshot.accessToken = at;
      snapshot.accessTokenExpiresAt = exp;
    }),
    forceSignOut: vi.fn().mockResolvedValue(undefined)
  };
  const authClient = {
    refresh: vi.fn(),
    signin: vi.fn(),
    signout: vi.fn()
  };
  const tokenStorage = {
    readRefreshToken: vi.fn(),
    writeRefreshToken: vi.fn().mockResolvedValue(undefined),
    clearRefreshToken: vi.fn().mockResolvedValue(undefined)
  };
  return { fetchMock, authStore, authClient, tokenStorage, now: 1_000_000 };
};

const jsonResponse = (status: number, body: unknown = {}): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body))
  }) as unknown as Response;

const buildFetch = (h: Harness) =>
  createAuthenticatedFetch({
    authStore: h.authStore as unknown as AuthenticatedFetchAuthStore,
    authClient: h.authClient as unknown as AuthClient,
    tokenStorage: h.tokenStorage as unknown as TokenStorage,
    fetchFn: h.fetchMock as unknown as typeof fetch,
    now: () => h.now
  });

const readAuthHeader = (init: RequestInit | undefined): string | null => {
  const headers = new Headers(init?.headers);
  return headers.get('Authorization');
};

describe('createAuthenticatedFetch', () => {
  let h: Harness;

  beforeEach(() => {
    h = buildHarness();
  });

  describe('no-auth behaviour', () => {
    it('passes through when no accessToken is present', async () => {
      h.fetchMock.mockResolvedValueOnce(jsonResponse(200));
      const authFetch = buildFetch(h);
      const res = await authFetch('https://api.test/x');
      expect(res.status).toBe(200);
      const [, init] = h.fetchMock.mock.calls[0];
      expect(readAuthHeader(init)).toBeNull();
    });

    it('propagates non-401 responses unchanged', async () => {
      h = buildHarness({
        accessToken: 'at-1',
        accessTokenExpiresAt: new Date(h.now + 60 * 60_000).toISOString()
      });
      h.fetchMock.mockResolvedValueOnce(jsonResponse(500, { err: 'upstream' }));
      const authFetch = buildFetch(h);
      const res = await authFetch('https://api.test/x');
      expect(res.status).toBe(500);
      expect(h.authClient.refresh).not.toHaveBeenCalled();
    });
  });

  describe('bearer header injection', () => {
    it('adds Authorization header when the store has an access token', async () => {
      h = buildHarness({
        accessToken: 'at-1',
        accessTokenExpiresAt: new Date(h.now + 60 * 60_000).toISOString()
      });
      h.fetchMock.mockResolvedValueOnce(jsonResponse(200));
      const authFetch = buildFetch(h);
      await authFetch('https://api.test/x');
      const [, init] = h.fetchMock.mock.calls[0];
      expect(readAuthHeader(init)).toBe('Bearer at-1');
    });

    it('preserves caller-supplied headers alongside the bearer', async () => {
      h = buildHarness({
        accessToken: 'at-1',
        accessTokenExpiresAt: new Date(h.now + 60 * 60_000).toISOString()
      });
      h.fetchMock.mockResolvedValueOnce(jsonResponse(200));
      const authFetch = buildFetch(h);
      await authFetch('https://api.test/x', {
        headers: { 'Content-Type': 'application/json' }
      });
      const [, init] = h.fetchMock.mock.calls[0];
      const headers = new Headers((init as RequestInit).headers);
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(headers.get('Authorization')).toBe('Bearer at-1');
    });
  });

  describe('proactive refresh (expiry window)', () => {
    it('refreshes before sending when token expires within buffer', async () => {
      const expiresSoon = new Date(h.now + 60_000).toISOString(); // 60s away
      h = buildHarness({
        accessToken: 'at-old',
        accessTokenExpiresAt: expiresSoon
      });
      h.tokenStorage.readRefreshToken.mockResolvedValueOnce('rt-1');
      h.authClient.refresh.mockResolvedValueOnce({
        accessToken: 'at-new',
        refreshToken: 'rt-new',
        accessTokenExpiresAt: new Date(h.now + 60 * 60_000).toISOString(),
        refreshTokenExpiresAt: new Date(h.now + 30 * 86400_000).toISOString()
      });
      h.fetchMock.mockResolvedValueOnce(jsonResponse(200));
      const authFetch = buildFetch(h);

      await authFetch('https://api.test/x');

      expect(h.authClient.refresh).toHaveBeenCalledWith('rt-1');
      expect(h.authStore.applyRefreshedTokens).toHaveBeenCalled();
      expect(h.tokenStorage.writeRefreshToken).toHaveBeenCalledWith('rt-new');
      const [, init] = h.fetchMock.mock.calls[0];
      expect(readAuthHeader(init)).toBe('Bearer at-new');
    });

    it('skips refresh when token is far from expiry', async () => {
      h = buildHarness({
        accessToken: 'at-ok',
        accessTokenExpiresAt: new Date(h.now + 60 * 60_000).toISOString()
      });
      h.fetchMock.mockResolvedValueOnce(jsonResponse(200));
      const authFetch = buildFetch(h);
      await authFetch('https://api.test/x');
      expect(h.authClient.refresh).not.toHaveBeenCalled();
    });

    it('proceeds without auth when no refresh token is stored', async () => {
      const expiresSoon = new Date(h.now + 60_000).toISOString();
      h = buildHarness({
        accessToken: 'at-old',
        accessTokenExpiresAt: expiresSoon
      });
      h.tokenStorage.readRefreshToken.mockResolvedValueOnce(undefined);
      h.fetchMock.mockResolvedValueOnce(jsonResponse(200));
      const authFetch = buildFetch(h);
      await authFetch('https://api.test/x');
      expect(h.authClient.refresh).not.toHaveBeenCalled();
      // Bearer still attached with the OLD token — callers fall
      // through to the 401-retry path if the server rejects it.
      const [, init] = h.fetchMock.mock.calls[0];
      expect(readAuthHeader(init)).toBe('Bearer at-old');
    });
  });

  describe('401 → refresh + retry', () => {
    it('refreshes and retries once with the new token', async () => {
      h = buildHarness({
        accessToken: 'at-old',
        accessTokenExpiresAt: new Date(h.now + 60 * 60_000).toISOString()
      });
      h.tokenStorage.readRefreshToken.mockResolvedValueOnce('rt-1');
      h.authClient.refresh.mockResolvedValueOnce({
        accessToken: 'at-new',
        refreshToken: 'rt-new',
        accessTokenExpiresAt: new Date(h.now + 60 * 60_000).toISOString(),
        refreshTokenExpiresAt: new Date(h.now + 30 * 86400_000).toISOString()
      });
      h.fetchMock
        .mockResolvedValueOnce(jsonResponse(401)) // first call
        .mockResolvedValueOnce(jsonResponse(200)); // retry

      const authFetch = buildFetch(h);
      const res = await authFetch('https://api.test/x');
      expect(res.status).toBe(200);
      expect(h.fetchMock).toHaveBeenCalledTimes(2);
      const [, retryInit] = h.fetchMock.mock.calls[1];
      expect(readAuthHeader(retryInit)).toBe('Bearer at-new');
      expect(h.authStore.forceSignOut).not.toHaveBeenCalled();
    });

    it('forces sign-out when the refresh returns invalid-credentials', async () => {
      h = buildHarness({
        accessToken: 'at-1',
        accessTokenExpiresAt: new Date(h.now + 60 * 60_000).toISOString()
      });
      h.tokenStorage.readRefreshToken.mockResolvedValueOnce('rt-1');
      h.authClient.refresh.mockRejectedValueOnce(
        new AuthClientError('invalid-credentials', 'revoked')
      );
      h.fetchMock.mockResolvedValueOnce(jsonResponse(401));

      const authFetch = buildFetch(h);
      const res = await authFetch('https://api.test/x');
      // Returns the original 401 so the caller sees the auth
      // failure as-is rather than an opaque thrown error.
      expect(res.status).toBe(401);
      expect(h.authStore.forceSignOut).toHaveBeenCalled();
    });

    it('forces sign-out when the retried response is also 401', async () => {
      h = buildHarness({
        accessToken: 'at-1',
        accessTokenExpiresAt: new Date(h.now + 60 * 60_000).toISOString()
      });
      h.tokenStorage.readRefreshToken.mockResolvedValueOnce('rt-1');
      h.authClient.refresh.mockResolvedValueOnce({
        accessToken: 'at-2',
        refreshToken: 'rt-2',
        accessTokenExpiresAt: new Date(h.now + 60 * 60_000).toISOString(),
        refreshTokenExpiresAt: new Date(h.now + 30 * 86400_000).toISOString()
      });
      h.fetchMock
        .mockResolvedValueOnce(jsonResponse(401))
        .mockResolvedValueOnce(jsonResponse(401));

      const authFetch = buildFetch(h);
      const res = await authFetch('https://api.test/x');
      expect(res.status).toBe(401);
      expect(h.authStore.forceSignOut).toHaveBeenCalled();
    });

    it('forces sign-out when no refresh token is stored on a 401', async () => {
      h = buildHarness({
        accessToken: 'at-1',
        accessTokenExpiresAt: new Date(h.now + 60 * 60_000).toISOString()
      });
      h.tokenStorage.readRefreshToken.mockResolvedValueOnce(undefined);
      h.fetchMock.mockResolvedValueOnce(jsonResponse(401));
      const authFetch = buildFetch(h);
      const res = await authFetch('https://api.test/x');
      expect(res.status).toBe(401);
      expect(h.authStore.forceSignOut).toHaveBeenCalled();
      expect(h.authClient.refresh).not.toHaveBeenCalled();
    });
  });

  describe('pass-through of non-auth failures', () => {
    it('bubbles up fetch rejections', async () => {
      h = buildHarness({
        accessToken: 'at-1',
        accessTokenExpiresAt: new Date(h.now + 60 * 60_000).toISOString()
      });
      h.fetchMock.mockRejectedValueOnce(new TypeError('offline'));
      const authFetch = buildFetch(h);
      await expect(authFetch('https://api.test/x')).rejects.toThrow(/offline/);
    });
  });
});
