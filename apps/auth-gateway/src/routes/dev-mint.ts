import type { AuthGatewayEnv } from '@operator-os/config';
import type { OperatorUser } from '@operator-os/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { JwtIssuer } from '../services/jwt-issuer.js';

/**
 * Request body for `POST /v1/dev/mint-test-token`. The optional
 * `expiresInSeconds` overrides the gateway's default access-token
 * TTL (3600s) so tests that need a tighter or wider window can
 * specify one.
 */
export const devMintRequestSchema = z.object({
  userId: z.string().min(1).max(128),
  expiresInSeconds: z
    .number()
    .int()
    .positive()
    .max(86_400) // 24h cap — dev token, not a session
    .optional()
});

export const devMintResponseSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.string().datetime(),
  expiresInSeconds: z.number().int().positive(),
  userId: z.string().min(1),
  warning: z.string()
});

interface DevMintRoutesOptions {
  readonly config: AuthGatewayEnv;
  readonly jwtIssuer: JwtIssuer;
}

/**
 * Privileged dev-only token mint. Gated on the
 * `AUTH_DEV_MINT_ENABLED` env flag — when `false` (default), the
 * route is NOT registered, so probes return Fastify's default 404
 * just like any non-existent path. Disabled-state behaviour
 * deliberately matches "endpoint does not exist" rather than
 * "feature off" so a probe cannot distinguish the two.
 *
 * **Why one token type for both user and agent paths.** The api's
 * `createRequiredGuard` (user routes like `POST /v1/tasks`) and
 * `createAgentGuard` (agent WebSocket `/v1/agent/ws`) both accept
 * operator-HS256 access tokens via the same `AccessTokenVerifier`.
 * A single dev-minted token is therefore valid for BOTH the user
 * submission leg AND the agent control-channel handshake. The
 * smoke test uses one token in two places.
 *
 * Security stance:
 * - Default `false` flag closes the route entirely.
 * - When enabled, ANY caller can mint for ANY userId. The
 *   endpoint is not auth-gated by design — that would defeat the
 *   purpose of bootstrapping a test user. Don't enable it
 *   outside a smoke window.
 * - The 24h cap on `expiresInSeconds` limits blast radius if a
 *   token leaks despite gating.
 * - `request.log.warn` on every mint so unexpected use is
 *   auditable in Cloud Logging.
 */
export const registerDevMintRoutes = async (
  app: FastifyInstance,
  options: DevMintRoutesOptions
): Promise<void> => {
  if (!options.config.AUTH_DEV_MINT_ENABLED) {
    // Route is not registered. Any request returns Fastify's
    // default 404 — same as a typo. No feature-detection leak.
    return;
  }

  app.log.warn(
    {
      route: '/v1/dev/mint-test-token',
      flag: 'AUTH_DEV_MINT_ENABLED'
    },
    'dev mint route registered — disable AUTH_DEV_MINT_ENABLED outside smoke-test windows'
  );

  app.post('/v1/dev/mint-test-token', async (request) => {
    const body = devMintRequestSchema.parse(request.body);
    const expiresInSeconds =
      body.expiresInSeconds ?? options.config.AUTH_ACCESS_TOKEN_TTL_SECONDS;

    // Synthesise a minimal OperatorUser shape good enough for
    // token claims. Real users come from the UsersRepository on
    // sign-in; here we synthesise so callers don't need a
    // pre-existing Firestore row.
    const synthUser: OperatorUser = {
      id: body.userId,
      googleSubject: `dev-${body.userId}`,
      email: `${body.userId}@dev.invalid`,
      displayName: body.userId,
      roles: ['owner'],
      plan: 'free',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    };

    const issued = await options.jwtIssuer.issue(
      synthUser,
      [],
      expiresInSeconds
    );

    request.log.warn(
      {
        userId: body.userId,
        expiresAt: issued.expiresAt.toISOString(),
        expiresInSeconds
      },
      'dev mint: minted operator access token'
    );

    return devMintResponseSchema.parse({
      accessToken: issued.token,
      expiresAt: issued.expiresAt.toISOString(),
      expiresInSeconds,
      userId: body.userId,
      warning:
        'Dev-only token. Disable AUTH_DEV_MINT_ENABLED on the gateway after the test window closes.'
    });
  });
};
