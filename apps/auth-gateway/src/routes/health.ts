import type { AuthGatewayEnv } from '@operator-os/config';
import { healthResponseSchema } from '@operator-os/contracts';
import type { FastifyInstance } from 'fastify';

import { buildHealthResponse } from '../readiness.js';

interface HealthRoutesOptions {
  buildReadiness: () => ReturnType<typeof buildHealthResponse>;
  config: AuthGatewayEnv;
}

export const registerHealthRoutes = async (
  app: FastifyInstance,
  options: HealthRoutesOptions
) => {
  app.get('/health', async () =>
    healthResponseSchema.parse(buildHealthResponse(options.config))
  );

  app.get('/ready', async (_, reply) => {
    const payload = healthResponseSchema.parse(options.buildReadiness());

    if (payload.status === 'degraded') {
      reply.code(503);
    }

    return payload;
  });
};
