/**
 * MassFailureDetector — detects when multiple agents fail in rapid succession
 * and triggers emergency response (spawn pausing).
 *
 * Standalone module extracted for independent testability and reuse by the
 * agent server. Uses a sliding window to count agent exits and triggers a
 * mass failure event when the threshold is reached.
 *
 * Usage:
 *   const detector = new MassFailureDetector({ threshold: 3, windowMs: 60_000 });
 *   detector.onMassFailure((data) => { ... });
 *   detector.recordExit({ agentId, exitCode, signal, error });
 */

// ── Mass Failure Event Data ─────────────────────────────────────────

export type MassFailureCause = 'auth_failure' | 'rate_limit' | 'model_unavailable' | 'resource_exhaustion' | 'unknown';

export interface MassFailureData {
  exitCount: number;
  windowSeconds: number;
  recentExits: Array<{
    agentId: string;
    exitCode: number | null;
    signal: string | null;
    error: string | null;
    timestamp: string;
  }>;
  pausedUntil: string;
  likelyCause: MassFailureCause;
}

// ── Types ───────────────────────────────────────────────────────────

/** A record of a single agent exit event. */
export interface ExitRecord {
  agentId: string;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  timestamp: number;
}

/** Configuration for the mass failure detector. */
export interface MassFailureConfig {
  /** Number of exits in the window to trigger mass failure (default: 3). */
  threshold?: number;
  /** Sliding window duration in milliseconds (default: 60_000). */
  windowMs?: number;
  /** Duration to pause spawning after mass failure in milliseconds (default: 120_000). */
  cooldownMs?: number;
}

/** Callback signature for mass failure events. */
export type MassFailureCallback = (data: MassFailureData) => void;

// ── Maximum exit history buffer size ────────────────────────────────

const MAX_EXIT_HISTORY = 50;

// ── Bounds for configuration values ─────────────────────────────────

const MIN_THRESHOLD = 1;
const MAX_THRESHOLD = 100;
const MIN_WINDOW_MS = 1_000;       // 1 second
const MAX_WINDOW_MS = 600_000;     // 10 minutes
const MIN_COOLDOWN_MS = 1_000;     // 1 second
const MAX_COOLDOWN_MS = 3_600_000; // 1 hour

function validateConfig(opts: MassFailureConfig): void {
  if (opts.threshold !== undefined) {
    if (!Number.isFinite(opts.threshold) || opts.threshold < MIN_THRESHOLD || opts.threshold > MAX_THRESHOLD) {
      throw new RangeError(`threshold must be between ${MIN_THRESHOLD} and ${MAX_THRESHOLD}, got ${opts.threshold}`);
    }
  }
  if (opts.windowMs !== undefined) {
    if (!Number.isFinite(opts.windowMs) || opts.windowMs < MIN_WINDOW_MS || opts.windowMs > MAX_WINDOW_MS) {
      throw new RangeError(`windowMs must be between ${MIN_WINDOW_MS} and ${MAX_WINDOW_MS}, got ${opts.windowMs}`);
    }
  }
  if (opts.cooldownMs !== undefined) {
    if (!Number.isFinite(opts.cooldownMs) || opts.cooldownMs < MIN_COOLDOWN_MS || opts.cooldownMs > MAX_COOLDOWN_MS) {
      throw new RangeError(`cooldownMs must be between ${MIN_COOLDOWN_MS} and ${MAX_COOLDOWN_MS}, got ${opts.cooldownMs}`);
    }
  }
}

// ── MassFailureDetector ─────────────────────────────────────────────

export class MassFailureDetector {
  private recentExits: ExitRecord[] = [];
  private paused = false;
  private pausedAt: number | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private callbacks: MassFailureCallback[] = [];

  private threshold: number;
  private windowMs: number;
  private cooldownMs: number;

  constructor(config: MassFailureConfig = {}) {
    validateConfig(config);
    this.threshold = config.threshold ?? 3;
    this.windowMs = config.windowMs ?? 60_000;
    this.cooldownMs = config.cooldownMs ?? 120_000;
  }

