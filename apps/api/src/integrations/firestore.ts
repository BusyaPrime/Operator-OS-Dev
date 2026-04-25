import { Firestore, FieldValue } from '@google-cloud/firestore';
import type { ApiEnv } from '@operator-os/config';
import {
  alertSchema,
  analyticsEventSchema,
  agentHeartbeatRequestSchema,
  costPlanSchema,
  costSnapshotSchema,
  costUsageRecordSchema,
  deviceStateSchema,
  mutationReceiptSchema,
  operatorStateSchema,
  sessionSchema,
  taskRecordSchema,
  taskStatusSchema,
  type Alert,
  type AgentHeartbeatRequest,
  type AnalyticsEvent,
  type CostPlan,
  type CostSnapshot,
  type CostUsageRecord,
  type DeviceState,
  type MutationReceipt,
  type OperatorState,
  type Session,
  type TaskRecord,
  type TaskStatus,
  type TaskStatusResponse
} from '@operator-os/contracts';
import { z } from 'zod';
import type { FastifyBaseLogger } from 'fastify';
import type { ZodType } from 'zod';

import { buildBootstrapOperatorState } from '../bootstrap-data.js';
import {
  buildConfiguredCheck,
  buildNotConfiguredCheck,
  detectApplicationDefaultCredentials
} from './runtime.js';

/**
 * Collection name for the agent-centric heartbeat stream
 * (Phase 2 / TD-024). Hardcoded until a multi-env split is
 * actually needed — matches the "no new env vars this phase"
 * scope boundary from the Phase 2 pre-plan.
 */
const AGENT_HEARTBEATS_COLLECTION = 'agentHeartbeats';
const COST_RECORDS_COLLECTION = 'costRecords';
const USER_BUDGETS_COLLECTION = 'userBudgets';
const TASKS_COLLECTION = 'tasks';

/**
 * List-query parameters for `listTasksForUser`. Opaque cursor
 * is the `createdAt` ISO timestamp of the last row in the prior
 * page — consumers should not parse it.
 */
export interface ListTasksQuery {
  readonly status?: TaskStatus;
  readonly limit?: number;
  readonly cursor?: string;
}

const taskStatusResponseProjection = (record: TaskRecord): TaskStatusResponse => ({
  taskId: record.taskId,
  status: record.status,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  output: record.output,
  error: record.error
});

/**
 * Per-user budget override persisted in the `userBudgets`
 * collection. Free / pro plans fall through to PLAN_BUDGETS in
 * services/cost.ts; `custom` / enterprise tiers use this doc
 * to carry a specific monthly ceiling.
 */
export interface UserBudgetRecord {
  readonly userId: string;
  readonly plan: CostPlan;
  readonly monthlyLimitUsd: number;
  readonly warnAtPercent: number;
  readonly updatedAt: string;
  readonly notes?: string;
}

const userBudgetRecordSchema = z.object({
  userId: z.string().min(1),
  plan: costPlanSchema,
  monthlyLimitUsd: z.number().nonnegative(),
  warnAtPercent: z.number().min(0).max(100),
  updatedAt: z.string().datetime(),
  notes: z.string().optional()
});

const mergeByKey = <T>(
  baseItems: readonly T[],
  overlayItems: readonly T[],
  keySelector: (item: T) => string
) => {
  const merged = new Map(baseItems.map((item) => [keySelector(item), item]));

  for (const item of overlayItems) {
    merged.set(keySelector(item), item);
  }

  return Array.from(merged.values());
};

export class FirestoreOperatorRepository {
  readonly name = 'firestore';

  #adcStatus = detectApplicationDefaultCredentials();
  #client?: Firestore;
  #config: ApiEnv;
  #logger: FastifyBaseLogger;
  #transientAlerts = new Map<string, Alert>();
  #transientCosts = new Map<string, CostSnapshot>();
  #transientDevices = new Map<string, DeviceState>();
  #transientSessions = new Map<string, Session>();

  constructor(config: ApiEnv, logger: FastifyBaseLogger) {
    this.#config = config;
    this.#logger = logger;
  }

  describeReadiness() {
    if (!this.#adcStatus.available) {
      return buildNotConfiguredCheck('firestore', this.#adcStatus.message, {
        database: this.#config.FIRESTORE_DATABASE
      });
    }

