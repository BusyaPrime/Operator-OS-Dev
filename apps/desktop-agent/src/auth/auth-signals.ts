/**
 * Phase 4.0 Part 4.C-F — shared event surface for agent-side
 * auth lifecycle.
 *
 * The REST client (Part 4.D), the WS connection (Part 4.E),
 * the rotator (Part 4.C), and the fatal-exit handler
 * (Part 4.F) need to coordinate without forming a circular
 * import graph. Each component receives a `TokenAuthSignals`
 * value at construction; they call the relevant method when
 * they observe an event, and a different component handles
 * it on the other side. The wiring lives in `main.ts`.
 *
 * Why callbacks rather than EventEmitter:
 *
 *   - Direct callbacks make the dependency graph explicit:
 *     reading a route handler tells you exactly which
 *     handler runs.
 *   - Single subscriber per signal — no fan-out semantics
 *     to reason about during tests.
 *   - Trivially mockable: tests pass `{ onRotationHinted: vi.fn(),
 *     onUnauthorized: vi.fn() }` to every component under test.
 */

/**
 * Context attached to a 401 observation. `source` says where
 * the 401 came from (rest / ws / rotate); `agentId` may be
 * unknown if the auth never succeeded; `url` and `method`
 * help the fatal-handler emit a single, actionable line in
 * the structured log.
 */
export interface UnauthorizedContext {
  readonly source: 'rest' | 'ws' | 'rotate' | 'register';
  readonly agentId?: string;
  readonly url?: string;
  readonly method?: string;
  /** Human-readable reason hint, e.g. 'agent_revoked'. */
  readonly reason?: string;
}

export interface TokenAuthSignals {
  /**
   * Fired whenever a server response carries
   * `X-Token-Rotation-Recommended: true`. The default impl
   * lives in `TokenRotator.triggerRotation()`. Idempotent —
   * the rotator debounces concurrent triggers.
   */
  readonly onRotationHinted: () => void;

  /**
   * Fired when an agent-token auth attempt receives a 401.
   * The fatal-handler logs structured context and exits the
   * process with code 87 (AGENT_TOKEN_REVOKED). Calling this
   * is terminal: the process should not be expected to
   * survive past the next event-loop tick.
   */
  readonly onUnauthorized: (context: UnauthorizedContext) => void;
}

/**
 * No-op implementation. Tests use this when they only care
 * about ONE of the two signals.
 */
export const noopAuthSignals: TokenAuthSignals = {
  onRotationHinted: () => {
    /* noop */
  },
  onUnauthorized: () => {
    /* noop */
  }
};
