import { describe, it, expect, beforeEach } from 'vitest';
import { CoverageTracker } from '../coordination/code-quality/CoverageTracker.js';

// ── Helpers ───────────────────────────────────────────────────────────

function makeSnapshot(passed: number, overrides: Partial<{ timestamp: number; totalTests: number; totalFiles: number; passed: number; failed: number; duration: number; commitRef: string }> = {}) {
  return {
    timestamp: Date.now(),
    totalTests: passed + (overrides.failed ?? 0),
    totalFiles: 10,
    passed,
    failed: 0,
    duration: 1000,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('CoverageTracker', () => {
  let tracker: CoverageTracker;

  beforeEach(() => {
    tracker = new CoverageTracker();
  });

  // ── record ────────────────────────────────────────────────────────

  it('returns regression=false and delta=0 for the very first snapshot', () => {
    const result = tracker.record(makeSnapshot(50));
    expect(result.regression).toBe(false);
    expect(result.delta).toBe(0);
  });

  it('returns regression=false when passed count increases', () => {
    tracker.record(makeSnapshot(50));
    const result = tracker.record(makeSnapshot(60));
    expect(result.regression).toBe(false);
    expect(result.delta).toBe(10);
  });

  it('returns regression=false when passed count stays the same', () => {
    tracker.record(makeSnapshot(50));
    const result = tracker.record(makeSnapshot(50));
    expect(result.regression).toBe(false);
    expect(result.delta).toBe(0);
  });

  it('detects a regression when passed count decreases', () => {
    tracker.record(makeSnapshot(60));
    const result = tracker.record(makeSnapshot(55));
    expect(result.regression).toBe(true);
    expect(result.delta).toBe(-5);
  });

  // ── ring-buffer eviction ───────────────────────────────────────────

  it('evicts the oldest snapshot when maxSnapshots is exceeded', () => {
    const small = new CoverageTracker(3);
    small.record(makeSnapshot(10, { timestamp: 1 }));
    small.record(makeSnapshot(20, { timestamp: 2 }));
    small.record(makeSnapshot(30, { timestamp: 3 }));
    small.record(makeSnapshot(40, { timestamp: 4 })); // should evict timestamp=1

    const history = small.getHistory();
    expect(history).toHaveLength(3);
    expect(history[0].passed).toBe(20);
    expect(history[2].passed).toBe(40);
  });

  it('size() reflects the current snapshot count', () => {
    expect(tracker.size()).toBe(0);
    tracker.record(makeSnapshot(10));
    tracker.record(makeSnapshot(20));
    expect(tracker.size()).toBe(2);
  });

  // ── getHistory / getLatest ────────────────────────────────────────

  it('getHistory returns snapshots in insertion order', () => {
    tracker.record(makeSnapshot(10, { timestamp: 100 }));
    tracker.record(makeSnapshot(20, { timestamp: 200 }));
    tracker.record(makeSnapshot(30, { timestamp: 300 }));
    const h = tracker.getHistory();
    expect(h.map((s) => s.passed)).toEqual([10, 20, 30]);
  });

  it('getHistory returns a defensive copy', () => {
    tracker.record(makeSnapshot(10));
    const h = tracker.getHistory();
    h.pop();
    expect(tracker.size()).toBe(1); // original unaffected
  });

  it('getLatest returns undefined when empty', () => {
    expect(tracker.getLatest()).toBeUndefined();
  });

  it('getLatest returns the most recent snapshot', () => {
    tracker.record(makeSnapshot(10));
    tracker.record(makeSnapshot(99, { commitRef: 'abc123' }));
    expect(tracker.getLatest()?.passed).toBe(99);
    expect(tracker.getLatest()?.commitRef).toBe('abc123');
  });

  // ── getTrend ──────────────────────────────────────────────────────

  it('getTrend returns empty arrays when no snapshots exist', () => {
    const trend = tracker.getTrend();
    expect(trend.tests).toEqual([]);
    expect(trend.durations).toEqual([]);
  });

  it('getTrend returns up to `count` most recent values', () => {
    for (let i = 1; i <= 15; i++) {
      tracker.record(makeSnapshot(i * 10, { duration: i * 100 }));
    }
    const trend = tracker.getTrend(5);
    expect(trend.tests).toHaveLength(5);
    expect(trend.tests).toEqual([110, 120, 130, 140, 150]);
    expect(trend.durations).toEqual([1100, 1200, 1300, 1400, 1500]);
  });

  it('getTrend defaults to 10 most recent values', () => {
    for (let i = 0; i < 20; i++) {
      tracker.record(makeSnapshot(i));
    }
    expect(tracker.getTrend().tests).toHaveLength(10);
  });

  // ── clear ─────────────────────────────────────────────────────────

  it('clear() empties the tracker', () => {
    tracker.record(makeSnapshot(10));
    tracker.record(makeSnapshot(20));
    tracker.clear();
    expect(tracker.size()).toBe(0);
    expect(tracker.getLatest()).toBeUndefined();
  });
});
