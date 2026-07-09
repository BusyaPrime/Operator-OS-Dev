import {
  agentRotateTokenResponseSchema,
  type AgentRotateTokenResponse
} from '@operator-os/contracts';
import type { Logger } from 'pino';

import {
  AGENT_TOKEN_TARGET,
  type CredentialStore
} from './credential-store.js';
import type { TokenAuthSignals, UnauthorizedContext } from './auth-signals.js';

/**
 * Phase 4.0 Part 4.C — token rotation background task.
 *
 * Responsibilities (per ADR-025 amendment 1):
 *
 *   1. React to `X-Token-Rotation-Recommended: true` headers
 *      observed by the REST client + WS upgrade. Trigger an
 *      out-of-band POST /v1/agent/rotate-token, store the
 *      new token in the CredentialStore, never block the
 *      in-flight request.
 *
 *   2. Background safety net: every 6h, check whether the
 *      current token is approaching the 30-day expiry server-
 *      side. The header path covers the common case; the
 *      timer covers an agent that genuinely sees no traffic
 *      for an extended window.
 *
 *   3. Atomic credential store update: write new token,
 *      verify it can be read back, only then consider the
 *      rotation successful. If the store write fails after
 *      the api accepted the rotation, we hold the new token
 *      in memory and schedule an immediate retry — calling
 *      rotate-token again with the new (now-stale) token
 *      gets us out of the bind by minting another fresh
 *      token and re-attempting the store write.
 *
 *   4. Exponential backoff on retryable failures. 401 is
 *      NOT retryable — it bubbles up to the FatalAuthHandler
 *      via the shared `TokenAuthSignals.onUnauthorized`.
 *
 * Single-flight semantics: if a rotation is already in
 * progress when `triggerRotation` fires again, the second
 * call is a debounced no-op. The api also enforces this
 * server-side via the `usedPreviousToken` 409 path, but
 * client-side debounce keeps us off the wire when we know
 * we'd just get rejected.
 */

const DEFAULT_PERIODIC_CHECK_MS = 6 * 60 * 60 * 1000; // 6h
const DEFAULT_BACKOFF_BASE_MS = 1_000;
const DEFAULT_BACKOFF_MAX_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 6;

/**
 * Minimum age (ms) at which the periodic timer triggers a
 * rotation regardless of the rotation-hint header. The api
 * starts emitting the hint at 30d but agents that genuinely
 * see no traffic for a month would otherwise drift past the
 * boundary; rotating at 25d locally gives a 5d safety
 * margin.
 */
const DEFAULT_LOCAL_AGE_TRIGGER_MS = 25 * 24 * 60 * 60 * 1000;

export interface TokenRotatorOptions {
  readonly apiBaseUrl: string;
  readonly credentialStore: CredentialStore;
  readonly authSignals: TokenAuthSignals;
  readonly logger: Logger;
  /** `globalThis.fetch` in production; tests inject a stub. */
  readonly fetch?: typeof globalThis.fetch;
  /** Default 6h. Tests pass a short interval. */
  readonly periodicCheckMs?: number;
  /** Default 25d. Tests pass small values. */
  readonly localAgeTriggerMs?: number;
  /** Backoff config — only matters on transient failures. */
  readonly backoff?: {
    readonly baseMs?: number;
    readonly maxMs?: number;
    readonly maxAttempts?: number;
  };
  /**
   * Override Date.now() for tests. Production uses real time.
   */
  readonly now?: () => number;
  /**
   * Provides the local snapshot of when the current token
   * was issued. Defaults to the in-process timestamp the
   * rotator captures on each successful `storeNewToken`. The
   * registration CLI seeds this value on first run via
   * `seedIssuedAt(...)`.
   */
  readonly issuedAtProvider?: () => number | undefined;
  /**
   * Test seam — schedule the periodic check via this
   * setTimeout (default `globalThis.setTimeout`). Tests
   * inject a fake-timer-aware version.
   */
  readonly setTimeout?: typeof globalThis.setTimeout;
  /** Pair to the setTimeout override. */
  readonly clearTimeout?: typeof globalThis.clearTimeout;
}

export class TokenRotator {
  readonly name = 'token-rotator';

  #apiBaseUrl: string;
  #store: CredentialStore;
  #signals: TokenAuthSignals;
  #logger: Logger;
  #fetch: typeof globalThis.fetch;
  #periodicCheckMs: number;
  #localAgeTriggerMs: number;
  #backoffBaseMs: number;
  #backoffMaxMs: number;
  #maxAttempts: number;
  #now: () => number;
  #issuedAtProvider: () => number | undefined;
  #setTimeout: typeof globalThis.setTimeout;
  #clearTimeout: typeof globalThis.clearTimeout;

