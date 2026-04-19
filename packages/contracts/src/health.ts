import { z } from 'zod';

import {
  environmentSchema,
  isoTimestampSchema,
  metadataSchema
} from './common.js';

export const serviceCheckStatusSchema = z.enum([
  'ok',
  'degraded',
  'not_configured'
]);

export const serviceCheckSchema = z.object({
  name: z.string().min(1),
  status: serviceCheckStatusSchema,
  message: z.string().min(1).optional(),
  details: metadataSchema.optional()
});

export const healthStatusSchema = z.enum(['ok', 'ready', 'degraded']);

export const healthResponseSchema = z.object({
  status: healthStatusSchema,
  service: z.string().min(1),
  version: z.string().min(1),
  environment: environmentSchema,
  timestamp: isoTimestampSchema,
  checks: z.array(serviceCheckSchema).default([])
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ServiceCheck = z.infer<typeof serviceCheckSchema>;
