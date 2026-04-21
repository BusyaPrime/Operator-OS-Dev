import type { FastifyBaseLogger } from 'fastify';

import type { RefreshTokenStore } from './refresh-token-store.js';

export interface SignoutInput {
  refreshToken: string;
}

export interface SignoutOutcome {
  revoked: boolean;
  reason?: string;
}

/**
 * Revokes a refresh token. Intentionally tolerant: unknown, expired,
 * already-revoked, or rotated tokens return `revoked: false` with a
 * reason but do not throw. The route handler surfaces 204 in every
 * case so signout is idempotent from the caller's perspective.
 */
export class SignoutService {
  readonly name = 'signout-service';

  #logger: FastifyBaseLogger;
  #refreshTokenStore: RefreshTokenStore;

  constructor(options: {
    logger: FastifyBaseLogger;
    refreshTokenStore: RefreshTokenStore;
  }) {
    this.#logger = options.logger;
    this.#refreshTokenStore = options.refreshTokenStore;
  }

  async signout(input: SignoutInput): Promise<SignoutOutcome> {
    const outcome = await this.#refreshTokenStore.revoke(input.refreshToken);

    if (outcome.ok) {
      this.#logger.info(
        { userId: outcome.record.userId, source: 'signout' },
        'refresh token revoked'
      );
      return { revoked: true };
    }

    this.#logger.info(
      { reason: outcome.reason, source: 'signout' },
      'signout called on non-active refresh token; treating as idempotent'
    );

    return { revoked: false, reason: outcome.reason };
  }
}
