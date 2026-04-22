import { jwtVerify } from 'jose';
import type { ApiEnv } from '@operator-os/config';
import {
  accessTokenPayloadSchema,
  verifiedUserContextSchema,
  type VerifiedUserContext
} from '@operator-os/contracts';
import type { FastifyBaseLogger } from 'fastify';

import type { AccessTokenSecretLoader } from './signing-secret.js';
import { IntegrationError } from './runtime.js';

/**
 * Verifies HS256 access tokens issued by the auth-gateway service.
 *
 * Rejects tokens whose signature, issuer, audience, or expiry
 * disagree with the configured values. On success returns a
 * VerifiedUserContext populated with `source: 'operator-access-token'`
 * and `kind: 'user'`, ready to be attached to the FastifyRequest by
 * the surrounding auth guards.
 */
export class AccessTokenVerifier {
  readonly name = 'access-token-verifier';

  #config: ApiEnv;
  #logger: FastifyBaseLogger;
  #secretLoader: AccessTokenSecretLoader;

  constructor(
    config: ApiEnv,
    logger: FastifyBaseLogger,
    secretLoader: AccessTokenSecretLoader
  ) {
    this.#config = config;
    this.#logger = logger;
    this.#secretLoader = secretLoader;
  }

  async verify(token: string): Promise<VerifiedUserContext> {
    if (!token || typeof token !== 'string') {
      throw new IntegrationError({
        code: 'invalid_config',
        dependency: 'access-token-verifier',
        message: 'Access token is missing or not a string.',
        statusCode: 401
      });
    }

    const secret = await this.#secretLoader.load();

    let verified;
    try {
      verified = await jwtVerify(token, secret, {
        algorithms: ['HS256'],
        issuer: this.#config.AUTH_ACCESS_TOKEN_ISSUER,
        audience: this.#config.AUTH_ACCESS_TOKEN_AUDIENCE
      });
    } catch (error) {
      this.#logger.debug({ err: error }, 'access token verification failed');
      throw new IntegrationError({
        code: 'invalid_config',
        dependency: 'access-token-verifier',
        message:
          error instanceof Error
            ? `Access token verification failed: ${error.message}`
            : 'Access token verification failed.',
        statusCode: 401
      });
    }

    const payload = accessTokenPayloadSchema.parse(verified.payload);

    return verifiedUserContextSchema.parse({
      uid: payload.sub,
      operatorId: payload.operatorId,
      email: payload.email,
      roles: ['owner'],
      source: 'operator-access-token',
      kind: 'user',
      authTime: new Date(payload.iat * 1000).toISOString(),
      claims: payload
    });
  }
}
