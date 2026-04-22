import { z } from 'zod';

import {
  booleanFromString,
  integerFromString,
  nodeEnvSchema,
  stringArrayFromCsv
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
  NOTIFIER_TOPIC: z.string().min(1).default('operator-alerts'),

  // AIAgent runtime additions (Week 2 Phase 1.4)

  /**
   * Absolute paths the agent's FileSystemProvider may access.
   * Comma-separated env var; the only source of file-access
   * authority. An agent that tries to write outside these
   * throws PathNotAllowedError at the provider boundary.
   */
  FS_ALLOWED_ROOTS: stringArrayFromCsv([process.cwd()]),

  /**
   * If true, every FileSystemProvider from this config is
   * read-only. Useful for audit / review agents.
   */
  FS_READ_ONLY: booleanFromString(false),

  /** Maximum bytes for a single writeFile. */
  FS_MAX_FILE_SIZE_BYTES: integerFromString(10 * 1024 * 1024),

  /** Maximum cumulative bytes across all writes in this session. */
  FS_MAX_TOTAL_WRITE_BYTES: integerFromString(100 * 1024 * 1024),

  /**
   * Provider ids of AIAgent plugins to load at startup. First-
   * party defaults: ["claude-code"]. Third-party plugins add to
   * this list via the provider registry (SPEC § 27.5) once that
   * machinery lands.
   */
  ENABLED_AGENTS: stringArrayFromCsv(['claude-code']),

  /**
   * User id on whose behalf this agent acts. Fed into
   * CostProvider calls so per-user budget + spending reporting
   * stay accurate. Required for multi-tenant deployments; for
   * single-operator local dev the default is sufficient.
   */
  AGENT_USER_ID: z.string().min(1).default('local-operator')
});

export type DesktopAgentEnv = z.infer<typeof desktopAgentEnvSchema>;

export const parseDesktopAgentEnv = (
  env: Record<string, string | undefined>
) => desktopAgentEnvSchema.parse(env);
