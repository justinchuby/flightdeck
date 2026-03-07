/**
 * AgentServerHealth — unit tests for the health state machine.
 *
 * Tests cover: state transitions (connected → degraded → disconnected),
 * pong recovery, latency tracking, start/stop lifecycle, and edge cases.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentServerHealth, type HealthState, type HealthStateChange } from '../AgentServerHealth.js';

// ── Helpers ─────────────────────────────────────────────────────────

function createHealth(options?: {
  pingIntervalMs?: number;
  degradedThreshold?: number;
  disconnectedThreshold?: number;
}) {
  let pingCount = 0;
  const sendPing = vi.fn(() => `hb-${++pingCount}`);

  const health = new AgentServerHealth(sendPing, {
    pingIntervalMs: options?.pingIntervalMs ?? 100,
    degradedThreshold: options?.degradedThreshold ?? 1,
    disconnectedThreshold: options?.disconnectedThreshold ?? 3,
  });

  return { health, sendPing };
}

function collectStateChanges(health: AgentServerHealth): HealthStateChange[] {
  const changes: HealthStateChange[] = [];
  health.onStateChange((change) => changes.push(change));
  return changes;
}

// ── Tests ───────────────────────────────────────────────────────────

describe('AgentServerHealth', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('starts in connected state', () => {
      const { health } = createHealth();
      expect(health.state).toBe('connected');
    });

    it('is not running before start()', () => {
      const { health } = createHealth();
      expect(health.isRunning).toBe(false);
    });

    it('has null lastPongAge before any pong', () => {
      const { health } = createHealth();
      expect(health.lastPongAge).toBeNull();
    });

    it('has null lastLatency before any pong', () => {
      const { health } = createHealth();
      expect(health.lastLatency).toBeNull();
    });

    it('has 0 consecutive misses initially', () => {
      const { health } = createHealth();
      expect(health.consecutiveMisses).toBe(0);
    });
  });

  describe('start/stop', () => {
    it('marks as running after start()', () => {
      const { health } = createHealth();
      health.start();
      expect(health.isRunning).toBe(true);
      health.stop();
    });

    it('sends first ping after one interval', () => {
      const { health, sendPing } = createHealth({ pingIntervalMs: 100 });
      health.start();

      expect(sendPing).not.toHaveBeenCalled();
      vi.advanceTimersByTime(100);
      expect(sendPing).toHaveBeenCalledOnce();

      health.stop();
    });

    it('stop() clears interval and resets misses', () => {
      const { health, sendPing } = createHealth({ pingIntervalMs: 100 });
      health.start();

      vi.advanceTimersByTime(100); // 1 ping
      health.stop();

      expect(health.isRunning).toBe(false);
      expect(health.consecutiveMisses).toBe(0);

      // No more pings after stop
      vi.advanceTimersByTime(500);
      expect(sendPing).toHaveBeenCalledOnce();
    });

    it('start() is idempotent when already running', () => {
      const { health, sendPing } = createHealth({ pingIntervalMs: 100 });
      health.start();
      health.start(); // Should not create a second interval

      vi.advanceTimersByTime(100);
      expect(sendPing).toHaveBeenCalledOnce();

      health.stop();
    });
  });

  describe('state transitions', () => {
    it('stays connected when pongs arrive on time', () => {
      const { health, sendPing } = createHealth({ pingIntervalMs: 100 });
      const changes = collectStateChanges(health);
      health.start();

      // Tick 1: sends ping hb-1
      vi.advanceTimersByTime(100);
      health.recordPong('hb-1');

      // Tick 2: sends ping hb-2 (no miss since hb-1 was answered)
      vi.advanceTimersByTime(100);
      health.recordPong('hb-2');

      expect(health.state).toBe('connected');
      expect(changes).toHaveLength(0);

      health.stop();
    });

    it('transitions to degraded after 1 missed pong', () => {
      const { health } = createHealth({ pingIntervalMs: 100, degradedThreshold: 1 });
      const changes = collectStateChanges(health);
      health.start();

      // Tick 1: sends ping hb-1
      vi.advanceTimersByTime(100);
      // Don't respond to hb-1

      // Tick 2: hb-1 is missed, sends hb-2
      vi.advanceTimersByTime(100);

      expect(health.state).toBe('degraded');
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        previous: 'connected',
        current: 'degraded',
        missedPongs: 1,
      });

      health.stop();
    });

    it('transitions to disconnected after 3 missed pongs', () => {
      const { health } = createHealth({
        pingIntervalMs: 100,
        degradedThreshold: 1,
        disconnectedThreshold: 3,
      });
      const changes = collectStateChanges(health);
      health.start();

      // Tick 1: sends hb-1 (no response)
      vi.advanceTimersByTime(100);
      // Tick 2: miss hb-1, sends hb-2 → degraded
      vi.advanceTimersByTime(100);
      // Tick 3: miss hb-2, sends hb-3
      vi.advanceTimersByTime(100);
      // Tick 4: miss hb-3, sends hb-4 → disconnected
      vi.advanceTimersByTime(100);

      expect(health.state).toBe('disconnected');
      expect(changes).toHaveLength(2);
      expect(changes[0].current).toBe('degraded');
      expect(changes[1]).toMatchObject({
        previous: 'degraded',
        current: 'disconnected',
        missedPongs: 3,
      });

      health.stop();
    });

    it('recovers from degraded to connected on pong', () => {
      const { health } = createHealth({ pingIntervalMs: 100 });
      const changes = collectStateChanges(health);
      health.start();

      // Tick 1: sends hb-1 (no response)
      vi.advanceTimersByTime(100);
      // Tick 2: miss → degraded, sends hb-2
      vi.advanceTimersByTime(100);
      expect(health.state).toBe('degraded');

      // Respond to hb-2
      health.recordPong('hb-2');
      expect(health.state).toBe('connected');
      expect(changes).toHaveLength(2);
      expect(changes[1]).toMatchObject({
        previous: 'degraded',
        current: 'connected',
      });

      health.stop();
    });

    it('recovers from disconnected to connected on pong', () => {
      const { health } = createHealth({
        pingIntervalMs: 100,
        degradedThreshold: 1,
        disconnectedThreshold: 2,
      });
      health.start();

      // Miss 2 pongs → disconnected
      vi.advanceTimersByTime(100); // sends hb-1
      vi.advanceTimersByTime(100); // miss hb-1 → degraded, sends hb-2
      vi.advanceTimersByTime(100); // miss hb-2 → disconnected, sends hb-3
      expect(health.state).toBe('disconnected');

      // Late pong arrives
      health.recordPong('hb-3');
      expect(health.state).toBe('connected');
      expect(health.consecutiveMisses).toBe(0);

      health.stop();
    });
  });

  describe('latency tracking', () => {
    it('records round-trip latency on pong', () => {
      const { health } = createHealth({ pingIntervalMs: 100 });
      health.start();

      vi.advanceTimersByTime(100); // sends hb-1 at t=100
      vi.advanceTimersByTime(25);  // 25ms later
      health.recordPong('hb-1');

      expect(health.lastLatency).toBe(25);
      health.stop();
    });

    it('ignores pongs with unknown requestId for latency (but still resets state)', () => {
      const { health } = createHealth({ pingIntervalMs: 100 });
      health.start();

      vi.advanceTimersByTime(100);
      health.recordPong('unknown-id');

      // State should still be connected (pong received)
      expect(health.state).toBe('connected');
      // Latency not updated since requestId didn't match
      expect(health.lastLatency).toBeNull();

      health.stop();
    });

    it('updates lastPongAge', () => {
      const { health } = createHealth({ pingIntervalMs: 100 });
      health.start();

      vi.advanceTimersByTime(100);
      health.recordPong('hb-1');

      vi.advanceTimersByTime(50);
      expect(health.lastPongAge).toBe(50);

      health.stop();
    });
  });

  describe('sendPing failure', () => {
    it('counts as a miss when sendPing throws', () => {
      let callCount = 0;
      const throwing = () => {
        callCount++;
        if (callCount > 1) throw new Error('transport disconnected');
        return `hb-${callCount}`;
      };

      const health = new AgentServerHealth(throwing, {
        pingIntervalMs: 100,
        degradedThreshold: 1,
      });
      health.start();

      // Tick 1: sends hb-1 (works)
      vi.advanceTimersByTime(100);
      // Tick 2: hb-1 missed, sendPing throws → double miss
      vi.advanceTimersByTime(100);

      expect(health.state).toBe('degraded');
      health.stop();
    });
  });

  describe('onStateChange', () => {
    it('returns an unsubscribe function', () => {
      const { health } = createHealth({ pingIntervalMs: 100 });
      const changes: HealthStateChange[] = [];
      const unsub = health.onStateChange((c) => changes.push(c));

      health.start();
      vi.advanceTimersByTime(100); // sends hb-1
      vi.advanceTimersByTime(100); // miss → degraded

      unsub();

      // More misses should not trigger the handler
      vi.advanceTimersByTime(100);
      vi.advanceTimersByTime(100);

      expect(changes).toHaveLength(1);
      expect(changes[0].current).toBe('degraded');

      health.stop();
    });

    it('handler errors are swallowed', () => {
      const { health } = createHealth({ pingIntervalMs: 100 });
      health.onStateChange(() => { throw new Error('boom'); });

      health.start();
      vi.advanceTimersByTime(100);
      vi.advanceTimersByTime(100); // miss → degraded

      // Should not throw
      expect(health.state).toBe('degraded');
      health.stop();
    });
  });

  describe('custom thresholds', () => {
    it('respects custom degradedThreshold=2', () => {
      const { health } = createHealth({
        pingIntervalMs: 100,
        degradedThreshold: 2,
        disconnectedThreshold: 5,
      });
      health.start();

      vi.advanceTimersByTime(100); // sends hb-1
      vi.advanceTimersByTime(100); // miss 1, sends hb-2
      expect(health.state).toBe('connected'); // Only 1 miss, threshold is 2

      vi.advanceTimersByTime(100); // miss 2, sends hb-3
      expect(health.state).toBe('degraded');

      health.stop();
    });
  });
});
