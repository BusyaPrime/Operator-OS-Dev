import type { ApiEnv } from '@operator-os/config';
import { healthResponseSchema } from '@operator-os/contracts';
import type { FastifyInstance } from 'fastify';

import { buildHealthResponse, buildReadinessResponse } from '../readiness.js';
import type { OperatorModule } from '../types.js';

interface HealthRoutesOptions {
  config: ApiEnv;
  modules: readonly OperatorModule[];
}

export const registerHealthRoutes = async (
  app: FastifyInstance,
  options: HealthRoutesOptions
) => {
  app.get('/health', async () =>
    healthResponseSchema.parse(buildHealthResponse(options.config))
  );

  app.get('/ready', async (_, reply) => {
    const payload = healthResponseSchema.parse(
      buildReadinessResponse(options.config, options.modules)
    );

    if (payload.status === 'degraded') {
      reply.code(503);
    }

    return payload;
  });
};
