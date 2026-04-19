import { z } from 'zod';

import { booleanFromString } from './helpers.js';

export const mobileEnvSchema = z.object({
  EXPO_PUBLIC_APP_ENV: z.string().min(1).default('development'),
  EXPO_PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:8080'),
  EXPO_PUBLIC_API_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  EXPO_PUBLIC_USE_MOCKS: booleanFromString(true),
  EXPO_PUBLIC_CONTROLLED_FALLBACK: booleanFromString(true),
  EXPO_PUBLIC_AUTH_MODE: z
    .enum(['bootstrap-fallback', 'firebase'])
    .default('bootstrap-fallback')
});

export type MobileEnv = z.infer<typeof mobileEnvSchema>;

export const parseMobileEnv = (env: Record<string, string | undefined>) =>
  mobileEnvSchema.parse(env);
