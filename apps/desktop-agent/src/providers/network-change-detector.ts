import { networkInterfaces } from 'node:os';
import type { Logger } from 'pino';

/**
 * Phase 4.0 Part 5.E — network change detector.
 *
 * Goal: nudge the WS reconnect attempt forward as soon as
 * the local network interface comes back, rather than
 * waiting for the backoff delay to expire on a stale schedule.
 *
 * Approach — polling-based with `os.networkInterfaces()`:
 *
 *   Windows has WMI / WNet event APIs that surface interface
 *   change events but reaching them requires a native node
 *   addon (node-ffi-napi, node-windows) — same install-deps
 *   problem we documented in Part 4.A's credential-store
 *   choice. The polling alternative samples
 *   `os.networkInterfaces()` every N seconds, computes a
 *   stable signature of the available IPv4/IPv6 addresses,
 *   and fires a callback whenever the signature changes.
 *
 *   At the agent's reconnect cadence (1s base, 60s ceiling),
 *   a 5-second poll interval is plenty fine — the worst
 *   case is "interface comes back, agent's next reconnect
 *   already scheduled in <5s, polling fires too late by
 *   2-3s". Network changes are 10-30s human-perceptible
 *   events anyway.
 *
 *   Forward path: when Phase 4.x lands a Windows native
 *   addon (or a cleaner cross-OS solution), the
 *   `NetworkChangeDetector` interface stays the same and
 *   the polling impl swaps in for an event-driven one.
 *
 * The detector is a passive observer — it doesn't trigger
 * the reconnect itself. ControlChannelWs subscribes via
 * `onChange(...)` and decides what to do (typically: cancel
 * the pending backoff timer and fire `#connect()` immediately).
 */

export interface NetworkChangeDetector {
  /**
   * Subscribe to interface-change notifications. The callback
   * fires with a brief description of what changed (purely
   * for logging; the caller doesn't need to act on the
   * specifics).
   */
  readonly onChange: (
    listener: (event: NetworkChangeEvent) => void
  ) => () => void;

  /** Begin polling. Idempotent. */
  readonly start: () => void;

  /** Stop polling. Idempotent. */
  readonly stop: () => void;
}

export interface NetworkChangeEvent {
  readonly previousSignature: string | null;
  readonly currentSignature: string;
  readonly interfaceCount: number;
  readonly at: string;
}

export interface PollingNetworkChangeDetectorOptions {
  readonly logger: Logger;
  /** Default 5_000 ms. Tests inject a tighter interval. */
  readonly pollIntervalMs?: number;
  /** Default `os.networkInterfaces`. Tests inject a stub. */
  readonly interfacesProvider?: () => ReturnType<typeof networkInterfaces>;
  /** Default `Date.now`. Tests inject a clock. */
  readonly clock?: () => string;
  /** Test seam — defaults to `globalThis.setInterval`. */
  readonly setInterval?: typeof globalThis.setInterval;
  /** Test seam — pair to setInterval. */
  readonly clearInterval?: typeof globalThis.clearInterval;
}

export class PollingNetworkChangeDetector implements NetworkChangeDetector {
  readonly name = 'polling-network-change-detector';
  #logger: Logger;
  #pollIntervalMs: number;
  #interfacesProvider: () => ReturnType<typeof networkInterfaces>;
  #clock: () => string;
  #setInterval: typeof globalThis.setInterval;
  #clearInterval: typeof globalThis.clearInterval;
  #listeners: Array<(event: NetworkChangeEvent) => void> = [];
  #timer: ReturnType<typeof setInterval> | undefined;
  #lastSignature: string | null = null;

  constructor(options: PollingNetworkChangeDetectorOptions) {
    this.#logger = options.logger.child({
      component: 'network-change-detector'
    });
    this.#pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.#interfacesProvider =
      options.interfacesProvider ?? networkInterfaces;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#setInterval = options.setInterval ?? globalThis.setInterval;
    this.#clearInterval = options.clearInterval ?? globalThis.clearInterval;
  }

  onChange(
    listener: (event: NetworkChangeEvent) => void
  ): () => void {
    this.#listeners.push(listener);
    return () => {
      const idx = this.#listeners.indexOf(listener);
      if (idx >= 0) this.#listeners.splice(idx, 1);
    };
  }

  start(): void {
    if (this.#timer !== undefined) return;
    // Take an initial signature without firing — we only
    // emit on CHANGE, not on first poll.
    this.#lastSignature = this.#computeSignature();
    this.#timer = this.#setInterval(
      () => this.#tick(),
      this.#pollIntervalMs
    );
    if (
      typeof this.#timer === 'object' &&
      this.#timer !== null &&
      typeof (this.#timer as { unref?: () => void }).unref === 'function'
    ) {
      (this.#timer as { unref: () => void }).unref();
    }
  }

  stop(): void {
    if (this.#timer !== undefined) {
      this.#clearInterval(this.#timer);
      this.#timer = undefined;
    }
    this.#listeners = [];
  }

  /** Test helper — manually advance the poll. */
  pollNow(): void {
    this.#tick();
  }

  #tick(): void {
    let current: string;
    try {
      current = this.#computeSignature();
    } catch (err) {
      this.#logger.warn(
        { err },
        'network interfaces snapshot failed; skipping this poll'
      );
      return;
    }
    if (current === this.#lastSignature) return;

    const event: NetworkChangeEvent = {
      previousSignature: this.#lastSignature,
      currentSignature: current,
      interfaceCount: current.split('|').filter((s) => s.length > 0).length,
      at: this.#clock()
    };
    this.#lastSignature = current;
    this.#logger.info(event, 'network interface change detected');
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (err) {
        this.#logger.warn({ err }, 'network change listener threw');
      }
    }
  }

  /**
   * Build a stable signature of the current local network
   * interfaces. Includes only non-internal IPv4/IPv6 addresses,
   * sorted, joined by '|' for diff-stability.
   */
  #computeSignature(): string {
    const ifaces = this.#interfacesProvider();
    const addrs: string[] = [];
    for (const list of Object.values(ifaces)) {
      if (list === undefined) continue;
      for (const addr of list) {
        if (addr.internal) continue;
        addrs.push(`${addr.family}:${addr.address}`);
      }
    }
    addrs.sort();
    return addrs.join('|');
  }
}
