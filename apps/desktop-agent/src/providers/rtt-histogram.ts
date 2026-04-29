/**
 * Phase 4.0 Part 5.B — rolling-window RTT histogram for the
 * agent's WS control channel.
 *
 * The api emits a server-side ping every 30s (Phase 3.2
 * agent-ws.ts default). When ControlChannelWs sends the
 * matching `pong`, we record the round-trip latency between
 * the inbound `ping` frame and our outbound `pong` send. The
 * sample lands in this histogram. Mobile UI surfaces the
 * resulting p95 to drive the DEGRADED indicator.
 *
 * Design choice — naive rolling-array vs HDR histogram:
 *
 *   For Phase 4.0's volume (≈ 120 samples/hour per agent),
 *   a sorted array of the last N samples is plenty. p50 /
 *   p95 / p99 are computed with a one-pass copy + sort.
 *   The whole structure caps at ~100 samples * 8 bytes ≈
 *   1KB per agent. HDR / t-digest would be overkill.
 *
 *   The window discards the oldest sample once full. No
 *   time-based eviction; if an agent goes idle for an hour,
 *   the histogram represents whatever the last N samples
 *   were. Phase 4.0's degraded threshold is "p95 over Xms
 *   in the last 5 minutes" but we approximate via the last
 *   N samples — at the 30s ping cadence, 10 samples ≈ 5
 *   minutes which is what we want.
 *
 * Used by:
 *
 *   - ControlChannelWs (Part 5.F) — records on every pong.
 *   - mobile UI fan-out (Part 7) — reads `.percentiles()`.
 */

export interface RttPercentiles {
  /** Number of samples currently in the window. */
  readonly count: number;
  /** 50th percentile latency in ms, or null if no samples. */
  readonly p50: number | null;
  /** 95th percentile latency in ms, or null if no samples. */
  readonly p95: number | null;
  /** 99th percentile latency in ms, or null if no samples. */
  readonly p99: number | null;
  /** Mean latency in ms, or null if no samples. */
  readonly mean: number | null;
  /** Most recent sample, or null if no samples. */
  readonly mostRecent: number | null;
}

export interface RttHistogramOptions {
  /**
   * Number of recent samples to retain. At 30s ping cadence,
   * 10 samples ≈ 5 minutes; default 20 ≈ 10 minutes which
   * is forgiving enough for short network blips not to
   * trigger DEGRADED.
   */
  readonly windowSize?: number;
}

export class RttHistogram {
  readonly name = 'rtt-histogram';
  #samples: number[] = [];
  #windowSize: number;

  constructor(options: RttHistogramOptions = {}) {
    const requested = options.windowSize ?? 20;
    if (!Number.isInteger(requested) || requested <= 0) {
      throw new Error(
        `RttHistogram windowSize must be a positive integer, got ${requested}`
      );
    }
    this.#windowSize = requested;
  }

  /**
   * Record a single round-trip latency. Negative or NaN
   * values are silently ignored — we'd rather drop a bogus
   * measurement than poison the percentiles.
   */
  record(rttMs: number): void {
    if (!Number.isFinite(rttMs) || rttMs < 0) return;
    this.#samples.push(rttMs);
    while (this.#samples.length > this.#windowSize) {
      this.#samples.shift();
    }
  }

  /** Compute the current percentile snapshot. O(n log n). */
  percentiles(): RttPercentiles {
    if (this.#samples.length === 0) {
      return {
        count: 0,
        p50: null,
        p95: null,
        p99: null,
        mean: null,
        mostRecent: null
      };
    }
    const sorted = [...this.#samples].sort((a, b) => a - b);
    const sum = this.#samples.reduce((acc, x) => acc + x, 0);
    return {
      count: this.#samples.length,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      mean: sum / this.#samples.length,
      mostRecent: this.#samples[this.#samples.length - 1] ?? null
    };
  }

  /** Drop every sample. Used on reconnect when the new connection invalidates prior measurements. */
  clear(): void {
    this.#samples = [];
  }

  /** Test seam: surface raw samples for assertions. */
  get sampleCount(): number {
    return this.#samples.length;
  }
}

/**
 * Linear-interpolation percentile across a pre-sorted array.
 * Matches the standard `np.percentile` / `numpy.quantile`
 * algorithm so the values agree with anything dashboards
 * compute downstream.
 */
const percentile = (sorted: number[], q: number): number => {
  if (sorted.length === 0) {
    throw new Error('percentile: empty array');
  }
  if (sorted.length === 1) return sorted[0]!;
  const rank = q * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower]!;
  const fraction = rank - lower;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * fraction;
};
