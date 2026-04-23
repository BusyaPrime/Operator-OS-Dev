import type { OperatorUser, SigninResponse } from '@operator-os/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// auth-store transitively imports google-signin.ts, which tries to
// load the native Google Sign-In module at import time. Mock it at
// the module level so vitest (Node) doesn't choke on RN-only paths.
vi.mock('@react-native-google-signin/google-signin', () => ({
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
    SIGN_IN_REQUIRED: 'SIGN_IN_REQUIRED',
    NULL_PRESENTER: 'NULL_PRESENTER'
  },
  GoogleSignin: {
    configure: vi.fn(),
    hasPlayServices: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn()
  },
  isErrorWithCode: (err: unknown): err is { code: string; message: string } =>
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined)
}));

import type { GoogleSignInModule } from '../auth/google-signin.js';
import type { TokenStorage } from '../auth/token-storage.js';
import type { AuthClient } from '../services/auth-client.js';
import { createAuthStore, type AuthStoreDeps } from './auth-store.js';
import { AuthClientError } from '../services/auth-client.js';

const fixtureUser: OperatorUser = {
  id: 'user-1',
  googleSubject: 'google-sub-1',
  email: 'u@example.com',
  displayName: 'U',
  roles: ['owner'],
  plan: 'free',
  createdAt: '2026-04-24T00:00:00.000Z',
  updatedAt: '2026-04-24T00:00:00.000Z'
};

const fixtureSignin: SigninResponse = {
  accessToken: 'at-abc',
  refreshToken: 'rt-abc',
  accessTokenExpiresAt: '2026-04-24T01:00:00.000Z',
  refreshTokenExpiresAt: '2026-05-24T00:00:00.000Z',
  user: fixtureUser
};

interface Harness {
  deps: AuthStoreDeps;
  authClient: {
    signin: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    signout: ReturnType<typeof vi.fn>;
  };
  tokenStorage: {
    readRefreshToken: ReturnType<typeof vi.fn>;
    writeRefreshToken: ReturnType<typeof vi.fn>;
    clearRefreshToken: ReturnType<typeof vi.fn>;
  };
  googleSignIn: {
    configure: ReturnType<typeof vi.fn>;
    isConfigured: ReturnType<typeof vi.fn>;
    signIn: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
  };
}

const buildHarness = (): Harness => {
  const authClient = {
    signin: vi.fn(),
    refresh: vi.fn(),
    signout: vi.fn().mockResolvedValue(undefined)
  };
  const tokenStorage = {
    readRefreshToken: vi.fn().mockResolvedValue(undefined),
    writeRefreshToken: vi.fn().mockResolvedValue(undefined),
    clearRefreshToken: vi.fn().mockResolvedValue(undefined)
  };
  const googleSignIn = {
    configure: vi.fn(),
    isConfigured: vi.fn().mockReturnValue(true),
    signIn: vi.fn(),
    signOut: vi.fn().mockResolvedValue(undefined)
  };
  return {
    deps: {
      authClient: authClient as unknown as AuthClient,
      tokenStorage: tokenStorage as unknown as TokenStorage,
      googleSignIn: googleSignIn as unknown as GoogleSignInModule
    },
    authClient,
    tokenStorage,
    googleSignIn
  };
};

