import * as SecureStore from 'expo-secure-store';

/**
 * Namespace for the refresh-token keychain entry. Stable across
 * app versions; changing it invalidates existing sessions.
 */
const REFRESH_TOKEN_KEY = 'operator-os-auth.refreshToken';

/**
 * Thin secure-storage interface used by the mobile auth layer.
 * Only the *refresh* token is persisted to disk — access tokens
 * live in memory only (auth-store) so a compromised backup can
 * never yield a usable bearer. See Phase 1.5 TZ §1.4 / §3.3.
 *
 * The module wraps expo-secure-store so tests can fake it via
 * `vi.mock('expo-secure-store', ...)` without touching the real
 * keychain and so unit tests stay fast.
 *
 * Errors: expo-secure-store throws on platforms that don't
 * support the feature (e.g. web browsers during dev). Every
 * helper here catches that and resolves to a safe default — a
 * missing token looks the same as "no session yet", which is
 * exactly what the caller needs to render the SignInScreen.
 */

export interface TokenStorage {
  readRefreshToken(): Promise<string | undefined>;
  writeRefreshToken(token: string): Promise<void>;
  clearRefreshToken(): Promise<void>;
}

/**
 * Default implementation backed by `expo-secure-store`. Keep the
 * constructor parameter-free so it can be exported as a
 * singleton and mocked via module-level import injection.
 */
export const tokenStorage: TokenStorage = {
  async readRefreshToken(): Promise<string | undefined> {
    try {
      const value = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      return value ?? undefined;
    } catch {
      // Platform unavailable / keychain locked — treat as "no session".
      // Deliberately no log here: we don't want refresh-token
      // debugging to accidentally surface the token value.
      return undefined;
    }
  },

  async writeRefreshToken(token: string): Promise<void> {
    if (token.length === 0) {
      // Avoid persisting an empty string and later treating it
      // as a valid session. Callers should pass the actual token.
      throw new Error('tokenStorage.writeRefreshToken: empty token');
    }
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
  },

  async clearRefreshToken(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    } catch {
      // Best-effort clear — if the keychain was already empty or
      // the platform can't reach it, we've still done our job.
    }
  }
};

/** Exported for tests that want to assert against the raw key. */
export const TOKEN_STORAGE_KEYS = {
  refreshToken: REFRESH_TOKEN_KEY
} as const;
