import { parseAuthGatewayEnv } from '@operator-os/config';
import { describe, expect, it } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';

import { RefreshTokenStore } from './refresh-token-store.js';

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  trace: () => {},
  fatal: () => {},
  level: 'info',
  silent: () => {}
} as unknown as FastifyBaseLogger;

const buildStore = () =>
  new RefreshTokenStore(parseAuthGatewayEnv({}), noopLogger);

describe('RefreshTokenStore (in-memory fallback)', () => {
  it('issues a token that then validates ok', async () => {
    const store = buildStore();
    const issued = await store.issue({ userId: 'user-1' });

    expect(issued.token).toBeTypeOf('string');
    expect(issued.token.length).toBeGreaterThan(20);
    expect(issued.hash.length).toBeGreaterThan(20);
    expect(issued.record.userId).toBe('user-1');

    const outcome = await store.validate(issued.token);
    expect(outcome.ok).toBe(true);
  });

  it('reports unknown for a never-issued token', async () => {
    const store = buildStore();
    const outcome = await store.validate('definitely-not-a-real-token');
    expect(outcome).toEqual({ ok: false, reason: 'unknown' });
  });

  it('rotates: old token becomes rotated, new token validates', async () => {
    const store = buildStore();
    const initial = await store.issue({ userId: 'user-2' });

    const rotation = await store.rotate(initial.token);
    expect(rotation.outcome.ok).toBe(true);
    expect(rotation.issued).toBeDefined();

    // New token validates ok
    const newOutcome = await store.validate(rotation.issued!.token);
    expect(newOutcome.ok).toBe(true);

    // Old token now reports rotated
    const oldOutcome = await store.validate(initial.token);
    expect(oldOutcome).toEqual({ ok: false, reason: 'rotated' });
  });

  it('revokes: token reports revoked after signout', async () => {
    const store = buildStore();
    const issued = await store.issue({ userId: 'user-3' });

    const revokeOutcome = await store.revoke(issued.token);
    expect(revokeOutcome.ok).toBe(true);

    const afterOutcome = await store.validate(issued.token);
    expect(afterOutcome).toEqual({ ok: false, reason: 'revoked' });
  });

  it('rejects rotation of an already-revoked token', async () => {
    const store = buildStore();
    const issued = await store.issue({ userId: 'user-4' });
    await store.revoke(issued.token);

    const rotation = await store.rotate(issued.token);
    expect(rotation.outcome).toEqual({ ok: false, reason: 'revoked' });
    expect(rotation.issued).toBeUndefined();
  });

  it('detects re-use of an already-rotated token', async () => {
    const store = buildStore();
    const initial = await store.issue({ userId: 'user-5' });
    await store.rotate(initial.token);

    const reuseRotation = await store.rotate(initial.token);
    expect(reuseRotation.outcome).toEqual({ ok: false, reason: 'rotated' });
    expect(reuseRotation.issued).toBeUndefined();
  });
});
