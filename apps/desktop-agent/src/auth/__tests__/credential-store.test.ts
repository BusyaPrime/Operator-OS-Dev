import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AGENT_TOKEN_TARGET,
  CredentialStoreError,
  DpapiCredentialStore,
  InMemoryCredentialStore,
  type PowerShellRunner
} from '../credential-store.js';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'credential-store-'));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

/**
 * Build a PowerShell stub that reverses the
 * Protect/Unprotect operation as base64(utf8(plain)). Real
 * DPAPI is unavailable in CI Linux runners; the base64
 * round-trip preserves the contract that we test against.
 */
const buildStubRunner = (): PowerShellRunner & {
  protectCalls: number;
  unprotectCalls: number;
  forceProtectFailure?: boolean;
  forceUnprotectFailure?: boolean;
} => {
  let protectCalls = 0;
  let unprotectCalls = 0;
  const stub: PowerShellRunner & {
    protectCalls: number;
    unprotectCalls: number;
    forceProtectFailure?: boolean;
    forceUnprotectFailure?: boolean;
  } = {
    get protectCalls() {
      return protectCalls;
    },
    get unprotectCalls() {
      return unprotectCalls;
    },
    forceProtectFailure: false,
    forceUnprotectFailure: false,
    async run(args, stdin) {
      const script = args[args.length - 1] ?? '';
      if (script.includes('ProtectedData]::Protect(')) {
        protectCalls += 1;
        if (stub.forceProtectFailure) {
          return { stdout: '', stderr: 'simulated', exitCode: 1 };
        }
        const buf = Buffer.from(stdin ?? '', 'utf-8');
        return {
          stdout: buf.toString('base64'),
          stderr: '',
          exitCode: 0
        };
      }
      if (script.includes('ProtectedData]::Unprotect(')) {
        unprotectCalls += 1;
        if (stub.forceUnprotectFailure) {
          return { stdout: '', stderr: 'simulated', exitCode: 1 };
        }
        const buf = Buffer.from(stdin ?? '', 'base64');
        return {
          stdout: buf.toString('utf-8'),
          stderr: '',
          exitCode: 0
        };
      }
      return { stdout: '', stderr: 'unknown script', exitCode: 2 };
    }
  };
  return stub;
};

describe('AGENT_TOKEN_TARGET', () => {
  it('is the documented canonical name', () => {
    expect(AGENT_TOKEN_TARGET).toBe('OperatorOS:agent-token');
  });
});

