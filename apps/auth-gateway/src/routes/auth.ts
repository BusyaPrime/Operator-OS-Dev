import {
  signinRequestSchema,
  signinResponseSchema
} from '@operator-os/contracts';
import type { FastifyInstance } from 'fastify';

import type { SigninService } from '../services/signin-service.js';

interface AuthRoutesOptions {
  signinService: SigninService;
}

export const registerAuthRoutes = async (
  app: FastifyInstance,
  options: AuthRoutesOptions
) => {
  app.post('/v1/auth/signin', async (request) => {
    const body = signinRequestSchema.parse(request.body);
    const userAgent = request.headers['user-agent'];
    const response = await options.signinService.signin({
      idToken: body.idToken,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined
    });
    return signinResponseSchema.parse(response);
  });
};
