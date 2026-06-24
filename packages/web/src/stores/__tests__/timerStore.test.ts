import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTimerStore, selectActiveTimerCount, _clearAllFireTimeouts } from '../timerStore';
import type { TimerInfo } from '../../types';

function makeTimer(overrides: Partial<TimerInfo> = {}): TimerInfo {
  return {
    id: 'timer-1',
    agentId: 'agent-abc123',
    label: 'check-build',
    message: 'Check if the build passed',
    fireAt: Date.now() + 60_000,
    createdAt: new Date().toISOString(),
    status: 'pending',
    repeat: false,
    delaySeconds: 60,
    remainingMs: 60_000,
    ...overrides,
  };
}

describe('timerStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _clearAllFireTimeouts();
    useTimerStore.setState({ timers: [], recentlyFiredIds: [] });
  });

  afterEach(() => {
    _clearAllFireTimeouts();
    vi.useRealTimers();
  });

  it('initializes with empty state', () => {
    const state = useTimerStore.getState();
    expect(state.timers).toEqual([]);
    expect(state.recentlyFiredIds).toEqual([]);
  });

  it('setTimers replaces all timers', () => {
    const t1 = makeTimer({ id: 't1' });
    const t2 = makeTimer({ id: 't2' });
    useTimerStore.getState().setTimers([t1, t2]);
    expect(useTimerStore.getState().timers).toHaveLength(2);
  });

  it('addTimer appends new timer', () => {
    const t1 = makeTimer({ id: 't1' });
    useTimerStore.getState().addTimer(t1);
    expect(useTimerStore.getState().timers).toHaveLength(1);
    expect(useTimerStore.getState().timers[0].id).toBe('t1');
  });

  it('addTimer updates existing timer by id', () => {
    const t1 = makeTimer({ id: 't1', label: 'old' });
    useTimerStore.getState().addTimer(t1);
    useTimerStore.getState().addTimer({ ...t1, label: 'updated' });
    expect(useTimerStore.getState().timers).toHaveLength(1);
    expect(useTimerStore.getState().timers[0].label).toBe('updated');
  });

  it('fireTimer marks timer as fired and adds to recentlyFiredIds', () => {
    useTimerStore.getState().setTimers([makeTimer({ id: 't1' })]);
    useTimerStore.getState().fireTimer('t1');
    const state = useTimerStore.getState();
    expect(state.timers[0].status).toBe('fired');
    expect(state.timers[0].remainingMs).toBe(0);
    expect(state.recentlyFiredIds).toContain('t1');
  });

  it('fireTimer is idempotent for recentlyFiredIds', () => {
    useTimerStore.getState().setTimers([makeTimer({ id: 't1' })]);
    useTimerStore.getState().fireTimer('t1');
    useTimerStore.getState().fireTimer('t1');
    expect(useTimerStore.getState().recentlyFiredIds).toEqual(['t1']);
  });

  it('removeTimer removes timer and clears from recentlyFiredIds', () => {
    useTimerStore.getState().setTimers([makeTimer({ id: 't1' }), makeTimer({ id: 't2' })]);
    useTimerStore.getState().fireTimer('t1');
    useTimerStore.getState().removeTimer('t1');
    const state = useTimerStore.getState();
    expect(state.timers).toHaveLength(1);
    expect(state.timers[0].id).toBe('t2');
    expect(state.recentlyFiredIds).not.toContain('t1');
  });

  it('clearRecentlyFired removes only from recentlyFiredIds, not timers', () => {
    useTimerStore.getState().setTimers([makeTimer({ id: 't1' })]);
    useTimerStore.getState().fireTimer('t1');
    useTimerStore.getState().clearRecentlyFired('t1');
    const state = useTimerStore.getState();
    expect(state.timers).toHaveLength(1);
    expect(state.recentlyFiredIds).toEqual([]);
  });

  it('removeTimer is safe for non-existent id', () => {
    useTimerStore.getState().setTimers([makeTimer({ id: 't1' })]);
    useTimerStore.getState().removeTimer('nonexistent');
    expect(useTimerStore.getState().timers).toHaveLength(1);
  });

  describe('selectActiveTimerCount', () => {
    it('counts only pending timers', () => {
      const state = {
        timers: [
          makeTimer({ id: 't1', status: 'pending' }),
          makeTimer({ id: 't2', status: 'fired' }),
          makeTimer({ id: 't3', status: 'pending' }),
        ],
        recentlyFiredIds: [],
        setTimers: () => {},
        addTimer: () => {},
        fireTimer: () => {},
        removeTimer: () => {},
        clearRecentlyFired: () => {},
      };
      expect(selectActiveTimerCount(state)).toBe(2);
    });

    it('returns 0 when all fired', () => {
      const state = {
        timers: [makeTimer({ id: 't1', status: 'fired' })],
        recentlyFiredIds: [],
        setTimers: () => {},
        addTimer: () => {},
        fireTimer: () => {},
        removeTimer: () => {},
        clearRecentlyFired: () => {},
      };
      expect(selectActiveTimerCount(state)).toBe(0);
    });

    it('returns 0 for empty timers', () => {
      const state = {
        timers: [],
        recentlyFiredIds: [],
        setTimers: () => {},
        addTimer: () => {},
        fireTimer: () => {},
        removeTimer: () => {},
        clearRecentlyFired: () => {},
      };
      expect(selectActiveTimerCount(state)).toBe(0);
    });
  });

  describe('race condition: timer:fired before timer:created', () => {
    it('addTimer marks timer as fired if already in recentlyFiredIds', () => {
      const store = useTimerStore.getState();
      // Simulate timer:fired arriving first
      store.fireTimer('t1');
      expect(useTimerStore.getState().recentlyFiredIds).toContain('t1');
      // Timer doesn't exist in timers yet — fireTimer only maps over existing
      expect(useTimerStore.getState().timers).toHaveLength(0);

      // Now timer:created arrives — addTimer should mark it as fired
      store.addTimer(makeTimer({ id: 't1', status: 'pending' }));
      const timer = useTimerStore.getState().timers.find((t) => t.id === 't1');
      expect(timer?.status).toBe('fired');
      expect(timer?.remainingMs).toBe(0);
    });

    it('addTimer leaves status alone if not in recentlyFiredIds', () => {
      const store = useTimerStore.getState();
      store.addTimer(makeTimer({ id: 't1', status: 'pending' }));
      expect(useTimerStore.getState().timers[0].status).toBe('pending');
    });
  });

  describe('scheduleFireRemoval', () => {
    it('clears recently-fired state after delay but keeps timer', () => {
      const store = useTimerStore.getState();
      store.addTimer(makeTimer({ id: 't1' }));
      store.fireTimer('t1');
      store.scheduleFireRemoval('t1', 2000);

      expect(useTimerStore.getState().timers).toHaveLength(1);
      expect(useTimerStore.getState().recentlyFiredIds).toContain('t1');
      vi.advanceTimersByTime(2000);
      // Timer stays in the store, but recently-fired flash is cleared
      expect(useTimerStore.getState().timers).toHaveLength(1);
      expect(useTimerStore.getState().recentlyFiredIds).not.toContain('t1');
    });

    it('clears previous timeout if called again', () => {
      const store = useTimerStore.getState();
      store.addTimer(makeTimer({ id: 't1' }));
      store.fireTimer('t1');
      store.scheduleFireRemoval('t1', 2000);
      // Reschedule — resets the timeout
      store.scheduleFireRemoval('t1', 5000);

      vi.advanceTimersByTime(2000);
      // Should still be recently fired (first timeout was cleared)
      expect(useTimerStore.getState().recentlyFiredIds).toContain('t1');

      vi.advanceTimersByTime(3000);
      // Now recently-fired state should be cleared, but timer remains
      expect(useTimerStore.getState().timers).toHaveLength(1);
      expect(useTimerStore.getState().recentlyFiredIds).not.toContain('t1');
    });

    it('removeTimer clears pending fire timeout', () => {
      const store = useTimerStore.getState();
      store.addTimer(makeTimer({ id: 't1' }));
      store.fireTimer('t1');
      store.scheduleFireRemoval('t1', 2000);

      // Manual removal before timeout fires
      store.removeTimer('t1');
      expect(useTimerStore.getState().timers).toHaveLength(0);

      // Advance past timeout — should not throw or cause issues
      vi.advanceTimersByTime(3000);
      expect(useTimerStore.getState().timers).toHaveLength(0);
    });
  });
});
