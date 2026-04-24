/**
 * In-memory tracker for tasks the agent has accepted but not yet
 * completed. Phase 3.2 scope: observability + cancellation hook only;
 * Phase 3.3 will hang real task cancellation off register/unregister.
 */

export interface InFlightTask {
  readonly taskId: string;
  readonly startedAt: string;
  readonly promise: Promise<unknown>;
}

export interface TaskQueue {
  register(taskId: string, promise: Promise<unknown>): void;
  unregister(taskId: string): void;
  has(taskId: string): boolean;
  size(): number;
  list(): readonly InFlightTask[];
}

export const createTaskQueue = (
  now: () => string = () => new Date().toISOString()
): TaskQueue => {
  const tasks = new Map<string, InFlightTask>();

  return {
    register(taskId, promise) {
      tasks.set(taskId, {
        taskId,
        startedAt: now(),
        promise
      });
      // Auto-unregister on settle so the queue does not leak.
      promise.finally(() => {
        const current = tasks.get(taskId);
        if (current?.promise === promise) {
          tasks.delete(taskId);
        }
      });
    },
    unregister(taskId) {
      tasks.delete(taskId);
    },
    has(taskId) {
      return tasks.has(taskId);
    },
    size() {
      return tasks.size;
    },
    list() {
      return [...tasks.values()];
    }
  };
};
