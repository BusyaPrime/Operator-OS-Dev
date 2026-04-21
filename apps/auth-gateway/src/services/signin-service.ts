import {
  signinResponseSchema,
  type SigninResponse
} from '@operator-os/contracts';
import type { FastifyBaseLogger } from 'fastify';

import type { GoogleIdTokenVerifier } from './google-id-token-verifier.js';
import type { JwtIssuer } from './jwt-issuer.js';
import type { RefreshTokenStore } from './refresh-token-store.js';
import type { UsersRepository } from './users-repository.js';

export interface SigninInput {
  idToken: string;
  userAgent?: string;
}

/**
 * Orchestrates the Google ID token -> operator user -> access token
 * -> refresh token flow. Keeps the route handler thin.
 */
export class SigninService {
  readonly name = 'signin-service';

  #googleVerifier: GoogleIdTokenVerifier;
  #jwtIssuer: JwtIssuer;
  #logger: FastifyBaseLogger;
  #refreshTokenStore: RefreshTokenStore;
  #usersRepository: UsersRepository;

  constructor(options: {
    googleVerifier: GoogleIdTokenVerifier;
    jwtIssuer: JwtIssuer;
    logger: FastifyBaseLogger;
    refreshTokenStore: RefreshTokenStore;
    usersRepository: UsersRepository;
  }) {
    this.#googleVerifier = options.googleVerifier;
    this.#jwtIssuer = options.jwtIssuer;
    this.#logger = options.logger;
    this.#refreshTokenStore = options.refreshTokenStore;
    this.#usersRepository = options.usersRepository;
  }

  async signin(input: SigninInput): Promise<SigninResponse> {
    const identity = await this.#googleVerifier.verify(input.idToken);

    const user = await this.#usersRepository.upsertByGoogleSubject({
      googleSubject: identity.subject,
      email: identity.email,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl
    });

    const accessToken = await this.#jwtIssuer.issue(user, ['user:read', 'tasks:write']);
    const refreshToken = await this.#refreshTokenStore.issue({
      userId: user.id,
      source: 'signin',
      userAgent: input.userAgent
    });

    this.#logger.info(
      {
        userId: user.id,
        googleSubject: identity.subject,
        source: 'signin',
        emailDomain: user.email.split('@')[1]
      },
      'user signed in'
    );

    return signinResponseSchema.parse({
      accessToken: accessToken.token,
      refreshToken: refreshToken.token,
      accessTokenExpiresAt: accessToken.expiresAt.toISOString(),
      refreshTokenExpiresAt: refreshToken.expiresAt.toISOString(),
      user
    });
  }
}
