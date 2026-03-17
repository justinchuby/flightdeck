/**
 * CoverageTracker — records test coverage snapshots over time and alerts on regressions.
 *
 * Each call to `record()` appends a snapshot (bounded to `maxSnapshots` by evicting
 * the oldest) and immediately computes whether the number of passing tests regressed
 * compared to the previous snapshot.
 */

// ── Types ─────────────────────────────────────────────────────────────

interface CoverageSnapshot {
  timestamp: number;
  totalTests: number;
  totalFiles: number;
  passed: number;
  failed: number;
  duration: number; // ms
  commitRef?: string;
}

export interface RecordResult {
  regression: boolean;
  /** Difference in passed tests vs. the previous snapshot (negative = regression). */
  delta: number;
}

// ── CoverageTracker ───────────────────────────────────────────────────

export class CoverageTracker {
  private snapshots: CoverageSnapshot[] = [];
  private maxSnapshots: number;

  constructor(maxSnapshots = 100) {
    this.maxSnapshots = maxSnapshots;
  }

  /**
   * Record a new snapshot and check for regression.
   *
   * Returns `{ regression: true, delta }` when `passed` is lower than the
   * previous snapshot, otherwise `{ regression: false, delta }`.
   */
  record(snapshot: CoverageSnapshot): RecordResult {
    this.snapshots.push(snapshot);

    // Evict oldest if the ring-buffer is over capacity.
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    if (this.snapshots.length >= 2) {
      const prev = this.snapshots[this.snapshots.length - 2];
      const delta = snapshot.passed - prev.passed;
      return { regression: delta < 0, delta };
    }

    // First snapshot — no prior data to compare against.
    return { regression: false, delta: 0 };
  }

  /** Return a defensive copy of all stored snapshots, oldest first. */
  getHistory(): CoverageSnapshot[] {
    return [...this.snapshots];
  }

  /** Return the most recently recorded snapshot, or `undefined` if none. */
  getLatest(): CoverageSnapshot | undefined {
    return this.snapshots[this.snapshots.length - 1];
  }

  /**
   * Return the time-series of `passed` counts and `duration` values for
   * the most recent `count` snapshots (default 10).
   */
  getTrend(count = 10): { tests: number[]; durations: number[] } {
    const recent = this.snapshots.slice(-count);
    return {
      tests: recent.map((s) => s.passed),
      durations: recent.map((s) => s.duration),
    };
  }

  /** Number of snapshots currently held. */
  size(): number {
    return this.snapshots.length;
  }

  /** Discard all stored snapshots. */
  clear(): void {
    this.snapshots = [];
  }
}
