import { z } from 'zod';

import { isoTimestampSchema, metadataSchema } from './common.js';
import {
  alertSchema,
  commandSchema,
  costSnapshotSchema,
  deviceStateSchema,
  exportJobSchema,
  sessionSchema
} from './operator.js';

export const queueNameSchema = z.enum(['commands', 'approvals', 'exports']);

export const commandQueuePayloadSchema = z.object({
  queue: z.literal('commands'),
  requestedAt: isoTimestampSchema,
  command: commandSchema
});

export const approvalQueuePayloadSchema = z.object({
  queue: z.literal('approvals'),
  requestedAt: isoTimestampSchema,
  commandId: z.string().min(1),
  operatorId: z.string().min(1),
  metadata: metadataSchema.default({})
});

export const exportQueuePayloadSchema = z.object({
  queue: z.literal('exports'),
  requestedAt: isoTimestampSchema,
  exportJob: exportJobSchema
});

export const pubsubTopicSchema = z.enum([
  'agent-events',
  'budget-events',
  'operator-alerts',
  'session-events'
]);

export const agentEventMessageSchema = z.object({
  topic: z.literal('agent-events'),
  publishedAt: isoTimestampSchema,
  device: deviceStateSchema,
  metadata: metadataSchema.default({})
});

export const budgetEventMessageSchema = z.object({
  topic: z.literal('budget-events'),
  publishedAt: isoTimestampSchema,
  snapshot: costSnapshotSchema,
  metadata: metadataSchema.default({})
});

export const alertEventMessageSchema = z.object({
  topic: z.literal('operator-alerts'),
  publishedAt: isoTimestampSchema,
  alert: alertSchema,
  metadata: metadataSchema.default({})
});

export const sessionEventMessageSchema = z.object({
  topic: z.literal('session-events'),
  publishedAt: isoTimestampSchema,
  session: sessionSchema,
  metadata: metadataSchema.default({})
});

export type AlertEventMessage = z.infer<typeof alertEventMessageSchema>;
export type AgentEventMessage = z.infer<typeof agentEventMessageSchema>;
export type ApprovalQueuePayload = z.infer<typeof approvalQueuePayloadSchema>;
export type BudgetEventMessage = z.infer<typeof budgetEventMessageSchema>;
export type CommandQueuePayload = z.infer<typeof commandQueuePayloadSchema>;
export type ExportQueuePayload = z.infer<typeof exportQueuePayloadSchema>;
export type SessionEventMessage = z.infer<typeof sessionEventMessageSchema>;
