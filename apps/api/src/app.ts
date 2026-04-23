import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { ApiEnv } from '@operator-os/config';

import { AccessTokenSecretLoader } from './integrations/signing-secret.js';
import { AccessTokenVerifier } from './integrations/access-token-verifier.js';
import { BigQueryAnalyticsWriter } from './integrations/bigquery.js';
import { FirebaseAuthService } from './integrations/auth.js';
import { FirestoreOperatorRepository } from './integrations/firestore.js';
import { PubSubPublisher } from './integrations/pubsub.js';
import { SecretManagerAccessor } from './integrations/secrets.js';
import { GcsStorageService } from './integrations/storage.js';
import { TasksQueueClient } from './integrations/tasks.js';
import { IntegrationError } from './integrations/runtime.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerAgentRoutes } from './routes/agent.js';
import { registerInternalTasksRoutes } from './routes/internal-tasks.js';
import { registerOperatorRoutes } from './routes/operator.js';
import { VertexAIProvider } from './providers/index.js';
import { buildReadinessResponse } from './readiness.js';
import { AlertsService } from './services/alerts.js';
import { CommandsService } from './services/commands.js';
import { ExportsService } from './services/exports.js';
import { SessionsService } from './services/sessions.js';
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

  app.decorateRequest('authSession', undefined);
  app.decorateRequest('currentUser', undefined);

  // Register @fastify/websocket (Phase 2 — TD-017). Keeps ws
  // support inside the same Fastify bootstrap so JWT middleware,
  // error handler, and logger all apply to WS upgrade requests
  // exactly like they apply to HTTP. Explicit max-payload guard
  // here — agent-side messages are small JSON control frames
  // and a multi-MB payload would be a bug worth surfacing.
  void app.register(fastifyWebsocket, {
    options: {
      maxPayload: 1_048_576 // 1 MiB
    }
  });

  const aiProvider =
    options.aiProvider ??
    new VertexAIProvider({
      project: config.GOOGLE_CLOUD_PROJECT,
      location: config.VERTEX_LOCATION,
      model: config.VERTEX_MODEL
    });
  const accessTokenSecretLoader = new AccessTokenSecretLoader(config, app.log);
  const accessTokenVerifier = new AccessTokenVerifier(
    config,
    app.log,
    accessTokenSecretLoader
  );
  const authService = new FirebaseAuthService(config, app.log, accessTokenVerifier);
  const firestoreRepository = new FirestoreOperatorRepository(config, app.log);
  const pubSubPublisher = new PubSubPublisher(config, app.log);
  const tasksQueue = new TasksQueueClient(config, app.log);
  const storageService = new GcsStorageService(config, app.log);
  const analyticsWriter = new BigQueryAnalyticsWriter(config, app.log);
  const secretsAccessor = new SecretManagerAccessor(config, app.log);
  const commandsService = new CommandsService({
    analyticsWriter,
    logger: app.log,
    repository: firestoreRepository,
    storageService,
    tasksQueue
  });
  const sessionsService = new SessionsService({
    analyticsWriter,
    logger: app.log,
    pubSubPublisher,
    repository: firestoreRepository
  });
  const alertsService = new AlertsService({
    analyticsWriter,
    logger: app.log,
    pubSubPublisher,
    repository: firestoreRepository
  });
  const exportsService = new ExportsService({
    logger: app.log,
    repository: firestoreRepository,
    storageService,
    tasksQueue
  });
  const operatorModules = [
    authService,
    firestoreRepository,
    pubSubPublisher,
    tasksQueue,
    storageService,
    analyticsWriter,
    secretsAccessor,
    commandsService,
    sessionsService,
    alertsService,
    exportsService,
    {
      name: 'vertex',
      describeReadiness: () => aiProvider.describeReadiness()
    }
  ] as const;
  const buildReadiness = () => buildReadinessResponse(config, operatorModules);

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
    if (error instanceof IntegrationError) {
      reply.status(error.statusCode).send({
        code: error.code,
        dependency: error.dependency,
        details: error.details,
        message: error.message,
        requestId: request.id
      });
      return;
    }

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
  void registerOperatorRoutes(app, {
    authService,
    buildReadiness,
    config,
    repository: firestoreRepository
  });
  const agentAudience =
    config.AGENT_AUDIENCE ??
    config.TASKS_TARGET_BASE_URL ??
    'https://operator-os-api-m545sz2isq-ez.a.run.app';

  void registerAgentRoutes(app, {
    alertsService,
    authGuard: authService.createAgentGuard(agentAudience),
    commandsService,
    exportsService,
    pubSubPublisher,
    repository: firestoreRepository,
    sessionsService
  });
  void registerAiRoutes(app, {
    aiProvider,
    authGuard: authService.createRequiredGuard()
  });
  void registerInternalTasksRoutes(app);

  return app;
};
