import { describe, expect, it } from 'vitest';

import { RttHistogram } from '../rtt-histogram.js';

describe('RttHistogram — empty', () => {
  it('returns null percentiles when no samples have been recorded', () => {
    const h = new RttHistogram();
    const p = h.percentiles();
    expect(p).toEqual({
      count: 0,
      p50: null,
      p95: null,
      p99: null,
      mean: null,
      mostRecent: null
    });
  });
});

describe('RttHistogram — single sample', () => {
  it('reports the single value across every percentile', () => {
    const h = new RttHistogram();
    h.record(42);
    expect(h.percentiles()).toEqual({
      count: 1,
      p50: 42,
      p95: 42,
      p99: 42,
      mean: 42,
      mostRecent: 42
    });
  });
});

describe('RttHistogram — windowing', () => {
  it('discards the oldest sample when the window fills', () => {
    const h = new RttHistogram({ windowSize: 3 });
    h.record(10);
    h.record(20);
    h.record(30);
    h.record(40); // 10 falls off
    expect(h.sampleCount).toBe(3);
    const p = h.percentiles();
    expect(p.count).toBe(3);
    expect(p.mostRecent).toBe(40);
    // Sorted [20, 30, 40]; p50 ≈ 30, p95 ≈ 39 (linear interp).
    expect(p.p50).toBe(30);
  });

  it('rejects bogus samples without affecting the window', () => {
    const h = new RttHistogram({ windowSize: 5 });
    h.record(10);
    h.record(NaN);
    h.record(-5);
    h.record(Infinity);
    h.record(-Infinity);
    h.record(20);
    expect(h.sampleCount).toBe(2);
    const p = h.percentiles();
    expect(p.count).toBe(2);
    expect(p.mean).toBe(15);
  });

  it('rejects a non-positive windowSize', () => {
    expect(() => new RttHistogram({ windowSize: 0 })).toThrow();
    expect(() => new RttHistogram({ windowSize: -1 })).toThrow();
    expect(() => new RttHistogram({ windowSize: 1.5 })).toThrow();
  });
});

describe('RttHistogram — percentile correctness', () => {
  it('computes p50 / p95 / p99 from a known distribution', () => {
    // Samples 1..100; p50 = 50.5, p95 ≈ 95.05, p99 ≈ 99.01
    // (linear-interpolation numpy-style).
    const h = new RttHistogram({ windowSize: 100 });
    for (let i = 1; i <= 100; i += 1) h.record(i);
    const p = h.percentiles();
    expect(p.count).toBe(100);
    expect(p.p50).toBeCloseTo(50.5, 2);
    expect(p.p95).toBeCloseTo(95.05, 2);
    expect(p.p99).toBeCloseTo(99.01, 2);
    expect(p.mean).toBeCloseTo(50.5, 2);
    expect(p.mostRecent).toBe(100);
  });

  it('handles a long tail correctly (one outlier)', () => {
    const h = new RttHistogram({ windowSize: 100 });
    for (let i = 0; i < 99; i += 1) h.record(10);
    h.record(1000);
    const p = h.percentiles();
    expect(p.p50).toBe(10);
    expect(p.p99).toBeGreaterThan(10);
  });
});

describe('RttHistogram — clear', () => {
  it('drops every sample and reverts to the empty-percentile shape', () => {
    const h = new RttHistogram();
    h.record(50);
    h.record(75);
    h.clear();
    expect(h.sampleCount).toBe(0);
    expect(h.percentiles().count).toBe(0);
  });
});
