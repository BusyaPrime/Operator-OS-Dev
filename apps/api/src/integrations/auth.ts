import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { OAuth2Client } from 'google-auth-library';
import type { ApiEnv } from '@operator-os/config';
import {
  authSessionSchema,
  type AuthSession,
  verifiedUserContextSchema,
  type VerifiedUserContext
} from '@operator-os/contracts';
import type {
  FastifyBaseLogger,
  FastifyReply,
  FastifyRequest
} from 'fastify';

import {
  buildConfiguredCheck,
  buildNotConfiguredCheck,
  detectApplicationDefaultCredentials,
  IntegrationError,
  mapGoogleIntegrationError
} from './runtime.js';

declare module 'fastify' {
  interface FastifyRequest {
    authSession?: AuthSession;
    currentUser?: VerifiedUserContext;
  }
}

const firebaseAppName = 'operator-os-api';

const extractBearerToken = (authorization?: string | string[]) => {
  const header = Array.isArray(authorization) ? authorization[0] : authorization;

  if (!header?.toLowerCase().startsWith('bearer ')) {
    return undefined;
  }

  return header.slice('bearer '.length).trim();
};

const toIsoTimestamp = (value?: number) =>
  value ? new Date(value * 1000).toISOString() : undefined;

export class FirebaseAuthService {
  readonly name = 'auth';

  #adcStatus = detectApplicationDefaultCredentials();
  #config: ApiEnv;
  #logger: FastifyBaseLogger;
  #oauthClient?: OAuth2Client;

  constructor(config: ApiEnv, logger: FastifyBaseLogger) {
    this.#config = config;
    this.#logger = logger;
  }

  describeReadiness() {
    if (!this.#adcStatus.available) {
      return buildNotConfiguredCheck('auth', this.#adcStatus.message, {
        projectId: this.#config.FIREBASE_PROJECT_ID
      });
    }