    return buildConfiguredCheck(
      'firestore',
      'Firestore repositories can initialize through Application Default Credentials.',
      {
        database: this.#config.FIRESTORE_DATABASE,
        deviceStatesCollection: this.#config.FIRESTORE_DEVICE_STATES_COLLECTION,
        sessionsCollection: this.#config.FIRESTORE_SESSIONS_COLLECTION
      }
    );
  }

  async getOperatorState() {
    const transientState = {
      devices: Array.from(this.#transientDevices.values()),
      sessions: Array.from(this.#transientSessions.values()),
      alerts: Array.from(this.#transientAlerts.values()),
      costs: Array.from(this.#transientCosts.values())
    };

    if (!this.#adcStatus.available) {
      return operatorStateSchema.parse(
        buildBootstrapOperatorState({
          ...transientState,
          fallbackReason: this.#adcStatus.message
        })
      );
    }

    try {
      const [devices, sessions, alerts, costs] = await Promise.all([
        this.#readCollection(
          this.#config.FIRESTORE_DEVICE_STATES_COLLECTION,
          deviceStateSchema
        ),
        this.#readCollection(this.#config.FIRESTORE_SESSIONS_COLLECTION, sessionSchema),
        this.#readCollection(this.#config.FIRESTORE_ALERTS_COLLECTION, alertSchema),
        this.#readCollection(
          this.#config.FIRESTORE_COST_SNAPSHOTS_COLLECTION,
          costSnapshotSchema
        )
      ]);

      const mergedDevices = mergeByKey(
        devices,
        transientState.devices,
        (device) => device.deviceId
      );
      const mergedSessions = mergeByKey(
        sessions,
        transientState.sessions,
        (session) => session.id
      );
      const mergedAlerts = mergeByKey(alerts, transientState.alerts, (alert) => alert.id);
      const mergedCosts = mergeByKey(costs, transientState.costs, (cost) => cost.id);

      if (
        mergedDevices.length === 0 &&
        mergedSessions.length === 0 &&
        mergedAlerts.length === 0 &&
        mergedCosts.length === 0
      ) {
        return operatorStateSchema.parse(
          buildBootstrapOperatorState({
            fallbackReason:
              'Firestore initialized successfully, but the bootstrap collections are still empty.'
          })
        );
      }

      return operatorStateSchema.parse({
        devices: mergedDevices,
        sessions: mergedSessions,
        alerts: mergedAlerts,
        costs: mergedCosts,
        generatedAt: new Date().toISOString(),
        dataSource: 'live'
      });
    } catch (error) {
      this.#logger.warn({ err: error }, 'firestore state read failed, falling back');

      return operatorStateSchema.parse(
        buildBootstrapOperatorState({
          ...transientState,
          fallbackReason:
            'Firestore read failed, so the API returned the controlled bootstrap fallback state instead.'
        })
      );
    }
  }

  async recordDeviceState(state: DeviceState): Promise<MutationReceipt> {
    const parsedState = deviceStateSchema.parse(state);
    this.#transientDevices.set(parsedState.deviceId, parsedState);

    return this.#persistDocument(
      this.#config.FIRESTORE_DEVICE_STATES_COLLECTION,
      parsedState.deviceId,
      parsedState,
      'device-state.heartbeat'
    );
  }

  async recordSession(session: Session): Promise<MutationReceipt> {
    const parsedSession = sessionSchema.parse(session);
    this.#transientSessions.set(parsedSession.id, parsedSession);

    return this.#persistDocument(
      this.#config.FIRESTORE_SESSIONS_COLLECTION,
      parsedSession.id,
      parsedSession,
      'session.upsert'
    );
  }

  async recordAlert(alert: Alert): Promise<MutationReceipt> {
    const parsedAlert = alertSchema.parse(alert);
    this.#transientAlerts.set(parsedAlert.id, parsedAlert);

    return this.#persistDocument(
      this.#config.FIRESTORE_ALERTS_COLLECTION,
      parsedAlert.id,
      parsedAlert,
      'alert.emit'
    );
  }

  async recordCostSnapshot(snapshot: CostSnapshot): Promise<MutationReceipt> {
    const parsedSnapshot = costSnapshotSchema.parse(snapshot);
    this.#transientCosts.set(parsedSnapshot.id, parsedSnapshot);

    return this.#persistDocument(
      this.#config.FIRESTORE_COST_SNAPSHOTS_COLLECTION,
      parsedSnapshot.id,
      parsedSnapshot,
      'cost-snapshot.record'
    );
  }

  // ---------------------------------------------------------------
  // Agent heartbeat v2 (Phase 2 / TD-024)
  //
  // NOTE: TTL on `agentHeartbeats` is a Firestore Console-level
  // setting (not configurable via the Node client SDK as of
  // @google-cloud/firestore 8.x). Manual step required by Akmal
  // before production scale:
  //   Console → Firestore → agentHeartbeats collection → TTL
  //   policy → field: receivedAt, 7 days.
  // Callouts also in the Phase 2 PR body.
  //
  // Collection name is hardcoded — pre-plan said no new env vars
  // this phase. If the name ever needs to flex per env, add a
  // config key then.
  // ---------------------------------------------------------------
  async recordAgentHeartbeat(
    heartbeat: AgentHeartbeatRequest,
    userId: string
  ): Promise<MutationReceipt> {
    const parsed = agentHeartbeatRequestSchema.parse(heartbeat);
    const receivedAtMs = Date.now();
    const receivedAt = new Date(receivedAtMs).toISOString();
    // Document id: `{agentId}__{receivedAtMs}`. Double underscore
    // because single underscore can appear in some UUID variants,
    // which would make the split parsing ambiguous if someone
    // ever wants to dissect the id from a dashboard.
    const documentId = `${parsed.agentId}__${receivedAtMs}`;
    return this.#persistDocument(
      AGENT_HEARTBEATS_COLLECTION,
      documentId,
      {
        ...parsed,
        userId,
        receivedAt
      },
      'agent-heartbeat.v2'
    );
  }

  // ---------------------------------------------------------------
  // Cost records + user budgets (Phase 2 / TD-022)
  //
  // Each usage record is an append-only row in `costRecords`; doc
  // id is auto so concurrent writes never collide. User budgets
  // are a keyed doc per userId in `userBudgets` — read via
  // getUserBudget(), upserted via setUserBudget() (not wired to a
  // public route yet; admin UI will use it once TD-025 lands).
  //
  // Index hints (manual Firestore setup, documented here so the
  // code comment carries the list next to the reads that need it):
  //   (userId, timestamp DESC)                  — status / spending
  //   (userId, providerId, timestamp DESC)       — per-provider breakdown
  // ---------------------------------------------------------------

  async recordCostUsage(record: CostUsageRecord): Promise<MutationReceipt> {
    const parsed = costUsageRecordSchema.parse(record);
    // Doc id: `{userId}__{taskId}`. Makes POST /v1/cost/record
    // idempotent per task — a duplicate submit for the same
    // (userId, taskId) overwrites without creating two rows.
    const documentId = `${parsed.userId}__${parsed.taskId}`;
    return this.#persistDocument(
      COST_RECORDS_COLLECTION,
      documentId,
      parsed,
      'cost.record'
    );
  }

  async listCostRecordsForUser(
    userId: string,
    range: { start: Date; end: Date }
  ): Promise<CostUsageRecord[]> {
    if (!this.#adcStatus.available) {
      // No Firestore access → empty array; route layer renders a
      // zeroed report with a `dataSource: bootstrap-fallback`
      // note.
      return [];
    }

    try {
      const snapshot = await this.#getClient()
        .collection(COST_RECORDS_COLLECTION)
        .where('userId', '==', userId)
        .where('timestamp', '>=', range.start.toISOString())
        .where('timestamp', '<', range.end.toISOString())
        .get();

      return snapshot.docs.flatMap((doc) => {
        const parsed = costUsageRecordSchema.safeParse(doc.data());
        if (!parsed.success) {
          this.#logger.warn(
            {
              collectionName: COST_RECORDS_COLLECTION,
              documentId: doc.id,
              issues: parsed.error.issues
            },
            'cost-record document skipped — does not match schema'
          );
          return [];
        }
        return [parsed.data];
      });
    } catch (err) {
      this.#logger.warn({ err, userId }, 'cost-record read failed');
      return [];
    }
  }

  async getUserBudget(userId: string): Promise<UserBudgetRecord | undefined> {
    if (!this.#adcStatus.available) return undefined;
    try {
      const doc = await this.#getClient()
        .collection(USER_BUDGETS_COLLECTION)
        .doc(userId)
        .get();
      if (!doc.exists) return undefined;
      const parsed = userBudgetRecordSchema.safeParse(doc.data());
      if (!parsed.success) {
        this.#logger.warn(
          {
            collectionName: USER_BUDGETS_COLLECTION,
            documentId: userId,
            issues: parsed.error.issues
          },
          'user-budget document skipped — does not match schema'
        );
        return undefined;
      }
      return parsed.data;
    } catch (err) {
      this.#logger.warn({ err, userId }, 'user-budget read failed');
      return undefined;
    }
  }

  async setUserBudget(record: UserBudgetRecord): Promise<MutationReceipt> {
    const parsed = userBudgetRecordSchema.parse(record);
    return this.#persistDocument(
      USER_BUDGETS_COLLECTION,
      parsed.userId,
      parsed,
      'user-budget.upsert'
    );
  }

  // ---------------------------------------------------------------
  // Tasks (Phase 3.1)
  //
  // Doc id = taskId. Schema-validated on both read and write.
  // Firestore TTL policy applied on `expireAt` (manual Console
  // step, documented in PR #33 body). TTL fires when expireAt
  // has passed — same pattern as TD-026's agentHeartbeats fix.
  //
  // Reads enforce ownership at this layer (getTask takes userId)
  // so every caller is forced through the ownership-check path
  // and there's one place to audit.
  // ---------------------------------------------------------------

  async recordTask(record: TaskRecord): Promise<MutationReceipt> {
    const parsed = taskRecordSchema.parse(record);
    return this.#persistDocument(
      TASKS_COLLECTION,
      parsed.taskId,
      parsed,
      'task.upsert'
    );
  }

  /**
   * Returns the task ONLY if it exists AND belongs to `userId`.
   * A mismatch returns undefined (route layer renders 404 so
   * we never leak existence of someone else's task).
   */
  async getTask(
    taskId: string,
    userId: string
  ): Promise<TaskRecord | undefined> {
    if (!this.#adcStatus.available) return undefined;
    try {
      const doc = await this.#getClient()
        .collection(TASKS_COLLECTION)
        .doc(taskId)
        .get();
      if (!doc.exists) return undefined;
      const parsed = taskRecordSchema.safeParse(doc.data());
      if (!parsed.success) {
        this.#logger.warn(
          {
            collectionName: TASKS_COLLECTION,
            documentId: taskId,
            issues: parsed.error.issues
          },
          'task document skipped — does not match schema'
        );
        return undefined;
      }
      if (parsed.data.userId !== userId) {
        // Ownership mismatch. Not this user's task — pretend it
        // doesn't exist so the route can 404 without leaking.
        return undefined;
      }
      return parsed.data;
    } catch (err) {
      this.#logger.warn({ err, taskId, userId }, 'task read failed');
      return undefined;
    }
  }

  /**
   * Finds a task that matches `(userId, idempotencyKey)`. Used
   * by POST /v1/tasks as a rebuild path when the in-memory LRU
   * idempotency cache has evicted / restarted. The composite
   * index (idempotencyKey, userId, createdAt DESC) supports
   * this query; manual Console step listed in PR #33 body.
   */
  async findTaskByIdempotencyKey(
    userId: string,
    idempotencyKey: string
  ): Promise<TaskRecord | undefined> {
    if (!this.#adcStatus.available) return undefined;
    try {
      const snapshot = await this.#getClient()
        .collection(TASKS_COLLECTION)
        .where('idempotencyKey', '==', idempotencyKey)
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();
      if (snapshot.empty) return undefined;
      const parsed = taskRecordSchema.safeParse(snapshot.docs[0].data());
      if (!parsed.success) {
        this.#logger.warn(
          {
            collectionName: TASKS_COLLECTION,
            documentId: snapshot.docs[0].id,
            issues: parsed.error.issues
          },
          'idempotency-lookup row skipped — schema drift'
        );
        return undefined;
      }
      return parsed.data;
    } catch (err) {
      this.#logger.warn(
        { err, userId, idempotencyKey },
        'idempotency lookup failed'
      );
      return undefined;
    }
  }

  /**
   * Paginated list for GET /v1/tasks. Cursor is the ISO
   * `createdAt` of the last row of the previous page — opaque
   * to callers.
   */
  async listTasksForUser(
    userId: string,
    options: ListTasksQuery = {}
  ): Promise<{
    readonly tasks: readonly TaskStatusResponse[];
    readonly nextCursor: string | null;
  }> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    if (!this.#adcStatus.available) {
      return { tasks: [], nextCursor: null };
    }

    try {
      let query = this.#getClient()
        .collection(TASKS_COLLECTION)
        .where('userId', '==', userId) as FirebaseFirestore.Query;

      if (options.status !== undefined) {
        // Validate caller-supplied status before pushing to Firestore.
        // Route layer also safeParses — belt and braces.
        taskStatusSchema.parse(options.status);
        query = query.where('status', '==', options.status);
      }

      query = query.orderBy('createdAt', 'desc').limit(limit + 1);
      if (options.cursor !== undefined) {
        query = query.startAfter(options.cursor);
      }

      const snapshot = await query.get();
      const docs = snapshot.docs;
      const parsed: TaskStatusResponse[] = docs.flatMap((doc) => {
        const r = taskRecordSchema.safeParse(doc.data());
        if (!r.success) {
          this.#logger.warn(
            {
              collectionName: TASKS_COLLECTION,
              documentId: doc.id,
              issues: r.error.issues
            },
            'task list row skipped — schema drift'
          );
          return [];
        }
        return [taskStatusResponseProjection(r.data)];
      });

      if (parsed.length > limit) {
        // Extra row is the next-page marker; drop it and emit a
        // cursor pointing at the last *kept* row's createdAt.
        const page = parsed.slice(0, limit);
        return {
          tasks: page,
          nextCursor: page[page.length - 1]?.createdAt ?? null
        };
      }
      return { tasks: parsed, nextCursor: null };
    } catch (err) {
      this.#logger.warn({ err, userId }, 'task list read failed');
      return { tasks: [], nextCursor: null };
    }
  }

  /**
   * Internal-dispatch read — no ownership check. Used by the Phase 3.2
   * dispatch pipeline (Pub/Sub push handler → router → WS) where the
   * caller is the api itself, not an end-user session. Ownership
   * enforcement still happens on user-facing getTask(taskId, userId).
   */
  async getTaskByIdInternal(taskId: string): Promise<TaskRecord | undefined> {
    if (!this.#adcStatus.available) return undefined;
    try {
      const doc = await this.#getClient()
        .collection(TASKS_COLLECTION)
        .doc(taskId)
        .get();
      if (!doc.exists) return undefined;
      const parsed = taskRecordSchema.safeParse(doc.data());
      if (!parsed.success) {
        this.#logger.warn(
          {
            collectionName: TASKS_COLLECTION,
            documentId: taskId,
            issues: parsed.error.issues
          },
          'internal task read skipped — schema drift'
        );
        return undefined;
      }
      return parsed.data;
    } catch (err) {
      this.#logger.warn({ err, taskId }, 'internal task read failed');
      return undefined;
    }
  }

  /**
   * Partial task update — Phase 3.2 dispatch writes status transitions
   * (pending → queued → assigned → failed) and assignedAgentId. Fields
   * not present in the patch are left unchanged. updatedAt is
   * auto-set if the caller does not provide it.
   *
   * Returns {updated: false} on ADC-absent or Firestore failure; the
   * dispatch pipeline tolerates record-only fallbacks the same way
   * the publisher and retry scheduler do.
   */
  async updateTask(
    taskId: string,
    patch: {
      readonly status?: TaskStatus;
      readonly assignedAgentId?: string | null;
      readonly error?: { readonly code: string; readonly message: string } | null;
      readonly updatedAt?: string;
    }
  ): Promise<{ readonly updated: boolean }> {
    if (!this.#adcStatus.available) return { updated: false };
    try {
      const sanitized: Record<string, unknown> = {
        updatedAt: patch.updatedAt ?? new Date().toISOString()
      };
      if (patch.status !== undefined) sanitized.status = patch.status;
      if (patch.assignedAgentId !== undefined) {
        sanitized.assignedAgentId = patch.assignedAgentId;
      }
      if (patch.error !== undefined) sanitized.error = patch.error;

      await this.#getClient()
        .collection(TASKS_COLLECTION)
        .doc(taskId)
        .update(sanitized);
      return { updated: true };
    } catch (err) {
      this.#logger.warn({ err, taskId, patch }, 'task update failed');
      return { updated: false };
    }
  }

  /**
   * Phase 3.3 streaming: atomically append a delta to the task's
   * `outputDeltas` array. Idempotent at the Firestore layer because
   * `arrayUnion` deduplicates by deep equality — a Pub/Sub redelivery
   * of the same delta (same seq + delta + timestamp) is a no-op.
   *
   * Returns `{appended: false}` on ADC-absent or write failure; the
   * dispatch pipeline tolerates record-only fallbacks the same way
   * publisher and updateTask do.
   */
  async appendTaskDelta(
    taskId: string,
    delta: { readonly seq: number; readonly delta: string; readonly timestamp: string }
  ): Promise<{ readonly appended: boolean }> {
    if (!this.#adcStatus.available) return { appended: false };
    try {
      await this.#getClient()
        .collection(TASKS_COLLECTION)
        .doc(taskId)
        .update({
          outputDeltas: FieldValue.arrayUnion(delta),
          updatedAt: new Date().toISOString()
        });
      return { appended: true };
    } catch (err) {
      this.#logger.warn(
        { err, taskId, seq: delta.seq },
        'task delta append failed'
      );
      return { appended: false };
    }
  }

  /**
   * Phase 3.3 terminal state write — records final status + output
   * (or error) + completedAt timestamp. Used by the WS task-completed
   * / task-failed callbacks (composed in `app.ts`) and by the
   * dispatch handler when DLQ-promoting a max-attempt task.
   */
  async setTaskTerminal(
    taskId: string,
    params: {
      readonly status: 'completed' | 'failed' | 'cancelled';
      readonly output?: string | null;
      readonly error?: { readonly code: string; readonly message: string } | null;
      readonly completedAt?: string;
    }
  ): Promise<{ readonly updated: boolean }> {
    if (!this.#adcStatus.available) return { updated: false };
    try {
      const sanitized: Record<string, unknown> = {
        status: params.status,
        completedAt: params.completedAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      if (params.output !== undefined) sanitized.output = params.output;
      if (params.error !== undefined) sanitized.error = params.error;

      await this.#getClient()
        .collection(TASKS_COLLECTION)
        .doc(taskId)
        .update(sanitized);
      return { updated: true };
    } catch (err) {
      this.#logger.warn(
        { err, taskId, status: params.status },
        'task terminal write failed'
      );
      return { updated: false };
    }
  }

  async appendAuditEvent(event: AnalyticsEvent): Promise<MutationReceipt> {
    const parsedEvent = analyticsEventSchema.parse(event);

    return this.#persistDocument(
      this.#config.FIRESTORE_AUDIT_EVENTS_COLLECTION,
      parsedEvent.id,
      parsedEvent,
      'audit.append'
    );
  }

  async saveOperatorStateSnapshot(state: OperatorState): Promise<MutationReceipt> {
    const parsedState = operatorStateSchema.parse(state);

    return this.#persistDocument(
      this.#config.FIRESTORE_OPERATOR_STATES_COLLECTION,
      'latest',
      parsedState,
      'operator-state.snapshot'
    );
  }

  async #persistDocument(
    collectionName: string,
    documentId: string,
    payload: Record<string, unknown>,
    operation: string
  ): Promise<MutationReceipt> {
    if (!this.#adcStatus.available) {
      return mutationReceiptSchema.parse({
        operation,
        accepted: true,
        resourceId: documentId,
        dataSource: 'api-controlled-fallback',
        message:
          'Stored in the API fallback overlay because Firestore ADC is not configured locally.',
        timestamp: new Date().toISOString()
      });
    }

    try {
      await this.#getClient().collection(collectionName).doc(documentId).set(payload, {
        merge: true
      });

      return mutationReceiptSchema.parse({
        operation,
        accepted: true,
        resourceId: documentId,
        dataSource: 'live',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.#logger.warn({ err: error, collectionName, documentId }, 'firestore write failed');

      return mutationReceiptSchema.parse({
        operation,
        accepted: true,
        resourceId: documentId,
        dataSource: 'api-controlled-fallback',
        message:
          'The request was accepted locally, but Firestore persistence failed and remains a controlled fallback.',
        timestamp: new Date().toISOString()
      });
    }
  }

  async #readCollection<T>(
    collectionName: string,
    schema: ZodType<T>
  ): Promise<T[]> {
    const snapshot = await this.#getClient().collection(collectionName).get();

    return snapshot.docs.flatMap((document) => {
      const parsed = schema.safeParse(document.data());

      if (!parsed.success) {
        this.#logger.warn(
          {
            collectionName,
            documentId: document.id,
            issues: parsed.error.issues
          },
          'firestore document skipped because it does not match the shared contract'
        );
        return [];
      }

      return [parsed.data];
    });
  }

  #getClient() {
    this.#client ??= new Firestore({
      projectId: this.#config.GOOGLE_CLOUD_PROJECT,
      databaseId: this.#config.FIRESTORE_DATABASE
    });

    return this.#client;
  }
}
