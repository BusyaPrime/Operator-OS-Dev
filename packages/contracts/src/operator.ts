import { z } from 'zod';

import { isoTimestampSchema, metadataSchema } from './common.js';

export const commandStatusSchema = z.enum([
  'pending',
  'approved',
  'dispatched',
  'running',
  'succeeded',
  'failed',
  'cancelled'
]);

export const commandTypeSchema = z.enum([
  'heartbeat',
  'sync_state',
  'start_session',
  'end_session',
  'export_artifacts',
  'ack_alert',
  'custom'
]);

export const devicePlatformSchema = z.enum(['windows', 'macos', 'linux']);

export const deviceCapabilitySchema = z.enum([
  'heartbeat',
  'commands',
  'exports',
  'trusted-session',
  'telemetry'
]);

export const deviceRuntimeStatusSchema = z.enum([
  'offline',
  'starting',
  'ready',
  'busy',
  'error'
]);

export const commandSchema = z.object({
  id: z.string().min(1),
  type: commandTypeSchema,
  status: commandStatusSchema,
  deviceId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  operatorId: z.string().min(1),
  approvalRequired: z.boolean().default(true),
  payload: metadataSchema.default({}),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema.optional()
});

export const sessionStatusSchema = z.enum([
  'pending',
  'approved',
  'active',
  'paused',
  'ended',
  'rejected'
]);

export const sessionModeSchema = z.enum(['trusted', 'observe-only']);

export const sessionSchema = z.object({
  id: z.string().min(1),
  deviceId: z.string().min(1),
  operatorId: z.string().min(1),
  status: sessionStatusSchema,
  mode: sessionModeSchema,
  visibility: z.literal('visible'),
  approvalId: z.string().min(1).optional(),
  startedAt: isoTimestampSchema.optional(),
  endedAt: isoTimestampSchema.optional(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema.optional()
});

export const alertSeveritySchema = z.enum(['info', 'warning', 'critical']);
export const alertStatusSchema = z.enum(['open', 'acknowledged', 'resolved']);

export const alertSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  severity: alertSeveritySchema,
  status: alertStatusSchema,
  title: z.string().min(1),
  message: z.string().min(1),
  deviceId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema.optional(),
  metadata: metadataSchema.default({})
});

export const exportJobStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed'
]);

export const exportJobTypeSchema = z.enum([
  'session-record',
  'artifact-bundle',
  'analytics-snapshot'
]);

export const exportJobSchema = z.object({
  id: z.string().min(1),
  type: exportJobTypeSchema,
  status: exportJobStatusSchema,
  deviceId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  destinationBucket: z.string().min(1),
  objectPath: z.string().min(1).optional(),
  requestedAt: isoTimestampSchema,
  completedAt: isoTimestampSchema.optional(),
  metadata: metadataSchema.default({})
});

export const analyticsEventCategorySchema = z.enum([
  'agent',
  'session',
  'budget',
  'alert',
  'deploy'
]);

export const analyticsEventSchema = z.object({
  id: z.string().min(1),
  category: analyticsEventCategorySchema,
  action: z.string().min(1),
  subjectId: z.string().min(1),
  occurredAt: isoTimestampSchema,
  metadata: metadataSchema.default({})
});

export const costScopeSchema = z.enum(['project', 'service', 'device', 'session']);

export const costSnapshotSchema = z.object({
  id: z.string().min(1),
  scope: costScopeSchema,
  scopeId: z.string().min(1),
  totalUsd: z.number().nonnegative(),
  currency: z.literal('USD').default('USD'),
  windowStart: isoTimestampSchema,
  windowEnd: isoTimestampSchema,
  budgetName: z.string().min(1).optional(),
  alertsOpen: z.number().int().nonnegative().default(0)
});

export const deviceStateSchema = z.object({
  deviceId: z.string().min(1),
  displayName: z.string().min(1),
  platform: devicePlatformSchema,
  runtimeStatus: deviceRuntimeStatusSchema,
  agentVersion: z.string().min(1),
  lastHeartbeatAt: isoTimestampSchema.optional(),
  activeSessionId: z.string().min(1).optional(),
  capabilities: z.array(deviceCapabilitySchema).default([]),
  metadata: metadataSchema.default({})
});

export type Alert = z.infer<typeof alertSchema>;
export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;
export type Command = z.infer<typeof commandSchema>;
export type CostSnapshot = z.infer<typeof costSnapshotSchema>;
export type DeviceState = z.infer<typeof deviceStateSchema>;
export type ExportJob = z.infer<typeof exportJobSchema>;
export type Session = z.infer<typeof sessionSchema>;
