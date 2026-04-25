import Fastify from 'fastify';
import type { AuthGatewayEnv } from '@operator-os/config';
import { ZodError } from 'zod';

import { IntegrationError } from './integrations/runtime.js';
import { SigningSecretLoader } from './integrations/signing-secret.js';
import { buildReadinessResponse } from './readiness.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerDevMintRoutes } from './routes/dev-mint.js';
import { registerHealthRoutes } from './routes/health.js';
import { GoogleIdTokenVerifier } from './services/google-id-token-verifier.js';
import { JwtIssuer } from './services/jwt-issuer.js';
import { RefreshService } from './services/refresh-service.js';
import { RefreshTokenStore } from './services/refresh-token-store.js';
import { SigninService } from './services/signin-service.js';
import { SignoutService } from './services/signout-service.js';
import { UsersRepository } from './services/users-repository.js';

export interface BuildServerOptions {
  refreshService?: RefreshService;
  signinService?: SigninService;
  signoutService?: SignoutService;
}

export const buildServer = (
  config: AuthGatewayEnv,
  options: BuildServerOptions = {}
) => {
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

  const signingSecretLoader = new SigningSecretLoader(config, app.log);
  const googleVerifier = new GoogleIdTokenVerifier(config, app.log);
  const jwtIssuer = new JwtIssuer(config, signingSecretLoader);
  const usersRepository = new UsersRepository(config, app.log);
  const refreshTokenStore = new RefreshTokenStore(config, app.log);

  const signinService =
    options.signinService ??
    new SigninService({
      googleVerifier,
      jwtIssuer,
      logger: app.log,
      refreshTokenStore,
      usersRepository
    });

  const refreshService =
    options.refreshService ??
    new RefreshService({
      jwtIssuer,
      logger: app.log,
      refreshTokenStore,
      usersRepository
    });

  const signoutService =
    options.signoutService ??
    new SignoutService({
      logger: app.log,
      refreshTokenStore
    });

  const moduleChecks = [
    signingSecretLoader.describeReadiness(),
    usersRepository.describeReadiness(),
    refreshTokenStore.describeReadiness()
  ];

  const buildReadiness = () => buildReadinessResponse(config, moduleChecks);

  app.addHook('onReady', async () => {
    app.log.info(
      {
        project: config.GOOGLE_CLOUD_PROJECT,
        issuer: config.AUTH_ACCESS_TOKEN_ISSUER,
        audience: config.AUTH_ACCESS_TOKEN_AUDIENCE
      },
      'auth-gateway ready'
    );
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send({
        code: 'invalid_request',
        message: 'Request payload failed schema validation.',
        issues: error.issues,
        requestId: request.id
      });
      return;
    }

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
  void registerAuthRoutes(app, {
    refreshService,
    signinService,
    signoutService
  });
  void registerDevMintRoutes(app, {
    config,
    jwtIssuer
  });

  return app;
};
