import type {
  TaskError,
  TaskOutputDelta,
  TaskStatus
} from '@operator-os/contracts';

/**
 * Frame the SSE handler emits to the client. Discriminated by `kind`:
 *
 * - `delta`     — a streaming output fragment (text token or chunk).
 *                 Carries the full TaskOutputDelta so the client can
 *                 render seq + timestamp without re-deriving them.
 * - `status`    — terminal-aware status transition observed on the
 *                 task (queued → assigned → executing → streaming).
 * - `completed` — terminal success. `output` is the full assembled
 *                 response. `seq` is the highest delta seq the
 *                 server emitted, so reconnecting clients can ask
 *                 for `Last-Event-ID > seq` and skip the replay.
 * - `failed`    — terminal failure. `error` mirrors TaskError.
 * - `heartbeat` — keep-alive comment frame (Cloud Run 60-min). Client
 *                 libraries discard these naturally; we still emit
 *                 them as `kind:'heartbeat'` so internal subscribers
 *                 can observe liveness too.
 *
 * `seq` is monotonically increasing within a task. `delta` events
 * carry their own seq via the embedded TaskOutputDelta; `completed`
 * and `failed` carry an explicit `seq` so the SSE handler can tag
 * the terminal SSE frame with `id: <seq>` per the spec.
 */
export type TaskStreamEvent =
  | { readonly kind: 'delta'; readonly delta: TaskOutputDelta }
  | { readonly kind: 'status'; readonly status: TaskStatus; readonly seq: number }
  | {
      readonly kind: 'completed';
      readonly output: string;
      readonly seq: number;
    }
  | { readonly kind: 'failed'; readonly error: TaskError; readonly seq: number }
  | { readonly kind: 'heartbeat'; readonly timestamp: string };

export type TaskStreamSubscriber = (event: TaskStreamEvent) => void;

export interface TaskEventBus {
  /**
   * Register a subscriber for a task. Returns an unsubscribe function
   * that the caller MUST invoke on connection close to prevent leaks.
   */
  subscribe(taskId: string, subscriber: TaskStreamSubscriber): () => void;

  /**
   * Publish an event to every active subscriber for `taskId`. Errors
   * thrown by individual subscribers are caught and swallowed — one
   * misbehaving subscriber must not affect the bus or its peers.
   */
  publish(taskId: string, event: TaskStreamEvent): void;

  /**
   * Drop all subscribers for `taskId`. Called by the dispatch path
   * after publishing a terminal `completed` / `failed` event so
   * future late-arriving frames cannot reach a closed stream.
   */
  closeTask(taskId: string): void;

  /** Test introspection. */
  subscriberCount(taskId: string): number;
  taskCount(): number;
}

/**
 * In-memory pub/sub keyed by taskId. Single-Fastify-instance scope
 * by design (TD-041 tracks the multi-instance migration to Redis or
 * equivalent). Pairs with the Phase 3.2 `AgentSessionRegistry` and
 * `TaskRouter` round-robin cursors which share the same posture.
 *
 * The bus does NOT persist events. SSE handler is responsible for
 * replaying historical deltas from Firestore on a `Last-Event-ID`
 * reconnect; the bus only carries live events going forward from
 * the moment of subscription.
 */
export const createTaskEventBus = (): TaskEventBus => {
  const taskSubscribers = new Map<string, Set<TaskStreamSubscriber>>();

  return {
    subscribe(taskId, subscriber) {
      let subscribers = taskSubscribers.get(taskId);
      if (subscribers === undefined) {
        subscribers = new Set();
        taskSubscribers.set(taskId, subscribers);
      }
      subscribers.add(subscriber);

      // The unsubscribe is closure-bound to the (taskId, subscriber)
      // pair captured here; calling it twice is a no-op (Set.delete
      // returns false, no throw).
      return () => {
        const current = taskSubscribers.get(taskId);
        if (current === undefined) return;
        current.delete(subscriber);
        if (current.size === 0) {
          taskSubscribers.delete(taskId);
        }
      };
    },

    publish(taskId, event) {
      const subscribers = taskSubscribers.get(taskId);
      if (subscribers === undefined) return;
      // Snapshot first — a subscriber might unsubscribe mid-iteration
      // (e.g. on a terminal event), and mutating a Set during for-of
      // iteration is implementation-defined.
      const snapshot = [...subscribers];
      for (const subscriber of snapshot) {
        try {
          subscriber(event);
        } catch {
          // Stop rule: one bad subscriber must not collapse the bus.
          // The SSE handler logs upstream; we swallow here.
        }
      }
    },

    closeTask(taskId) {
      taskSubscribers.delete(taskId);
    },

    subscriberCount(taskId) {
      return taskSubscribers.get(taskId)?.size ?? 0;
    },

    taskCount() {
      return taskSubscribers.size;
    }
  };
};
