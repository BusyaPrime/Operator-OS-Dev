import { randomUUID } from 'node:crypto';
import os from 'node:os';

import {
  agentRegisterRequestSchema,
  agentRegisterResponseSchema,
  type AgentRegisterResponse
} from '@operator-os/contracts';

import {
  verifyMaxSession,
  type MaxSessionPreflightOptions,
  type MaxSessionPreflightResult
} from '../agents/claude-code-agent/max-session-preflight.js';
import {
  AGENT_TOKEN_TARGET,
  type CredentialStore
} from '../auth/credential-store.js';

/**
 * Phase 4.0 Part 4.B — registration CLI.
 *
 * Run from the user's shell exactly once per machine:
 *
 *   pnpm --filter @operator-os/desktop-agent register
 *
 * Flow:
 *
 *   1. Pre-flight: confirm the Claude CLI is logged in via
 *      OAuth (`~/.claude/.credentials.json` carries
 *      `claudeAiOauth`). The agent's WS path needs the Max
 *      session to spawn the `claude` subprocess; if it's
 *      missing we surface the failure NOW, not on first
 *      task.
 *
 *   2. UX: ask for a user JWT (paste from the mobile app or
 *      the gateway sign-in flow), validate the shape (three
 *      dot-separated base64 chunks).
 *
 *   3. Generate machine identity: randomUUID() agentId,
 *      hostname → machineName (sanitised to printable ASCII
 *      to satisfy the contracts schema).
 *
 *   4. POST /v1/agent/register with the user JWT and the
 *      generated identity. The api validates the user JWT,
 *      mints the per-machine token, persists the bcrypt hash,
 *      returns the raw token in the response body.
 *
 *   5. Store the raw token in the Credential Manager (DPAPI
 *      file under %APPDATA%) at `OperatorOS:agent-token`.
 *
 *   6. Self-test: GET /v1/agent/{id}/status with the user
 *      JWT, verify the api confirms the agent is registered.
 *      This catches API URL typos / network blackholes
 *      before the user reboots and the auto-start kicks in.
 *
 *   7. Print success summary and exit 0.
 *
 * Every external dependency (stdin/stdout, fetch, the
 * credential store, the Max-session preflight, the agentId
 * generator, the hostname source) is injectable so this
 * function is unit-testable end-to-end without a real Windows
 * keychain or a real network round-trip.
 */

export interface RegisterCliIo {
  /** Reads one line from stdin (with the trailing newline stripped). */
  readonly readLine: (prompt: string) => Promise<string>;
  /** Writes a status line to stdout (newline appended). */
  readonly writeLine: (line: string) => void;
  /** Writes a status line to stderr (newline appended). */
  readonly writeErrLine: (line: string) => void;
}

export interface RegisterCliOptions {
  readonly io: RegisterCliIo;
  readonly fetch: typeof globalThis.fetch;
  readonly credentialStore: CredentialStore;
  /** Override for tests. Default: `() => randomUUID()`. */
  readonly makeAgentId?: () => string;
  /** Override for tests. Default: `os.hostname()`. */
  readonly readHostname?: () => string;
  /** Override for tests. Default: `process.env`. */
  readonly env?: Record<string, string | undefined>;
  /**
   * Override for tests. Default invokes the real preflight,
   * which reads `~/.claude/.credentials.json`. Tests pass a
   * fake that resolves to a known good shape OR throws to
   * exercise the failure UX.
   */
  readonly maxSessionPreflight?:
    | false
    | MaxSessionPreflightOptions
    | (() => Promise<MaxSessionPreflightResult>);
}

export interface RegisterCliResult {
  readonly exitCode: number;
  readonly agentId?: string;
}

const DEFAULT_API_BASE_URL = 'http://localhost:8080';
const DEFAULT_CAPABILITIES: ReadonlyArray<string> = ['code-generation'];

/**
 * Sanitise a hostname into a printable-ASCII machine name.
 * Strips control chars, replaces non-Latin / non-printable
 * bytes with '-'. Caps at 100 chars per the contracts schema.
 */
