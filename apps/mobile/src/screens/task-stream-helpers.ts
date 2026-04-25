import type {
  TaskError,
  TaskOutputDelta,
  TaskStatus,
  TaskStreamEvent
} from '@operator-os/contracts';
import { safeParseTaskStreamEvent } from '@operator-os/contracts';

/**
 * Pure-logic helpers for TaskStreamScreen, extracted into a
 * non-tsx module so the test file can import them without
 * pulling react-native (whose Flow-syntax index.js confuses
 * vitest's rolldown parser).
 *
 * Same Phase 1.5 / Phase 3.3 c12 pattern: target the extracted
 * handler, not the rendered tree.
 *
 * Phase 3.3 c17: parsing is delegated to the shared Zod schema
 * `taskStreamEventSchema` from @operator-os/contracts so the
 * client-server agreement is enforced by a single source of
 * truth. Heartbeat frames pass through the validator but are
 * filtered before reaching the store (the screen renders them
 * as connection-state heartbeats only).
 */

/**
 * Non-heartbeat parsed events. Heartbeat is dropped at the
 * helper boundary because the store only cares about deltas +
 * terminal events. The screen-level connection state subscribes
 * separately to liveness via SSE comment frames.
 */
export type ParsedStreamEvent = Exclude<
  TaskStreamEvent,
  { kind: 'heartbeat' }
>;

/**
 * Parse a single SSE message's `data` payload into a
 * ParsedStreamEvent. Returns `undefined` when:
 *
 *   - the payload is not valid JSON
 *   - the `kind` field is missing or unrecognized (e.g. heartbeat
 *     comments that the SSE library has already filtered before
 *     onmessage; this is a defence-in-depth check)
 *
 * No throw: the screen never wants a malformed frame to crash the
 * render loop, especially since reconnect can replay tail-end
 * deltas and skipping one is harmless given seq-idempotent state.
 */
export const parseStreamEvent = (
  raw: string
): ParsedStreamEvent | undefined => {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const event = safeParseTaskStreamEvent(json);
  if (event === undefined) return undefined;
  // Drop heartbeats — they're observed at the connection layer
  // (SSE comment frames), not the store layer.
  if (event.kind === 'heartbeat') return undefined;
  return event;
};

/**
 * Surface of the task-store the screen drives. Narrowed so tests
 * can hand over a plain object — same idiom as
 * `AuthenticatedFetchAuthStore`.
 */
export interface TaskStreamStoreSurface {
  appendDelta(taskId: string, delta: TaskOutputDelta): void;
  setStatus(taskId: string, status: TaskStatus, seq?: number): void;
  completeTask(taskId: string, output: string, seq: number): void;
  failTask(taskId: string, error: TaskError, seq: number): void;
}

/**
 * Apply a parsed stream event to the task store. Pure-side-effect
 * function; returns `true` if this event ends the stream
 * (completed/failed) so the screen can transition into the
 * terminal-only render path.
 */
export const applyStreamEvent = (
  taskId: string,
  event: ParsedStreamEvent,
  store: TaskStreamStoreSurface
): boolean => {
  switch (event.kind) {
    case 'delta':
      store.appendDelta(taskId, event.delta);
      return false;
    case 'status':
      store.setStatus(taskId, event.status, event.seq);
      return false;
    case 'completed':
      store.completeTask(taskId, event.output, event.seq);
      return true;
    case 'failed':
      store.failTask(taskId, event.error, event.seq);
      return true;
  }
};

/**
 * Return value of `processStreamMessage`. Tells the caller
 * whether the connection should now close (terminal frame seen).
 */
export interface StreamMessageOutcome {
  /** `true` once a terminal frame (completed/failed) has landed. */
  readonly terminal: boolean;
  /** The parsed event, or undefined if the payload was malformed. */
  readonly event: ParsedStreamEvent | undefined;
}

/**
 * Convenience aggregation of `parseStreamEvent` + `applyStreamEvent`.
 * One thing the test verifies: if `data` is malformed, no store
 * call is made and the connection is NOT marked terminal.
 */
export const processStreamMessage = (
  taskId: string,
  data: string,
  store: TaskStreamStoreSurface
): StreamMessageOutcome => {
  const event = parseStreamEvent(data);
  if (event === undefined) return { terminal: false, event: undefined };
  const terminal = applyStreamEvent(taskId, event, store);
  return { terminal, event };
};
