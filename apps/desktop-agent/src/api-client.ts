import type {
  Alert,
  Command,
  DeviceState,
  ExportJob,
  MutationReceipt,
  Session
} from '@operator-os/contracts';
import {
  commandPollResponseSchema,
  exportReceiptSchema,
  mutationReceiptSchema,
  sessionReceiptSchema,
  TOKEN_ROTATION_RECOMMENDED_HEADER
} from '@operator-os/contracts';
import type { Logger } from 'pino';

import type { DesktopAgentEnv } from '@operator-os/config';

import {
  AGENT_TOKEN_TARGET,
  type CredentialStore
} from './auth/credential-store.js';
import { noopAuthSignals, type TokenAuthSignals } from './auth/auth-signals.js';

/**
 * Phase 4.0 Part 4.D — REST client now centralises agent
 * token authentication.
 *
 * Every request reads the current token from the
 * `CredentialStore` at request time (NOT cached) so a
 * rotation by the `TokenRotator` is picked up on the very
 * next call without a restart. Closes TD-056 — the legacy
 * 401s on `/v1/agent/heartbeat` and friends were caused by
 * the absence of an Authorization header; this commit adds
 * one to every method.
 *
 * Two response observations are forwarded to the shared
 * `TokenAuthSignals`:
 *
 *   - `X-Token-Rotation-Recommended: true` → call
 *     `signals.onRotationHinted()` so the rotator schedules
 *     an out-of-band rotate-token call on the next event-
 *     loop tick.
 *   - HTTP 401 → call `signals.onUnauthorized({source:
 *     'rest', ...})` so the FatalAuthHandler in Part 4.F
 *     logs and exits with code 87.
 *
 * Backward compatibility: the constructor accepts
 * `credentialStore` and `authSignals` as optional arguments
 * — old call sites that don't yet wire them up get the
 * behaviour they had before (no Authorization, signals
 * inert). main.ts wiring lands in Part 4.E.
 */
export interface DesktopApiClientOptions {
  readonly credentialStore?: CredentialStore;
  readonly authSignals?: TokenAuthSignals;
}

export class DesktopApiClient {
  #config: DesktopAgentEnv;
  #logger: Logger;
  #credentialStore?: CredentialStore;
  #signals: TokenAuthSignals;

  constructor(
    config: DesktopAgentEnv,
    logger: Logger,
    options: DesktopApiClientOptions = {}
  ) {
    this.#config = config;
    this.#logger = logger;
    this.#credentialStore = options.credentialStore;
    this.#signals = options.authSignals ?? noopAuthSignals;
  }

  async postHeartbeat(state: DeviceState) {
    return this.#post('/v1/agent/heartbeat', state, mutationReceiptSchema.parse, {
      operation: 'device-state.heartbeat',
      resourceId: state.deviceId
    });
  }

  async pollCommands(): Promise<Command[]> {
    try {
      const payload = await this.#get(
        `/v1/agent/commands?deviceId=${encodeURIComponent(this.#config.DEVICE_ID)}`,
        (value) => commandPollResponseSchema.parse(value)
      );

      return payload.commands;
    } catch (error) {
      if (!this.#config.CONTROLLED_FALLBACK) {
        throw error;
      }

      this.#logger.warn({ err: error }, 'command polling fell back to an empty list');
      return [];
    }
  }

  async reportSession(session: Session) {
    return this.#post('/v1/agent/sessions', session, sessionReceiptSchema.parse, {
      operation: 'session.upsert',
      resourceId: session.id
    });
  }

  async reportExport(exportJob: ExportJob) {
    return this.#post('/v1/agent/exports', exportJob, exportReceiptSchema.parse, {
      operation: 'export.queue',
      resourceId: exportJob.id
    });
  }

  async publishAlert(alert: Alert) {
    return this.#post('/v1/agent/alerts', alert, mutationReceiptSchema.parse, {
      operation: 'alert.emit',
      resourceId: alert.id
    });
  }

  async #get<T>(path: string, parse: (value: unknown) => T) {
    const response = await this.#fetch(path, {
      method: 'GET'
    });

    return parse(await response.json());
  }

  async #post<T>(
    path: string,
    body: unknown,
    parse: (value: unknown) => T,
    fallback: Pick<MutationReceipt, 'operation' | 'resourceId'>
  ) {
    try {
      const response = await this.#fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      return parse(await response.json());
    } catch (error) {
      if (!this.#config.CONTROLLED_FALLBACK) {
        throw error;
      }

      this.#logger.warn({ err: error, path }, 'desktop agent request fell back');

      return mutationReceiptSchema.parse({
        operation: fallback.operation,
        accepted: true,
        resourceId: fallback.resourceId,
        dataSource: 'api-controlled-fallback',
        message:
          'Desktop agent request was retained locally because the API is unavailable or still in fallback mode.',
        timestamp: new Date().toISOString()
      }) as T;
    }
  }

  async #fetch(path: string, init: RequestInit) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.#config.API_REQUEST_TIMEOUT_MS
    );

    try {
      const headers = await this.#buildHeaders(init.headers);
      const response = await fetch(`${this.#config.API_BASE_URL}${path}`, {
        ...init,
        headers,
        signal: controller.signal
      });

      // Observe the rotation header BEFORE the not-ok check
      // so a request that comes back 200-with-hint still
      // triggers the rotator. Only headers from
      // authenticated calls carry it (the api guard sets
      // it inside the `usedPreviousToken` branch).
      if (
        response.headers.get(TOKEN_ROTATION_RECOMMENDED_HEADER) === 'true'
      ) {
        try {
          this.#signals.onRotationHinted();
        } catch (err) {
          this.#logger.warn(
            { err, path },
            'authSignals.onRotationHinted threw — continuing'
          );
        }
      }

      if (response.status === 401 && this.#credentialStore !== undefined) {
        // 401 against an authenticated agent request → fatal.
        // Fire the signal; the FatalAuthHandler exits the
        // process. We still throw so the caller's error path
        // runs (including controlled-fallback logging).
        try {
          this.#signals.onUnauthorized({
            source: 'rest',
            url: `${this.#config.API_BASE_URL}${path}`,
            method:
              typeof init.method === 'string' ? init.method : 'GET',
            reason: 'rest_401'
          });
        } catch (err) {
          this.#logger.warn(
            { err, path },
            'authSignals.onUnauthorized threw — continuing'
          );
        }
      }

      if (!response.ok) {
        throw new Error(`Agent request failed with status ${response.status}`);
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  async #buildHeaders(
    existing: HeadersInit | undefined
  ): Promise<Record<string, string>> {
    const merged: Record<string, string> = {};
    // Normalise whatever shape the caller passed (Headers,
    // entries array, plain object) into our flat record.
    if (existing instanceof Headers) {
      existing.forEach((value, key) => {
        merged[key] = value;
      });
    } else if (Array.isArray(existing)) {
      for (const [key, value] of existing) {
        merged[key] = value;
      }
    } else if (existing !== undefined) {
      Object.assign(merged, existing);
    }

    if (this.#credentialStore !== undefined) {
      try {
        const token = await this.#credentialStore.getToken(
          AGENT_TOKEN_TARGET
        );
        if (token !== null && token.length > 0) {
          merged.authorization = `Bearer ${token}`;
        }
      } catch (err) {
        this.#logger.warn(
          { err },
          'credential store getToken failed; sending request unauthenticated'
        );
      }
    }

    return merged;
  }
}
