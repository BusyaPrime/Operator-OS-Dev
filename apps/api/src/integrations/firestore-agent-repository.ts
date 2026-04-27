import { Firestore, FieldValue } from '@google-cloud/firestore';
import type { ApiEnv } from '@operator-os/config';
import {
  agentRecordSchema,
  type AgentCapabilityName,
  type AgentRecord,
  type AgentSummary
} from '@operator-os/contracts';
import type { FastifyBaseLogger } from 'fastify';

import type { AgentRecordRepository } from './agent-token-guard.js';
import { detectApplicationDefaultCredentials } from './runtime.js';

/**
 * Phase 4.0 Part 3.C — durable storage for the
 * `agents/{agentId}` collection introduced by ADR-025.
 *
 * Composition over inheritance: this class implements the
 * narrow `AgentRecordRepository` interface the agentTokenGuard
 * needs (findCandidatesByTokenLookup + incrementOldTokenUsage)
 * AND adds the lifecycle methods (create / get / list /
 * rotate / revoke / setOnline) that Parts 3.D-G route handlers
 * call. Splitting the auth-side narrow interface from the
 * lifecycle one keeps the guard's tests trivial — they don't
 * depend on the full lifecycle surface.
 *
 * No fallback-to-in-memory path: agents are durable identity,
 * not transient state. If Firestore is unavailable, every
 * method returns / throws an error and the route handler
 * surfaces a 503. This differs from `FirestoreOperatorRepository`
 * (which falls back to in-memory bootstrap data for the
 * dashboard read paths) because dashboards are read-only-ish
 * displays and agents are the auth root of trust.
 */

const AGENTS_COLLECTION = 'agents';

/**
 * Trichotomy threshold for the WS-derived `online` field.
 * Mirrors ADR-025 D2: lastHeartbeatAt within 90s of now.
 * Encoded as a constant so the cleanup job, the guard, and
 * the status route agree on the same boundary.
 */
const HEARTBEAT_FRESHNESS_MS = 90_000;

export class AgentsCollectionUnavailableError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AgentsCollectionUnavailableError';
    this.code = code;
  }
}

/**
 * Lifecycle methods used by the route handlers. The auth
 * guard depends only on the narrower `AgentRecordRepository`
 * interface from `agent-token-guard.ts`, which the
 * `FirestoreAgentRepository` also implements.
 */
export interface AgentLifecycleRepository {
  /**
   * Create a new agent record. Throws if a record with the
   * same `agentId` already exists — register-vs-update is a
   * route-layer decision (no implicit upsert).
   */
  readonly create: (record: AgentRecord) => Promise<void>;

  /** Read a single record by id, regardless of owner. */
  readonly getById: (agentId: string) => Promise<AgentRecord | undefined>;

  /**
   * List all records owned by the named user. Sorted by
   * `createdAt` descending — newest first. Excludes revoked
   * records by default; `includeRevoked: true` opts in.
   */
  readonly listForUser: (
    userId: string,
    options?: { readonly includeRevoked?: boolean }
  ) => Promise<ReadonlyArray<AgentRecord>>;

  /**
   * Atomic rotate: writes the new bcrypt + lookup hashes, moves
   * the previous values into the previous-* fields, sets the
   * overlap expiry, and bumps `tokenLastRotatedAt`. The
   * returned record is the post-write snapshot.
   */
  readonly rotateToken: (
    agentId: string,
    newTokenHash: string,
    newTokenLookupHash: string,
    overlapExpiresAt: Date
  ) => Promise<AgentRecord>;

  /** Mark the record revoked. Idempotent. */
  readonly markRevoked: (
    agentId: string,
    reason: string
  ) => Promise<AgentRecord>;

  /** Set online=true + lastConnectAt. Called on WS welcome. */
  readonly markOnline: (agentId: string, connectedAt: Date) => Promise<void>;

  /** Set online=false + lastDisconnectAt. Called on WS close. */
  readonly markOffline: (
    agentId: string,
    disconnectedAt: Date
  ) => Promise<void>;

  /** Update lastHeartbeatAt. Called on every WS pong. */
  readonly recordHeartbeat: (
    agentId: string,
    heartbeatAt: Date
  ) => Promise<void>;

