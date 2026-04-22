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

export type ValidationOutcome =
  | { ok: true; record: RefreshTokenRecord }
  | {
      ok: false;
      reason:
        | 'unknown'
        | 'revoked'
        | 'rotated'
        | 'expired'
        | 'malformed';
    };

/**
 * Generates, stores, rotates, and revokes refresh tokens.
 *
 * Tokens are opaque 32-byte random strings encoded base64url. The
 * SHA-256 hash of the token is the Firestore document id (and the
 * in-memory map key in fallback mode). Plaintext is never stored.
 *
 * Rotation on use: every successful refresh marks the old record
 * with `rotatedTo = <new hash>` and `revokedAt = now()`. A reused
 * already-rotated token returns `reason: 'rotated'` so the caller
 * can treat it as a security signal.
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

    await this.#write(record);
    return { token, hash, expiresAt: expires, record };
  }

  async validate(token: string): Promise<ValidationOutcome> {
    if (!token || typeof token !== 'string') {
      return { ok: false, reason: 'malformed' };
    }

    const hash = this.#hashToken(token);
    const record = await this.#read(hash);

    if (!record) {
      return { ok: false, reason: 'unknown' };
    }

    if (record.rotatedTo) {
      return { ok: false, reason: 'rotated' };
    }

    if (record.revokedAt) {
      return { ok: false, reason: 'revoked' };
    }

    if (new Date(record.expiresAt).getTime() <= Date.now()) {
      return { ok: false, reason: 'expired' };
    }

    return { ok: true, record };
  }

  async rotate(oldToken: string, userAgent?: string): Promise<{
    outcome: ValidationOutcome;
    issued?: IssuedRefreshToken;
  }> {
    const outcome = await this.validate(oldToken);
    if (!outcome.ok) {
      return { outcome };
    }

    const issued = await this.issue({
      userId: outcome.record.userId,
      source: 'refresh',
      userAgent
    });

    const now = new Date().toISOString();
    const updated: RefreshTokenRecord = {
      ...outcome.record,
      revokedAt: now,
      rotatedTo: issued.hash
    };

    await this.#write(refreshTokenRecordSchema.parse(updated));

    return { outcome, issued };
  }

  async revoke(token: string): Promise<ValidationOutcome> {
    const outcome = await this.validate(token);
    if (!outcome.ok) {
      return outcome;
    }

    const now = new Date().toISOString();
    const updated: RefreshTokenRecord = {
      ...outcome.record,
      revokedAt: now
    };

    await this.#write(refreshTokenRecordSchema.parse(updated));
    return outcome;
  }

  hashToken(token: string) {
    return this.#hashToken(token);
  }

  async #write(record: RefreshTokenRecord) {
    if (!this.#adcStatus.available) {
      this.#inMemory.set(record.hash, record);
      return;
    }

    try {
      await this.#getFirestore()
        .collection(this.#config.FIRESTORE_REFRESH_TOKENS_COLLECTION)
        .doc(record.hash)
        .set(record);
    } catch (error) {
      this.#logger.warn({ err: error }, 'firestore refresh token write failed');
      throw mapGoogleIntegrationError('refresh-token-store', error);
    }
  }

  async #read(hash: string): Promise<RefreshTokenRecord | undefined> {
    if (!this.#adcStatus.available) {
      return this.#inMemory.get(hash);
    }

    try {
      const doc = await this.#getFirestore()
        .collection(this.#config.FIRESTORE_REFRESH_TOKENS_COLLECTION)
        .doc(hash)
        .get();

      if (!doc.exists) {
        return undefined;
      }

      return refreshTokenRecordSchema.parse(doc.data());
    } catch (error) {
      this.#logger.warn({ err: error }, 'firestore refresh token read failed');
      throw mapGoogleIntegrationError('refresh-token-store', error);
    }
  }

  #generateToken() {
    return randomBytes(32).toString('base64url');
  }

  #hashToken(token: string) {
    return createHash('sha256').update(token).digest('base64url');
  }

  #getFirestore() {
    this.#firestore ??= new Firestore({
      projectId: this.#config.GOOGLE_CLOUD_PROJECT,
      // Kept symmetric with users-repository so every Firestore
      // client used by auth-gateway has identical write semantics.
      // See users-repository.ts for the full rationale behind
      // ignoring undefined properties on upsert.
      ignoreUndefinedProperties: true
    });
    return this.#firestore;
  }
}
