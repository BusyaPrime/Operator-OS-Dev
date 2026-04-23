import type { TaskStatus } from '@operator-os/contracts';

/**
 * The bit of TaskRecord the cache needs to replay — just enough
 * to synthesise a TaskSubmitResponse without re-reading
 * Firestore. `status` is the status at first-submit time; the
 * client sees that consistently across replay, which matches the
 * HTTP idempotency semantic ("same request, same response").
 */
export interface IdempotencyEntry {
  readonly taskId: string;
  readonly status: TaskStatus;
  readonly createdAt: string;
}

export interface IdempotencyLookupHit {
  readonly hit: true;
  readonly record: IdempotencyEntry;
}

export interface IdempotencyLookupMiss {
  readonly hit: false;
}

export type IdempotencyLookupResult =
  | IdempotencyLookupHit
  | IdempotencyLookupMiss;

export interface IdempotencyCache {
  /**
   * Returns `{ hit, record }` if the `(userId, idempotencyKey)`
   * pair is in the cache and not yet expired; otherwise
   * `{ hit: false }`. Expired entries are swept on read.
   */
  lookup(userId: string, idempotencyKey: string): IdempotencyLookupResult;
  /**
   * Records a fresh submission. LRU-evicts the oldest entry
   * when the cache exceeds its capacity.
   */
  remember(
    userId: string,
    idempotencyKey: string,
    entry: IdempotencyEntry
  ): void;
  /** Current entry count — observability hook for tests. */
  size(): number;
}

export interface IdempotencyCacheOptions {
  /** TTL per entry in ms. Default 24 hours. */
  readonly ttlMs?: number;
  /** Hard cap on entries. Default 10 000. */
  readonly maxEntries?: number;
  /** Injected clock for tests. Default Date.now. */
  readonly now?: () => number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_ENTRIES = 10_000;

interface StoredEntry extends IdempotencyEntry {
  readonly expiresAtMs: number;
}

/**
 * In-memory LRU idempotency cache for POST /v1/tasks. Keyed by
 * `${userId}:${idempotencyKey}` so two users submitting the same
 * client-generated UUID don't collide. 24h TTL matches Phase 3.1
 * §3.1.5; max 10 000 entries keeps the per-Fastify-instance
 * memory footprint bounded (~1 MB at steady state).
 *
 * Single-instance scope — when the api scales horizontally,
 * migrate to a shared Redis cache (TD-027). The Firestore
 * composite index (idempotencyKey, userId, createdAt DESC) is
 * the rebuild path for both cold-start this-instance misses and
 * the future multi-instance world.
 *
 * LRU implementation: Map preserves insertion order per ES spec.
 * `lookup` re-inserts the entry on hit to mark it as most-recently-
 * used; evictions drop the first entry in iteration order, which
 * is the least-recently-used.
 */
export const createIdempotencyCache = (
  options: IdempotencyCacheOptions = {}
): IdempotencyCache => {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = options.now ?? (() => Date.now());
  const store = new Map<string, StoredEntry>();

  const compositeKey = (userId: string, idempotencyKey: string): string =>
    `${userId}:${idempotencyKey}`;

  const sweepExpired = (currentMs: number): void => {
    // Iteration order is insertion (= roughly expiry) order, so
    // we can stop at the first non-expired entry. But since
    // `remember` re-inserts on refresh, ordering is MRU-ish, not
    // strictly expiry-ordered. Full scan is O(n) but n ≤ 10 000
    // and this sweep only fires lazily on reads — acceptable.
    for (const [key, value] of store) {
      if (value.expiresAtMs <= currentMs) {
        store.delete(key);
      }
    }
  };

  return {
    lookup(userId, idempotencyKey): IdempotencyLookupResult {
      const key = compositeKey(userId, idempotencyKey);
      const entry = store.get(key);
      if (entry === undefined) return { hit: false };
      const currentMs = now();
      if (entry.expiresAtMs <= currentMs) {
        store.delete(key);
        return { hit: false };
      }
      // Mark as most-recently-used.
      store.delete(key);
      store.set(key, entry);
      return {
        hit: true,
        record: {
          taskId: entry.taskId,
          status: entry.status,
          createdAt: entry.createdAt
        }
      };
    },

    remember(userId, idempotencyKey, entry): void {
      const key = compositeKey(userId, idempotencyKey);
      const currentMs = now();
      store.delete(key); // refresh ordering if it exists
      store.set(key, {
        ...entry,
        expiresAtMs: currentMs + ttlMs
      });
      if (store.size > maxEntries) {
        sweepExpired(currentMs);
        while (store.size > maxEntries) {
          // Map iteration order is insertion → first entry is
          // least-recently-used after the re-insert dance above.
          const oldest = store.keys().next();
          if (oldest.done === true || oldest.value === undefined) break;
          store.delete(oldest.value);
        }
      }
    },

    size(): number {
      return store.size;
    }
  };
};
