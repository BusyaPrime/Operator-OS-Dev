import { z } from 'zod';

import { isoTimestampSchema } from './common.js';
import { authSessionSchema } from './auth.js';
import { healthResponseSchema } from './health.js';
import {
  alertSchema,
  commandSchema,
  costSnapshotSchema,
  deviceStateSchema,
  exportJobSchema,
  sessionSchema
} from './operator.js';

export const dataSourceModeSchema = z.enum([
  'live',
  'bootstrap-fallback',
  'api-controlled-fallback'
]);

export const operatorStateSchema = z.object({
  devices: z.array(deviceStateSchema).default([]),
  sessions: z.array(sessionSchema).default([]),
  alerts: z.array(alertSchema).default([]),
  costs: z.array(costSnapshotSchema).default([]),
  generatedAt: isoTimestampSchema,
  dataSource: dataSourceModeSchema,
  fallbackReason: z.string().min(1).optional()
});

export const operatorDashboardSchema = z.object({
  operatorState: operatorStateSchema,
  health: healthResponseSchema,
  readiness: healthResponseSchema,
  auth: authSessionSchema
});

export const commandPollResponseSchema = z.object({
  deviceId: z.string().min(1),
  commands: z.array(commandSchema).default([]),
  generatedAt: isoTimestampSchema,
  dataSource: dataSourceModeSchema,
  fallbackReason: z.string().min(1).optional()
});

export const mutationReceiptSchema = z.object({
  operation: z.string().min(1),
  accepted: z.boolean(),
  resourceId: z.string().min(1).optional(),
  dataSource: dataSourceModeSchema,
  message: z.string().min(1).optional(),
  timestamp: isoTimestampSchema
});

export const exportReceiptSchema = mutationReceiptSchema.extend({
  exportJob: exportJobSchema.optional()
});

export const sessionReceiptSchema = mutationReceiptSchema.extend({
  session: sessionSchema.optional()
});

export type CommandPollResponse = z.infer<typeof commandPollResponseSchema>;
export type MutationReceipt = z.infer<typeof mutationReceiptSchema>;
export type OperatorDashboard = z.infer<typeof operatorDashboardSchema>;
export type OperatorState = z.infer<typeof operatorStateSchema>;
