import { z } from 'zod';

import {
  booleanFromString,
  integerFromString,
  nodeEnvSchema
} from './helpers.js';

export const apiEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: integerFromString(8080),
  LOG_LEVEL: z.string().min(1).default('info'),
  API_SERVICE_NAME: z.string().min(1).default('operator-os-api'),
  GOOGLE_CLOUD_PROJECT: z.string().min(1).default('operator-os-dev'),
  VERTEX_LOCATION: z.string().min(1).default('europe-west4'),
  VERTEX_MODEL: z.string().min(1).default('gemini-2.5-flash'),
  FIRESTORE_DATABASE: z.string().min(1).default('(default)'),
  COMMANDS_QUEUE: z.string().min(1).default('commands'),
  APPROVALS_QUEUE: z.string().min(1).default('approvals'),
  EXPORTS_QUEUE: z.string().min(1).default('exports'),
  AGENT_EVENTS_TOPIC: z.string().min(1).default('agent-events'),
  BUDGET_EVENTS_TOPIC: z.string().min(1).default('budget-events'),
  OPERATOR_ALERTS_TOPIC: z.string().min(1).default('operator-alerts'),
  SESSION_EVENTS_TOPIC: z.string().min(1).default('session-events'),
  ARTIFACTS_BUCKET: z.string().min(1).default('operator-os-dev-artifacts'),
  EXPORTS_BUCKET: z.string().min(1).default('operator-os-dev-exports'),
  REMOTE_BUCKET: z.string().min(1).default('operator-os-dev-remote'),
  OPERATOR_JWT_SECRET_NAME: z
    .string()
    .min(1)
    .default('operator-jwt-secret'),
  SESSION_SIGNING_SECRET_NAME: z
    .string()
    .min(1)
    .default('session-signing-secret'),
  READINESS_STRICT: booleanFromString(false)
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const parseApiEnv = (env: Record<string, string | undefined>) =>
  apiEnvSchema.parse(env);