const normaliseHostname = (raw: string): string => {
  const ascii = raw
    .replace(/[^\x20-\x7E]/g, '-') // non-printable-ASCII → '-'
    .replace(/\s+/g, '-') // whitespace → '-'
    .replace(/-+/g, '-') // collapse runs of '-'
    .replace(/^-|-$/g, ''); // trim leading/trailing '-'
  const trimmed = ascii.length === 0 ? 'unnamed-host' : ascii;
  return trimmed.slice(0, 100);
};

const looksLikeJwt = (value: string): boolean => {
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  return parts.every((part) => /^[A-Za-z0-9_-]+$/u.test(part));
};

const decodeJwtPayload = (jwt: string): Record<string, unknown> | null => {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1]! + '='.repeat((4 - (parts[1]!.length % 4)) % 4);
    const json = Buffer.from(
      padded.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf-8');
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const runRegisterCli = async (
  options: RegisterCliOptions
): Promise<RegisterCliResult> => {
  const { io, credentialStore, fetch: fetchFn } = options;
  const env = options.env ?? process.env;
  const makeAgentId = options.makeAgentId ?? randomUUID;
  const readHostname = options.readHostname ?? os.hostname;

  io.writeLine('Operator OS — desktop agent registration');
  io.writeLine('');

  // 1. Pre-flight: Max session check.
  io.writeLine('[1/6] Checking Claude Max session ...');
  const preflight = options.maxSessionPreflight ?? {};
  if (preflight !== false) {
    try {
      const result =
        typeof preflight === 'function'
          ? await preflight()
          : await verifyMaxSession(preflight);
      const expiresIn = result.expiresInSeconds;
      if (expiresIn < 0) {
        io.writeLine(
          '   warn: OAuth access token already expired; the CLI will refresh on first call'
        );
      } else if (expiresIn < 24 * 60 * 60) {
        io.writeLine(
          `   warn: OAuth access token expires in ${Math.floor(expiresIn / 60)}m`
        );
      }
      io.writeLine(`   ok — credentials at ${result.path}`);
    } catch (err) {
      io.writeErrLine('   FAIL — Claude Max OAuth session unavailable.');
      io.writeErrLine(
        `   ${err instanceof Error ? err.message : String(err)}`
      );
      io.writeErrLine(
        '   Run `claude` once interactively, complete OAuth login, then re-run register.'
      );
      return { exitCode: 1 };
    }
  }
  io.writeLine('');

  // 2. Backend URL.
  const defaultUrl =
    env.API_BASE_URL && env.API_BASE_URL.length > 0
      ? env.API_BASE_URL
      : DEFAULT_API_BASE_URL;
  io.writeLine('[2/6] Backend URL');
  const urlAnswer = (
    await io.readLine(`   API base URL [${defaultUrl}]: `)
  ).trim();
  const apiBaseUrl =
    urlAnswer.length > 0 ? urlAnswer.replace(/\/$/, '') : defaultUrl;
  if (!/^https?:\/\//.test(apiBaseUrl)) {
    io.writeErrLine(
      `   FAIL — API base URL must start with http:// or https:// (got: ${apiBaseUrl})`
    );
    return { exitCode: 1 };
  }
  io.writeLine(`   using ${apiBaseUrl}`);
  io.writeLine('');

  // 3. User JWT.
  io.writeLine('[3/6] User JWT');
  io.writeLine(
    '   Paste a user JWT from the mobile app or the gateway sign-in flow.'
  );
  const jwt = (await io.readLine('   user JWT: ')).trim();
  if (!looksLikeJwt(jwt)) {
    io.writeErrLine(
      '   FAIL — value does not look like a JWT (expected three dot-separated base64url parts).'
    );
    return { exitCode: 1 };
  }
  const payload = decodeJwtPayload(jwt);
  if (payload === null) {
    io.writeErrLine('   FAIL — JWT payload did not parse as JSON.');
    return { exitCode: 1 };
  }
  const exp = typeof payload.exp === 'number' ? payload.exp : null;
  if (exp !== null && exp * 1000 <= Date.now()) {
    io.writeErrLine(
      '   FAIL — JWT is already expired. Sign in fresh on the mobile app.'
    );
    return { exitCode: 1 };
  }
  const operatorId =
    typeof payload.operatorId === 'string'
      ? payload.operatorId
      : typeof payload.sub === 'string'
        ? payload.sub
        : null;
  if (operatorId === null || operatorId.length === 0) {
    io.writeErrLine(
      '   FAIL — JWT payload has neither `operatorId` nor `sub` — cannot identify owner.'
    );
    return { exitCode: 1 };
  }
  io.writeLine(`   ok — operator ${operatorId}`);
  io.writeLine('');

  // 4. Machine identity.
  io.writeLine('[4/6] Machine identity');
  const machineName = normaliseHostname(readHostname());
  const agentId = makeAgentId();
  const registerBody = agentRegisterRequestSchema.parse({
    agentId,
    machineName,
    capabilities: [...DEFAULT_CAPABILITIES]
  });
  io.writeLine(`   agentId    ${agentId}`);
  io.writeLine(`   machine    ${machineName}`);
  io.writeLine(`   capabilities  ${registerBody.capabilities.join(', ')}`);
  io.writeLine('');

  // 5. POST /v1/agent/register.
  io.writeLine('[5/6] Registering with the api ...');
  let registerResult: AgentRegisterResponse;
  try {
    const response = await fetchFn(`${apiBaseUrl}/v1/agent/register`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${jwt}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(registerBody)
    });
    if (!response.ok) {
      const text = await safeReadText(response);
      io.writeErrLine(
        `   FAIL — POST /v1/agent/register returned ${response.status}`
      );
      if (text.length > 0) io.writeErrLine(`   body: ${text.slice(0, 500)}`);
      return { exitCode: 1 };
    }
    const json = await response.json();
    registerResult = agentRegisterResponseSchema.parse(json);
  } catch (err) {
    io.writeErrLine(
      `   FAIL — register request errored: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return { exitCode: 1 };
  }
  io.writeLine(`   ok — agentToken issued at ${registerResult.tokenIssuedAt}`);
  io.writeLine('');

  // 6. Store + self-test.
  io.writeLine('[6/6] Storing token and running self-test ...');
  try {
    await credentialStore.storeToken(
      AGENT_TOKEN_TARGET,
      registerResult.agentToken
    );
  } catch (err) {
    io.writeErrLine(
      `   FAIL — could not store agent token in Credential Manager: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return { exitCode: 1 };
  }
  io.writeLine(`   stored at credential target ${AGENT_TOKEN_TARGET}`);

  // Self-test: GET /v1/agent/{id}/status with the user JWT.
  // Confirms the api can find the agent we just registered.
  // Doesn't exercise the agent token yet — that lands in
  // Part 4.E when the WS reads from the credential store.
  try {
    const response = await fetchFn(
      `${apiBaseUrl}/v1/agent/${registerResult.agentId}/status`,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${jwt}` }
      }
    );
    if (!response.ok) {
      io.writeErrLine(
        `   FAIL — self-test GET /v1/agent/${registerResult.agentId}/status returned ${response.status}`
      );
      io.writeErrLine(
        '   The token IS stored locally; you may proceed but expect issues until the api state catches up.'
      );
      return { exitCode: 1 };
    }
    const status = (await response.json()) as { agentId?: unknown };
    if (status.agentId !== registerResult.agentId) {
      io.writeErrLine(
        `   FAIL — self-test response agentId did not match (got ${String(status.agentId)})`
      );
      return { exitCode: 1 };
    }
  } catch (err) {
    io.writeErrLine(
      `   FAIL — self-test errored: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return { exitCode: 1 };
  }
  io.writeLine('   self-test passed.');
  io.writeLine('');

  io.writeLine('Done.');
  io.writeLine(`  agentId  ${registerResult.agentId}`);
  io.writeLine(`  api      ${apiBaseUrl}`);
  io.writeLine('');
  io.writeLine(
    'Next: configure auto-start (see scripts/install-agent-autostart.ps1 — Phase 4.0 Part 6).'
  );

  return { exitCode: 0, agentId: registerResult.agentId };
};

const safeReadText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};
