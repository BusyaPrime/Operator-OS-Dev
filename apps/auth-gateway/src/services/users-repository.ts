import { randomUUID } from 'node:crypto';

import { Firestore } from '@google-cloud/firestore';
import type { AuthGatewayEnv } from '@operator-os/config';
import { operatorUserSchema, type OperatorUser } from '@operator-os/contracts';
import type { FastifyBaseLogger } from 'fastify';

import {
  buildConfiguredCheck,
  buildDegradedCheck,
  buildNotConfiguredCheck,
  detectApplicationDefaultCredentials,
  mapGoogleIntegrationError
} from '../integrations/runtime.js';

export interface UserUpsertInput {
  googleSubject: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
}

/**
 * Reads and upserts operator user records.
 *
 * When Application Default Credentials are available the repository
 * writes to Firestore under FIRESTORE_USERS_COLLECTION. Otherwise it
 * falls back to an in-memory map so local dev and unit tests stay
 * viable. Readiness honestly reports the fallback.
 */
export class UsersRepository {
  readonly name = 'users-repository';

  #adcStatus = detectApplicationDefaultCredentials();
  #config: AuthGatewayEnv;
  #firestore?: Firestore;
  #inMemory = new Map<string, OperatorUser>();
  #logger: FastifyBaseLogger;

  constructor(config: AuthGatewayEnv, logger: FastifyBaseLogger) {
    this.#config = config;
    this.#logger = logger;
  }

  describeReadiness() {
    if (!this.#adcStatus.available) {
      return buildNotConfiguredCheck(
        'users-repository',
        'Firestore is not reachable; user records are kept in process memory only.',
        { collection: this.#config.FIRESTORE_USERS_COLLECTION }
      );
    }
    return buildConfiguredCheck(
      'users-repository',
      'Firestore-backed user repository is configured.',
      { collection: this.#config.FIRESTORE_USERS_COLLECTION }
    );
  }

  async upsertByGoogleSubject(input: UserUpsertInput): Promise<OperatorUser> {
    const now = new Date().toISOString();

    if (!this.#adcStatus.available) {
      const existing = [...this.#inMemory.values()].find(
        (user) => user.googleSubject === input.googleSubject
      );

      if (existing) {
        const updated = operatorUserSchema.parse({
          ...existing,
          email: input.email,
          displayName: input.displayName ?? existing.displayName,
          avatarUrl: input.avatarUrl ?? existing.avatarUrl,
          updatedAt: now,
          lastSeenAt: now
        });
        this.#inMemory.set(updated.id, updated);
        return updated;
      }

      const created = operatorUserSchema.parse({
        id: randomUUID(),
        googleSubject: input.googleSubject,
        email: input.email,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
        roles: ['owner'],
        plan: 'free',
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now
      });
      this.#inMemory.set(created.id, created);
      return created;
    }

    try {
      const db = this.#getFirestore();
      const collection = db.collection(this.#config.FIRESTORE_USERS_COLLECTION);

      const existingSnapshot = await collection
        .where('googleSubject', '==', input.googleSubject)
        .limit(1)
        .get();

      if (!existingSnapshot.empty) {
        const doc = existingSnapshot.docs[0];
        if (!doc) {
          throw new Error('Firestore returned an empty docs array for a non-empty snapshot.');
        }
        const existing = operatorUserSchema.parse({ ...doc.data(), id: doc.id });
        const updated = operatorUserSchema.parse({
          ...existing,
          email: input.email,
          displayName: input.displayName ?? existing.displayName,
          avatarUrl: input.avatarUrl ?? existing.avatarUrl,
          updatedAt: now,
          lastSeenAt: now
        });
        await doc.ref.set(updated, { merge: true });
        return updated;
      }

      const id = randomUUID();
      const created = operatorUserSchema.parse({
        id,
        googleSubject: input.googleSubject,
        email: input.email,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
        roles: ['owner'],
        plan: 'free',
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now
      });
      await collection.doc(id).set(created);
      return created;
    } catch (error) {
      this.#logger.warn({ err: error }, 'firestore user upsert failed');
      throw mapGoogleIntegrationError('users-repository', error);
    }
  }

  describeFallbackSize() {
    return buildDegradedCheck(
      'users-repository-fallback',
      `Users repository in-memory fallback currently holds ${this.#inMemory.size} records.`
    );
  }

  #getFirestore() {
    this.#firestore ??= new Firestore({
      projectId: this.#config.GOOGLE_CLOUD_PROJECT
    });
    return this.#firestore;
  }
}