describe('DpapiCredentialStore — round-trip', () => {
  it('stores then retrieves the original value', async () => {
    const ps = buildStubRunner();
    const store = new DpapiCredentialStore({ rootDir: tmpRoot, powershell: ps });

    await store.storeToken(AGENT_TOKEN_TARGET, 'super-secret-token-bytes');
    const round = await store.getToken(AGENT_TOKEN_TARGET);

    expect(round).toBe('super-secret-token-bytes');
    expect(ps.protectCalls).toBe(1);
    expect(ps.unprotectCalls).toBe(1);
  });

  it('persists ciphertext to disk under <rootDir>/<sanitized-target>.dpapi', async () => {
    const ps = buildStubRunner();
    const store = new DpapiCredentialStore({ rootDir: tmpRoot, powershell: ps });
    await store.storeToken(AGENT_TOKEN_TARGET, 'hi');

    const expectedPath = path.join(tmpRoot, 'OperatorOS-agent-token.dpapi');
    expect(store.fileFor(AGENT_TOKEN_TARGET)).toBe(expectedPath);

    const onDisk = await fs.readFile(expectedPath, 'utf-8');
    // Stub returns base64 of plaintext.
    expect(onDisk).toBe(Buffer.from('hi', 'utf-8').toString('base64'));
  });

  it('returns null on getToken for a target that was never stored', async () => {
    const ps = buildStubRunner();
    const store = new DpapiCredentialStore({ rootDir: tmpRoot, powershell: ps });
    const result = await store.getToken(AGENT_TOKEN_TARGET);
    expect(result).toBeNull();
    // Unprotect not called when file is missing.
    expect(ps.unprotectCalls).toBe(0);
  });

  it('overwrites existing entry on second storeToken (idempotent overwrite)', async () => {
    const ps = buildStubRunner();
    const store = new DpapiCredentialStore({ rootDir: tmpRoot, powershell: ps });
    await store.storeToken(AGENT_TOKEN_TARGET, 'first');
    await store.storeToken(AGENT_TOKEN_TARGET, 'second');
    const round = await store.getToken(AGENT_TOKEN_TARGET);
    expect(round).toBe('second');
  });

  it('deleteToken removes the file', async () => {
    const ps = buildStubRunner();
    const store = new DpapiCredentialStore({ rootDir: tmpRoot, powershell: ps });
    await store.storeToken(AGENT_TOKEN_TARGET, 'tok');
    await store.deleteToken(AGENT_TOKEN_TARGET);
    const round = await store.getToken(AGENT_TOKEN_TARGET);
    expect(round).toBeNull();
  });

  it('deleteToken on a non-existent target is a silent no-op', async () => {
    const ps = buildStubRunner();
    const store = new DpapiCredentialStore({ rootDir: tmpRoot, powershell: ps });
    await expect(
      store.deleteToken(AGENT_TOKEN_TARGET)
    ).resolves.toBeUndefined();
  });

  it('refuses to store an empty value', async () => {
    const ps = buildStubRunner();
    const store = new DpapiCredentialStore({ rootDir: tmpRoot, powershell: ps });
    await expect(store.storeToken(AGENT_TOKEN_TARGET, '')).rejects.toThrow(
      CredentialStoreError
    );
    expect(ps.protectCalls).toBe(0);
  });

  it('never leaves a partial write on disk if Protect fails', async () => {
    const ps = buildStubRunner();
    ps.forceProtectFailure = true;
    const store = new DpapiCredentialStore({ rootDir: tmpRoot, powershell: ps });

    await expect(
      store.storeToken(AGENT_TOKEN_TARGET, 'some-value')
    ).rejects.toMatchObject({
      name: 'CredentialStoreError',
      code: 'DPAPI_PROTECT_FAILED'
    });

    // No file should exist on disk for the target.
    const filePath = path.join(tmpRoot, 'OperatorOS-agent-token.dpapi');
    await expect(fs.readFile(filePath, 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });

  it('surfaces DPAPI_UNPROTECT_FAILED on Unprotect failure', async () => {
    const ps = buildStubRunner();
    const store = new DpapiCredentialStore({ rootDir: tmpRoot, powershell: ps });
    await store.storeToken(AGENT_TOKEN_TARGET, 'tok');

    ps.forceUnprotectFailure = true;
    await expect(store.getToken(AGENT_TOKEN_TARGET)).rejects.toMatchObject({
      name: 'CredentialStoreError',
      code: 'DPAPI_UNPROTECT_FAILED'
    });
  });

  it('writes through a .tmp + rename so a crash mid-Protect leaves the previous value intact', async () => {
    // First successful write.
    const ps = buildStubRunner();
    const store = new DpapiCredentialStore({ rootDir: tmpRoot, powershell: ps });
    await store.storeToken(AGENT_TOKEN_TARGET, 'first');

    // Second attempt fails at Protect — the existing file
    // must NOT have been replaced or truncated.
    ps.forceProtectFailure = true;
    await expect(
      store.storeToken(AGENT_TOKEN_TARGET, 'second')
    ).rejects.toThrow();

    ps.forceProtectFailure = false;
    const round = await store.getToken(AGENT_TOKEN_TARGET);
    expect(round).toBe('first');
  });

  it('sanitises target names with special characters', async () => {
    const ps = buildStubRunner();
    const store = new DpapiCredentialStore({ rootDir: tmpRoot, powershell: ps });
    const weird = 'OperatorOS:agent-token@host/with spaces';
    await store.storeToken(weird, 'tok');
    const filePath = store.fileFor(weird);
    // ':' → '-', '@', '/', ' ' → '_'
    expect(path.basename(filePath)).toBe(
      'OperatorOS-agent-token_host_with_spaces.dpapi'
    );
    const round = await store.getToken(weird);
    expect(round).toBe('tok');
  });
});

describe('InMemoryCredentialStore', () => {
  it('round-trips a value', async () => {
    const store = new InMemoryCredentialStore();
    await store.storeToken('a', 'A');
    expect(await store.getToken('a')).toBe('A');
  });

  it('returns null for unknown targets', async () => {
    const store = new InMemoryCredentialStore();
    expect(await store.getToken('nope')).toBeNull();
  });

  it('supports delete + idempotent re-delete', async () => {
    const store = new InMemoryCredentialStore();
    await store.storeToken('a', 'A');
    await store.deleteToken('a');
    await store.deleteToken('a'); // no throw
    expect(await store.getToken('a')).toBeNull();
  });

  it('snapshot returns a stable copy of the current map', async () => {
    const store = new InMemoryCredentialStore();
    await store.storeToken('a', 'A');
    const snap = store.snapshot();
    await store.storeToken('a', 'B');
    expect(snap.get('a')).toBe('A'); // snapshot is a clone
    expect(await store.getToken('a')).toBe('B');
  });

  it('overwrites on second store', async () => {
    const store = new InMemoryCredentialStore();
    await store.storeToken('a', 'first');
    await store.storeToken('a', 'second');
    expect(await store.getToken('a')).toBe('second');
  });
});

// Force vi to import — keeps prepush hook happy when no
// other vi.* call is made in this file.
void vi;
