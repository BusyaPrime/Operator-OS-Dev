import type { ApiEnv } from '@operator-os/config';
import {
  authSessionSchema,
  healthResponseSchema,
  operatorDashboardSchema,
  operatorStateSchema
} from '@operator-os/contracts';
import type { FastifyInstance } from 'fastify';

import { buildHealthResponse } from '../readiness.js';
import type { FirebaseAuthService } from '../integrations/auth.js';
import type { FirestoreOperatorRepository } from '../integrations/firestore.js';

interface OperatorRoutesOptions {
  authService: FirebaseAuthService;
  buildReadiness: () => ReturnType<typeof buildHealthResponse>;
  config: ApiEnv;
  repository: FirestoreOperatorRepository;
}

const fallbackSession = authSessionSchema.parse({
  authenticated: false,
  source: 'bootstrap-fallback',
  message: 'Authentication state has not been resolved for this request yet.'
});

export const registerOperatorRoutes = async (
  app: FastifyInstance,
  options: OperatorRoutesOptions
) => {
  const optionalGuard = options.authService.createOptionalGuard();

  app.get('/v1/auth/session', { preHandler: optionalGuard }, async (request) =>
    authSessionSchema.parse(request.authSession ?? fallbackSession)
  );

  app.get('/v1/operator/state', { preHandler: optionalGuard }, async () =>
    operatorStateSchema.parse(await options.repository.getOperatorState())
  );

  app.get('/v1/operator/dashboard', { preHandler: optionalGuard }, async (request) =>
    operatorDashboardSchema.parse({
      operatorState: await options.repository.getOperatorState(),
      health: healthResponseSchema.parse(buildHealthResponse(options.config)),
      readiness: healthResponseSchema.parse(options.buildReadiness()),
      auth: authSessionSchema.parse(request.authSession ?? fallbackSession)
    })
  );

  app.get('/v1/devices', async () => (await options.repository.getOperatorState()).devices);
  app.get('/v1/sessions', async () => (await options.repository.getOperatorState()).sessions);
  app.get('/v1/alerts', async () => (await options.repository.getOperatorState()).alerts);
  app.get('/v1/costs', async () => (await options.repository.getOperatorState()).costs);
};
