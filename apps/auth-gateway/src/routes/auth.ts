import {
  refreshRequestSchema,
  refreshResponseSchema,
  signinRequestSchema,
  signinResponseSchema,
  signoutRequestSchema
} from '@operator-os/contracts';
import type { FastifyInstance } from 'fastify';

import type { RefreshService } from '../services/refresh-service.js';
import type { SigninService } from '../services/signin-service.js';
import type { SignoutService } from '../services/signout-service.js';

interface AuthRoutesOptions {
  refreshService: RefreshService;
  signinService: SigninService;
  signoutService: SignoutService;
}

const readUserAgent = (value?: string | string[]) =>
  typeof value === 'string' ? value : undefined;

export const registerAuthRoutes = async (
  app: FastifyInstance,
  options: AuthRoutesOptions
) => {
  app.post('/v1/auth/signin', async (request) => {
    const body = signinRequestSchema.parse(request.body);
    const response = await options.signinService.signin({
      idToken: body.idToken,
      userAgent: readUserAgent(request.headers['user-agent'])
    });
    return signinResponseSchema.parse(response);
  });

  app.post('/v1/auth/refresh', async (request) => {
    const body = refreshRequestSchema.parse(request.body);
    const response = await options.refreshService.refresh({
      refreshToken: body.refreshToken,
      userAgent: readUserAgent(request.headers['user-agent'])
    });
    return refreshResponseSchema.parse(response);
  });

  app.post('/v1/auth/signout', async (request, reply) => {
    const body = signoutRequestSchema.parse(request.body);
    await options.signoutService.signout({
      refreshToken: body.refreshToken
    });
    reply.code(204);
    return reply.send();
  });
};
