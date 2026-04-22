import { z } from 'zod';

/**
 * Agent-centric heartbeat payload. NEW and additive — does NOT
 * replace `deviceStateSchema` in `operator.ts`. Device state
 * models a mobile device's ambient telemetry; this schema
 * models an AI worker process's runtime (tasks, CPU, provider
 * capability status).
 *
 * See the DECISIONS.md ADR "Agent Heartbeat Schema Is Additive,
 * Not Replacement" (2026-04-24) for the decision history.
 */

/** Lifecycle state the agent reports in each heartbeat. */
export const agentHeartbeatStateSchema = z.enum([
  'idle',
  'busy',
  'degraded',
  'offline'
]);

/** Per-check health probe status. */
export const agentHeartbeatHealthStatusSchema = z.enum([
  'ok',
  'warn',
  'fail'
]);

/** Host OS family discriminator. */
export const agentHeartbeatPlatformSchema = z.enum([
  'win32',
  'darwin',
  'linux'
]);

/** Process + host load sample, all fields optional. */
export const agentHeartbeatSystemLoadSchema = z.object({
  cpuPercent: z.number().min(0).max(100).optional(),
  memoryUsedMb: z.number().nonnegative().optional(),
  memoryTotalMb: z.number().nonnegative().optional()
});

/**
 * Full heartbeat request body posted by the Desktop Agent to
 * the api on every heartbeat interval.
 */
export const agentHeartbeatRequestSchema = z.object({
  agentId: z.string().uuid(),
  providerId: z.string().min(1),
  providerVersion: z.string().min(1),
  platform: agentHeartbeatPlatformSchema,
  hostname: z.string().min(1),
  state: agentHeartbeatStateSchema,
  uptimeSeconds: z.number().int().nonnegative(),
  activeTaskCount: z.number().int().nonnegative(),
  systemLoad: agentHeartbeatSystemLoadSchema.optional(),
  healthChecks: z.record(z.string(), agentHeartbeatHealthStatusSchema),
  /** ISO8601 timestamp the agent generated this heartbeat. */
  timestamp: z.string().datetime()
});

/** Server-side command the api can send back in a heartbeat response. */
export const agentHeartbeatCommandSchema = z.object({
  type: z.enum(['pause', 'resume', 'shutdown', 'update-config']),
  payload: z.unknown()
});

/** Heartbeat response body returned to the Desktop Agent. */
export const agentHeartbeatResponseSchema = z.object({
  status: z.literal('ok'),
  /** ISO8601 timestamp when the api processed the heartbeat. */
  serverTime: z.string().datetime(),
  /** Task ids the api wants this agent to pick up next. */
  pendingTaskIds: z.array(z.string().uuid()),
  /** Ops commands the server wants this agent to apply. */
  commands: z.array(agentHeartbeatCommandSchema)
});

export type AgentHeartbeatState = z.infer<typeof agentHeartbeatStateSchema>;
export type AgentHeartbeatHealthStatus = z.infer<
  typeof agentHeartbeatHealthStatusSchema
>;
export type AgentHeartbeatPlatform = z.infer<
  typeof agentHeartbeatPlatformSchema
>;
export type AgentHeartbeatSystemLoad = z.infer<
  typeof agentHeartbeatSystemLoadSchema
>;
export type AgentHeartbeatRequest = z.infer<typeof agentHeartbeatRequestSchema>;
export type AgentHeartbeatCommand = z.infer<typeof agentHeartbeatCommandSchema>;
export type AgentHeartbeatResponse = z.infer<
  typeof agentHeartbeatResponseSchema
>;
