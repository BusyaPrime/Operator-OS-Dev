import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import type { AuthGatewayEnv } from '@operator-os/config';
import type { FastifyBaseLogger } from 'fastify';

import {
  buildConfiguredCheck,
  buildNotConfiguredCheck,
  detectApplicationDefaultCredentials,
  IntegrationError,
  mapGoogleIntegrationError
} from './runtime.js';

/**
 * Loads the HS256 signing secret for access tokens. Priority:
 *
 * 1. AUTH_JWT_SIGNING_SECRET_LITERAL env (local dev / tests).
 * 2. Google Secret Manager at AUTH_JWT_SIGNING_SECRET_NAME
 *    (latest version), when ADC is available.
 *
 * Both paths produce a `Uint8Array` for `jose` HS256 signing.
 */
export class SigningSecretLoader {
  readonly name = 'signing-secret';

  #adcStatus = detectApplicationDefaultCredentials();
  #cached?: Uint8Array;
  #client?: SecretManagerServiceClient;
  #config: AuthGatewayEnv;
  #logger: FastifyBaseLogger;

  constructor(config: AuthGatewayEnv, logger: FastifyBaseLogger) {
    this.#config = config;
    this.#logger = logger;
  }

  describeReadiness() {
    if (this.#config.AUTH_JWT_SIGNING_SECRET_LITERAL) {
      return buildConfiguredCheck(
        'signing-secret',
        'Signing secret is configured via AUTH_JWT_SIGNING_SECRET_LITERAL (not recommended for production).'
      );
    }

    if (!this.#adcStatus.available) {
      return buildNotConfiguredCheck(
        'signing-secret',
        'No AUTH_JWT_SIGNING_SECRET_LITERAL and no ADC available; access tokens cannot be signed.',
        { secretName: this.#config.AUTH_JWT_SIGNING_SECRET_NAME }
      );
    }

    return buildConfiguredCheck(
      'signing-secret',
      'Signing secret will be loaded from Secret Manager on first use.',
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
      this.#logger.debug('signing secret loaded from literal env');
      this.#cached = new TextEncoder().encode(literal);
      return this.#cached;
    }

    if (!this.#adcStatus.available) {
      throw new IntegrationError({
        code: 'missing_adc',
        dependency: 'signing-secret',
        message:
          'No AUTH_JWT_SIGNING_SECRET_LITERAL and no ADC available to load the signing secret.',
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
          dependency: 'signing-secret',
          message: `Secret ${this.#config.AUTH_JWT_SIGNING_SECRET_NAME} returned an empty payload.`,
          statusCode: 500
        });
      }

      const bytes =
        typeof data === 'string' ? new TextEncoder().encode(data) : Uint8Array.from(data);
      this.#cached = bytes;
      this.#logger.debug(
        { secretName: this.#config.AUTH_JWT_SIGNING_SECRET_NAME },
        'signing secret loaded from Secret Manager'
      );
      return bytes;
    } catch (error) {
      if (error instanceof IntegrationError) {
        throw error;
      }
      throw mapGoogleIntegrationError('signing-secret', error);
    }
  }

  #getClient() {
    this.#client ??= new SecretManagerServiceClient();
    return this.#client;
  }
}
