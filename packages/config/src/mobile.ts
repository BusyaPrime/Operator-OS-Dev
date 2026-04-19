import { z } from 'zod';

import { booleanFromString } from './helpers.js';

export const mobileEnvSchema = z.object({
  EXPO_PUBLIC_APP_ENV: z.string().min(1).default('development'),
  EXPO_PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:8080'),
  EXPO_PUBLIC_USE_MOCKS: booleanFromString(true)
});

export type MobileEnv = z.infer<typeof mobileEnvSchema>;

export const parseMobileEnv = (env: Record<string, string | undefined>) =>
  mobileEnvSchema.parse(env);
