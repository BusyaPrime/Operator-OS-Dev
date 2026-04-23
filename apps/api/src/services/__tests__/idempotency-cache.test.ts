import { describe, expect, it } from 'vitest';

import { createIdempotencyCache } from '../idempotency-cache.js';

const entry = (taskId: string, createdAt = '2026-04-24T00:00:00.000Z') => ({
  taskId,
  status: 'pending' as const,
  createdAt
});

describe('createIdempotencyCache', () => {
  describe('basic lookup / remember', () => {
    it('returns a miss for an unknown key', () => {
      const cache = createIdempotencyCache();
      expect(cache.lookup('user-1', 'key-1')).toEqual({ hit: false });
    });

    it('returns a hit after remember with the same user + key', () => {
      const cache = createIdempotencyCache();
      cache.remember('user-1', 'key-1', entry('task-A'));
      const result = cache.lookup('user-1', 'key-1');
      expect(result.hit).toBe(true);
      if (result.hit) {
        expect(result.record.taskId).toBe('task-A');
        expect(result.record.status).toBe('pending');
      }
    });

    it('isolates the same key across different users', () => {
      const cache = createIdempotencyCache();
      cache.remember('user-a', 'shared-key', entry('task-A'));
      cache.remember('user-b', 'shared-key', entry('task-B'));
      const a = cache.lookup('user-a', 'shared-key');
      const b = cache.lookup('user-b', 'shared-key');
      expect(a.hit && a.record.taskId).toBe('task-A');
      expect(b.hit && b.record.taskId).toBe('task-B');
    });

    it('does not mix keys within the same user', () => {
      const cache = createIdempotencyCache();
      cache.remember('user-1', 'key-1', entry('task-A'));
      expect(cache.lookup('user-1', 'key-2')).toEqual({ hit: false });
    });
  });

  describe('TTL expiration', () => {
    it('treats a just-expired entry as a miss and evicts it', () => {
      let current = 1_000;
      const cache = createIdempotencyCache({
        ttlMs: 100,
        now: () => current
      });
      cache.remember('user-1', 'key-1', entry('task-A'));
      expect(cache.size()).toBe(1);

      current = 1_101; // > ttl
      expect(cache.lookup('user-1', 'key-1')).toEqual({ hit: false });
      expect(cache.size()).toBe(0); // swept on miss
    });

    it('keeps entries alive until exactly their expiry moment', () => {
      let current = 1_000;
      const cache = createIdempotencyCache({
        ttlMs: 100,
        now: () => current
      });
      cache.remember('user-1', 'key-1', entry('task-A'));

      current = 1_099; // 1 ms before expiry
      const stillAlive = cache.lookup('user-1', 'key-1');
      expect(stillAlive.hit).toBe(true);

      current = 1_100; // exactly at expiry
      const atExpiry = cache.lookup('user-1', 'key-1');
      expect(atExpiry.hit).toBe(false);
    });
  });

  describe('LRU eviction', () => {
    it('evicts the least-recently-used entry when at capacity', () => {
      const cache = createIdempotencyCache({ maxEntries: 3 });
      cache.remember('u', 'k1', entry('t1'));
      cache.remember('u', 'k2', entry('t2'));
      cache.remember('u', 'k3', entry('t3'));
      expect(cache.size()).toBe(3);

      // Fourth insert → `k1` is the LRU and should be evicted.
      cache.remember('u', 'k4', entry('t4'));
      expect(cache.size()).toBe(3);
      expect(cache.lookup('u', 'k1').hit).toBe(false);
      expect(cache.lookup('u', 'k2').hit).toBe(true);
      expect(cache.lookup('u', 'k4').hit).toBe(true);
    });

    it('lookup hit marks the entry as MRU — it survives subsequent eviction', () => {
      const cache = createIdempotencyCache({ maxEntries: 3 });
      cache.remember('u', 'k1', entry('t1'));
      cache.remember('u', 'k2', entry('t2'));
      cache.remember('u', 'k3', entry('t3'));
      // Touch k1 so it becomes MRU.
      cache.lookup('u', 'k1');
      // Insert k4 — k2 should now be the oldest and get evicted,
      // NOT k1.
      cache.remember('u', 'k4', entry('t4'));
      expect(cache.lookup('u', 'k1').hit).toBe(true);
      expect(cache.lookup('u', 'k2').hit).toBe(false);
    });

    it('sweeps expired entries before evicting an unexpired MRU', () => {
      let current = 1_000;
      const cache = createIdempotencyCache({
        maxEntries: 2,
        ttlMs: 100,
        now: () => current
      });
      cache.remember('u', 'k1', entry('t1'));
      cache.remember('u', 'k2', entry('t2'));

      current = 1_200; // both expired

      cache.remember('u', 'k3', entry('t3'));
      // Sweep should have cleared k1+k2; only k3 remains.
      expect(cache.size()).toBe(1);
      expect(cache.lookup('u', 'k3').hit).toBe(true);
      expect(cache.lookup('u', 'k1').hit).toBe(false);
      expect(cache.lookup('u', 'k2').hit).toBe(false);
    });
  });

  describe('remember() refreshes an existing entry', () => {
    it('refreshes expiry when the same key is written again', () => {
      let current = 1_000;
      const cache = createIdempotencyCache({
        ttlMs: 100,
        now: () => current
      });
      cache.remember('u', 'k1', entry('t-original'));

      current = 1_050;
      cache.remember('u', 'k1', entry('t-refreshed'));

      current = 1_149; // would be expired from original write
      const r = cache.lookup('u', 'k1');
      expect(r.hit).toBe(true);
      if (r.hit) expect(r.record.taskId).toBe('t-refreshed');
    });
  });
});