  /**
   * Cleanup job entry-point: clear `previousTokenHash` /
   * `previousTokenLookupHash` / `previousTokenExpiresAt` on
   * every record where the overlap window has expired.
   * Returns the number of records updated.
   */
  readonly clearExpiredPreviousTokens: (
    now: Date,
    options?: { readonly batchSize?: number }
  ) => Promise<number>;
}

/**
 * Combined surface used by the agent-registration routes +
 * the agentTokenGuard. The concrete FirestoreAgentRepository
 * implements it; tests pass an in-memory fake. Splitting the
 * combined interface from the two narrow ones keeps the guard
 * tests shielded from the lifecycle surface and vice-versa.
 */
export interface AgentRepository
  extends AgentRecordRepository,
    AgentLifecycleRepository {}

export class FirestoreAgentRepository implements AgentRepository {
  readonly name = 'firestore-agents';

  #adcStatus = detectApplicationDefaultCredentials();
  #client?: Firestore;
  #config: ApiEnv;
  #logger: FastifyBaseLogger;

  constructor(config: ApiEnv, logger: FastifyBaseLogger) {
    this.#config = config;
    this.#logger = logger;
  }

  // --- AgentRecordRepository (the narrow guard interface) ---

  async findCandidatesByTokenLookup(
    lookupHash: string
  ): Promise<ReadonlyArray<AgentRecord>> {
    if (!this.#adcStatus.available) return [];
    const collection = this.#getCollection();
    try {
      // Query both the current and previous lookup-hash fields
      // and union the results. Firestore does not support OR
      // queries pre-2023 across fields without a composite
      // index hack; running two queries in parallel is the
      // documented workaround and is cheaper than a
      // collection-wide scan.
      const [currentSnap, previousSnap] = await Promise.all([
        collection.where('tokenLookupHash', '==', lookupHash).get(),
        collection.where('previousTokenLookupHash', '==', lookupHash).get()
      ]);

      const seen = new Set<string>();
      const records: AgentRecord[] = [];
      for (const doc of [...currentSnap.docs, ...previousSnap.docs]) {
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        const parsed = agentRecordSchema.safeParse(doc.data());
        if (!parsed.success) {
          this.#logger.warn(
            {
              collectionName: AGENTS_COLLECTION,
              documentId: doc.id,
              issues: parsed.error.issues
            },
            'agent document skipped — does not match schema'
          );
          continue;
        }
        records.push(parsed.data);
      }
      return records;
    } catch (err) {
      this.#logger.warn(
        { err, lookupHash },
        'agent token lookup failed; treating as unknown token'
      );
      return [];
    }
  }

  async incrementOldTokenUsage(agentId: string): Promise<void> {
    if (!this.#adcStatus.available) return;
    try {
      await this.#getCollection()
        .doc(agentId)
        .update({ oldTokenUsageCount: FieldValue.increment(1) });
    } catch (err) {
      // Best-effort metric; the guard already swallows our
      // rejection so the auth path is unaffected.
      this.#logger.warn({ err, agentId }, 'oldTokenUsageCount increment failed');
    }
  }

  // --- AgentLifecycleRepository (used by route handlers) ---

  async create(record: AgentRecord): Promise<void> {
    this.#requireAdc('create agent');
    const ref = this.#getCollection().doc(record.agentId);
    // Use a transaction so register-twice surfaces as a real
    // error, not a silent overwrite that would let an attacker
    // re-register an agent_id they already burned.
    await this.#getClient().runTransaction(async (txn) => {
      const existing = await txn.get(ref);
      if (existing.exists) {
        throw new AgentsCollectionUnavailableError(
          'AGENT_ID_TAKEN',
          `Agent ${record.agentId} already exists`
        );
      }
      txn.set(ref, record);
    });
  }

  async getById(agentId: string): Promise<AgentRecord | undefined> {
    if (!this.#adcStatus.available) return undefined;
    try {
      const doc = await this.#getCollection().doc(agentId).get();
      if (!doc.exists) return undefined;
      const parsed = agentRecordSchema.safeParse(doc.data());
      if (!parsed.success) {
        this.#logger.warn(
          { agentId, issues: parsed.error.issues },
          'agent document skipped — does not match schema'
        );
        return undefined;
      }
      return parsed.data;
    } catch (err) {
      this.#logger.warn({ err, agentId }, 'agent read failed');
      return undefined;
    }
  }

  async listForUser(
    userId: string,
    options: { readonly includeRevoked?: boolean } = {}
  ): Promise<ReadonlyArray<AgentRecord>> {
    if (!this.#adcStatus.available) return [];
    const includeRevoked = options.includeRevoked ?? false;
    try {
      let query = this.#getCollection().where('userId', '==', userId);
      if (!includeRevoked) {
        query = query.where('revoked', '==', false);
      }
      const snapshot = await query.orderBy('createdAt', 'desc').get();
      const records: AgentRecord[] = [];
      for (const doc of snapshot.docs) {
        const parsed = agentRecordSchema.safeParse(doc.data());
        if (!parsed.success) {
          this.#logger.warn(
            { agentId: doc.id, issues: parsed.error.issues },
            'agent document skipped during list — schema drift'
          );
          continue;
        }
        records.push(parsed.data);
      }
      return records;
    } catch (err) {
      this.#logger.warn({ err, userId }, 'agent list failed');
      return [];
    }
  }

  async rotateToken(
    agentId: string,
    newTokenHash: string,
    newTokenLookupHash: string,
    overlapExpiresAt: Date
  ): Promise<AgentRecord> {
    this.#requireAdc('rotate agent token');
    const ref = this.#getCollection().doc(agentId);
    const now = new Date().toISOString();
    return this.#getClient().runTransaction(async (txn) => {
      const snap = await txn.get(ref);
      if (!snap.exists) {
        throw new AgentsCollectionUnavailableError(
          'AGENT_NOT_FOUND',
          `Agent ${agentId} not found`
        );
      }
      const parsed = agentRecordSchema.safeParse(snap.data());
      if (!parsed.success) {
        throw new AgentsCollectionUnavailableError(
          'AGENT_RECORD_INVALID',
          `Agent ${agentId} record has invalid shape`
        );
      }
      const record = parsed.data;
      if (record.revoked) {
        throw new AgentsCollectionUnavailableError(
          'AGENT_REVOKED',
          `Agent ${agentId} is revoked`
        );
      }
      const updated: AgentRecord = {
        ...record,
        tokenHash: newTokenHash,
        tokenLookupHash: newTokenLookupHash,
        tokenIssuedAt: now,
        tokenLastRotatedAt: now,
        previousTokenHash: record.tokenHash,
        previousTokenLookupHash: record.tokenLookupHash,
        previousTokenExpiresAt: overlapExpiresAt.toISOString(),
        oldTokenUsageCount: 0,
        updatedAt: now
      };
      txn.set(ref, updated);
      return updated;
    });
  }

  async markRevoked(agentId: string, reason: string): Promise<AgentRecord> {
    this.#requireAdc('revoke agent');
    const ref = this.#getCollection().doc(agentId);
    const now = new Date().toISOString();
    return this.#getClient().runTransaction(async (txn) => {
      const snap = await txn.get(ref);
      if (!snap.exists) {
        throw new AgentsCollectionUnavailableError(
          'AGENT_NOT_FOUND',
          `Agent ${agentId} not found`
        );
      }
      const parsed = agentRecordSchema.safeParse(snap.data());
      if (!parsed.success) {
        throw new AgentsCollectionUnavailableError(
          'AGENT_RECORD_INVALID',
          `Agent ${agentId} record has invalid shape`
        );
      }
      const updated: AgentRecord = {
        ...parsed.data,
        revoked: true,
        revokedAt: parsed.data.revokedAt ?? now,
        revokedReason: parsed.data.revokedReason ?? reason,
        updatedAt: now
      };
      txn.set(ref, updated);
      return updated;
    });
  }

  async markOnline(agentId: string, connectedAt: Date): Promise<void> {
    if (!this.#adcStatus.available) return;
    try {
      await this.#getCollection()
        .doc(agentId)
        .update({
          online: true,
          lastConnectAt: connectedAt.toISOString(),
          lastHeartbeatAt: connectedAt.toISOString(),
          updatedAt: connectedAt.toISOString()
        });
    } catch (err) {
      this.#logger.warn({ err, agentId }, 'markOnline failed');
    }
  }

  async markOffline(agentId: string, disconnectedAt: Date): Promise<void> {
    if (!this.#adcStatus.available) return;
    try {
      await this.#getCollection()
        .doc(agentId)
        .update({
          online: false,
          lastDisconnectAt: disconnectedAt.toISOString(),
          updatedAt: disconnectedAt.toISOString()
        });
    } catch (err) {
      this.#logger.warn({ err, agentId }, 'markOffline failed');
    }
  }

  async recordHeartbeat(agentId: string, heartbeatAt: Date): Promise<void> {
    if (!this.#adcStatus.available) return;
    try {
      await this.#getCollection()
        .doc(agentId)
        .update({
          lastHeartbeatAt: heartbeatAt.toISOString(),
          updatedAt: heartbeatAt.toISOString()
        });
    } catch (err) {
      this.#logger.warn({ err, agentId }, 'recordHeartbeat failed');
    }
  }

  async clearExpiredPreviousTokens(
    now: Date,
    options: { readonly batchSize?: number } = {}
  ): Promise<number> {
    if (!this.#adcStatus.available) return 0;
    const batchSize = options.batchSize ?? 500;
    try {
      const snap = await this.#getCollection()
        .where('previousTokenExpiresAt', '<=', now.toISOString())
        .where('previousTokenExpiresAt', '!=', null)
        .limit(batchSize)
        .get();
      if (snap.empty) return 0;
      const batch = this.#getClient().batch();
      for (const doc of snap.docs) {
        batch.update(doc.ref, {
          previousTokenHash: null,
          previousTokenLookupHash: null,
          previousTokenExpiresAt: null,
          oldTokenUsageCount: 0,
          updatedAt: now.toISOString()
        });
      }
      await batch.commit();
      return snap.size;
    } catch (err) {
      this.#logger.warn({ err }, 'clearExpiredPreviousTokens failed');
      return 0;
    }
  }

  // --- helpers ---

  #getClient(): Firestore {
    if (this.#client) return this.#client;
    this.#client = new Firestore({
      projectId: this.#config.GOOGLE_CLOUD_PROJECT,
      databaseId: this.#config.FIRESTORE_DATABASE
    });
    return this.#client;
  }

  #getCollection(): FirebaseFirestore.CollectionReference {
    return this.#getClient().collection(AGENTS_COLLECTION);
  }

  #requireAdc(operation: string): void {
    if (!this.#adcStatus.available) {
      throw new AgentsCollectionUnavailableError(
        'FIRESTORE_UNAVAILABLE',
        `Firestore not available; cannot ${operation}: ${this.#adcStatus.message}`
      );
    }
  }
}

