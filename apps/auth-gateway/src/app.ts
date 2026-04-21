import Fastify from 'fastify';
import type { AuthGatewayEnv } from '@operator-os/config';

import { buildReadinessResponse } from './readiness.js';
import { registerHealthRoutes } from './routes/health.js';

export const buildServer = (config: AuthGatewayEnv) => {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      base: {
        service: config.AUTH_GATEWAY_SERVICE_NAME,
        environment: config.NODE_ENV
      }
    },
    trustProxy: true
  });

  const buildReadiness = () => buildReadinessResponse(config, []);

  app.addHook('onReady', async () => {
    app.log.info(
      {
        project: config.GOOGLE_CLOUD_PROJECT,
        issuer: config.AUTH_ACCESS_TOKEN_ISSUER,
        audience: config.AUTH_ACCESS_TOKEN_AUDIENCE
      },
      'auth-gateway scaffold ready'
    );
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'request failed');
    reply.status(500).send({
      message: 'Internal server error',
      requestId: request.id
    });
  });

  void registerHealthRoutes(app, {
    buildReadiness,
    config
  });

  return app;
};
