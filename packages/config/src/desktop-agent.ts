import { z } from 'zod';

import {
  booleanFromString,
  integerFromString,
  nodeEnvSchema
} from './helpers.js';

export const desktopAgentEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: z.string().min(1).default('info'),
  GOOGLE_CLOUD_PROJECT: z.string().min(1).default('operator-os-dev'),
  AGENT_ID: z.string().min(1).default('local-desktop-agent'),
  DEVICE_ID: z.string().min(1).default('local-device'),
  DEVICE_NAME: z.string().min(1).default('Local Workstation'),
  DEVICE_PLATFORM: z.enum(['windows', 'macos', 'linux']).default('windows'),
  API_BASE_URL: z.string().url().default('http://localhost:8080'),
  API_REQUEST_TIMEOUT_MS: integerFromString(10000),
  HEARTBEAT_INTERVAL_MS: integerFromString(30000),
  COMMAND_POLL_INTERVAL_MS: integerFromString(15000),
  SESSION_POLL_INTERVAL_MS: integerFromString(15000),
  ENABLE_COMMAND_EXECUTION: booleanFromString(false),
  CONTROLLED_FALLBACK: booleanFromString(true),
  EXPORTS_BUCKET: z.string().min(1).default('operator-os-dev-exports'),
  REMOTE_BUCKET: z.string().min(1).default('operator-os-dev-remote'),
  NOTIFIER_TOPIC: z.string().min(1).default('operator-alerts')
});

export type DesktopAgentEnv = z.infer<typeof desktopAgentEnvSchema>;

export const parseDesktopAgentEnv = (
  env: Record<string, string | undefined>
) => desktopAgentEnvSchema.parse(env);
