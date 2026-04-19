import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
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
        authTime: toIsoTimestamp(decoded.auth_time),
        claims: decoded
      });
    } catch (error) {
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
}
