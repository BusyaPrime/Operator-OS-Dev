import Fastify from 'fastify';
import type { ApiEnv } from '@operator-os/config';

import { operatorModules } from './modules/index.js';
import { registerHealthRoutes } from './routes/health.js';
import { VertexAIProvider } from './providers/index.js';
import type { AIProvider } from './types.js';

interface BuildServerOptions {
  aiProvider?: AIProvider;
}

export const buildServer = (config: ApiEnv, options: BuildServerOptions = {}) => {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      base: {
        service: config.API_SERVICE_NAME,
        environment: config.NODE_ENV
      }
    },
    trustProxy: true
  });

  const aiProvider =
    options.aiProvider ??
    new VertexAIProvider({
      project: config.GOOGLE_CLOUD_PROJECT,
      location: config.VERTEX_LOCATION,
      model: config.VERTEX_MODEL
    });

  app.addHook('onReady', async () => {
    app.log.info(
      {
        provider: aiProvider.name,
        model: aiProvider.model,
        project: config.GOOGLE_CLOUD_PROJECT,
        location: config.VERTEX_LOCATION
      },
      'api scaffold ready'
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
    config,
    modules: operatorModules
  });

  return app;
};
