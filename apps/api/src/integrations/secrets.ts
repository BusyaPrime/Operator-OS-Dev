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

export class SecretManagerAccessor {
  readonly name = 'secrets';

  #adcStatus = detectApplicationDefaultCredentials();
  #client?: SecretManagerServiceClient;
  #config: ApiEnv;
  #logger: FastifyBaseLogger;

  constructor(config: ApiEnv, logger: FastifyBaseLogger) {
    this.#config = config;
    this.#logger = logger;
  }

  describeReadiness() {
    if (!this.#adcStatus.available) {
      return buildNotConfiguredCheck('secrets', this.#adcStatus.message, {
        secretNames: [
          this.#config.OPERATOR_JWT_SECRET_NAME,
          this.#config.SESSION_SIGNING_SECRET_NAME,
          this.#config.GITHUB_TOKEN_SECRET_NAME
        ]
      });
    }

    return buildConfiguredCheck(
      'secrets',
      'Secret Manager accessor is configured for operator JWT, session signing, and GitHub tokens.',
      {
        secretNames: [
          this.#config.OPERATOR_JWT_SECRET_NAME,
          this.#config.SESSION_SIGNING_SECRET_NAME,
          this.#config.GITHUB_TOKEN_SECRET_NAME
        ]
      }
    );
  }

  readOperatorJwtSecret() {
    return this.#readLatestVersion(this.#config.OPERATOR_JWT_SECRET_NAME);
  }

  readSessionSigningSecret() {
    return this.#readLatestVersion(this.#config.SESSION_SIGNING_SECRET_NAME);
  }

  readGitHubToken() {
    return this.#readLatestVersion(this.#config.GITHUB_TOKEN_SECRET_NAME);
  }

  async #readLatestVersion(secretName: string) {
    if (!this.#adcStatus.available) {
      throw new IntegrationError({
        code: 'missing_adc',
        dependency: 'secrets',
        message: this.#adcStatus.message,
        statusCode: 503
      });
    }

    try {
      const [version] = await this.#getClient().accessSecretVersion({
        name: `projects/${this.#config.GOOGLE_CLOUD_PROJECT}/secrets/${secretName}/versions/latest`
      });

      return version.payload?.data?.toString('utf8') ?? '';
    } catch (error) {
      this.#logger.warn({ err: error, secretName }, 'secret manager read failed');
      throw mapGoogleIntegrationError('secrets', error);
    }
  }

  #getClient() {
    this.#client ??= new SecretManagerServiceClient();
    return this.#client;
  }
}
