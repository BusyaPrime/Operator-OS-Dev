import { z } from 'zod';

import { isoTimestampSchema } from './common.js';
import { operatorRoleSchema } from './auth.js';

export const planTierSchema = z.enum(['free', 'pro', 'team', 'enterprise']);

export const operatorUserSchema = z.object({
  id: z.string().min(1),
  googleSubject: z.string().min(1),
  email: z.string().email(),
  displayName: z.string().min(1).optional(),
  avatarUrl: z.string().url().optional(),
  roles: z.array(operatorRoleSchema).default(['owner']),
  plan: planTierSchema.default('free'),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  lastSeenAt: isoTimestampSchema.optional()
});

export const signinRequestSchema = z.object({
  provider: z.literal('google').default('google'),
  idToken: z.string().min(1)
});

export const accessTokenPayloadSchema = z.object({
  sub: z.string().min(1),
  iss: z.string().min(1),
  aud: z.string().min(1),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  scopes: z.array(z.string()).default([]),
  plan: planTierSchema.default('free'),
  operatorId: z.string().min(1),
  email: z.string().email().optional()
});

export const signinResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  accessTokenExpiresAt: isoTimestampSchema,
  refreshTokenExpiresAt: isoTimestampSchema,
  user: operatorUserSchema
});

export const refreshTokenRecordSchema = z.object({
  hash: z.string().min(1),
  userId: z.string().min(1),
  createdAt: isoTimestampSchema,
  expiresAt: isoTimestampSchema,
  revokedAt: isoTimestampSchema.optional(),
  rotatedTo: z.string().min(1).optional(),
  source: z.string().min(1).default('signin'),
  userAgent: z.string().max(512).optional()
});

export type OperatorUser = z.infer<typeof operatorUserSchema>;
export type PlanTier = z.infer<typeof planTierSchema>;
export type SigninRequest = z.infer<typeof signinRequestSchema>;
export type AccessTokenPayload = z.infer<typeof accessTokenPayloadSchema>;
export type SigninResponse = z.infer<typeof signinResponseSchema>;
export type RefreshTokenRecord = z.infer<typeof refreshTokenRecordSchema>;
