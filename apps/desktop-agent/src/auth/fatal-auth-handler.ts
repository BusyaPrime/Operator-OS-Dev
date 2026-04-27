import type { Logger } from 'pino';

import type {
  TokenAuthSignals,
  UnauthorizedContext
} from './auth-signals.js';

/**
 * Phase 4.0 Part 4.F — fatal-auth-handler.
 *
 * Single subscriber to `TokenAuthSignals.onUnauthorized`.
 * On the first 401 observation:
 *
 *   1. Log a structured fatal entry with the full context
 *      (source, agentId, url, method, reason, last successful
 *      auth timestamp). The log uses pino's `fatal` level
 *      and a stable `source: 'fatal-auth-handler'` field so
 *      ops can grep across instances.
 *
 *   2. Flush pino. Pino flushes on stream end; we await a
 *      microtask + setImmediate to give it a chance.
 *
 *   3. Call `process.exit(87)` (or the injected exit
 *      function in tests). The exit code 87 =
 *      `AGENT_TOKEN_REVOKED`. The Phase 4.0 Part 6 install
 *      script's Scheduled Task XML knows about this code:
 *      it does NOT auto-restart on exit 87 (the agent
 *      genuinely needs the user to re-register, restarting
 *      would just thrash).
 *
 * Subsequent 401 observations after the first are no-ops —
 * the process is already on its way out, and we don't want
 * to double-log if the REST and WS paths both surface the
 * same revocation event in quick succession.
 *
 * The `lastSuccessfulAuthAt` field is updated externally
 * via `recordSuccessfulAuth()` when the agent sees a
 * non-401 authenticated response from any path. Used in
 * the structured fatal log to give ops a "the agent was
 * fine until X" timestamp.
 */

/** Exit code emitted on revoked-token fatal. */
export const AGENT_TOKEN_REVOKED_EXIT_CODE = 87;

export interface FatalAuthHandlerOptions {
  readonly logger: Logger;
  /** Test seam — defaults to `process.exit`. */
  readonly exit?: (code: number) => void;
  /** Test seam — defaults to a 50ms async pause for pino flush. */
  readonly flushDelayMs?: number;
}

export class FatalAuthHandler {
  readonly name = 'fatal-auth-handler';
  #logger: Logger;
  #exit: (code: number) => void;
  #flushDelayMs: number;
  #fired = false;
  #lastSuccessfulAuthAt: string | null = null;

  constructor(options: FatalAuthHandlerOptions) {
    this.#logger = options.logger.child({
      source: 'fatal-auth-handler'
    });
    this.#exit = options.exit ?? ((code) => process.exit(code));
    this.#flushDelayMs = options.flushDelayMs ?? 50;
  }

  /**
   * Subscribe by passing this method as the `onUnauthorized`
   * handler in `TokenAuthSignals`. Idempotent — second-and-
   * subsequent calls are no-ops while the process is already
   * exiting.
   */
  readonly onUnauthorized = (context: UnauthorizedContext): void => {
    if (this.#fired) return;
    this.#fired = true;

    this.#logger.fatal(
      {
        agentId: context.agentId,
        url: context.url,
        method: context.method,
        reason: context.reason,
        authSource: context.source,
        lastSuccessfulAuthAt: this.#lastSuccessfulAuthAt,
        exitCode: AGENT_TOKEN_REVOKED_EXIT_CODE
      },
      'agent token revoked or rejected — exiting'
    );

    // Async fire-and-forget. The exit call schedules itself
    // after the flush window so pino has time to drain to
    // stderr before the process tears down.
    setTimeout(() => {
      this.#exit(AGENT_TOKEN_REVOKED_EXIT_CODE);
    }, this.#flushDelayMs).unref?.();
  };

  /**
   * Convenience: wire this handler into a `TokenAuthSignals`
   * value, optionally augmenting an existing
   * `onRotationHinted`. Returns a fresh signals object — the
   * caller passes it into the rotator / api-client / WS.
   */
  attachTo(rotationHandler: () => void): TokenAuthSignals {
    return {
      onRotationHinted: rotationHandler,
      onUnauthorized: this.onUnauthorized
    };
  }

  /**
   * Update the in-memory watermark for the most recent
   * successful authentication. Called from the api-client
   * + WS paths whenever a non-401 authenticated response
   * arrives. The fatal log includes this for ops.
   */
  recordSuccessfulAuth(at: Date = new Date()): void {
    this.#lastSuccessfulAuthAt = at.toISOString();
  }

  /** Test-only: surface whether the handler has fired. */
  get hasFired(): boolean {
    return this.#fired;
  }
}
