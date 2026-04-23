import type { OperatorUser } from '@operator-os/contracts';
import { create } from 'zustand';

import { createAuthClient, type AuthClient } from '../services/auth-client.js';
import { createGoogleSignIn, type GoogleSignInModule } from '../auth/google-signin.js';
import { tokenStorage, type TokenStorage } from '../auth/token-storage.js';

/**
 * High-level auth state the UI subscribes to.
 *
 *   unknown         — app just launched, we haven't decided yet
 *   authenticating  — an in-flight sign-in / refresh is running
 *   authenticated   — we have a valid accessToken + user
 *   unauthenticated — no session; show the SignInScreen
 *   error           — terminal failure with a user-facing message
 *
 * "unknown" is the initial state — the root navigator reads it
 * and shows an AuthLoadingScreen until bootstrap() settles.
 */
export type AuthStatus =
  | 'unknown'
  | 'authenticating'
  | 'authenticated'
  | 'unauthenticated'
  | 'error';

export interface AuthError {
  readonly code: string;
  readonly message: string;
}

export interface AuthStoreState {
  readonly status: AuthStatus;
  readonly user?: OperatorUser;
  /** Access token — MEMORY ONLY. Never persisted, never logged. */
  readonly accessToken?: string;
  readonly accessTokenExpiresAt?: string;
  readonly error?: AuthError;

  bootstrap(): Promise<void>;
  signInWithGoogleIdToken(idToken: string): Promise<void>;
  signOut(): Promise<void>;
  clearError(): void;
  /**
   * Called by the authenticated api-client after a silent refresh.
   * Tests also call this directly to assert state transitions.
   */
  applyRefreshedTokens(
    accessToken: string,
    accessTokenExpiresAt: string
  ): void;
  /** Force state reset — used when refresh fails with 401. */
  forceSignOut(): Promise<void>;
}

export interface AuthStoreDeps {
  readonly authClient: AuthClient;
  readonly tokenStorage: TokenStorage;
  readonly googleSignIn: GoogleSignInModule;
}

/**
 * Build a zustand auth-store wired to real deps by default and
 * overridable in tests. Export both the factory and a default
 * singleton (`useAuthStore`) — screens consume the singleton,
 * tests construct isolated instances via `createAuthStore`.
 */
export const createAuthStore = (deps: AuthStoreDeps) =>
  create<AuthStoreState>((set, get) => ({
    status: 'unknown',

    async bootstrap() {
      // Called once from AuthLoadingScreen on app launch. Tries
      // to restore a session using the stored refresh token; if
      // that fails for any reason, lands on unauthenticated.
      const refreshToken = await deps.tokenStorage.readRefreshToken();
      if (refreshToken === undefined) {
        set({ status: 'unauthenticated' });
        return;
      }
      set({ status: 'authenticating' });
      try {
        const response = await deps.authClient.refresh(refreshToken);
        await deps.tokenStorage.writeRefreshToken(response.refreshToken);
        set({
          status: 'authenticated',
          accessToken: response.accessToken,
          accessTokenExpiresAt: response.accessTokenExpiresAt,
          // `user` is not returned on refresh; preserve whatever
          // was in memory. bootstrap() runs at launch so `user`
          // will be undefined until a later call completes.
          error: undefined
        });
      } catch (err) {
        // Any refresh failure at launch is treated as "session
        // expired, please sign in again" — code-specific messages
        // are future polish.
        await deps.tokenStorage.clearRefreshToken();
        set({
          status: 'unauthenticated',
          accessToken: undefined,
          accessTokenExpiresAt: undefined,
          user: undefined,
          error: toAuthError(err)
        });
      }
    },

    async signInWithGoogleIdToken(idToken: string) {
      set({ status: 'authenticating', error: undefined });
      try {
        const response = await deps.authClient.signin(idToken);
        await deps.tokenStorage.writeRefreshToken(response.refreshToken);
        set({
          status: 'authenticated',
          accessToken: response.accessToken,
          accessTokenExpiresAt: response.accessTokenExpiresAt,
          user: response.user,
          error: undefined
        });
      } catch (err) {
        set({
          status: 'error',
          error: toAuthError(err)
        });
      }
    },

    async signOut() {
      // Best-effort server-side revoke. Storage + in-memory state
      // are always cleared, even if the network call fails.
      const refreshToken = await deps.tokenStorage.readRefreshToken();
      if (refreshToken !== undefined) {
        try {
          await deps.authClient.signout(refreshToken);
        } catch {
          // Intentional: even if revoke fails (offline, 5xx), we
          // still clear local state. The token will expire
          // server-side on its own schedule.
        }
      }
      try {
        await deps.googleSignIn.signOut();
      } catch {
        // Native SDK sign-out failures are non-fatal. The user
        // has already asked to be logged out; surfacing an
        // error here would be user-hostile.
      }
      await deps.tokenStorage.clearRefreshToken();
      set({
        status: 'unauthenticated',
        accessToken: undefined,
        accessTokenExpiresAt: undefined,
        user: undefined,
        error: undefined
      });
    },

    clearError() {
      const { status } = get();
      // Only clear when we're actually parked on an error; moving
      // away from 'authenticating' mid-flight would be wrong.
      if (status === 'error') {
        set({ status: 'unauthenticated', error: undefined });
      } else {
        set({ error: undefined });
      }
    },

    applyRefreshedTokens(accessToken, accessTokenExpiresAt) {
      set({
        accessToken,
        accessTokenExpiresAt,
        status: 'authenticated'
      });
    },

    async forceSignOut() {
      // Called by the authenticated api-client after it has
      // observed a refresh 401 (the server dropped our session).
      // Skip the signout RPC — it's already gone.
      try {
        await deps.googleSignIn.signOut();
      } catch {
        // swallow — see signOut() above
      }
      await deps.tokenStorage.clearRefreshToken();
      set({
        status: 'unauthenticated',
        accessToken: undefined,
        accessTokenExpiresAt: undefined,
        user: undefined,
        error: { code: 'session-expired', message: 'Please sign in again.' }
      });
    }
  }));

const toAuthError = (err: unknown): AuthError => {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'string') {
      return {
        code,
        message: err instanceof Error ? err.message : String(err)
      };
    }
  }
  return {
    code: 'unknown',
    message: err instanceof Error ? err.message : String(err)
  };
};

/**
 * Default singleton wired to real dependencies. Screens consume
 * this; tests build their own via `createAuthStore`.
 */
const defaultDeps: AuthStoreDeps = {
  authClient: createAuthClient({
    // Read at module load from the mobile env; mirrors the
    // pattern in services/api-client.ts.
    gatewayBaseUrl:
      process.env.EXPO_PUBLIC_AUTH_GATEWAY_BASE_URL ?? 'http://localhost:8081'
  }),
  tokenStorage,
  googleSignIn: createGoogleSignIn()
};

export const useAuthStore = createAuthStore(defaultDeps);