  /**
   * In-process record of when the last successful rotation
   * (or initial registration) happened. Set by
   * `seedIssuedAt` and updated on every store-new-token call.
   */
  #lastIssuedAtMs: number | undefined;

  #periodicTimer: ReturnType<typeof setTimeout> | undefined;
  #rotationInFlight = false;
  #stopping = false;

  constructor(options: TokenRotatorOptions) {
    this.#apiBaseUrl = options.apiBaseUrl.replace(/\/$/, '');
    this.#store = options.credentialStore;
    this.#signals = options.authSignals;
    this.#logger = options.logger.child({ component: 'token-rotator' });
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#periodicCheckMs = options.periodicCheckMs ?? DEFAULT_PERIODIC_CHECK_MS;
    this.#localAgeTriggerMs =
      options.localAgeTriggerMs ?? DEFAULT_LOCAL_AGE_TRIGGER_MS;
    this.#backoffBaseMs =
      options.backoff?.baseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.#backoffMaxMs =
      options.backoff?.maxMs ?? DEFAULT_BACKOFF_MAX_MS;
    this.#maxAttempts =
      options.backoff?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.#now = options.now ?? Date.now;
    this.#issuedAtProvider =
      options.issuedAtProvider ?? (() => this.#lastIssuedAtMs);
    this.#setTimeout = options.setTimeout ?? globalThis.setTimeout;
    this.#clearTimeout = options.clearTimeout ?? globalThis.clearTimeout;
  }

  /**
   * Inform the rotator of the timestamp at which the current
   * stored token was issued. The registration CLI calls this
   * on first install; subsequent rotations update it
   * automatically.
   */
  seedIssuedAt(issuedAtIso: string): void {
    const ms = Date.parse(issuedAtIso);
    if (!Number.isNaN(ms)) {
      this.#lastIssuedAtMs = ms;
    }
  }

  /** Start the periodic-check timer. Idempotent. */
  start(): void {
    if (this.#periodicTimer !== undefined || this.#stopping) return;
    this.#scheduleNextCheck();
  }

  /** Cancel the periodic-check timer. Idempotent. */
  async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#periodicTimer !== undefined) {
      this.#clearTimeout(this.#periodicTimer);
      this.#periodicTimer = undefined;
    }
  }

