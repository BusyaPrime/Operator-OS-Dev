import { describe, expect, it } from 'vitest';

import { ReconnectBackoff } from '../reconnect-backoff.js';

describe('ReconnectBackoff — deterministic (jitter=0)', () => {
  it('produces the canonical exponential sequence capped at maxMs', () => {
    const b = new ReconnectBackoff({
      baseMs: 1000,
      maxMs: 60_000,
      jitter: 0,
      maxAttempts: 10
    });
    const seq: Array<number | null> = [];
    for (let i = 0; i < 10; i += 1) seq.push(b.nextDelayMs());
    expect(seq).toEqual([
      1000,   // 1 * 1s
      2000,   // 2
      4000,   // 4
      8000,   // 8
      16_000, // 16
      32_000, // 32
      60_000, // capped (would be 64)
      60_000,
      60_000,
      60_000
    ]);
  });

  it('returns null after maxAttempts is reached', () => {
    const b = new ReconnectBackoff({
      baseMs: 1,
      maxMs: 1,
      jitter: 0,
      maxAttempts: 3
    });
    expect(b.nextDelayMs()).not.toBeNull();
    expect(b.nextDelayMs()).not.toBeNull();
    expect(b.nextDelayMs()).not.toBeNull();
    expect(b.nextDelayMs()).toBeNull();
  });

  it('reset() rewinds the attempt counter', () => {
    const b = new ReconnectBackoff({
      baseMs: 1000,
      maxMs: 60_000,
      jitter: 0,
      maxAttempts: 100
    });
    b.nextDelayMs();
    b.nextDelayMs();
    b.nextDelayMs();
    expect(b.attempts).toBe(3);
    b.reset();
    expect(b.attempts).toBe(0);
    expect(b.nextDelayMs()).toBe(1000); // base again
  });
});

describe('ReconnectBackoff — jitter', () => {
  it('clamps the jittered value to [baseMs, maxMs]', () => {
    // Inject a Math.random that returns 0 (full negative
    // jitter) and then 1 (full positive jitter).
    let i = 0;
    const random = () => (i++ % 2 === 0 ? 0 : 1);
    const b = new ReconnectBackoff({
      baseMs: 1000,
      maxMs: 60_000,
      jitter: 0.5,
      maxAttempts: 100,
      random
    });
    // Attempt 1: exponent = 1000, range = 500.
    //   random=0 → full negative → 1000 + (-1)*500 = 500.
    //   But min-clamp pushes it back to baseMs=1000.
    expect(b.nextDelayMs()).toBe(1000);

    // Attempt 2: exponent = 2000, range = 1000.
    //   random=1 → full positive → 2000 + (+1)*1000 = 3000.
    //   Within [base,max] → 3000.
    expect(b.nextDelayMs()).toBe(3000);
  });

  it('jittered value sits within ±jitter * exponent (1000 trials)', () => {
    // Stochastic check using Math.random — verify that
    // 1000 attempt-1 samples all land in the documented
    // window.
    const baseMs = 1000;
    const jitter = 0.2; // ±20%
    const samples: number[] = [];
    for (let i = 0; i < 1000; i += 1) {
      const b = new ReconnectBackoff({
        baseMs,
        maxMs: 60_000,
        jitter,
        maxAttempts: 100
      });
      const d = b.nextDelayMs();
      if (d !== null) samples.push(d);
    }
    // Attempt 1 exponent = 1000. ±20% range = 800..1200.
    // BUT min-clamp at baseMs=1000 means actual range
    // collapses to 1000..1200.
    expect(samples.every((s) => s >= 1000)).toBe(true);
    expect(samples.every((s) => s <= 1200)).toBe(true);
    // Some variance is observable (not all equal).
    const unique = new Set(samples);
    expect(unique.size).toBeGreaterThan(10);
  });
});

describe('ReconnectBackoff — invalid options', () => {
  it('throws when baseMs <= 0', () => {
    expect(() => new ReconnectBackoff({ baseMs: 0 })).toThrow();
    expect(() => new ReconnectBackoff({ baseMs: -100 })).toThrow();
  });

  it('throws when maxMs < baseMs', () => {
    expect(() => new ReconnectBackoff({ baseMs: 5_000, maxMs: 1000 })).toThrow();
  });

  it('throws when jitter is out of [0, 1]', () => {
    expect(() => new ReconnectBackoff({ jitter: -0.1 })).toThrow();
    expect(() => new ReconnectBackoff({ jitter: 1.1 })).toThrow();
  });

  it('throws when maxAttempts is non-positive', () => {
    expect(() => new ReconnectBackoff({ maxAttempts: 0 })).toThrow();
    expect(() => new ReconnectBackoff({ maxAttempts: -5 })).toThrow();
  });
});
