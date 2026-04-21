import { createHash, randomBytes } from 'node:crypto';

import { Firestore } from '@google-cloud/firestore';
import type { AuthGatewayEnv } from '@operator-os/config';
import {
  refreshTokenRecordSchema,
  type RefreshTokenRecord
} from '@operator-os/contracts';
import type { FastifyBaseLogger } from 'fastify';

import {
  buildConfiguredCheck,
  buildNotConfiguredCheck,
  detectApplicationDefaultCredentials,
  mapGoogleIntegrationError
} from '../integrations/runtime.js';

export interface IssuedRefreshToken {
  token: string;
  hash: string;
  expiresAt: Date;
  record: RefreshTokenRecord;
}

/**
 * Generates, stores, and validates refresh tokens.
 *
 * Tokens are opaque 32-byte random strings encoded as base64url.
 * The SHA-256 hash of the token is the Firestore document id (and
 * the in-memory map key in fallback mode). Plaintext is never
 * stored.
 *
 * Rotation on use lives in PR C. This file only covers issuance
 * so PR B can land a complete signin flow end to end.
 */
export class RefreshTokenStore {
  readonly name = 'refresh-token-store';

  #adcStatus = detectApplicationDefaultCredentials();
  #config: AuthGatewayEnv;
  #firestore?: Firestore;
  #inMemory = new Map<string, RefreshTokenRecord>();
  #logger: FastifyBaseLogger;

  constructor(config: AuthGatewayEnv, logger: FastifyBaseLogger) {
    this.#config = config;
    this.#logger = logger;
  }

  describeReadiness() {
    if (!this.#adcStatus.available) {
      return buildNotConfiguredCheck(
        'refresh-token-store',
        'Firestore is not reachable; refresh tokens are kept in process memory only.',
        { collection: this.#config.FIRESTORE_REFRESH_TOKENS_COLLECTION }
      );
    }
    return buildConfiguredCheck(
      'refresh-token-store',
      'Firestore-backed refresh token store is configured.',
      { collection: this.#config.FIRESTORE_REFRESH_TOKENS_COLLECTION }
    );
  }

  async issue(input: {
    userId: string;
    source?: string;
    userAgent?: string;
  }): Promise<IssuedRefreshToken> {
    const token = this.#generateToken();
    const hash = this.#hashToken(token);
    const now = new Date();
    const expires = new Date(
      now.getTime() + this.#config.AUTH_REFRESH_TOKEN_TTL_SECONDS * 1000
    );

    const record = refreshTokenRecordSchema.parse({
      hash,
      userId: input.userId,
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      source: input.source ?? 'signin',
      userAgent: input.userAgent
    });

    if (!this.#adcStatus.available) {
      this.#inMemory.set(hash, record);
      this.#logger.debug(
        { userId: input.userId, source: record.source },
        'refresh token stored in memory fallback'
      );
      return { token, hash, expiresAt: expires, record };
    }

    try {
      await this.#getFirestore()
        .collection(this.#config.FIRESTORE_REFRESH_TOKENS_COLLECTION)
        .doc(hash)
        .set(record);
      return { token, hash, expiresAt: expires, record };
    } catch (error) {
      this.#logger.warn({ err: error }, 'firestore refresh token write failed');
      throw mapGoogleIntegrationError('refresh-token-store', error);
    }
  }

  hashToken(token: string) {
    return this.#hashToken(token);
  }

  #generateToken() {
    return randomBytes(32).toString('base64url');
  }

  #hashToken(token: string) {
    return createHash('sha256').update(token).digest('base64url');
  }

  #getFirestore() {
    this.#firestore ??= new Firestore({
      projectId: this.#config.GOOGLE_CLOUD_PROJECT
    });
    return this.#firestore;
  }
}
