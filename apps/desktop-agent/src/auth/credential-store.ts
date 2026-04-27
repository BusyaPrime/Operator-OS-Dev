import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';

/**
 * Phase 4.0 Part 4.A — secret-at-rest abstraction for the
 * desktop agent's per-machine API token (ADR-025 D1).
 *
 * Design choice — DPAPI-encrypted file rather than Windows
 * Credential Manager direct API:
 *
 *   The user's TZ for Part 4 listed "Native Windows API
 *   preferred, encrypted file (DPAPI) as fallback". We're
 *   shipping DPAPI-file as the primary path for Phase 4.0
 *   because:
 *
 *     - Windows Credential Manager has no first-party
 *       Node API. Reaching it requires either
 *       `node-windows-credentials` (native build deps that
 *       complicate the agent's install path) or hand-rolled
 *       FFI. Both add dependencies the agent currently
 *       doesn't have, which means more failure modes during
 *       the Part 6 install-script work.
 *
 *     - DPAPI under the hood is exactly what Credential
 *       Manager uses to encrypt secrets at rest. Calling
 *       DPAPI directly via PowerShell gives us the same
 *       per-user encryption guarantee without the
 *       indirection.
 *
 *     - PowerShell is universally present on every Windows
 *       host the agent will run on. No additional
 *       installation, no version pinning, no native rebuild
 *       on Node-version bumps.
 *
 *     - Tradeoff: a bad actor with arbitrary code execution
 *       under the same user account can extract the token
 *       either way (DPAPI ScopeCurrentUser is the same
 *       protection level Credential Manager gives by
 *       default). Net protection equivalent.
 *
 *   When Phase 4.x grows multi-OS support, the macOS
 *   Keychain + Linux libsecret implementations land as
 *   sibling classes implementing the same `CredentialStore`
 *   interface; the registration CLI + WS auth path don't
 *   change.
 *
 * On-disk shape: each token lives at
 *
 *   <rootDir>/<sanitized-target>.dpapi
 *
 * where the file content is the base64-encoded ciphertext
 * produced by `Protect-Data -Scope CurrentUser`. The token
 * never sits unencrypted on disk.
 */

export interface CredentialStore {
  /** Stores `value` under `target`. Overwrites any existing entry. */
  readonly storeToken: (target: string, value: string) => Promise<void>;
  /** Reads the value at `target`, or returns null if absent. */
  readonly getToken: (target: string) => Promise<string | null>;
  /** Removes the entry at `target`. Idempotent. */
  readonly deleteToken: (target: string) => Promise<void>;
}

/**
 * Canonical target name used by the Phase 4.0 register CLI
 * + the WS connection. Both ends import this constant so
 * they agree on the same key — drift would silently break
 * auth.
 */
export const AGENT_TOKEN_TARGET = 'OperatorOS:agent-token';

/**
 * Test seam for the DPAPI store: stub PowerShell invocations.
 * Production omits to take execa.
 */
