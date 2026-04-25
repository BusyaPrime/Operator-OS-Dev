import { describe, expect, it, vi } from 'vitest';

import {
  applyStreamEvent,
  parseStreamEvent,
  processStreamMessage,
  type TaskStreamStoreSurface
} from '../task-stream-helpers.js';

const TASK_ID = '12345678-1234-4234-8234-123456789012';

const buildStore = (): TaskStreamStoreSurface => ({
  appendDelta: vi.fn(),
  setStatus: vi.fn(),
  completeTask: vi.fn(),
  failTask: vi.fn()
});

describe('parseStreamEvent', () => {
  it('parses a delta frame', () => {
    const out = parseStreamEvent(
      JSON.stringify({
        kind: 'delta',
        delta: { seq: 3, delta: 'hello', timestamp: '2026-04-25T14:00:00Z' }
      })
    );
    expect(out).toEqual({
      kind: 'delta',
      delta: { seq: 3, delta: 'hello', timestamp: '2026-04-25T14:00:00Z' }
    });
  });

  it('parses a status frame', () => {
    const out = parseStreamEvent(
      JSON.stringify({ kind: 'status', status: 'executing', seq: 5 })
    );
    expect(out).toEqual({ kind: 'status', status: 'executing', seq: 5 });
  });

  it('parses a completed frame', () => {
    const out = parseStreamEvent(
      JSON.stringify({ kind: 'completed', output: 'final', seq: 9 })
    );
    expect(out).toEqual({ kind: 'completed', output: 'final', seq: 9 });
  });

  it('parses a failed frame', () => {
    const out = parseStreamEvent(
      JSON.stringify({
        kind: 'failed',
        error: { code: 'rate_limit', message: 'too many' },
        seq: 9
      })
    );
    expect(out).toEqual({
      kind: 'failed',
      error: { code: 'rate_limit', message: 'too many' },
      seq: 9
    });
  });

  it('returns undefined for malformed JSON', () => {
    expect(parseStreamEvent('not json')).toBeUndefined();
  });

  it('returns undefined for unknown kinds', () => {
    expect(parseStreamEvent(JSON.stringify({ kind: 'mystery' }))).toBeUndefined();
  });

  it('returns undefined for delta missing seq', () => {
    expect(
      parseStreamEvent(JSON.stringify({ kind: 'delta', delta: { delta: 'x' } }))
    ).toBeUndefined();
  });
});

describe('applyStreamEvent', () => {
  it('routes delta -> appendDelta and is non-terminal', () => {
    const store = buildStore();
    const terminal = applyStreamEvent(
      TASK_ID,
      {
        kind: 'delta',
        delta: { seq: 1, delta: 'a', timestamp: '2026-04-25T14:00:00Z' }
      },
      store
    );
    expect(terminal).toBe(false);
    expect(store.appendDelta).toHaveBeenCalledExactlyOnceWith(TASK_ID, {
      seq: 1,
      delta: 'a',
      timestamp: '2026-04-25T14:00:00Z'
    });
    expect(store.setStatus).not.toHaveBeenCalled();
    expect(store.completeTask).not.toHaveBeenCalled();
    expect(store.failTask).not.toHaveBeenCalled();
  });

  it('routes status -> setStatus and is non-terminal', () => {
    const store = buildStore();
    const terminal = applyStreamEvent(
      TASK_ID,
      { kind: 'status', status: 'executing', seq: 2 },
      store
    );
    expect(terminal).toBe(false);
    expect(store.setStatus).toHaveBeenCalledExactlyOnceWith(
      TASK_ID,
      'executing',
      2
    );
  });

  it('routes completed -> completeTask and is terminal', () => {
    const store = buildStore();
    const terminal = applyStreamEvent(
      TASK_ID,
      { kind: 'completed', output: 'done', seq: 7 },
      store
    );
    expect(terminal).toBe(true);
    expect(store.completeTask).toHaveBeenCalledExactlyOnceWith(
      TASK_ID,
      'done',
      7
    );
  });

  it('routes failed -> failTask and is terminal', () => {
    const store = buildStore();
    const terminal = applyStreamEvent(
      TASK_ID,
      {
        kind: 'failed',
        error: { code: 'boom', message: 'kaboom' },
        seq: 8
      },
      store
    );
    expect(terminal).toBe(true);
    expect(store.failTask).toHaveBeenCalledExactlyOnceWith(
      TASK_ID,
      { code: 'boom', message: 'kaboom' },
      8
    );
  });
});

describe('processStreamMessage', () => {
  it('parses + applies + signals terminal on a completed frame', () => {
    const store = buildStore();
    const out = processStreamMessage(
      TASK_ID,
      JSON.stringify({ kind: 'completed', output: 'final', seq: 9 }),
      store
    );
    expect(out.terminal).toBe(true);
    expect(out.event?.kind).toBe('completed');
    expect(store.completeTask).toHaveBeenCalledOnce();
  });

  it('does NOT touch the store and is non-terminal on malformed data', () => {
    const store = buildStore();
    const out = processStreamMessage(TASK_ID, '{not-json', store);
    expect(out.terminal).toBe(false);
    expect(out.event).toBeUndefined();
    expect(store.appendDelta).not.toHaveBeenCalled();
    expect(store.setStatus).not.toHaveBeenCalled();
    expect(store.completeTask).not.toHaveBeenCalled();
    expect(store.failTask).not.toHaveBeenCalled();
  });

  it('feeds a sequence of delta frames to appendDelta in order (idempotency check is the store-side responsibility)', () => {
    const store = buildStore();
    const seqs = [1, 2, 3];
    for (const seq of seqs) {
      processStreamMessage(
        TASK_ID,
        JSON.stringify({
          kind: 'delta',
          delta: { seq, delta: String(seq), timestamp: '2026-04-25T14:00:00Z' }
        }),
        store
      );
    }
    expect(store.appendDelta).toHaveBeenCalledTimes(3);
    const calls = (store.appendDelta as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]?.[1]).toMatchObject({ seq: 1 });
    expect(calls[1]?.[1]).toMatchObject({ seq: 2 });
    expect(calls[2]?.[1]).toMatchObject({ seq: 3 });
  });
});
