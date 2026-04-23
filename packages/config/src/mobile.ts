import { z } from 'zod';

import { booleanFromString } from './helpers.js';

export const mobileEnvSchema = z.object({
  EXPO_PUBLIC_APP_ENV: z.string().min(1).default('development'),
  EXPO_PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:8080'),
  EXPO_PUBLIC_API_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  EXPO_PUBLIC_USE_MOCKS: booleanFromString(true),
  EXPO_PUBLIC_CONTROLLED_FALLBACK: booleanFromString(true),
  EXPO_PUBLIC_AUTH_MODE: z
    .enum(['bootstrap-fallback', 'firebase', 'google'])
    .default('bootstrap-fallback'),

  // ---- Phase 1.5 Google Sign-In additions --------------------------

  /**
   * Base URL for the auth-gateway service. Split from API_BASE_URL
   * because the gateway (HS256 minting + refresh) runs as a
   * separate Cloud Run service from the main api. In local dev
   * both may be `http://localhost:8081`; in prod they differ.
   */
  EXPO_PUBLIC_AUTH_GATEWAY_BASE_URL: z
    .string()
    .url()
    .default('http://localhost:8081'),

  /**
   * OAuth 2.0 client id for the *iOS* application, from
   * Google Cloud Console → APIs & Services → Credentials.
   * Required for native iOS Google Sign-In. Optional at
   * build-time because the dev client may stub the picker.
   */
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: z.string().min(1).optional(),

  /**
   * OAuth 2.0 client id for the *Android* application. Not used
   * directly by @react-native-google-signin at runtime (Android
   * reads `google-services.json` via the Play Services plugin),
   * but we carry it here so build-time config generators can
   * pull it from a single source of truth.
   */
  EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: z.string().min(1).optional(),

  /**
   * OAuth 2.0 *web* client id — this is the audience the
   * auth-gateway verifies against (same one in its
   * `AUTH_ACCEPTED_GOOGLE_CLIENT_IDS`). Google Sign-In requires
   * it via `webClientId` so the idToken's `aud` claim matches
   * server expectations.
   */
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: z.string().min(1).optional()
});

export type MobileEnv = z.infer<typeof mobileEnvSchema>;

export const parseMobileEnv = (env: Record<string, string | undefined>) =>
  mobileEnvSchema.parse(env);