describe('auth-store', () => {
  let h: Harness;

  beforeEach(() => {
    h = buildHarness();
  });

  describe('initial state', () => {
    it('starts in "unknown" with no tokens or user', () => {
      const store = createAuthStore(h.deps);
      const state = store.getState();
      expect(state.status).toBe('unknown');
      expect(state.accessToken).toBeUndefined();
      expect(state.user).toBeUndefined();
      expect(state.error).toBeUndefined();
    });
  });

  describe('bootstrap()', () => {
    it('lands on unauthenticated when no refresh token exists', async () => {
      h.tokenStorage.readRefreshToken.mockResolvedValueOnce(undefined);
      const store = createAuthStore(h.deps);
      await store.getState().bootstrap();
      expect(store.getState().status).toBe('unauthenticated');
      expect(h.authClient.refresh).not.toHaveBeenCalled();
    });

    it('refreshes the session when a stored token is present', async () => {
      h.tokenStorage.readRefreshToken.mockResolvedValueOnce('rt-stored');
      h.authClient.refresh.mockResolvedValueOnce({
        accessToken: 'at-new',
        refreshToken: 'rt-new',
        accessTokenExpiresAt: '2026-04-24T02:00:00.000Z',
        refreshTokenExpiresAt: '2026-05-24T00:00:00.000Z'
      });
      const store = createAuthStore(h.deps);
      await store.getState().bootstrap();
      expect(h.authClient.refresh).toHaveBeenCalledWith('rt-stored');
      expect(h.tokenStorage.writeRefreshToken).toHaveBeenCalledWith('rt-new');
      const state = store.getState();
      expect(state.status).toBe('authenticated');
      expect(state.accessToken).toBe('at-new');
      expect(state.accessTokenExpiresAt).toBe('2026-04-24T02:00:00.000Z');
    });

    it('wipes storage + lands on unauthenticated on refresh failure', async () => {
      h.tokenStorage.readRefreshToken.mockResolvedValueOnce('rt-expired');
      h.authClient.refresh.mockRejectedValueOnce(
        new AuthClientError('invalid-credentials', 'revoked')
      );
      const store = createAuthStore(h.deps);
      await store.getState().bootstrap();
      expect(h.tokenStorage.clearRefreshToken).toHaveBeenCalledOnce();
      const state = store.getState();
      expect(state.status).toBe('unauthenticated');
      expect(state.error?.code).toBe('invalid-credentials');
    });
  });

  describe('signInWithGoogleIdToken()', () => {
    it('happy path → authenticated, refresh persisted, user in memory', async () => {
      h.authClient.signin.mockResolvedValueOnce(fixtureSignin);
      const store = createAuthStore(h.deps);
      await store.getState().signInWithGoogleIdToken('id-token');
      expect(h.authClient.signin).toHaveBeenCalledWith('id-token');
      expect(h.tokenStorage.writeRefreshToken).toHaveBeenCalledWith('rt-abc');
      const state = store.getState();
      expect(state.status).toBe('authenticated');
      expect(state.accessToken).toBe('at-abc');
      expect(state.user?.email).toBe('u@example.com');
      expect(state.error).toBeUndefined();
    });

    it('lands in "error" on auth-client failure', async () => {
      h.authClient.signin.mockRejectedValueOnce(
        new AuthClientError('network', 'offline')
      );
      const store = createAuthStore(h.deps);
      await store.getState().signInWithGoogleIdToken('id-token');
      const state = store.getState();
      expect(state.status).toBe('error');
      expect(state.error?.code).toBe('network');
      expect(h.tokenStorage.writeRefreshToken).not.toHaveBeenCalled();
    });

    it('transitions through "authenticating" before resolving', async () => {
      let resolve!: (r: SigninResponse) => void;
      h.authClient.signin.mockReturnValueOnce(
        new Promise((r) => {
          resolve = r;
        })
      );
      const store = createAuthStore(h.deps);
      const pending = store.getState().signInWithGoogleIdToken('id-token');
      // Allow the initial set() to run.
      await Promise.resolve();
      expect(store.getState().status).toBe('authenticating');
      resolve(fixtureSignin);
      await pending;
      expect(store.getState().status).toBe('authenticated');
    });
  });

  describe('signOut()', () => {
    it('revokes server-side, signs out of Google, clears storage + memory', async () => {
      h.tokenStorage.readRefreshToken.mockResolvedValueOnce('rt-abc');
      const store = createAuthStore(h.deps);
      // Put the store in an authenticated state first.
      h.authClient.signin.mockResolvedValueOnce(fixtureSignin);
      await store.getState().signInWithGoogleIdToken('id-token');

      await store.getState().signOut();

      expect(h.authClient.signout).toHaveBeenCalled();
      expect(h.googleSignIn.signOut).toHaveBeenCalled();
      expect(h.tokenStorage.clearRefreshToken).toHaveBeenCalled();
      const state = store.getState();
      expect(state.status).toBe('unauthenticated');
      expect(state.accessToken).toBeUndefined();
      expect(state.user).toBeUndefined();
    });

    it('still clears local state when the revoke RPC fails', async () => {
      h.tokenStorage.readRefreshToken.mockResolvedValueOnce('rt-abc');
      h.authClient.signout.mockRejectedValueOnce(
        new AuthClientError('network', 'offline')
      );
      const store = createAuthStore(h.deps);
      await store.getState().signOut();
      expect(h.tokenStorage.clearRefreshToken).toHaveBeenCalled();
      expect(store.getState().status).toBe('unauthenticated');
    });

    it('still clears local state when the Google signOut throws', async () => {
      h.tokenStorage.readRefreshToken.mockResolvedValueOnce('rt-abc');
      h.googleSignIn.signOut.mockRejectedValueOnce(new Error('boom'));
      const store = createAuthStore(h.deps);
      await store.getState().signOut();
      expect(store.getState().status).toBe('unauthenticated');
    });
  });

  describe('forceSignOut()', () => {
    it('skips the revoke RPC and sets a session-expired error banner', async () => {
      const store = createAuthStore(h.deps);
      await store.getState().forceSignOut();
      expect(h.authClient.signout).not.toHaveBeenCalled();
      expect(h.tokenStorage.clearRefreshToken).toHaveBeenCalled();
      expect(h.googleSignIn.signOut).toHaveBeenCalled();
      const state = store.getState();
      expect(state.status).toBe('unauthenticated');
      expect(state.error?.code).toBe('session-expired');
    });
  });

  describe('applyRefreshedTokens()', () => {
    it('updates access token + expires without touching user/refresh', async () => {
      h.authClient.signin.mockResolvedValueOnce(fixtureSignin);
      const store = createAuthStore(h.deps);
      await store.getState().signInWithGoogleIdToken('id-token');

      store
        .getState()
        .applyRefreshedTokens('at-rotated', '2026-04-24T03:00:00.000Z');

      const state = store.getState();
      expect(state.accessToken).toBe('at-rotated');
      expect(state.accessTokenExpiresAt).toBe('2026-04-24T03:00:00.000Z');
      expect(state.user?.email).toBe('u@example.com');
      expect(state.status).toBe('authenticated');
    });
  });

  describe('clearError()', () => {
    it('moves error → unauthenticated when parked on error', async () => {
      h.authClient.signin.mockRejectedValueOnce(
        new AuthClientError('bad-request', 'bad idtoken')
      );
      const store = createAuthStore(h.deps);
      await store.getState().signInWithGoogleIdToken('x');
      expect(store.getState().status).toBe('error');
      store.getState().clearError();
      expect(store.getState().status).toBe('unauthenticated');
      expect(store.getState().error).toBeUndefined();
    });

    it('drops the error banner without status change when authenticated', async () => {
      h.authClient.signin.mockResolvedValueOnce(fixtureSignin);
      const store = createAuthStore(h.deps);
      await store.getState().signInWithGoogleIdToken('id-token');
      // Manually stamp an error (e.g. from a transient refresh warning).
      store.setState({ error: { code: 'warn', message: 'noise' } });
      store.getState().clearError();
      expect(store.getState().status).toBe('authenticated');
      expect(store.getState().error).toBeUndefined();
    });
  });
});
