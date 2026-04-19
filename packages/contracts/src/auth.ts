import { z } from 'zod';

import { isoTimestampSchema, metadataSchema } from './common.js';

export const operatorRoleSchema = z.enum(['owner', 'admin', 'viewer', 'agent']);

export const verifiedUserContextSchema = z.object({
  uid: z.string().min(1),
  operatorId: z.string().min(1),
  email: z.string().email().optional(),
  displayName: z.string().min(1).optional(),
  roles: z.array(operatorRoleSchema).default(['viewer']),
  source: z.enum(['firebase-id-token', 'bootstrap-fallback', 'anonymous']),
  authTime: isoTimestampSchema.optional(),
  claims: metadataSchema.default({})
});

export const authSessionSchema = z.object({
  authenticated: z.boolean(),
  source: z.enum(['firebase-id-token', 'bootstrap-fallback', 'anonymous']),
  currentUser: verifiedUserContextSchema.optional(),
  message: z.string().min(1).optional()
});

export type AuthSession = z.infer<typeof authSessionSchema>;
export type VerifiedUserContext = z.infer<typeof verifiedUserContextSchema>;
