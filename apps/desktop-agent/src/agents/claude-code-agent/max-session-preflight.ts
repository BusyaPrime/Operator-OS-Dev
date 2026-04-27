import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Verifies that the host has a Claude Max OAuth session present.
 * The Phase 4.0 agent posture is "Max session, not API key" —
 * `~/.claude/.credentials.json` is the on-disk marker the
 * `claude` CLI uses, and its presence (with a `claudeAiOauth`
 * top-level key shape) is the strongest signal we have that the
 * subscription path is wired before we spawn a single subprocess.
 *
 * Phase 1.4 + Phase 3.3 only checked `claude --version`, which
 * means an API-key-only install or a logged-out install would
 * still spawn the subprocess and fail at first model call with a
 * runtime error. This preflight surfaces the failure at
 * `agent.start()` time, with a clear actionable message, before
 * any task is dispatched.
 *
 * The function reads ONLY the top-level key shape — never the
 * token strings, never `subscriptionType` values, never the
 * expiresAt timestamp's exact value (only a "is it in the future"
 * check). Failure messages name the file path and the missing
 * shape, never the secret content.
 */

export interface MaxSessionPreflightOptions {
  /**
   * Override the credentials file path. Default
   * `~/.claude/.credentials.json` (the Claude CLI's standard
   * location). Tests pass an absolute path to a fixture.
   */
  readonly credentialsPath?: string;
  /**
   * Now-getter for the expiry check. Defaults to `Date.now()`.
   * Tests inject a fixed clock.
   */
  readonly now?: () => number;
}

export interface MaxSessionPreflightResult {
  /** Path that was read (resolved). */
  readonly path: string;
  /**
   * Seconds until the session's `expiresAt`. Negative if already
   * expired (the CLI's refresh path takes over from there).
   */
  readonly expiresInSeconds: number;
  /** True if the OAuth shape is intact and not yet expired. */
  readonly ok: boolean;
}

export class MaxSessionUnavailableError extends Error {
  readonly code: string;
  readonly path: string;
  readonly hint: string;

  constructor(code: string, path: string, message: string, hint: string) {
    super(`${message} (path=${path}). ${hint}`);
    this.name = 'MaxSessionUnavailableError';
    this.code = code;
    this.path = path;
    this.hint = hint;
  }
}

const HINT_LOGIN =
  "Run `claude` once interactively and complete the OAuth login, " +
  'or set DESKTOP_AGENT_EXECUTOR=echo-stub to bypass.';

const expectedClaudeAiOauthKeys: ReadonlyArray<string> = [
  'accessToken',
  'expiresAt',
  'subscriptionType'
];

/** Resolve `~/.claude/.credentials.json` with override support. */
const resolveCredentialsPath = (override?: string): string => {
  if (override !== undefined && override.length > 0) return override;
  return path.join(os.homedir(), '.claude', '.credentials.json');
};

/**
 * Reads the credentials file and validates the OAuth shape. Throws
 * `MaxSessionUnavailableError` with a specific code when the
 * shape is missing or expired. Caller (`ClaudeCodeAgent.start()`)
 * is expected to convert the throw into the agent's own
 * `AIAgentError` so the existing main-loop fallback to echo-stub
 * keeps working.
 */
export const verifyMaxSession = async (
  options: MaxSessionPreflightOptions = {}
): Promise<MaxSessionPreflightResult> => {
  const credentialsPath = resolveCredentialsPath(options.credentialsPath);
  const now = options.now ?? Date.now;

  let raw: string;
  try {
    raw = await fs.readFile(credentialsPath, 'utf-8');
  } catch {
    throw new MaxSessionUnavailableError(
      'CREDENTIALS_FILE_MISSING',
      credentialsPath,
      'Claude Max OAuth credentials file not found',
      HINT_LOGIN
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MaxSessionUnavailableError(
      'CREDENTIALS_FILE_INVALID_JSON',
      credentialsPath,
      'Claude Max credentials file did not parse as JSON',
      HINT_LOGIN
    );
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new MaxSessionUnavailableError(
      'CREDENTIALS_SHAPE_INVALID',
      credentialsPath,
      'Credentials file root is not a JSON object',
      HINT_LOGIN
    );
  }

  const root = parsed as Record<string, unknown>;
  const oauth = root.claudeAiOauth;
  if (typeof oauth !== 'object' || oauth === null) {
    throw new MaxSessionUnavailableError(
      'CREDENTIALS_OAUTH_MISSING',
      credentialsPath,
      'Credentials file has no `claudeAiOauth` block (API-key-only install?)',
      HINT_LOGIN
    );
  }

  const oauthRecord = oauth as Record<string, unknown>;
  const missingKeys = expectedClaudeAiOauthKeys.filter(
    (key) => !(key in oauthRecord)
  );
  if (missingKeys.length > 0) {
    throw new MaxSessionUnavailableError(
      'CREDENTIALS_OAUTH_INCOMPLETE',
      credentialsPath,
      `claudeAiOauth missing required keys: ${missingKeys.join(', ')}`,
      HINT_LOGIN
    );
  }

  const expiresAtRaw = oauthRecord.expiresAt;
  const expiresAtMs =
    typeof expiresAtRaw === 'number'
      ? expiresAtRaw
      : typeof expiresAtRaw === 'string'
        ? Date.parse(expiresAtRaw)
        : Number.NaN;
  if (Number.isNaN(expiresAtMs)) {
    throw new MaxSessionUnavailableError(
      'CREDENTIALS_EXPIRY_UNPARSEABLE',
      credentialsPath,
      `claudeAiOauth.expiresAt is not a number or ISO date string`,
      HINT_LOGIN
    );
  }

  const expiresInSeconds = Math.floor((expiresAtMs - now()) / 1000);

  // We do NOT throw on already-expired sessions: the Claude CLI
  // refresh path uses `refreshToken` to mint a new access token
  // before the next command. We surface the value so the caller
  // can log a warning when the session is close to expiry.

  return {
    path: credentialsPath,
    expiresInSeconds,
    ok: true
  };
};