    return buildConfiguredCheck(
      'auth',
      'Firebase Admin can initialize through Application Default Credentials.',
      {
        projectId: this.#config.FIREBASE_PROJECT_ID,
        source: this.#adcStatus.source
      }
    );
  }

  async verifyFirebaseIdToken(idToken: string) {
    if (!this.#adcStatus.available) {
      throw new IntegrationError({
        code: 'missing_adc',
        dependency: 'auth',
        message: this.#adcStatus.message,
        statusCode: 503
      });
    }

    try {
      const decoded = await getAuth(this.#getFirebaseApp()).verifyIdToken(idToken);

      return verifiedUserContextSchema.parse({
        uid: decoded.uid,
        operatorId:
          typeof decoded.operatorId === 'string' ? decoded.operatorId : decoded.uid,
        email: decoded.email,
        displayName: typeof decoded.name === 'string' ? decoded.name : undefined,
        roles: Array.isArray(decoded.roles)
          ? decoded.roles.filter((role): role is string => typeof role === 'string')
          : ['viewer'],
        source: 'firebase-id-token',
        kind: 'user',
        authTime: toIsoTimestamp(decoded.auth_time),
        claims: decoded
      });
    } catch (error) {
      throw mapGoogleIntegrationError('auth', error);
    }
  }

  async verifyGoogleIdToken(idToken: string, expectedAudience: string) {
    try {
      const ticket = await this.#getOAuthClient().verifyIdToken({
        idToken,
        audience: expectedAudience
      });

      const payload = ticket.getPayload();

      if (!payload) {
        throw new IntegrationError({
          code: 'upstream_error',
          dependency: 'auth',
          message: 'Google ID token had no payload after verification.',
          statusCode: 401
        });
      }

      if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
        throw new IntegrationError({
          code: 'invalid_config',
          dependency: 'auth',
          message: `Google ID token issuer is not trusted: ${payload.iss ?? 'unknown'}`,
          statusCode: 401
        });
      }

      const subject = payload.sub;

      if (!subject) {
        throw new IntegrationError({
          code: 'upstream_error',
          dependency: 'auth',
          message: 'Google ID token is missing a subject claim.',
          statusCode: 401
        });
      }

      const callerIdentifier = payload.email ?? subject;

      return verifiedUserContextSchema.parse({
        uid: subject,
        operatorId: callerIdentifier,
        email: payload.email,
        displayName:
          typeof payload.name === 'string'
            ? payload.name
            : payload.email ?? undefined,
        roles: ['agent'],
        source: 'google-id-token',
        kind: 'service',
        authTime: toIsoTimestamp(payload.iat),
        claims: payload as unknown as Record<string, unknown>
      });
    } catch (error) {
      if (error instanceof IntegrationError) {
        throw error;
      }

      throw mapGoogleIntegrationError('auth', error);
    }
  }

  async resolveSession(
    authorization?: string | string[],
    options: { strict?: boolean } = {}
  ): Promise<AuthSession> {
    const token = extractBearerToken(authorization);

    if (!token) {
      return authSessionSchema.parse({
        authenticated: false,
        source: this.#adcStatus.available ? 'anonymous' : 'bootstrap-fallback',
        message: this.#adcStatus.available
          ? 'No Firebase ID token was supplied with the request.'
          : this.#adcStatus.message
      });
    }

    try {
      const currentUser = await this.verifyFirebaseIdToken(token);

      return authSessionSchema.parse({
        authenticated: true,
        source: 'firebase-id-token',
        currentUser
      });
    } catch (error) {
      if (options.strict) {
        throw error;
      }

      const message =
        error instanceof Error
          ? error.message
          : 'Failed to validate the supplied Firebase ID token.';

      this.#logger.warn({ err: error }, 'firebase token validation failed');

      return authSessionSchema.parse({
        authenticated: false,
        source: this.#adcStatus.available ? 'anonymous' : 'bootstrap-fallback',
        message
      });
    }
  }

  createOptionalGuard() {
    return async (request: FastifyRequest) => {
      const session = await this.resolveSession(request.headers.authorization);
      request.authSession = session;
      request.currentUser = session.currentUser;
    };
  }

  createRequiredGuard() {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await this.resolveSession(request.headers.authorization, {
        strict: true
      });

      if (!session.authenticated || !session.currentUser) {
        reply.code(401);
        return reply.send({
          message: 'A valid Firebase ID token is required for this route.'
        });
      }

      request.authSession = session;
      request.currentUser = session.currentUser;
    };
  }

  /**
   * Guard for /v1/agent/* routes. Accepts a Firebase ID token (human
   * caller from mobile) OR a Google OIDC ID token minted for the
   * service's own audience (desktop-agent or Cloud Tasks service-to-
   * service). Either path produces a VerifiedUserContext that routes
   * can audit. Missing or invalid token returns 401.
   *
   * The expected audience for Google OIDC tokens is the service URL.
   * Cloud Run injects requests with tokens whose audience matches the
   * service URL, so desktop-agent calling through the runtime SA will
   * land here cleanly.
   */
  createAgentGuard(expectedAudience: string) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const token = extractBearerToken(request.headers.authorization);

      if (!token) {
        reply.code(401);
        return reply.send({
          message:
            'A Firebase ID token or a Google OIDC ID token is required for this route.'
        });
      }

      try {
        const currentUser = await this.verifyFirebaseIdToken(token);
        const session = authSessionSchema.parse({
          authenticated: true,
          source: 'firebase-id-token',
          currentUser
        });
        request.authSession = session;
        request.currentUser = currentUser;
        return;
      } catch (firebaseError) {
        this.#logger.debug(
          { err: firebaseError },
          'firebase verification failed, trying google OIDC'
        );
      }

      try {
        const currentUser = await this.verifyGoogleIdToken(token, expectedAudience);
        const session = authSessionSchema.parse({
          authenticated: true,
          source: 'google-id-token',
          currentUser
        });
        request.authSession = session;
        request.currentUser = currentUser;
        return;
      } catch (googleError) {
        this.#logger.warn(
          { err: googleError },
          'agent guard rejected token: neither firebase nor google OIDC accepted it'
        );

        reply.code(401);
        return reply.send({
          message:
            'Provided bearer token is neither a valid Firebase ID token nor a valid Google OIDC ID token for this service.'
        });
      }
    };
  }

  #getFirebaseApp() {
    return (
      getApps().find((app) => app.name === firebaseAppName) ??
      initializeApp(
        {
          credential: applicationDefault(),
          projectId: this.#config.FIREBASE_PROJECT_ID
        },
        firebaseAppName
      )
    );
  }

  #getOAuthClient() {
    this.#oauthClient ??= new OAuth2Client();
    return this.#oauthClient;
  }
}