  /**
   * Public trigger surface. Called from:
   *   - The REST client when a response carries
   *     `X-Token-Rotation-Recommended: true`.
   *   - The WS upgrade observer when the server set the
   *     header on the welcome response.
   *   - The periodic timer when the local age threshold is
   *     crossed.
   * Single-flight: subsequent calls during an in-flight
   * rotation are debounced.
   */
  triggerRotation(): void {
    if (this.#rotationInFlight) {
      this.#logger.debug(
        'rotation already in flight; debouncing redundant trigger'
      );
      return;
    }
    void this.#runRotation();
  }

  /**
   * Internal — wraps `#performRotation` with single-flight
   * + backoff + non-retryable handling. Returns when the
   * rotation either succeeded, exhausted retries, or was
   * cancelled by `onUnauthorized`.
   */
  async #runRotation(): Promise<void> {
    this.#rotationInFlight = true;
    try {
      let attempt = 0;
      while (attempt < this.#maxAttempts) {
        attempt += 1;
        const outcome = await this.#performRotation(attempt);
        if (outcome.kind === 'ok') {
          this.#logger.info(
            { attempt, tokenIssuedAt: outcome.tokenIssuedAt },
            'agent token rotated'
          );
          return;
        }
        if (outcome.kind === 'fatal') {
          this.#logger.error(
            { attempt, reason: outcome.reason },
            'token rotation aborted (fatal)'
          );
          return;
        }
        // outcome.kind === 'retry'
        const delay = Math.min(
          this.#backoffBaseMs * 2 ** (attempt - 1),
          this.#backoffMaxMs
        );
        this.#logger.warn(
          { attempt, delay, reason: outcome.reason },
          'token rotation retry scheduled'
        );
        await sleep(delay);
      }
      this.#logger.error(
        { maxAttempts: this.#maxAttempts },
        'token rotation gave up after exhausting retries'
      );
    } finally {
      this.#rotationInFlight = false;
    }
  }

  /**
   * Single rotation attempt. Returns a structured outcome:
   *   - `ok`: rotation successful, token persisted
   *   - `retry`: transient failure, caller should backoff
   *   - `fatal`: non-retryable (401 = revoked); caller stops
   */
  async #performRotation(
    attempt: number
  ): Promise<RotationOutcome> {
    const currentToken = await this.#store.getToken(AGENT_TOKEN_TARGET);
    if (currentToken === null) {
      return {
        kind: 'fatal',
        reason: 'no token in credential store; agent must re-register'
      };
    }

    let response: Response;
    try {
      response = await this.#fetch(
        `${this.#apiBaseUrl}/v1/agent/rotate-token`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${currentToken}`,
            'content-type': 'application/json'
          },
          body: '{}'
        }
      );
    } catch (err) {
      return {
        kind: 'retry',
        reason: `network error on attempt ${attempt}: ${
          err instanceof Error ? err.message : String(err)
        }`
      };
    }

    if (response.status === 401) {
      // Bubble up to the fatal handler. We do NOT retry —
      // the token is genuinely revoked.
      this.#emitUnauthorized({
        source: 'rotate',
        url: `${this.#apiBaseUrl}/v1/agent/rotate-token`,
        method: 'POST',
        reason: 'rotate_token_returned_401'
      });
      return { kind: 'fatal', reason: '401 from rotate-token' };
    }

    if (response.status === 409) {
      // Server says rotation already in progress (the
      // `usedPreviousToken` 409 from the route handler).
      // Treat as benign success-at-most-once: another rotator
      // already ran. Clear the in-flight flag and trust the
      // X-Token-Rotation-Recommended hint will land again
      // if the server still needs a fresher token.
      return {
        kind: 'fatal',
        reason: 'server reports rotation already in progress'
      };
    }

    if (!response.ok) {
      return {
        kind: 'retry',
        reason: `rotate-token returned ${response.status} on attempt ${attempt}`
      };
    }

    let parsed: AgentRotateTokenResponse;
    try {
      const json = await response.json();
      parsed = agentRotateTokenResponseSchema.parse(json);
    } catch (err) {
      return {
        kind: 'retry',
        reason: `rotate-token response did not match schema on attempt ${attempt}: ${
          err instanceof Error ? err.message : String(err)
        }`
      };
    }

    const newToken = parsed.agentToken;

    // Atomic store: write, then verify by reading back, only
    // then commit the in-memory issuedAt. If the read-back
    // fails we still hold the new token in memory and could
    // retry — but for Phase 4.0 simplicity we surface as
    // retry and let the next rotation attempt mint another.
    try {
      await this.#store.storeToken(AGENT_TOKEN_TARGET, newToken);
      const readBack = await this.#store.getToken(AGENT_TOKEN_TARGET);
      if (readBack !== newToken) {
        return {
          kind: 'retry',
          reason: 'credential store read-back did not match what we wrote'
        };
      }
    } catch (err) {
      return {
        kind: 'retry',
        reason: `credential store write failed on attempt ${attempt}: ${
          err instanceof Error ? err.message : String(err)
        }`
      };
    }

    // Update the local issuedAt watermark.
    const issuedAtMs = Date.parse(parsed.tokenIssuedAt);
    if (!Number.isNaN(issuedAtMs)) {
      this.#lastIssuedAtMs = issuedAtMs;
    }

    return { kind: 'ok', tokenIssuedAt: parsed.tokenIssuedAt };
  }

  #scheduleNextCheck(): void {
    if (this.#stopping) return;
    this.#periodicTimer = this.#setTimeout(() => {
      this.#periodicTimer = undefined;
      void this.#periodicTick();
    }, this.#periodicCheckMs);
    if (typeof this.#periodicTimer === 'object' && this.#periodicTimer !== null) {
      const t = this.#periodicTimer as { unref?: () => void };
      if (typeof t.unref === 'function') t.unref();
    }
  }

  async #periodicTick(): Promise<void> {
    try {
      const issuedAt = this.#issuedAtProvider();
      if (issuedAt !== undefined) {
        const age = this.#now() - issuedAt;
        if (age >= this.#localAgeTriggerMs) {
          this.#logger.info(
            { ageMs: age, thresholdMs: this.#localAgeTriggerMs },
            'periodic check: token age past local trigger; rotating'
          );
          this.triggerRotation();
        }
      }
    } finally {
      this.#scheduleNextCheck();
    }
  }

  #emitUnauthorized(context: UnauthorizedContext): void {
    try {
      this.#signals.onUnauthorized(context);
    } catch (err) {
      this.#logger.warn(
        { err },
        'authSignals.onUnauthorized threw — continuing'
      );
    }
  }
}

type RotationOutcome =
  | { readonly kind: 'ok'; readonly tokenIssuedAt: string }
  | { readonly kind: 'retry'; readonly reason: string }
  | { readonly kind: 'fatal'; readonly reason: string };

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
