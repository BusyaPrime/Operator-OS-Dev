import type { Logger } from 'pino';

/**
 * Phase 4.0 Part 5.A — explicit connection state machine
 * for the agent's WS control channel.
 *
 * Phase 3.2 + Phase 4.0 Part 4.E left state scattered
 * across `ControlChannelWs` (booleans + an attempt counter
 * + the socket reference). That worked for the simpler
 * lifecycle, but Part 5 adds:
 *
 *   - DEGRADED (high RTT) as a real state mobile UI shows.
 *   - REVOKED as a terminal absorbing state so a 401 cleanly
 *     disables reconnect without the FatalAuthHandler having
 *     to flip a private boolean inside the WS.
 *   - State-transition logging with reasons that ops can
 *     grep across instances.
 *
 * The machine itself is pure: no socket I/O, no timers. The
 * `ControlChannelWs` (Part 5.F) calls `request(...)` on
 * every event — open / message / close / error / send-success
 * — and the machine returns either an accepted-transition
 * or a rejected-transition with the reason. The WS uses the
 * accepted state to drive its observable behaviour
 * (reconnect or stop), and listeners receive the state-
 * change notifications.
 *
 * Six states + their semantics:
 *
 *   DISCONNECTED   — start state; not currently trying to
 *                    connect. Reached after `disconnect()`
 *                    or after a fatal-non-revoke that the
 *                    operator chose not to retry.
 *   CONNECTING     — open() in progress; awaiting `welcome`.
 *   CONNECTED      — `welcome` received; healthy traffic.
 *   DEGRADED       — `welcome` received but recent RTT p95
 *                    exceeds the threshold. Functionally
 *                    identical to CONNECTED for operations
 *                    (frames flow); the difference is what
 *                    the mobile UI surfaces.
 *   DISCONNECTING  — operator-initiated stop; suppress
 *                    reconnect.
 *   REVOKED        — terminal absorbing state. No further
 *                    transitions. Reached when the WS
 *                    observed a 4001 close OR a 401 upgrade
 *                    error. The FatalAuthHandler exits the
 *                    process in the same window.
 *
 * Transition matrix:
 *
 *   DISCONNECTED   → CONNECTING (operator start, reconnect)
 *   CONNECTING     → CONNECTED (welcome)
 *   CONNECTING     → DISCONNECTED (transient close, allow reconnect)
 *   CONNECTING     → REVOKED (4001 or upgrade-401)
 *   CONNECTING     → DISCONNECTING (operator stop)
 *   CONNECTED      → DEGRADED (RTT regression)
 *   CONNECTED      → DISCONNECTED (close other than 4001)
 *   CONNECTED      → REVOKED (4001)
 *   CONNECTED      → DISCONNECTING (operator stop)
 *   DEGRADED       → CONNECTED (RTT recovery)
 *   DEGRADED       → DISCONNECTED (close other than 4001)
 *   DEGRADED       → REVOKED (4001)
 *   DEGRADED       → DISCONNECTING (operator stop)
 *   DISCONNECTING  → DISCONNECTED (close)
 *   REVOKED        → REVOKED (terminal absorbing)
 *   DISCONNECTED   → DISCONNECTING (defensive — operator stop with no live socket)
 *
 * Anything else is a programming error and surfaces as a
 * rejected transition.
 */

export type ConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DEGRADED'
  | 'DISCONNECTING'
  | 'REVOKED';

export interface StateChangeEvent {
  readonly from: ConnectionState;
  readonly to: ConnectionState;
  readonly reason: string;
  readonly at: string; // ISO timestamp
  readonly metadata?: Record<string, unknown>;
}

export type StateTransitionListener = (event: StateChangeEvent) => void;

export interface TransitionRequest {
  readonly to: ConnectionState;
  readonly reason: string;
  readonly metadata?: Record<string, unknown>;
}

export type TransitionOutcome =
  | { readonly kind: 'accepted'; readonly event: StateChangeEvent }
  | {
      readonly kind: 'rejected';
      readonly from: ConnectionState;
      readonly to: ConnectionState;
      readonly reason: string;
    };

const ALLOWED_TRANSITIONS: Readonly<
  Record<ConnectionState, ReadonlySet<ConnectionState>>
