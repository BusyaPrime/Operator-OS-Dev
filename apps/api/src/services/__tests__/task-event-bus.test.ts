import { describe, expect, it, vi } from 'vitest';

import {
  createTaskEventBus,
  type TaskStreamEvent
} from '../task-event-bus.js';

const TASK_A = '11111111-1111-4111-8111-111111111111';
const TASK_B = '22222222-2222-4222-8222-222222222222';

const heartbeatEvent: TaskStreamEvent = {
  kind: 'heartbeat',
  timestamp: '2026-04-25T08:00:00.000Z'
};

const deltaEvent: TaskStreamEvent = {
  kind: 'delta',
  delta: {
    seq: 1,
    delta: 'hello',
    timestamp: '2026-04-25T08:00:01.000Z'
  }
};

describe('createTaskEventBus', () => {
  it('publishes events to every active subscriber for a task', () => {
    const bus = createTaskEventBus();
    const subA = vi.fn();
    const subB = vi.fn();

    bus.subscribe(TASK_A, subA);
    bus.subscribe(TASK_A, subB);

    bus.publish(TASK_A, heartbeatEvent);

    expect(subA).toHaveBeenCalledExactlyOnceWith(heartbeatEvent);
    expect(subB).toHaveBeenCalledExactlyOnceWith(heartbeatEvent);
  });

  it('isolates subscribers across different taskIds', () => {
    const bus = createTaskEventBus();
    const subA = vi.fn();
    const subB = vi.fn();

    bus.subscribe(TASK_A, subA);
    bus.subscribe(TASK_B, subB);

    bus.publish(TASK_A, deltaEvent);

    expect(subA).toHaveBeenCalledOnce();
    expect(subB).not.toHaveBeenCalled();
  });

  it('publish to a taskId with no subscribers is a silent no-op', () => {
    const bus = createTaskEventBus();
    expect(() => bus.publish(TASK_A, heartbeatEvent)).not.toThrow();
    expect(bus.taskCount()).toBe(0);
  });

  it('unsubscribe closure removes the subscriber and cleans up the empty Set', () => {
    const bus = createTaskEventBus();
    const sub = vi.fn();
    const unsubscribe = bus.subscribe(TASK_A, sub);

    expect(bus.subscriberCount(TASK_A)).toBe(1);
    expect(bus.taskCount()).toBe(1);

    unsubscribe();

    expect(bus.subscriberCount(TASK_A)).toBe(0);
    expect(bus.taskCount()).toBe(0);

    bus.publish(TASK_A, heartbeatEvent);
    expect(sub).not.toHaveBeenCalled();

    // Idempotent — calling unsubscribe again must be safe.
    expect(() => unsubscribe()).not.toThrow();
  });

  it('subscriber errors are caught — one bad subscriber does not block peers', () => {
    const bus = createTaskEventBus();
    const throwing = vi.fn(() => {
      throw new Error('subscriber bug');
    });
    const peer = vi.fn();

    bus.subscribe(TASK_A, throwing);
    bus.subscribe(TASK_A, peer);

    expect(() => bus.publish(TASK_A, heartbeatEvent)).not.toThrow();

    expect(throwing).toHaveBeenCalledOnce();
    expect(peer).toHaveBeenCalledOnce();
  });

  it('closeTask drops all subscribers for that task and leaves siblings intact', () => {
    const bus = createTaskEventBus();
    const subA = vi.fn();
    const subB = vi.fn();

    bus.subscribe(TASK_A, subA);
    bus.subscribe(TASK_B, subB);

    bus.closeTask(TASK_A);

    expect(bus.subscriberCount(TASK_A)).toBe(0);
    expect(bus.subscriberCount(TASK_B)).toBe(1);

    bus.publish(TASK_A, heartbeatEvent);
    bus.publish(TASK_B, heartbeatEvent);

    expect(subA).not.toHaveBeenCalled();
    expect(subB).toHaveBeenCalledOnce();
  });

  it('a subscriber that unsubscribes itself mid-publish does not break peers', () => {
    // Defends the snapshot pattern in publish — Sets being mutated
    // during for-of iteration are implementation-defined.
    const bus = createTaskEventBus();
    let unsubscribeSelf: (() => void) | undefined;
    const selfUnsub = vi.fn(() => {
      unsubscribeSelf?.();
    });
    const peer = vi.fn();

    unsubscribeSelf = bus.subscribe(TASK_A, selfUnsub);
    bus.subscribe(TASK_A, peer);

    bus.publish(TASK_A, heartbeatEvent);

    expect(selfUnsub).toHaveBeenCalledOnce();
    expect(peer).toHaveBeenCalledOnce();
    expect(bus.subscriberCount(TASK_A)).toBe(1);
  });
});
