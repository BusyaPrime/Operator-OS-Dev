import { createRequire } from 'node:module';

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

// Module-level cache for the google-auth-library version string.
// Read once at first import; emitted on every signin diagnostic log so
// we can correlate verifier behaviour with specific library versions
// when triaging production failures (LAW #1 - Trusted / Visible).
const googleAuthLibraryVersion = (() => {
  try {
    const req = createRequire(import.meta.url);
    const pkg = req('google-auth-library/package.json') as {
      version?: string;
    };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

// Matches ASCII control characters (C0: U+0000..U+001F, DEL: U+007F).
// Built via RegExp constructor with explicit hex escapes so the source
// file never carries raw control bytes.
const controlCharPattern = new RegExp('[\\u0000-\\u001F\\u007F]');

const maskClientId = (clientId: string): string => {
  if (clientId.length <= 24) {
    return clientId;
  }
  return `${clientId.slice(0, 14)}...${clientId.slice(-18)}`;
};

/**
 * Verifies a Google OAuth ID token supplied by a client on signin.
 *
 * Emits a structured diagnostic log at verifier entry for every call.
 * This is a permanent observability surface (LAW #1 Trusted / Visible
 * + LAW #5 Verifiable Honesty) rather than temporary debug output -
 * it does NOT log the token content itself, only shape metadata
 * (lengths, segment counts, first/last characters of each segment,
 * masked accepted-client-ids, library version). See TD-013 for the
 * rationale and scope.
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

  async verify(
    idToken: string,
    requestLogger?: FastifyBaseLogger
  ): Promise<VerifiedGoogleIdentity> {
    const acceptedClientIds = this.#config.AUTH_ACCEPTED_GOOGLE_CLIENT_IDS;
    const logger = requestLogger ?? this.#logger;

    const segments = idToken.split('.');
    logger.info(
      {
        source: 'GoogleIdTokenVerifier.verify',
        googleAuthLibraryVersion,
        tokenLength: idToken.length,
        segmentCount: segments.length,
        segmentLengths: segments.map((s) => s.length),
        hasWhitespace: /\s/.test(idToken),
        hasControlChars: controlCharPattern.test(idToken),
        nonBase64UrlChars: Array.from(
          new Set(idToken.split('').filter((c) => !/[A-Za-z0-9._\-=]/.test(c)))
        ),
        headerPrefix: segments[0]?.slice(0, 16),
        headerSuffix: segments[0]?.slice(-16),
        payloadPrefix: segments[1]?.slice(0, 16),
        payloadSuffix: segments[1]?.slice(-16),
        signaturePrefix: segments[2]?.slice(0, 16),
        acceptedClientIdsCount: acceptedClientIds.length,
        acceptedClientIdsMasked: acceptedClientIds.map(maskClientId)
      },
      'verify.idToken diagnostic shape'
    );

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
      // Full stack trace with correlation id so we can see where
      // google-auth-library lost the token. `err` is Pino's conventional
      // field; serialises Error subclasses including `stack` by default.
      logger.warn(
        {
          source: 'GoogleIdTokenVerifier.verify',
          googleAuthLibraryVersion,
          err: error
        },
        'google id token verification failed'
      );
      throw mapGoogleIntegrationError('google-id-token-verifier', error);
    }
  }

  #getClient() {
    this.#client ??= new OAuth2Client();
    return this.#client;
  }
}
