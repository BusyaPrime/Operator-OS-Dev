import {
  refreshResponseSchema,
  signinResponseSchema,
  type RefreshResponse,
  type SigninResponse
} from '@operator-os/contracts';

/**
 * Error class for all auth-client failures. Callers branch on
 * `code` (not message strings) when deciding to re-prompt the
 * user vs. force sign-out.
 *
 * Codes surfaced:
 *   network           — fetch threw (offline / DNS / CORS)
 *   timeout           — AbortController fired
 *   invalid-credentials — 401 from gateway (bad / expired refresh)
 *   bad-request       — 400 (e.g. malformed idToken)
 *   server            — 5xx
 *   malformed-response — 2xx but Zod rejected the body shape
 *   unknown           — anything else
 */
export type AuthClientErrorCode =
  | 'network'
  | 'timeout'
  | 'invalid-credentials'
  | 'bad-request'
  | 'server'
  | 'malformed-response'
  | 'unknown';

export class AuthClientError extends Error {
  readonly code: AuthClientErrorCode;
  readonly status?: number;

  constructor(code: AuthClientErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'AuthClientError';
    this.code = code;
    this.status = status;
  }
}

export interface AuthClientOptions {
  readonly gatewayBaseUrl: string;
  readonly timeoutMs?: number;
  /** Injectable for tests — defaults to `globalThis.fetch`. */
  readonly fetchFn?: typeof fetch;
}

export interface AuthClient {
  signin(idToken: string): Promise<SigninResponse>;
  refresh(refreshToken: string): Promise<RefreshResponse>;
  signout(refreshToken: string): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export const createAuthClient = (options: AuthClientOptions): AuthClient => {
  const baseUrl = options.gatewayBaseUrl.replace(/\/$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchFn = options.fetchFn ?? globalThis.fetch;

  const post = async (path: string, body: unknown): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchFn(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        throw new AuthClientError(
          'timeout',
          `auth-gateway ${path} timed out after ${timeoutMs}ms`
        );
      }
      // Anything else thrown by fetch is a network-layer failure
      // (offline, DNS, TLS). Surface as `network` so callers can
      // show an "offline" UI instead of a generic error.
      throw new AuthClientError(
        'network',
        `auth-gateway ${path} unreachable: ${errorMessage(err)}`
      );
    } finally {
      clearTimeout(timer);
    }
  };

  const raiseFor = (path: string, status: number): never => {
    if (status === 401) {
      throw new AuthClientError(
        'invalid-credentials',
        `auth-gateway ${path} rejected credentials`,
        status
      );
    }
    if (status === 400) {
      throw new AuthClientError(
        'bad-request',
        `auth-gateway ${path} rejected request body`,
        status
      );
    }
    if (status >= 500) {
      throw new AuthClientError(
        'server',
        `auth-gateway ${path} returned ${status}`,
        status
      );
    }
    throw new AuthClientError(
      'unknown',
      `auth-gateway ${path} returned unexpected status ${status}`,
      status
    );
  };

  const parseOrThrow = <T>(
    path: string,
    parser: { parse(input: unknown): T },
    body: unknown
  ): T => {
    try {
      return parser.parse(body);
    } catch (err) {
      throw new AuthClientError(
        'malformed-response',
        `auth-gateway ${path} response did not match schema: ${errorMessage(err)}`
      );
    }
  };

  return {
    async signin(idToken: string): Promise<SigninResponse> {
      // idToken is Zod-sanitised server-side; mobile sends the raw
      // string as the user's device produced it (trim/newline
      // scrubbing happens at the gateway per TD-013).
      const response = await post('/v1/auth/signin', { idToken });
      if (!response.ok) raiseFor('/v1/auth/signin', response.status);
      const body = await response.json().catch(() => undefined);
      return parseOrThrow('/v1/auth/signin', signinResponseSchema, body);
    },

    async refresh(refreshToken: string): Promise<RefreshResponse> {
      const response = await post('/v1/auth/refresh', { refreshToken });
      if (!response.ok) raiseFor('/v1/auth/refresh', response.status);
      const body = await response.json().catch(() => undefined);
      return parseOrThrow('/v1/auth/refresh', refreshResponseSchema, body);
    },

    async signout(refreshToken: string): Promise<void> {
      const response = await post('/v1/auth/signout', { refreshToken });
      // Gateway returns 204 on success; a 401 here means the
      // token was already revoked — that's effectively a
      // success from the caller's perspective, so we treat both
      // 204 and 401 as "session ended".
      if (response.status === 204 || response.status === 401) return;
      if (!response.ok) raiseFor('/v1/auth/signout', response.status);
    }
  };
};

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