  /**
   * Record an agent exit event.
   * If the exit triggers mass failure detection, returns the MassFailureData
   * and invokes all registered callbacks. Returns null if no mass failure.
   */
  recordExit(record: ExitRecord): MassFailureData | null {
    this.recentExits.push(record);
    // Cap history to prevent unbounded growth
    if (this.recentExits.length > MAX_EXIT_HISTORY) {
      this.recentExits.shift();
    }

    // Don't re-trigger while already paused
    if (this.paused) return null;

    const now = record.timestamp;
    const windowStart = now - this.windowMs;
    const recentInWindow = this.recentExits.filter((r) => r.timestamp >= windowStart);

    if (recentInWindow.length >= this.threshold) {
      this.paused = true;
      this.pausedAt = now;
      const pausedUntil = new Date(now + this.cooldownMs).toISOString();

      this.resumeTimer = setTimeout(() => {
        this.paused = false;
        this.pausedAt = null;
        this.resumeTimer = null;
      }, this.cooldownMs);

      const data: MassFailureData = {
        exitCount: recentInWindow.length,
        windowSeconds: Math.round((now - recentInWindow[0].timestamp) / 1000),
        recentExits: recentInWindow.map((r) => ({
          agentId: r.agentId,
          exitCode: r.exitCode,
          signal: r.signal,
          error: r.error,
          timestamp: new Date(r.timestamp).toISOString(),
        })),
        pausedUntil,
        likelyCause: detectCause(recentInWindow),
      };

      // Notify all registered callbacks
      for (const cb of this.callbacks) {
        try {
          cb(data);
        } catch {
          // Don't let callback errors break the detector
        }
      }

      return data;
    }

    return null;
  }

  /** Whether spawning is currently paused due to a mass failure event. */
  get isPaused(): boolean {
    return this.paused;
  }

  /** Timestamp (ms) when the current pause started, or null if not paused. */
  get pauseStartedAt(): number | null {
    return this.pausedAt;
  }

  /** The number of exit records currently tracked. */
  get exitCount(): number {
    return this.recentExits.length;
  }

  /**
   * Register a callback for mass failure events.
   * Returns an unsubscribe function.
   */
  onMassFailure(callback: MassFailureCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      const idx = this.callbacks.indexOf(callback);
      if (idx >= 0) this.callbacks.splice(idx, 1);
    };
  }

  /** Manually resume spawning (clear the pause state). */
  resume(): void {
    this.paused = false;
    this.pausedAt = null;
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
  }

  /** Clear all exit history and reset pause state. */
  reset(): void {
    this.resume();
    this.recentExits = [];
  }

  /** Update configuration at runtime. */
  configure(opts: MassFailureConfig): void {
    validateConfig(opts);
    if (opts.threshold !== undefined) this.threshold = opts.threshold;
    if (opts.windowMs !== undefined) this.windowMs = opts.windowMs;
    if (opts.cooldownMs !== undefined) this.cooldownMs = opts.cooldownMs;
  }

  /** Get the current configuration. */
  getConfig(): Required<MassFailureConfig> {
    return {
      threshold: this.threshold,
      windowMs: this.windowMs,
      cooldownMs: this.cooldownMs,
    };
  }

  /** Get recent exit records (copy). */
  getRecentExits(): ExitRecord[] {
    return [...this.recentExits];
  }

  /** Clean up timers. Call when the detector is no longer needed. */
  dispose(): void {
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    this.callbacks = [];
  }
}

// ── Cause Detection ─────────────────────────────────────────────────

/**
 * Analyze recent exit records to determine the likely root cause.
 *
 * Checks error messages for common patterns:
 * - 401/unauthorized → auth_failure
 * - 429/rate_limit → rate_limit
 * - 503/unavailable → model_unavailable
 * - SIGKILL/exit 137 → resource_exhaustion (OOM killer)
 */
export function detectCause(exits: ExitRecord[]): MassFailureCause {
  const errors = exits.map((e) => e.error ?? '').filter(Boolean);
  if (errors.length === 0) return 'unknown';

  if (errors.every((e) => /401|unauthorized/i.test(e))) return 'auth_failure';
  if (errors.every((e) => /429|rate.?limit/i.test(e))) return 'rate_limit';
  if (errors.every((e) => /503|unavailable/i.test(e))) return 'model_unavailable';

  const signals = exits.map((e) => e.signal).filter(Boolean);
  if (signals.length > 0 && signals.every((s) => s === 'SIGKILL')) return 'resource_exhaustion';
  if (exits.every((e) => e.exitCode === 137)) return 'resource_exhaustion';

  return 'unknown';
}
