import { z } from 'zod';

import {
  booleanFromString,
  integerFromString,
  nodeEnvSchema,
  optionalUrlFromString
} from './helpers.js';

export const apiEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: integerFromString(8080),
  LOG_LEVEL: z.string().min(1).default('info'),
  API_SERVICE_NAME: z.string().min(1).default('operator-os-api'),
  /**
   * Agent release pointer surfaced by GET /v1/agent/latest-version
   * (Phase 4.0 Part 3.G). Phase 4.0 returns it as the version
   * string with downloadUrl + signature null per TD-059. When
   * TD-059 lands the signed-update pipeline this field becomes
   * a real release tag the api reads from a GCS bucket pointer.
   */
  API_SERVICE_VERSION: z.string().min(1).default('0.1.0'),
  GOOGLE_CLOUD_PROJECT: z.string().min(1).default('operator-os-dev'),
  GOOGLE_CLOUD_REGION: z.string().min(1).default('europe-west4'),
  FIREBASE_PROJECT_ID: z.string().min(1).default('operator-os-dev'),
  VERTEX_LOCATION: z.string().min(1).default('europe-west4'),
  VERTEX_MODEL: z.string().min(1).default('gemini-2.5-flash'),
  FIRESTORE_DATABASE: z.string().min(1).default('(default)'),
  FIRESTORE_DEVICE_STATES_COLLECTION: z
    .string()
    .min(1)
    .default('deviceStates'),
  FIRESTORE_OPERATOR_STATES_COLLECTION: z
    .string()
    .min(1)
    .default('operatorStates'),
  FIRESTORE_SESSIONS_COLLECTION: z.string().min(1).default('sessions'),
  FIRESTORE_ALERTS_COLLECTION: z.string().min(1).default('alerts'),
  FIRESTORE_COST_SNAPSHOTS_COLLECTION: z
    .string()
    .min(1)
    .default('costSnapshots'),
  FIRESTORE_AUDIT_EVENTS_COLLECTION: z
    .string()
    .min(1)
    .default('auditEvents'),
  CLOUD_TASKS_LOCATION: z.string().min(1).default('europe-west1'),
  COMMANDS_QUEUE: z.string().min(1).default('commands'),
  APPROVALS_QUEUE: z.string().min(1).default('approvals'),
  EXPORTS_QUEUE: z.string().min(1).default('exports'),
  TASK_DISPATCH_RETRY_QUEUE: z
    .string()
    .min(1)
    .default('task-dispatch-retry-dev'),
  TASK_DISPATCH_RETRY_QUEUE_LOCATION: z
    .string()
    .min(1)
    .default('europe-west1'),
  TASK_DISPATCH_RETRY_DELAY_SECONDS: integerFromString(30),
  TASKS_TARGET_BASE_URL: optionalUrlFromString(),
  AGENT_AUDIENCE: optionalUrlFromString(),
  AUTH_ACCESS_TOKEN_ISSUER: z
    .string()
    .min(1)
    .default('operator-auth-gateway'),
  AUTH_ACCESS_TOKEN_AUDIENCE: z
    .string()
    .min(1)
    .default('operator-os-api'),
  AUTH_JWT_SIGNING_SECRET_NAME: z
    .string()
    .min(1)
    .default('operator-jwt-secret'),
  AUTH_JWT_SIGNING_SECRET_LITERAL: z.string().optional(),
  AGENT_EVENTS_TOPIC: z.string().min(1).default('agent-events'),
  BUDGET_EVENTS_TOPIC: z.string().min(1).default('budget-events'),
  OPERATOR_ALERTS_TOPIC: z.string().min(1).default('operator-alerts'),
  SESSION_EVENTS_TOPIC: z.string().min(1).default('session-events'),
  PUBSUB_TOPIC_TASK_DISPATCH: z
    .string()
    .min(1)
    .default('task-dispatch-dev'),
  PUBSUB_SUBSCRIPTION_TASK_DISPATCH: z
    .string()
    .min(1)
    .default('task-dispatch-api-dev'),
  PUBSUB_TOPIC_TASK_DLQ: z
    .string()
    .min(1)
    .default('task-dispatch-dlq-dev'),
  PUBSUB_PUSH_AUDIENCE: optionalUrlFromString(),
  BIGQUERY_DATASET: z.string().min(1).default('ops_analytics'),
  /**
   * Phase 4.0 TD-057 — agent auth audit backend selection.
   *
   * - `bigquery` (default): stream events into the
   *   `operator_os_dev_audit.agent_auth` partitioned + clustered
   *   table provisioned per ADR-025 D1.
   * - `logging`: keep the Phase 4.0 Part 3 stub behaviour
   *   (structured pino logs only). Used in tests where ADC is
   *   unavailable and in the breakglass case where BQ inserts
   *   are misbehaving.
   * - `noop`: drop events on the floor. Unused outside of niche
   *   diagnostic scenarios but available so the switch covers
   *   the full operational matrix without code changes.
   */
  AGENT_AUDIT_BACKEND: z
    .enum(['bigquery', 'logging', 'noop'])
    .optional(),
  AGENT_AUDIT_DATASET: z.string().min(1).default('operator_os_dev_audit'),
  AGENT_AUDIT_TABLE: z.string().min(1).default('agent_auth'),
  ARTIFACTS_BUCKET: z.string().min(1).default('operator-os-dev-artifacts'),
  EXPORTS_BUCKET: z.string().min(1).default('operator-os-dev-exports'),
  REMOTE_BUCKET: z.string().min(1).default('operator-os-dev-remote'),
  ARTIFACT_REGISTRY_REPOSITORY: z
    .string()
    .min(1)
    .default('operator-os-docker'),
  CLOUD_RUN_SERVICE_NAME: z.string().min(1).default('operator-os-api'),
  CLOUD_RUN_SERVICE_ACCOUNT: z
    .string()
    .min(1)
    .default('cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com'),
  OPERATOR_JWT_SECRET_NAME: z
    .string()
    .min(1)
    .default('operator-jwt-secret'),
  SESSION_SIGNING_SECRET_NAME: z
    .string()
    .min(1)
    .default('session-signing-secret'),
  GITHUB_TOKEN_SECRET_NAME: z.string().min(1).default('github-token'),
  READINESS_STRICT: booleanFromString(false)
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const parseApiEnv = (env: Record<string, string | undefined>) =>
  apiEnvSchema.parse(env);
