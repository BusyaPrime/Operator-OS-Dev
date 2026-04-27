import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MaxSessionUnavailableError,
  verifyMaxSession
} from '../max-session-preflight.js';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'max-session-preflight-'));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

const writeCredentials = async (
  contents: unknown | string
): Promise<string> => {
  const file = path.join(tmpRoot, '.credentials.json');
  const body = typeof contents === 'string' ? contents : JSON.stringify(contents);
  await writeFile(file, body, 'utf-8');
  return file;
};

const FIXED_NOW = new Date('2026-04-27T12:00:00Z').getTime();

describe('verifyMaxSession', () => {
  it('returns ok with positive expiresInSeconds when the OAuth shape is intact and not expired', async () => {
    const expiresAt = new Date('2026-04-27T13:00:00Z').toISOString();
    const credentialsPath = await writeCredentials({
      claudeAiOauth: {
        accessToken: 'redacted',
        refreshToken: 'redacted',
        expiresAt,
        subscriptionType: 'max',
        scopes: ['user:read']
      }
    });

    const result = await verifyMaxSession({
      credentialsPath,
      now: () => FIXED_NOW
    });

    expect(result.ok).toBe(true);
    expect(result.path).toBe(credentialsPath);
    expect(result.expiresInSeconds).toBe(60 * 60);
  });

  it('also accepts expiresAt as a numeric epoch (the CLI sometimes writes ms)', async () => {
    const expiresAt = FIXED_NOW + 30 * 60 * 1000;
    const credentialsPath = await writeCredentials({
      claudeAiOauth: {
        accessToken: 'redacted',
        expiresAt,
        subscriptionType: 'max'
      }
    });

    const result = await verifyMaxSession({
      credentialsPath,
      now: () => FIXED_NOW
    });

    expect(result.expiresInSeconds).toBe(30 * 60);
  });

  it('returns ok with negative expiresInSeconds when expiry is in the past', async () => {
    const expiresAt = new Date('2026-04-27T11:00:00Z').toISOString();
    const credentialsPath = await writeCredentials({
      claudeAiOauth: {
        accessToken: 'redacted',
        expiresAt,
        subscriptionType: 'max'
      }
    });

    const result = await verifyMaxSession({
      credentialsPath,
      now: () => FIXED_NOW
    });

    expect(result.ok).toBe(true);
    expect(result.expiresInSeconds).toBe(-60 * 60);
  });

  it('throws CREDENTIALS_FILE_MISSING when the file does not exist', async () => {
    const credentialsPath = path.join(tmpRoot, 'does-not-exist.json');

    await expect(verifyMaxSession({ credentialsPath })).rejects.toMatchObject({
      name: 'MaxSessionUnavailableError',
      code: 'CREDENTIALS_FILE_MISSING',
      path: credentialsPath
    });
  });

  it('throws CREDENTIALS_FILE_INVALID_JSON when the file is unparseable', async () => {
    const credentialsPath = await writeCredentials('not-json{{{');

    await expect(verifyMaxSession({ credentialsPath })).rejects.toMatchObject({
      code: 'CREDENTIALS_FILE_INVALID_JSON'
    });
  });

  it('throws CREDENTIALS_OAUTH_MISSING when claudeAiOauth is absent', async () => {
    const credentialsPath = await writeCredentials({
      // API-key-only install — no OAuth block
      apiKey: 'redacted'
    });

    await expect(verifyMaxSession({ credentialsPath })).rejects.toMatchObject({
      code: 'CREDENTIALS_OAUTH_MISSING'
    });
  });

  it('throws CREDENTIALS_OAUTH_INCOMPLETE when required sub-keys are missing', async () => {
    const credentialsPath = await writeCredentials({
      claudeAiOauth: {
        // missing accessToken, expiresAt, subscriptionType
        scopes: ['user:read']
      }
    });

    let caught: MaxSessionUnavailableError | undefined;
    try {
      await verifyMaxSession({ credentialsPath });
    } catch (err) {
      caught = err as MaxSessionUnavailableError;
    }
    expect(caught?.code).toBe('CREDENTIALS_OAUTH_INCOMPLETE');
    expect(caught?.message).toMatch(/accessToken/);
    expect(caught?.message).toMatch(/expiresAt/);
    expect(caught?.message).toMatch(/subscriptionType/);
  });

  it('throws CREDENTIALS_EXPIRY_UNPARSEABLE when expiresAt is not a number or ISO string', async () => {
    const credentialsPath = await writeCredentials({
      claudeAiOauth: {
        accessToken: 'redacted',
        expiresAt: { weird: 'shape' },
        subscriptionType: 'max'
      }
    });

    await expect(verifyMaxSession({ credentialsPath })).rejects.toMatchObject({
      code: 'CREDENTIALS_EXPIRY_UNPARSEABLE'
    });
  });

  it('throws CREDENTIALS_SHAPE_INVALID when the JSON root is not an object', async () => {
    const credentialsPath = await writeCredentials('"not-an-object"');

    await expect(verifyMaxSession({ credentialsPath })).rejects.toMatchObject({
      code: 'CREDENTIALS_SHAPE_INVALID'
    });
  });

  it('error message names the path and includes a remediation hint, never the secret', async () => {
    const credentialsPath = path.join(tmpRoot, 'does-not-exist.json');
    let caught: MaxSessionUnavailableError | undefined;
    try {
      await verifyMaxSession({ credentialsPath });
    } catch (err) {
      caught = err as MaxSessionUnavailableError;
    }

    expect(caught).toBeDefined();
    expect(caught!.message).toContain(credentialsPath);
    expect(caught!.message).toMatch(/claude/i);
    // Sanity: never echoes secret-shaped strings
    expect(caught!.message).not.toMatch(/sk-ant-/);
    expect(caught!.message).not.toMatch(/Bearer\s/);
  });
});
