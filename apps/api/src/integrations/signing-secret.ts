import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import type { ApiEnv } from '@operator-os/config';
import type { FastifyBaseLogger } from 'fastify';

import {
  buildConfiguredCheck,
  buildNotConfiguredCheck,
  detectApplicationDefaultCredentials,
  IntegrationError,
  mapGoogleIntegrationError
} from './runtime.js';

/**
 * Loads the HS256 verification secret for access tokens issued by
 * the auth-gateway service. Priority:
 *
 * 1. `AUTH_JWT_SIGNING_SECRET_LITERAL` env (local dev / tests).
 * 2. Google Secret Manager at `AUTH_JWT_SIGNING_SECRET_NAME`
 *    (latest version), when ADC is available.
 *
 * This mirrors the auth-gateway's loader so both services resolve
 * the exact same HS256 key for sign / verify.
 */
export class AccessTokenSecretLoader {
  readonly name = 'access-token-secret';

  #adcStatus = detectApplicationDefaultCredentials();
  #cached?: Uint8Array;
  #client?: SecretManagerServiceClient;
  #config: ApiEnv;
  #logger: FastifyBaseLogger;

  constructor(config: ApiEnv, logger: FastifyBaseLogger) {
    this.#config = config;
    this.#logger = logger;
  }

  describeReadiness() {
    if (this.#config.AUTH_JWT_SIGNING_SECRET_LITERAL) {
      return buildConfiguredCheck(
        'access-token-secret',
        'Access token verification secret is configured via AUTH_JWT_SIGNING_SECRET_LITERAL (not recommended for production).'
      );
    }

    if (!this.#adcStatus.available) {
      return buildNotConfiguredCheck(
        'access-token-secret',
        'No AUTH_JWT_SIGNING_SECRET_LITERAL and no ADC available; access tokens cannot be verified.',
        { secretName: this.#config.AUTH_JWT_SIGNING_SECRET_NAME }
      );
    }

    return buildConfiguredCheck(
      'access-token-secret',
      'Access token verification secret will be loaded from Secret Manager on first use.',
      {
        secretName: this.#config.AUTH_JWT_SIGNING_SECRET_NAME,
        source: 'secret-manager'
      }
    );
  }

  async load(): Promise<Uint8Array> {
    if (this.#cached) {
      return this.#cached;
    }

    const literal = this.#config.AUTH_JWT_SIGNING_SECRET_LITERAL;
    if (literal && literal.length > 0) {
      this.#logger.debug('access token verification secret loaded from literal env');
      this.#cached = new TextEncoder().encode(literal);
      return this.#cached;
    }

    if (!this.#adcStatus.available) {
      throw new IntegrationError({
        code: 'missing_adc',
        dependency: 'access-token-secret',
        message:
          'No AUTH_JWT_SIGNING_SECRET_LITERAL and no ADC available to load the verification secret.',
        statusCode: 503
      });
    }

    try {
      const resource = `projects/${this.#config.GOOGLE_CLOUD_PROJECT}/secrets/${this.#config.AUTH_JWT_SIGNING_SECRET_NAME}/versions/latest`;
      const [response] = await this.#getClient().accessSecretVersion({
        name: resource
      });
      const data = response.payload?.data;

      if (!data) {
        throw new IntegrationError({
          code: 'invalid_config',
          dependency: 'access-token-secret',
          message: `Secret ${this.#config.AUTH_JWT_SIGNING_SECRET_NAME} returned an empty payload.`,
          statusCode: 500
        });
      }

      const bytes =
        typeof data === 'string' ? new TextEncoder().encode(data) : Uint8Array.from(data);
      this.#cached = bytes;
      this.#logger.debug(
        { secretName: this.#config.AUTH_JWT_SIGNING_SECRET_NAME },
        'access token verification secret loaded from Secret Manager'
      );
      return bytes;
    } catch (error) {
      if (error instanceof IntegrationError) {
        throw error;
      }
      throw mapGoogleIntegrationError('access-token-secret', error);
    }
  }

  #getClient() {
    this.#client ??= new SecretManagerServiceClient();
    return this.#client;
  }
}
