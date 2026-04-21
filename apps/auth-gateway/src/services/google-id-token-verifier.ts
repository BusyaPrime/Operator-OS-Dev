import { OAuth2Client } from 'google-auth-library';
import type { AuthGatewayEnv } from '@operator-os/config';
import type { FastifyBaseLogger } from 'fastify';

import {
  IntegrationError,
  mapGoogleIntegrationError
} from '../integrations/runtime.js';

export interface VerifiedGoogleIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
  avatarUrl?: string;
  audience: string;
}

/**
 * Verifies a Google OAuth ID token supplied by a client on signin.
 */
export class GoogleIdTokenVerifier {
  readonly name = 'google-id-token-verifier';

  #client?: OAuth2Client;
  #config: AuthGatewayEnv;
  #logger: FastifyBaseLogger;

  constructor(config: AuthGatewayEnv, logger: FastifyBaseLogger) {
    this.#config = config;
    this.#logger = logger;
  }

  async verify(idToken: string): Promise<VerifiedGoogleIdentity> {
    const acceptedClientIds = this.#config.AUTH_ACCEPTED_GOOGLE_CLIENT_IDS;

    try {
      const ticket = await this.#getClient().verifyIdToken({
        idToken,
        audience: acceptedClientIds.length > 0 ? acceptedClientIds : undefined
      });

      const payload = ticket.getPayload();

      if (!payload) {
        throw new IntegrationError({
          code: 'upstream_error',
          dependency: 'google-id-token-verifier',
          message: 'Google ID token had no payload after verification.',
          statusCode: 401
        });
      }

      if (
        payload.iss !== 'https://accounts.google.com' &&
        payload.iss !== 'accounts.google.com'
      ) {
        throw new IntegrationError({
          code: 'invalid_config',
          dependency: 'google-id-token-verifier',
          message: `Google ID token issuer is not trusted: ${payload.iss ?? 'unknown'}`,
          statusCode: 401
        });
      }

      if (!payload.sub) {
        throw new IntegrationError({
          code: 'upstream_error',
          dependency: 'google-id-token-verifier',
          message: 'Google ID token is missing the subject claim.',
          statusCode: 401
        });
      }

      if (!payload.email) {
        throw new IntegrationError({
          code: 'upstream_error',
          dependency: 'google-id-token-verifier',
          message:
            'Google ID token is missing the email claim. Request the "email" scope at signin.',
          statusCode: 401
        });
      }

      if (
        acceptedClientIds.length > 0 &&
        payload.aud &&
        !acceptedClientIds.includes(
          Array.isArray(payload.aud) ? payload.aud[0] ?? '' : payload.aud
        )
      ) {
        throw new IntegrationError({
          code: 'invalid_config',
          dependency: 'google-id-token-verifier',
          message: 'Google ID token audience is not in the accepted client id list.',
          statusCode: 401
        });
      }

      return {
        subject: payload.sub,
        email: payload.email,
        emailVerified: Boolean(payload.email_verified),
        displayName: typeof payload.name === 'string' ? payload.name : undefined,
        avatarUrl: typeof payload.picture === 'string' ? payload.picture : undefined,
        audience: Array.isArray(payload.aud)
          ? payload.aud[0] ?? ''
          : payload.aud ?? ''
      };
    } catch (error) {
      if (error instanceof IntegrationError) {
        throw error;
      }
      this.#logger.warn({ err: error }, 'google id token verification failed');
      throw mapGoogleIntegrationError('google-id-token-verifier', error);
    }
  }

  #getClient() {
    this.#client ??= new OAuth2Client();
    return this.#client;
  }
}