/**
 * Pure helper: derive the `AgentSummary` (the wire-safe shape)
 * from an `AgentRecord` (the Firestore-side shape). Strips
 * bcrypt hashes; computes the trichotomy from `online` +
 * `lastHeartbeatAt`. Exported standalone so route tests don't
 * need a full Firestore mock to assert summary projection.
 */
export const projectAgentSummary = (
  record: AgentRecord,
  now: number = Date.now()
): AgentSummary => {
  let onlineState: AgentSummary['onlineState'];
  if (
    record.online &&
    record.lastHeartbeatAt !== null &&
    Date.parse(record.lastHeartbeatAt) > now - HEARTBEAT_FRESHNESS_MS
  ) {
    // For Phase 4.0 we don't yet have RTT data on the server.
    // The trichotomy will gain the 'degraded' state once Part 5
    // emits RTT histograms over the WS; for now everything fresh
    // is plain 'online'.
    onlineState = 'online';
  } else {
    onlineState = 'offline';
  }

  return {
    agentId: record.agentId,
    machineName: record.machineName,
    // AgentSummary's `capabilities` is a mutable array; spread
    // out of the record's readonly view to satisfy the variance.
    capabilities: [...record.capabilities] as AgentCapabilityName[],
    onlineState,
    lastHeartbeatAt: record.lastHeartbeatAt,
    lastConnectAt: record.lastConnectAt,
    lastDisconnectAt: record.lastDisconnectAt,
    createdAt: record.createdAt,
    oldTokenUsageCount: record.oldTokenUsageCount
  };
};
