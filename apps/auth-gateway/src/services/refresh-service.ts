import {
  refreshResponseSchema,
  type RefreshResponse
} from '@operator-os/contracts';
import type { FastifyBaseLogger } from 'fastify';

import { IntegrationError } from '../integrations/runtime.js';
import type { JwtIssuer } from './jwt-issuer.js';
import type { RefreshTokenStore, ValidationOutcome } from './refresh-token-store.js';
import type { UsersRepository } from './users-repository.js';

export interface RefreshInput {
  refreshToken: string;
  userAgent?: string;
}

export class RefreshService {
  readonly name = 'refresh-service';

  #jwtIssuer: JwtIssuer;
  #logger: FastifyBaseLogger;
  #refreshTokenStore: RefreshTokenStore;
  #usersRepository: UsersRepository;

  constructor(options: {
    jwtIssuer: JwtIssuer;
    logger: FastifyBaseLogger;
    refreshTokenStore: RefreshTokenStore;
    usersRepository: UsersRepository;
  }) {
    this.#jwtIssuer = options.jwtIssuer;
    this.#logger = options.logger;
    this.#refreshTokenStore = options.refreshTokenStore;
    this.#usersRepository = options.usersRepository;
  }

  async refresh(input: RefreshInput): Promise<RefreshResponse> {
    const rotation = await this.#refreshTokenStore.rotate(
      input.refreshToken,
      input.userAgent
    );

    if (!rotation.outcome.ok) {
      throw this.#rejectionForOutcome(rotation.outcome);
    }

    const issued = rotation.issued;
    if (!issued) {
      throw new IntegrationError({
        code: 'upstream_error',
        dependency: 'refresh-service',
        message:
          'Refresh token store reported a valid rotation but did not return an issued token.',
        statusCode: 500
      });
    }

    const user = await this.#usersRepository.findById(rotation.outcome.record.userId);

    if (!user) {
      this.#logger.warn(
        { userId: rotation.outcome.record.userId },
        'refresh rejected: backing user record not found'
      );
      throw new IntegrationError({
        code: 'invalid_config',
        dependency: 'refresh-service',
        message: 'The user associated with this refresh token no longer exists.',
        statusCode: 401
      });
    }

    const accessToken = await this.#jwtIssuer.issue(user, [
      'user:read',
      'tasks:write'
    ]);

    this.#logger.info(
      { userId: user.id, source: 'refresh' },
      'access token refreshed'
    );

    return refreshResponseSchema.parse({
      accessToken: accessToken.token,
      refreshToken: issued.token,
      accessTokenExpiresAt: accessToken.expiresAt.toISOString(),
      refreshTokenExpiresAt: issued.expiresAt.toISOString()
    });
  }

  #rejectionForOutcome(outcome: Extract<ValidationOutcome, { ok: false }>) {
    const messages: Record<typeof outcome.reason, string> = {
      unknown: 'Refresh token is not recognised.',
      revoked: 'Refresh token has been revoked.',
      rotated:
        'Refresh token was already rotated; treat this as a potential token reuse and sign in again.',
      expired: 'Refresh token has expired; sign in again.',
      malformed: 'Refresh token format is invalid.'
    };

    return new IntegrationError({
      code: 'invalid_config',
      dependency: 'refresh-service',
      message: messages[outcome.reason],
      statusCode: 401,
      details: { reason: outcome.reason }
    });
  }
}
