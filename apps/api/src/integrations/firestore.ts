import { Firestore } from '@google-cloud/firestore';
import type { ApiEnv } from '@operator-os/config';
import {
  alertSchema,
  analyticsEventSchema,
  agentHeartbeatRequestSchema,
  costSnapshotSchema,
  deviceStateSchema,
  mutationReceiptSchema,
  operatorStateSchema,
  sessionSchema,
  type Alert,
  type AgentHeartbeatRequest,
  type AnalyticsEvent,
  type CostSnapshot,
  type DeviceState,
  type MutationReceipt,
  type OperatorState,
  type Session
} from '@operator-os/contracts';
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
