import { z } from 'zod';

import {
  booleanFromString,
  integerFromString,
  nodeEnvSchema
} from './helpers.js';

const commaSeparatedStringList = () =>
  z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
        : []
    );

export const authGatewayEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: integerFromString(8081),
  LOG_LEVEL: z.string().min(1).default('info'),
  AUTH_GATEWAY_SERVICE_NAME: z
    .string()
    .min(1)
    .default('operator-auth-gateway'),
  GOOGLE_CLOUD_PROJECT: z.string().min(1).default('operator-os-dev'),
  FIREBASE_PROJECT_ID: z.string().min(1).default('operator-os-dev'),
  AUTH_ACCESS_TOKEN_ISSUER: z
    .string()
    .min(1)
    .default('operator-auth-gateway'),
  AUTH_ACCESS_TOKEN_AUDIENCE: z.string().min(1).default('operator-os-api'),
  AUTH_ACCESS_TOKEN_TTL_SECONDS: integerFromString(3600),
  AUTH_REFRESH_TOKEN_TTL_SECONDS: integerFromString(2592000),
  AUTH_JWT_SIGNING_SECRET_NAME: z
    .string()
    .min(1)
    .default('operator-jwt-secret'),
  AUTH_JWT_SIGNING_SECRET_LITERAL: z.string().optional(),
  AUTH_ACCEPTED_GOOGLE_CLIENT_IDS: commaSeparatedStringList(),
  FIRESTORE_USERS_COLLECTION: z.string().min(1).default('users'),
  FIRESTORE_REFRESH_TOKENS_COLLECTION: z
    .string()
    .min(1)
    .default('refreshTokens'),
  READINESS_STRICT: booleanFromString(false)
});

export type AuthGatewayEnv = z.infer<typeof authGatewayEnvSchema>;

export const parseAuthGatewayEnv = (env: Record<string, string | undefined>) =>
  authGatewayEnvSchema.parse(env);
