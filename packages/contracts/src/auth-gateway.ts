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

/**
 * Google ID tokens are compact JWTs: three base64url segments
 * (`header.payload.signature`) separated by a literal `.`. The
 * base64url alphabet is `A-Z a-z 0-9 - _`. No whitespace, no padding
 * `=`, no other characters are ever legal inside a real token.
 *
 * Clients that copy tokens out of browser UIs (OAuth Playground,
 * sign-in consoles) routinely end up pasting a string with embedded
 * line-wrap newlines, trailing whitespace, or BOMs. Those are never
 * valid JWT characters but we sanitise defensively rather than
 * failing downstream inside google-auth-library with a misleading
 * error (see TD-013).
 *
 * We strip **all** whitespace before validation. `\t`, `\n`, `\r`,
 * zero-width characters in the `\s` class, etc. are all removed.
 * Then we require exactly three base64url segments joined by `.`.
 */
const jwtShape = /^[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-=]+$/;

export const sanitizedJwtSchema = z
  .string()
  .min(1, { message: 'idToken is required' })
  .transform((value) => value.trim().replace(/\s+/g, ''))
  .refine((value) => value.length > 0, {
    message: 'idToken was empty after whitespace sanitisation'
  })
  .refine((value) => value.split('.').length === 3, {
    message:
      'idToken must have exactly three dot-separated segments (header.payload.signature)'
  })
  .refine((value) => jwtShape.test(value), {
    message:
      'idToken segments must use base64url characters (A-Z, a-z, 0-9, -, _) only'
  });

export const signinRequestSchema = z.object({
  provider: z.literal('google').default('google'),
  idToken: sanitizedJwtSchema
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

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1)
});

export const refreshResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  accessTokenExpiresAt: isoTimestampSchema,
  refreshTokenExpiresAt: isoTimestampSchema
});

export const signoutRequestSchema = z.object({
  refreshToken: z.string().min(1)
});

export type OperatorUser = z.infer<typeof operatorUserSchema>;
export type PlanTier = z.infer<typeof planTierSchema>;
export type SigninRequest = z.infer<typeof signinRequestSchema>;
export type AccessTokenPayload = z.infer<typeof accessTokenPayloadSchema>;
export type SigninResponse = z.infer<typeof signinResponseSchema>;
export type RefreshTokenRecord = z.infer<typeof refreshTokenRecordSchema>;
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;
export type SignoutRequest = z.infer<typeof signoutRequestSchema>;
