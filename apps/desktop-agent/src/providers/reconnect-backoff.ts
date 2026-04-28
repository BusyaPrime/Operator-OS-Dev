/**
 * Phase 4.0 Part 5.D — exponential backoff with jitter for
 * the agent's WS reconnect schedule.
 *
 * Phase 3.2's ControlChannelWs already had base 1s, ceiling
 * 60s exponential backoff. Part 5 adds:
 *
 *   - ±20% uniform jitter so a fleet of agents doesn't
 *     thunder-herd a Cloud Run instance after a region-wide
 *     blip.
 *   - Max attempts ceiling (default 1000). At 60s ceiling
 *     this is ~16h of retry time — enough that "I came back
 *     from a long weekend, the agent's still trying" is the
 *     normal case, but not infinite.
 *   - Reset semantics: any successful welcome resets the
 *     attempt counter to 0 so the next disconnect starts
 *     from base again.
 *
 * Pure utility — no timers, no I/O. The caller schedules.
 */

export interface BackoffPolicyOptions {
  /** Base delay in ms (default 1000). */
  readonly baseMs?: number;
  /** Ceiling delay in ms (default 60_000). */
  readonly maxMs?: number;
  /**
   * Jitter as a fraction of the computed delay. Default 0.2
   * = ±20%. Set to 0 for deterministic tests.
   */
  readonly jitter?: number;
  /**
   * Max attempts before `nextDelay()` returns null. Default
   * 1000. After exhaustion the caller is expected to surface
   * a distress signal and stop reconnecting.
   */
  readonly maxAttempts?: number;
  /**
   * Random source (default `Math.random`). Tests inject a
   * deterministic generator.
   */
  readonly random?: () => number;
}

export class ReconnectBackoff {
  readonly name = 'reconnect-backoff';
  #baseMs: number;
  #maxMs: number;
  #jitter: number;
  #maxAttempts: number;
  #random: () => number;
  #attempt = 0;

  constructor(options: BackoffPolicyOptions = {}) {
    this.#baseMs = options.baseMs ?? 1_000;
    this.#maxMs = options.maxMs ?? 60_000;
    this.#jitter = options.jitter ?? 0.2;
    this.#maxAttempts = options.maxAttempts ?? 1000;
    this.#random = options.random ?? Math.random;

    if (this.#baseMs <= 0 || this.#maxMs < this.#baseMs) {
      throw new Error(
        `ReconnectBackoff: invalid baseMs/maxMs (base=${this.#baseMs} max=${this.#maxMs})`
      );
    }
    if (this.#jitter < 0 || this.#jitter > 1) {
      throw new Error(
        `ReconnectBackoff: jitter must be in [0,1] (got ${this.#jitter})`
      );
    }
    if (this.#maxAttempts <= 0) {
      throw new Error(
        `ReconnectBackoff: maxAttempts must be positive (got ${this.#maxAttempts})`
      );
    }
  }

  /**
   * Compute the delay for the next attempt and tick the
   * counter forward. Returns null when `maxAttempts` is
   * reached — caller stops retrying.
   */
  nextDelayMs(): number | null {
    if (this.#attempt >= this.#maxAttempts) return null;
    this.#attempt += 1;
    const exponent = Math.min(
      this.#baseMs * 2 ** (this.#attempt - 1),
      this.#maxMs
    );
    if (this.#jitter === 0) return Math.floor(exponent);
    // Uniform jitter in [exponent * (1 - jitter), exponent * (1 + jitter)]
    // clamped to [baseMs, maxMs].
    const range = exponent * this.#jitter;
    const jittered = exponent + (this.#random() * 2 - 1) * range;
    return Math.max(
      this.#baseMs,
      Math.min(this.#maxMs, Math.floor(jittered))
    );
  }

  /** Reset to attempt 0 — call after a successful welcome. */
  reset(): void {
    this.#attempt = 0;
  }

  /** Number of attempts produced so far (0 means no nextDelayMs() call yet). */
  get attempts(): number {
    return this.#attempt;
  }
}