> = {
  DISCONNECTED: new Set<ConnectionState>([
    'CONNECTING',
    'DISCONNECTING'
  ]),
  CONNECTING: new Set<ConnectionState>([
    'CONNECTED',
    'DISCONNECTED',
    'DISCONNECTING',
    'REVOKED'
  ]),
  CONNECTED: new Set<ConnectionState>([
    'DEGRADED',
    'DISCONNECTED',
    'DISCONNECTING',
    'REVOKED'
  ]),
  DEGRADED: new Set<ConnectionState>([
    'CONNECTED',
    'DISCONNECTED',
    'DISCONNECTING',
    'REVOKED'
  ]),
  DISCONNECTING: new Set<ConnectionState>(['DISCONNECTED']),
  REVOKED: new Set<ConnectionState>() // terminal absorbing
};

export interface ConnectionStateMachineOptions {
  readonly logger: Logger;
  /** Test seam — defaults to `() => new Date().toISOString()`. */
  readonly clock?: () => string;
}

export class ConnectionStateMachine {
  readonly name = 'connection-state-machine';
  #state: ConnectionState = 'DISCONNECTED';
  #logger: Logger;
  #clock: () => string;
  #listeners: StateTransitionListener[] = [];

  constructor(options: ConnectionStateMachineOptions) {
    this.#logger = options.logger.child({
      component: 'connection-state-machine'
    });
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  /** Read the current state (snapshot — does not subscribe). */
  get state(): ConnectionState {
    return this.#state;
  }

  /** True when the machine is in a state that accepts no further transitions. */
  get isTerminal(): boolean {
    return this.#state === 'REVOKED';
  }

  /** True when the machine is in a state where frames should flow. */
  get canSend(): boolean {
    return this.#state === 'CONNECTED' || this.#state === 'DEGRADED';
  }

  /**
   * Subscribe to transitions. Listeners fire AFTER the state
   * field has updated so they can read `.state` and observe
   * the new value. Returns an unsubscribe function.
   */
  subscribe(listener: StateTransitionListener): () => void {
    this.#listeners.push(listener);
    return () => {
      const idx = this.#listeners.indexOf(listener);
      if (idx >= 0) this.#listeners.splice(idx, 1);
    };
  }

  /**
   * Request a transition. Returns `{kind: 'accepted', event}`
   * or `{kind: 'rejected', from, to, reason}`. The machine
   * never throws — invalid transitions are observable in
   * the return value so callers can decide whether to log,
   * panic, or retry.
   *
   * REVOKED is absorbing: a request from REVOKED to anything
   * else is always rejected.
   */
  request(req: TransitionRequest): TransitionOutcome {
    const from = this.#state;
    if (this.#state === 'REVOKED') {
      return {
        kind: 'rejected',
        from,
        to: req.to,
        reason: `cannot transition out of terminal REVOKED (requested ${req.to})`
      };
    }
    if (from === req.to) {
      // Same-state "transition" is benign — accepted but no
      // listeners are notified so DEGRADED -> DEGRADED on
      // every RTT bucket update doesn't spam.
      const event: StateChangeEvent = {
        from,
        to: req.to,
        reason: req.reason,
        at: this.#clock(),
        ...(req.metadata !== undefined ? { metadata: req.metadata } : {})
      };
      return { kind: 'accepted', event };
    }
    const allowed = ALLOWED_TRANSITIONS[from];
    if (!allowed.has(req.to)) {
      const reason = `transition ${from} -> ${req.to} is not allowed`;
      this.#logger.warn(
        { from, to: req.to, requestReason: req.reason },
        reason
      );
      return { kind: 'rejected', from, to: req.to, reason };
    }
    this.#state = req.to;
    const event: StateChangeEvent = {
      from,
      to: req.to,
      reason: req.reason,
      at: this.#clock(),
      ...(req.metadata !== undefined ? { metadata: req.metadata } : {})
    };
    this.#logger.info(
      { from, to: req.to, reason: req.reason, metadata: req.metadata },
      'connection state transition'
    );
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (err) {
        this.#logger.warn(
          { err, from, to: req.to },
          'state transition listener threw — continuing'
        );
      }
    }
    return { kind: 'accepted', event };
  }
}
