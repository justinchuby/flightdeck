import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MassFailureDetector,
  detectCause,
  type ExitRecord,
  type MassFailureConfig,
} from '../MassFailureDetector.js';

describe('MassFailureDetector', () => {
  let detector: MassFailureDetector;

  beforeEach(() => {
    vi.useFakeTimers();
    detector = new MassFailureDetector({ threshold: 3, windowMs: 60_000, cooldownMs: 120_000 });
  });

  afterEach(() => {
    detector.dispose();
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Helper: create an exit record
  // ---------------------------------------------------------------------------
  function makeExit(overrides: Partial<ExitRecord> = {}): ExitRecord {
    return {
      agentId: `agent-${Math.random().toString(36).slice(2, 6)}`,
      exitCode: 1,
      signal: null,
      error: 'Process exited unexpectedly',
      timestamp: Date.now(),
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------------
  // Threshold detection
  // ---------------------------------------------------------------------------
  describe('threshold detection', () => {
    it('does not trigger below threshold', () => {
      const result1 = detector.recordExit(makeExit({ agentId: 'a1' }));
      const result2 = detector.recordExit(makeExit({ agentId: 'a2' }));

      expect(result1).toBeNull();
      expect(result2).toBeNull();
      expect(detector.isPaused).toBe(false);
    });

    it('triggers at exactly the threshold', () => {
      detector.recordExit(makeExit({ agentId: 'a1' }));
      detector.recordExit(makeExit({ agentId: 'a2' }));
      const result = detector.recordExit(makeExit({ agentId: 'a3' }));

      expect(result).not.toBeNull();
      expect(result!.exitCount).toBe(3);
      expect(detector.isPaused).toBe(true);
    });

    it('triggers above the threshold', () => {
      detector.recordExit(makeExit({ agentId: 'a1' }));
      detector.recordExit(makeExit({ agentId: 'a2' }));
      detector.recordExit(makeExit({ agentId: 'a3' }));
      // Already triggered — 4th should not re-trigger
      const result4 = detector.recordExit(makeExit({ agentId: 'a4' }));

      expect(result4).toBeNull();
      expect(detector.isPaused).toBe(true);
    });

    it('uses custom threshold', () => {
      const custom = new MassFailureDetector({ threshold: 2, windowMs: 60_000 });

      custom.recordExit(makeExit({ agentId: 'a1' }));
      const result = custom.recordExit(makeExit({ agentId: 'a2' }));

      expect(result).not.toBeNull();
      expect(custom.isPaused).toBe(true);
      custom.dispose();
    });

    it('returns MassFailureData with exit details', () => {
      const now = Date.now();
      detector.recordExit(makeExit({ agentId: 'a1', timestamp: now - 5000, error: 'Error: 401 Unauthorized' }));
      detector.recordExit(makeExit({ agentId: 'a2', timestamp: now - 3000, error: 'Error: 401 Unauthorized' }));
      const result = detector.recordExit(makeExit({ agentId: 'a3', timestamp: now, error: 'Error: 401 Unauthorized' }));

      expect(result).not.toBeNull();
      expect(result!.exitCount).toBe(3);
      expect(result!.recentExits).toHaveLength(3);
      expect(result!.recentExits[0].agentId).toBe('a1');
      expect(result!.recentExits[2].agentId).toBe('a3');
      expect(result!.pausedUntil).toBeDefined();
      expect(result!.likelyCause).toBe('auth_failure');
    });
  });

  // ---------------------------------------------------------------------------
  // Sliding window
  // ---------------------------------------------------------------------------
  describe('sliding window', () => {
    it('ignores exits outside the window', () => {
      const now = Date.now();

      // Two old exits (outside 60s window)
      detector.recordExit(makeExit({ agentId: 'a1', timestamp: now - 120_000 }));
      detector.recordExit(makeExit({ agentId: 'a2', timestamp: now - 90_000 }));

      // One recent exit
      const result = detector.recordExit(makeExit({ agentId: 'a3', timestamp: now }));

      expect(result).toBeNull();
      expect(detector.isPaused).toBe(false);
    });

    it('detects exits within the window boundary', () => {
      const now = Date.now();

      // All three within 60s
      detector.recordExit(makeExit({ agentId: 'a1', timestamp: now - 50_000 }));
      detector.recordExit(makeExit({ agentId: 'a2', timestamp: now - 30_000 }));
      const result = detector.recordExit(makeExit({ agentId: 'a3', timestamp: now }));

      expect(result).not.toBeNull();
      expect(result!.exitCount).toBe(3);
    });

    it('uses custom window duration', () => {
      const custom = new MassFailureDetector({ threshold: 3, windowMs: 10_000 });
      const now = Date.now();

      // Two exits outside 10s window, one inside
      custom.recordExit(makeExit({ agentId: 'a1', timestamp: now - 30_000 }));
      custom.recordExit(makeExit({ agentId: 'a2', timestamp: now - 20_000 }));
      const result = custom.recordExit(makeExit({ agentId: 'a3', timestamp: now }));

      expect(result).toBeNull();
      custom.dispose();
    });

    it('calculates windowSeconds correctly', () => {
      const now = Date.now();

      detector.recordExit(makeExit({ agentId: 'a1', timestamp: now - 45_000 }));
      detector.recordExit(makeExit({ agentId: 'a2', timestamp: now - 20_000 }));
      const result = detector.recordExit(makeExit({ agentId: 'a3', timestamp: now }));

      expect(result).not.toBeNull();
      expect(result!.windowSeconds).toBe(45);
    });
  });

  // ---------------------------------------------------------------------------
  // Cooldown and auto-resume
  // ---------------------------------------------------------------------------
  describe('cooldown', () => {
    it('auto-resumes after cooldown period', () => {
      detector.recordExit(makeExit({ agentId: 'a1' }));
      detector.recordExit(makeExit({ agentId: 'a2' }));
      detector.recordExit(makeExit({ agentId: 'a3' }));

      expect(detector.isPaused).toBe(true);

      // Advance past cooldown (120s)
      vi.advanceTimersByTime(120_001);

      expect(detector.isPaused).toBe(false);
    });

    it('does not resume before cooldown expires', () => {
      detector.recordExit(makeExit({ agentId: 'a1' }));
      detector.recordExit(makeExit({ agentId: 'a2' }));
      detector.recordExit(makeExit({ agentId: 'a3' }));

      // Advance partway through cooldown
      vi.advanceTimersByTime(60_000);

      expect(detector.isPaused).toBe(true);
    });

    it('does not re-trigger during cooldown', () => {
      detector.recordExit(makeExit({ agentId: 'a1' }));
      detector.recordExit(makeExit({ agentId: 'a2' }));
      const first = detector.recordExit(makeExit({ agentId: 'a3' }));

      expect(first).not.toBeNull();

      // More exits during cooldown
      const during = detector.recordExit(makeExit({ agentId: 'a4' }));
      expect(during).toBeNull();
    });

    it('can re-trigger after cooldown expires', () => {
      detector.recordExit(makeExit({ agentId: 'a1' }));
      detector.recordExit(makeExit({ agentId: 'a2' }));
      detector.recordExit(makeExit({ agentId: 'a3' }));

      expect(detector.isPaused).toBe(true);

      // Wait for cooldown
      vi.advanceTimersByTime(120_001);
      expect(detector.isPaused).toBe(false);

      // New wave of failures
      const now = Date.now();
      detector.recordExit(makeExit({ agentId: 'b1', timestamp: now }));
      detector.recordExit(makeExit({ agentId: 'b2', timestamp: now }));
      const result = detector.recordExit(makeExit({ agentId: 'b3', timestamp: now }));

      expect(result).not.toBeNull();
      expect(detector.isPaused).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Manual resume
  // ---------------------------------------------------------------------------
  describe('resume', () => {
    it('clears pause state immediately', () => {
      detector.recordExit(makeExit({ agentId: 'a1' }));
      detector.recordExit(makeExit({ agentId: 'a2' }));
      detector.recordExit(makeExit({ agentId: 'a3' }));

      expect(detector.isPaused).toBe(true);

      detector.resume();

      expect(detector.isPaused).toBe(false);
      expect(detector.pauseStartedAt).toBeNull();
    });

    it('cancels the auto-resume timer', () => {
      detector.recordExit(makeExit({ agentId: 'a1' }));
      detector.recordExit(makeExit({ agentId: 'a2' }));
      detector.recordExit(makeExit({ agentId: 'a3' }));

      detector.resume();

      // Advancing time should have no effect
      vi.advanceTimersByTime(200_000);
      expect(detector.isPaused).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------
  describe('reset', () => {
    it('clears pause state and exit history', () => {
      detector.recordExit(makeExit({ agentId: 'a1' }));
      detector.recordExit(makeExit({ agentId: 'a2' }));
      detector.recordExit(makeExit({ agentId: 'a3' }));

      expect(detector.isPaused).toBe(true);
      expect(detector.exitCount).toBe(3);

      detector.reset();

      expect(detector.isPaused).toBe(false);
      expect(detector.exitCount).toBe(0);
      expect(detector.getRecentExits()).toHaveLength(0);
    });

    it('allows fresh detection after reset', () => {
      detector.recordExit(makeExit({ agentId: 'a1' }));
      detector.recordExit(makeExit({ agentId: 'a2' }));
      detector.recordExit(makeExit({ agentId: 'a3' }));

      detector.reset();

      // Should need 3 new exits to trigger again
      detector.recordExit(makeExit({ agentId: 'b1' }));
      expect(detector.isPaused).toBe(false);

      detector.recordExit(makeExit({ agentId: 'b2' }));
      expect(detector.isPaused).toBe(false);

      detector.recordExit(makeExit({ agentId: 'b3' }));
      expect(detector.isPaused).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Callback / onMassFailure
  // ---------------------------------------------------------------------------
  describe('onMassFailure', () => {
    it('invokes registered callbacks on mass failure', () => {
      const callback = vi.fn();
      detector.onMassFailure(callback);

      detector.recordExit(makeExit({ agentId: 'a1' }));
      detector.recordExit(makeExit({ agentId: 'a2' }));
      detector.recordExit(makeExit({ agentId: 'a3' }));

      expect(callback).toHaveBeenCalledOnce();
      expect(callback.mock.calls[0][0].exitCount).toBe(3);
    });

    it('supports multiple callbacks', () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      detector.onMassFailure(cb1);
      detector.onMassFailure(cb2);

      detector.recordExit(makeExit({ agentId: 'a1' }));
      detector.recordExit(makeExit({ agentId: 'a2' }));
      detector.recordExit(makeExit({ agentId: 'a3' }));

      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledOnce();
    });

    it('returns an unsubscribe function', () => {
      const callback = vi.fn();
      const unsub = detector.onMassFailure(callback);

      unsub();

      detector.recordExit(makeExit({ agentId: 'a1' }));
      detector.recordExit(makeExit({ agentId: 'a2' }));
      detector.recordExit(makeExit({ agentId: 'a3' }));

      expect(callback).not.toHaveBeenCalled();
    });

    it('survives callback errors without breaking detection', () => {
      const badCallback = vi.fn(() => {
        throw new Error('callback error');
      });
      const goodCallback = vi.fn();

      detector.onMassFailure(badCallback);
      detector.onMassFailure(goodCallback);

      detector.recordExit(makeExit({ agentId: 'a1' }));
      detector.recordExit(makeExit({ agentId: 'a2' }));
      detector.recordExit(makeExit({ agentId: 'a3' }));

      expect(badCallback).toHaveBeenCalled();
      expect(goodCallback).toHaveBeenCalled();
      expect(detector.isPaused).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Configure
  // ---------------------------------------------------------------------------
  describe('configure', () => {
    it('updates threshold at runtime', () => {
      detector.configure({ threshold: 5 });

      detector.recordExit(makeExit({ agentId: 'a1' }));
      detector.recordExit(makeExit({ agentId: 'a2' }));
      detector.recordExit(makeExit({ agentId: 'a3' }));

      expect(detector.isPaused).toBe(false);

      detector.recordExit(makeExit({ agentId: 'a4' }));
      detector.recordExit(makeExit({ agentId: 'a5' }));

      expect(detector.isPaused).toBe(true);
    });

    it('updates windowMs at runtime', () => {
      detector.configure({ windowMs: 5_000 });
      const now = Date.now();

      detector.recordExit(makeExit({ agentId: 'a1', timestamp: now - 10_000 }));
      detector.recordExit(makeExit({ agentId: 'a2', timestamp: now - 8_000 }));
      const result = detector.recordExit(makeExit({ agentId: 'a3', timestamp: now }));

      // Old exits outside 5s window, shouldn't trigger
      expect(result).toBeNull();
    });

    it('returns config via getConfig()', () => {
      const config = detector.getConfig();
      expect(config).toEqual({
        threshold: 3,
        windowMs: 60_000,
        cooldownMs: 120_000,
      });
    });

    it('rejects threshold of 0', () => {
      expect(() => detector.configure({ threshold: 0 })).toThrow(RangeError);
    });

    it('rejects negative threshold', () => {
      expect(() => detector.configure({ threshold: -1 })).toThrow(RangeError);
    });

    it('rejects threshold above 100', () => {
      expect(() => detector.configure({ threshold: 101 })).toThrow(RangeError);
    });

    it('rejects windowMs below 1 second', () => {
      expect(() => detector.configure({ windowMs: 500 })).toThrow(RangeError);
    });

    it('rejects windowMs above 10 minutes', () => {
      expect(() => detector.configure({ windowMs: 700_000 })).toThrow(RangeError);
    });

    it('rejects cooldownMs above 1 hour', () => {
      expect(() => detector.configure({ cooldownMs: 3_700_000 })).toThrow(RangeError);
    });

    it('rejects Infinity values', () => {
      expect(() => detector.configure({ cooldownMs: Infinity })).toThrow(RangeError);
      expect(() => detector.configure({ windowMs: Infinity })).toThrow(RangeError);
      expect(() => detector.configure({ threshold: Infinity })).toThrow(RangeError);
    });

    it('rejects NaN values', () => {
      expect(() => detector.configure({ threshold: NaN })).toThrow(RangeError);
    });

    it('does not apply partial config when validation fails', () => {
      const before = detector.getConfig();
      expect(() => detector.configure({ threshold: 0 })).toThrow();
      expect(detector.getConfig()).toEqual(before);
    });
  });

  describe('constructor validation', () => {
    it('rejects invalid config in constructor', () => {
      expect(() => new MassFailureDetector({ threshold: 0 })).toThrow(RangeError);
      expect(() => new MassFailureDetector({ cooldownMs: Infinity })).toThrow(RangeError);
    });

    it('accepts valid boundary values', () => {
      const d = new MassFailureDetector({ threshold: 1, windowMs: 1_000, cooldownMs: 3_600_000 });
      expect(d.getConfig()).toEqual({ threshold: 1, windowMs: 1_000, cooldownMs: 3_600_000 });
      d.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // Exit history management
  // ---------------------------------------------------------------------------
  describe('exit history', () => {
    it('tracks exit count', () => {
      expect(detector.exitCount).toBe(0);

      detector.recordExit(makeExit({ agentId: 'a1' }));
      expect(detector.exitCount).toBe(1);

      detector.recordExit(makeExit({ agentId: 'a2' }));
      expect(detector.exitCount).toBe(2);
    });

    it('caps history at 50 entries', () => {
      for (let i = 0; i < 60; i++) {
        detector.recordExit(makeExit({ agentId: `a${i}` }));
        if (detector.isPaused) detector.resume();
      }

      expect(detector.exitCount).toBeLessThanOrEqual(50);
    });

    it('returns a copy of recent exits', () => {
      detector.recordExit(makeExit({ agentId: 'a1' }));
      const exits = detector.getRecentExits();

      expect(exits).toHaveLength(1);
      expect(exits[0].agentId).toBe('a1');

      // Modifying the copy should not affect the detector
      exits.push(makeExit({ agentId: 'fake' }));
      expect(detector.exitCount).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Pause state
  // ---------------------------------------------------------------------------
  describe('pause state', () => {
    it('reports pauseStartedAt when paused', () => {
      expect(detector.pauseStartedAt).toBeNull();

      const now = Date.now();
      detector.recordExit(makeExit({ agentId: 'a1', timestamp: now }));
      detector.recordExit(makeExit({ agentId: 'a2', timestamp: now }));
      detector.recordExit(makeExit({ agentId: 'a3', timestamp: now }));

      expect(detector.pauseStartedAt).toBe(now);
    });
  });

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------
  describe('dispose', () => {
    it('clears timers', () => {
      detector.recordExit(makeExit({ agentId: 'a1' }));
      detector.recordExit(makeExit({ agentId: 'a2' }));
      detector.recordExit(makeExit({ agentId: 'a3' }));

      detector.dispose();

      // Timer cleared — advancing time should not change state
      vi.advanceTimersByTime(200_000);
      // Still paused because dispose doesn't clear pause state
      expect(detector.isPaused).toBe(true);
    });

    it('clears all callbacks', () => {
      const callback = vi.fn();
      detector.onMassFailure(callback);
      detector.dispose();

      // Create a new detector to test the callback was cleared
      const fresh = new MassFailureDetector({ threshold: 1 });
      fresh.onMassFailure(callback);
      fresh.recordExit(makeExit({ agentId: 'a1' }));
      expect(callback).toHaveBeenCalledOnce(); // Only from fresh detector

      fresh.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
  describe('edge cases', () => {
    it('handles threshold of 1 (single failure trigger)', () => {
      const sensitive = new MassFailureDetector({ threshold: 1 });
      const result = sensitive.recordExit(makeExit({ agentId: 'a1' }));

      expect(result).not.toBeNull();
      expect(sensitive.isPaused).toBe(true);
      sensitive.dispose();
    });

    it('handles default configuration', () => {
      const defaults = new MassFailureDetector();
      const config = defaults.getConfig();

      expect(config.threshold).toBe(3);
      expect(config.windowMs).toBe(60_000);
      expect(config.cooldownMs).toBe(120_000);
      defaults.dispose();
    });

    it('handles exits with no error message', () => {
      detector.recordExit(makeExit({ agentId: 'a1', error: null }));
      detector.recordExit(makeExit({ agentId: 'a2', error: null }));
      const result = detector.recordExit(makeExit({ agentId: 'a3', error: null }));

      expect(result).not.toBeNull();
      expect(result!.likelyCause).toBe('unknown');
    });

    it('handles exits with exit code 0 (graceful)', () => {
      detector.recordExit(makeExit({ agentId: 'a1', exitCode: 0 }));
      detector.recordExit(makeExit({ agentId: 'a2', exitCode: 0 }));
      const result = detector.recordExit(makeExit({ agentId: 'a3', exitCode: 0 }));

      // Even graceful exits can trigger mass failure (e.g., misconfigured agents)
      expect(result).not.toBeNull();
    });
  });
});

// ── detectCause — unit tests ────────────────────────────────────────

describe('detectCause', () => {
  function makeExits(errors: (string | null)[], signals: (string | null)[] = []): ExitRecord[] {
    return errors.map((error, i) => ({
      agentId: `agent-${i}`,
      exitCode: 1,
      signal: signals[i] ?? null,
      error,
      timestamp: Date.now(),
    }));
  }

  it('detects auth_failure from 401 errors', () => {
    expect(detectCause(makeExits(['Error: 401 Unauthorized', 'HTTP 401']))).toBe('auth_failure');
  });

  it('detects rate_limit from 429 errors', () => {
    expect(detectCause(makeExits(['Error: 429 Too Many Requests', 'rate limit exceeded']))).toBe('rate_limit');
  });

  it('detects model_unavailable from 503 errors', () => {
    expect(detectCause(makeExits(['Error: 503 Service Unavailable', '503 unavailable']))).toBe('model_unavailable');
  });

  it('detects resource_exhaustion from SIGKILL signals', () => {
    expect(detectCause(makeExits(['killed', 'killed'], ['SIGKILL', 'SIGKILL']))).toBe('resource_exhaustion');
  });

  it('detects resource_exhaustion from exit code 137', () => {
    const exits = makeExits(['OOM', 'OOM']).map((e) => ({ ...e, exitCode: 137 }));
    expect(detectCause(exits)).toBe('resource_exhaustion');
  });

  it('returns unknown for no errors', () => {
    expect(detectCause(makeExits([null, null]))).toBe('unknown');
  });

  it('returns unknown for mixed error types', () => {
    expect(detectCause(makeExits(['Error: 401', 'Error: 503']))).toBe('unknown');
  });

  it('returns unknown for unrecognized errors', () => {
    expect(detectCause(makeExits(['Something went wrong', 'Another error']))).toBe('unknown');
  });
});