export interface PowerShellRunner {
  readonly run: (
    args: ReadonlyArray<string>,
    stdin?: string
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

const defaultPowerShellRunner: PowerShellRunner = {
  async run(args, stdin) {
    const result = await execa('powershell.exe', [...args], {
      reject: false,
      input: stdin,
      stripFinalNewline: false
    });
    return {
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
      exitCode: typeof result.exitCode === 'number' ? result.exitCode : -1
    };
  }
};

export interface DpapiCredentialStoreOptions {
  /**
   * Override the on-disk root. Defaults to
   * `%APPDATA%/OperatorOS/.credentials`. Tests pass an
   * absolute tmp dir.
   */
  readonly rootDir?: string;
  /**
   * Override the PowerShell runner. Tests pass a stub that
   * doesn't actually shell out — the DPAPI calls are
   * deterministic against an injected ciphertext blob.
   */
  readonly powershell?: PowerShellRunner;
}

export class CredentialStoreError extends Error {
  readonly code: string;
  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = 'CredentialStoreError';
    this.code = code;
    if (cause instanceof Error) this.cause = cause;
  }
}

/**
 * Sanitise a target like `OperatorOS:agent-token` into a
 * filename-safe slug. We map ':' → '-', anything outside
 * `[A-Za-z0-9._-]` → '_'. Reversible enough for ops to
 * eyeball the directory and recognise the credential.
 */
const sanitizeTarget = (target: string): string =>
  target.replace(/:/g, '-').replace(/[^A-Za-z0-9._-]/g, '_');

const PROTECT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$plain = [Console]::In.ReadToEnd()
$bytes = [System.Text.Encoding]::UTF8.GetBytes($plain)
$encrypted = [System.Security.Cryptography.ProtectedData]::Protect(
    $bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([System.Convert]::ToBase64String($encrypted))
`;

const UNPROTECT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$base64 = [Console]::In.ReadToEnd()
$bytes = [System.Convert]::FromBase64String($base64)
$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($decrypted))
`;

export class DpapiCredentialStore implements CredentialStore {
  readonly name = 'dpapi-credential-store';
  #rootDir: string;
  #ps: PowerShellRunner;

  constructor(options: DpapiCredentialStoreOptions = {}) {
    this.#rootDir =
      options.rootDir ??
      path.join(
        process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
        'OperatorOS',
        '.credentials'
      );
    this.#ps = options.powershell ?? defaultPowerShellRunner;
  }

  async storeToken(target: string, value: string): Promise<void> {
    if (typeof value !== 'string' || value.length === 0) {
      throw new CredentialStoreError(
        'CREDENTIAL_VALUE_EMPTY',
        'Refusing to store an empty token'
      );
    }
    await fs.mkdir(this.#rootDir, { recursive: true });
    const ciphertext = await this.#protect(value);
    const filePath = this.#fileFor(target);
    // Write to a sibling .tmp first then rename so a partial
    // write doesn't corrupt the existing token.
    const tmpPath = `${filePath}.tmp`;
    await fs.writeFile(tmpPath, ciphertext, { encoding: 'utf-8', mode: 0o600 });
    await fs.rename(tmpPath, filePath);
  }

  async getToken(target: string): Promise<string | null> {
    const filePath = this.#fileFor(target);
    let ciphertext: string;
    try {
      ciphertext = await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new CredentialStoreError(
        'CREDENTIAL_READ_FAILED',
        `Failed to read credential file at ${filePath}`,
        err
      );
    }
    if (ciphertext.length === 0) return null;
    return this.#unprotect(ciphertext);
  }

  async deleteToken(target: string): Promise<void> {
    const filePath = this.#fileFor(target);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new CredentialStoreError(
        'CREDENTIAL_DELETE_FAILED',
        `Failed to delete credential file at ${filePath}`,
        err
      );
    }
  }

  /** Test helper — surface the resolved file path for a target. */
  fileFor(target: string): string {
    return this.#fileFor(target);
  }

  #fileFor(target: string): string {
    return path.join(this.#rootDir, `${sanitizeTarget(target)}.dpapi`);
  }

  async #protect(plain: string): Promise<string> {
    const result = await this.#ps.run(
      ['-NoProfile', '-NonInteractive', '-Command', PROTECT_SCRIPT],
      plain
    );
    if (result.exitCode !== 0) {
      throw new CredentialStoreError(
        'DPAPI_PROTECT_FAILED',
        `PowerShell ProtectedData.Protect exited ${result.exitCode}: ${result.stderr.trim()}`
      );
    }
    const ciphertext = result.stdout.trim();
    if (ciphertext.length === 0) {
      throw new CredentialStoreError(
        'DPAPI_PROTECT_EMPTY',
        'PowerShell returned empty ciphertext'
      );
    }
    return ciphertext;
  }

  async #unprotect(ciphertext: string): Promise<string> {
    const result = await this.#ps.run(
      ['-NoProfile', '-NonInteractive', '-Command', UNPROTECT_SCRIPT],
      ciphertext
    );
    if (result.exitCode !== 0) {
      throw new CredentialStoreError(
        'DPAPI_UNPROTECT_FAILED',
        `PowerShell ProtectedData.Unprotect exited ${result.exitCode}: ${result.stderr.trim()}`
      );
    }
    return result.stdout;
  }
}

/**
 * In-memory implementation, intended for unit tests of code
 * that consumes a `CredentialStore` (e.g. the register CLI in
 * Part 4.B). Production never wires this up.
 */
export class InMemoryCredentialStore implements CredentialStore {
  readonly name = 'in-memory-credential-store';
  #map = new Map<string, string>();

  async storeToken(target: string, value: string): Promise<void> {
    this.#map.set(target, value);
  }

  async getToken(target: string): Promise<string | null> {
    return this.#map.get(target) ?? null;
  }

  async deleteToken(target: string): Promise<void> {
    this.#map.delete(target);
  }

  /** Test helper — surface the underlying map. */
  snapshot(): ReadonlyMap<string, string> {
    return new Map(this.#map);
  }
}
