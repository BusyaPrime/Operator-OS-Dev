import type { TokenStorage } from '../auth/token-storage.js';

import {
  AuthClientError,
  type AuthClient
} from './auth-client.js';

/**
 * Surface of the auth store that the authenticated fetch needs.
 * Kept narrow so tests can hand over a plain object — no need to
 * construct a real zustand instance to exercise the refresh path.
 */
export interface AuthenticatedFetchAuthStore {
  getState(): {
    readonly accessToken?: string;
    readonly accessTokenExpiresAt?: string;
  };
  applyRefreshedTokens(
    accessToken: string,
    accessTokenExpiresAt: string
  ): void;
  forceSignOut(): Promise<void>;
}

export interface AuthenticatedFetchOptions {
  readonly authStore: AuthenticatedFetchAuthStore;
  readonly authClient: AuthClient;
  readonly tokenStorage: TokenStorage;
  /** Inject a fetch impl for tests. Defaults to globalThis.fetch. */
  readonly fetchFn?: typeof fetch;
  /**
   * If the access token expires within this window, refresh
   * proactively before sending. Default 5 minutes.
   */
  readonly expiryBufferMs?: number;
  /** Inject a clock for tests. Defaults to Date.now. */
  readonly now?: () => number;
}

const DEFAULT_EXPIRY_BUFFER_MS = 5 * 60 * 1_000;

/**
 * Build a fetch-compatible function that:
 *
 *  1. Attaches `Authorization: Bearer <accessToken>` when a token
 *     is available.
 *  2. Proactively refreshes when the cached token is within
 *     `expiryBufferMs` of expiring. This keeps background
 *     requests from paying a 401/refresh round-trip right when
 *     the user triggers them.
 *  3. On 401 response with a bearer attached: refresh once,
 *     retry the same request. If the refresh itself 401s or
 *     the second attempt also 401s, force sign-out — the
 *     server has repudiated the session.
 *  4. Any non-auth error propagates unchanged (the wrapper is
 *     auth-specific, not a general resilience layer).
 *
 * The returned function is shape-compatible with `globalThis.fetch`
 * so existing `api-client.ts` can opt in by swapping `fetch` for
 * `createAuthenticatedFetch(deps)`.
 */
export const createAuthenticatedFetch = (
  options: AuthenticatedFetchOptions
): typeof fetch => {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const expiryBufferMs = options.expiryBufferMs ?? DEFAULT_EXPIRY_BUFFER_MS;
  const now = options.now ?? (() => Date.now());

  const shouldPreRefresh = (): boolean => {
    const state = options.authStore.getState();
    if (!state.accessToken || !state.accessTokenExpiresAt) return false;
    const expires = Date.parse(state.accessTokenExpiresAt);
    if (Number.isNaN(expires)) return false;
    return expires - now() < expiryBufferMs;
  };

  const refreshAccessToken = async (): Promise<string | undefined> => {
    const refreshToken = await options.tokenStorage.readRefreshToken();
    if (refreshToken === undefined) {
      // No refresh token means we never had a session to extend.
      // Caller decides whether to force sign-out (on a 401) or
      // just fire the request without auth.
      return undefined;
    }
    try {
      const response = await options.authClient.refresh(refreshToken);
      await options.tokenStorage.writeRefreshToken(response.refreshToken);
      options.authStore.applyRefreshedTokens(
        response.accessToken,
        response.accessTokenExpiresAt
      );
      return response.accessToken;
    } catch (err) {
      if (
        err instanceof AuthClientError &&
        err.code === 'invalid-credentials'
      ) {
        // Server dropped the refresh token. Nothing we can do —
        // kick the user back to SignInScreen.
        await options.authStore.forceSignOut();
      }
      throw err;
    }
  };

  const withAuthHeader = (init: RequestInit | undefined, token: string): RequestInit => {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return { ...init, headers };
  };

  return async (input, init) => {
    let accessToken = options.authStore.getState().accessToken;

    if (accessToken && shouldPreRefresh()) {
      const refreshed = await refreshAccessToken();
      if (refreshed !== undefined) accessToken = refreshed;
    }

    const firstInit =
      accessToken !== undefined ? withAuthHeader(init, accessToken) : init;
    const firstResponse = await fetchFn(input, firstInit);

    if (firstResponse.status !== 401 || accessToken === undefined) {
      return firstResponse;
    }

    // 401 with a bearer attached → one refresh + retry attempt.
    let retriedToken: string | undefined;
    try {
      retriedToken = await refreshAccessToken();
    } catch {
      // refreshAccessToken already called forceSignOut for
      // invalid-credentials; swallow and return the original 401
      // so the caller sees the auth failure as-is.
      return firstResponse;
    }
    if (retriedToken === undefined) {
      // No refresh token available — session is gone. Force
      // sign-out so the UI bounces to SignInScreen.
      await options.authStore.forceSignOut();
      return firstResponse;
    }

    const retriedResponse = await fetchFn(
      input,
      withAuthHeader(init, retriedToken)
    );
    if (retriedResponse.status === 401) {
      // Server said no again even with a freshly-minted token.
      // The session is unquestionably gone; force out.
      await options.authStore.forceSignOut();
    }
    return retriedResponse;
  };
};
