import { Storage } from '@google-cloud/storage';
import type { ApiEnv } from '@operator-os/config';
import type { FastifyBaseLogger } from 'fastify';

import {
  buildConfiguredCheck,
  buildNotConfiguredCheck,
  detectApplicationDefaultCredentials,
  IntegrationError,
  mapGoogleIntegrationError
} from './runtime.js';

type BucketAlias = 'artifacts' | 'exports' | 'remote';

interface StorageResult {
  mode: 'gcs' | 'record-only';
  objectPath: string;
  uploaded: boolean;
}

export class GcsStorageService {
  readonly name = 'storage';

  #adcStatus = detectApplicationDefaultCredentials();
  #client?: Storage;
  #config: ApiEnv;
  #logger: FastifyBaseLogger;

  constructor(config: ApiEnv, logger: FastifyBaseLogger) {
    this.#config = config;
    this.#logger = logger;
  }

  describeReadiness() {
    if (!this.#adcStatus.available) {
      return buildNotConfiguredCheck('storage', this.#adcStatus.message, {
        buckets: this.#getBucketMap()
      });
    }

    return buildConfiguredCheck(
      'storage',
      'Cloud Storage bucket mappings are configured for artifacts, exports, and remote payloads.',
      {
        buckets: this.#getBucketMap()
      }
    );
  }

  async uploadJson(
    bucketAlias: BucketAlias,
    objectPath: string,
    payload: unknown
  ): Promise<StorageResult> {
    if (!this.#adcStatus.available) {
      return {
        uploaded: false,
        mode: 'record-only',
        objectPath
      };
    }

    try {
      await this.#getClient()
        .bucket(this.#getBucketName(bucketAlias))
        .file(objectPath)
        .save(JSON.stringify(payload, null, 2), {
          contentType: 'application/json'
        });

      return {
        uploaded: true,
        mode: 'gcs',
        objectPath
      };
    } catch (error) {
      this.#logger.warn({ err: error, bucketAlias, objectPath }, 'gcs upload failed');

      return {
        uploaded: false,
        mode: 'record-only',
        objectPath
      };
    }
  }

  async downloadText(bucketAlias: BucketAlias, objectPath: string) {
    if (!this.#adcStatus.available) {
      throw new IntegrationError({
        code: 'missing_adc',
        dependency: 'storage',
        message: this.#adcStatus.message,
        statusCode: 503
      });
    }

    try {
      const [contents] = await this.#getClient()
        .bucket(this.#getBucketName(bucketAlias))
        .file(objectPath)
        .download();

      return contents.toString('utf8');
    } catch (error) {
      throw mapGoogleIntegrationError('storage', error);
    }
  }

  #getBucketMap() {
    return {
      artifacts: this.#config.ARTIFACTS_BUCKET,
      exports: this.#config.EXPORTS_BUCKET,
      remote: this.#config.REMOTE_BUCKET
    };
  }

  #getBucketName(bucketAlias: BucketAlias) {
    const bucketMap = this.#getBucketMap();
    return bucketMap[bucketAlias];
  }

  #getClient() {
    this.#client ??= new Storage({
      projectId: this.#config.GOOGLE_CLOUD_PROJECT
    });

    return this.#client;
  }
}
