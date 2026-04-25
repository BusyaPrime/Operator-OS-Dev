import type {
  TaskError,
  TaskOutputDelta,
  TaskStatus
} from '@operator-os/contracts';

/**
 * Pure-logic helpers for TaskStreamScreen, extracted into a
 * non-tsx module so the test file can import them without
 * pulling react-native (whose Flow-syntax index.js confuses
 * vitest's rolldown parser).
 *
 * Same Phase 1.5 / Phase 3.3 c12 pattern: target the extracted
 * handler, not the rendered tree.
 */

/**
 * Discriminated union mirroring `TaskStreamEvent` from
 * `apps/api/src/services/task-event-bus.ts`. We don't import the
 * server-side type to keep the mobile build dependency-free of
 * the api package; the wire format is the source of truth and is
 * covered by the server-side type tests.
 */
export type ParsedStreamEvent =
  | { readonly kind: 'delta'; readonly delta: TaskOutputDelta }
  | {
      readonly kind: 'status';
      readonly status: TaskStatus;
      readonly seq: number;
    }
  | {
      readonly kind: 'completed';
      readonly output: string;
      readonly seq: number;
    }
  | {
      readonly kind: 'failed';
      readonly error: TaskError;
      readonly seq: number;
    };

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
  if (typeof json !== 'object' || json === null) return undefined;
  const obj = json as { kind?: unknown };
  switch (obj.kind) {
    case 'delta': {
      const d = obj as { delta?: unknown };
      if (
        typeof d.delta !== 'object' ||
        d.delta === null ||
        typeof (d.delta as { seq?: unknown }).seq !== 'number'
      ) {
        return undefined;
      }
      return { kind: 'delta', delta: d.delta as TaskOutputDelta };
    }
    case 'status': {
      const s = obj as { status?: unknown; seq?: unknown };
      if (typeof s.status !== 'string' || typeof s.seq !== 'number') {
        return undefined;
      }
      return {
        kind: 'status',
        status: s.status as TaskStatus,
        seq: s.seq
      };
    }
    case 'completed': {
      const c = obj as { output?: unknown; seq?: unknown };
      if (typeof c.output !== 'string' || typeof c.seq !== 'number') {
        return undefined;
      }
      return { kind: 'completed', output: c.output, seq: c.seq };
    }
    case 'failed': {
      const f = obj as { error?: unknown; seq?: unknown };
      if (
        typeof f.error !== 'object' ||
        f.error === null ||
        typeof f.seq !== 'number'
      ) {
        return undefined;
      }
      return {
        kind: 'failed',
        error: f.error as TaskError,
        seq: f.seq
      };
    }
    default:
      return undefined;
  }
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
