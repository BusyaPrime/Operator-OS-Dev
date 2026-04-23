import { OAuth2Client } from 'google-auth-library';
import type { FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    oidcIdentity?: OidcIdentity;
  }
}

export interface OidcIdentity {
  readonly subject: string;
  readonly email: string;
  readonly audience: string;
}

export type OidcVerificationCode =
  | 'no_payload'
  | 'untrusted_issuer'
  | 'no_subject'
  | 'no_email'
  | 'email_unverified'
  | 'wrong_audience';

export class OidcVerificationError extends Error {
  readonly code: OidcVerificationCode;

  constructor(code: OidcVerificationCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'OidcVerificationError';
  }
}

export interface GoogleOidcVerifierOptions {
  /** Expected OIDC audience — the api URL. Exact-match enforced. */
  readonly audience: string;
  /** Service-account emails whose OIDC tokens may invoke the guarded route. */
  readonly allowedEmails: ReadonlySet<string>;
  /** Test seam for injecting a stubbed OAuth2Client. */
  readonly oauthClient?: OAuth2Client;
}

const TRUSTED_ISSUERS = new Set([
  'https://accounts.google.com',
  'accounts.google.com'
]);

export class GoogleOidcVerifier {
  readonly #audience: string;
  readonly #allowedEmails: ReadonlySet<string>;
  readonly #client: OAuth2Client;

  constructor(opts: GoogleOidcVerifierOptions) {
    if (!opts.audience) {
      throw new Error('GoogleOidcVerifier: audience is required');
    }
    if (opts.allowedEmails.size === 0) {
      throw new Error('GoogleOidcVerifier: allowedEmails must not be empty');
    }
    this.#audience = opts.audience;
    this.#allowedEmails = opts.allowedEmails;
    this.#client = opts.oauthClient ?? new OAuth2Client();
  }

  async verify(idToken: string): Promise<OidcIdentity> {
    const ticket = await this.#client.verifyIdToken({
      idToken,
      audience: this.#audience
    });
    const payload = ticket.getPayload();

    if (!payload) {
      throw new OidcVerificationError(
        'no_payload',
        'Google ID token had no payload after verification.'
      );
    }
    if (!payload.iss || !TRUSTED_ISSUERS.has(payload.iss)) {
      throw new OidcVerificationError(
        'untrusted_issuer',
        `Google ID token issuer is not trusted: ${payload.iss ?? 'unknown'}`
      );
    }
    if (!payload.sub) {
      throw new OidcVerificationError(
        'no_subject',
        'Google ID token is missing the subject claim.'
      );
    }
    if (!payload.email) {
      throw new OidcVerificationError(
        'no_email',
        'Google ID token is missing the email claim.'
      );
    }
    if (payload.email_verified !== true) {
      throw new OidcVerificationError(
        'email_unverified',
        'Google ID token email is not verified.'
      );
    }

    const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
    if (aud !== this.#audience) {
      throw new OidcVerificationError(
        'wrong_audience',
        `Google ID token audience mismatch: expected ${this.#audience}, got ${aud ?? 'unknown'}`
      );
    }

    return {
      subject: payload.sub,
      email: payload.email,
      audience: this.#audience
    };
  }

  isEmailAllowed(email: string): boolean {
    return this.#allowedEmails.has(email);
  }
}

const extractBearer = (header?: string | string[]): string | undefined => {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw || !raw.toLowerCase().startsWith('bearer ')) {
    return undefined;
  }
  const token = raw.slice('bearer '.length).trim();
  return token.length > 0 ? token : undefined;
};

/**
 * Fastify preHandler that enforces Google OIDC ID-token auth on a route.
 *
 * Rejection matrix:
 *  - No / malformed Bearer                     → 401 unauthorized
 *  - OAuth2Client.verifyIdToken throws         → 401 unauthorized
 *  - Issuer / subject / email / email_verified → 401 unauthorized
 *  - Audience mismatch                         → 401 unauthorized
 *  - Email not in allowedEmails                → 403 forbidden
 *
 * On success, attaches `request.oidcIdentity` for downstream handlers.
 */
export const createGoogleOidcGuard = (verifier: GoogleOidcVerifier) => {
  return async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const token = extractBearer(request.headers.authorization);
    if (!token) {
      request.log.warn(
        { source: 'createGoogleOidcGuard' },
        'oidc guard rejected request: missing bearer token'
      );
      await reply.code(401).send({
        code: 'unauthorized',
        message: 'Google OIDC bearer token is required.'
      });
      return;
    }

    let identity: OidcIdentity;
    try {
      identity = await verifier.verify(token);
    } catch (error) {
      const code =
        error instanceof OidcVerificationError ? error.code : 'verify_failed';
      request.log.warn(
        { source: 'createGoogleOidcGuard', code, err: error },
        'oidc guard rejected request: token verification failed'
      );
      await reply.code(401).send({
        code: 'unauthorized',
        message: 'Google OIDC token verification failed.'
      });
      return;
    }

    if (!verifier.isEmailAllowed(identity.email)) {
      request.log.warn(
        { source: 'createGoogleOidcGuard', email: identity.email },
        'oidc guard rejected request: caller email not in allowlist'
      );
      await reply.code(403).send({
        code: 'forbidden',
        message: 'Caller identity is not authorized for this endpoint.'
      });
      return;
    }

    request.oidcIdentity = identity;
  };
};
