// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAccessibilityAnnouncements } from '../useAccessibilityAnnouncements';

describe('useAccessibilityAnnouncements', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns initial empty state', () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());
    const state = result.current.getState();
    expect(state.politeMessage).toBe('');
    expect(state.assertiveMessage).toBe('');
  });

  it('announces polite messages immediately when throttle window has passed', () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());

    act(() => {
      result.current.announcePolite('Hello world');
    });

    expect(result.current.getState().politeMessage).toBe('Hello world');
  });

  it('throttles rapid polite announcements', () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());

    act(() => {
      result.current.announcePolite('First');
    });
    expect(result.current.getState().politeMessage).toBe('First');

    // Send another within throttle window
    act(() => {
      result.current.announcePolite('Second');
    });
    // Should still show first (second is pending)
    expect(result.current.getState().politeMessage).toBe('First');

    // Advance past throttle window
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current.getState().politeMessage).toBe('Second');
  });

  it('only delivers the last polite message during throttle burst', () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());

    act(() => {
      result.current.announcePolite('First');
    });

    act(() => {
      result.current.announcePolite('Second');
      result.current.announcePolite('Third');
    });

    // Advance past throttle
    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(result.current.getState().politeMessage).toBe('Third');
  });

  it('announces assertive messages immediately without throttling', () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());

    act(() => {
      result.current.announceAssertive('Critical error');
    });
    expect(result.current.getState().assertiveMessage).toBe('Critical error');

    act(() => {
      result.current.announceAssertive('Another error');
    });
    expect(result.current.getState().assertiveMessage).toBe('Another error');
  });

  it('announceNewEvents formats single event with summary', () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());

    act(() => {
      result.current.announceNewEvents(1, 'Agent spawned');
    });
    expect(result.current.getState().politeMessage).toBe('New event: Agent spawned');
  });

  it('announceNewEvents formats single event with default summary', () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());

    act(() => {
      result.current.announceNewEvents(1);
    });
    expect(result.current.getState().politeMessage).toBe('New event: activity update');
  });

  it('announceNewEvents formats multiple events', () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());

    act(() => {
      result.current.announceNewEvents(5);
    });
    expect(result.current.getState().politeMessage).toBe('5 new events');
  });

  it('announceNewEvents does nothing for count 0', () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());

    act(() => {
      result.current.announceNewEvents(0);
    });
    expect(result.current.getState().politeMessage).toBe('');
  });

  it('announceError prepends "Error:" and uses assertive', () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());

    act(() => {
      result.current.announceError('Connection failed');
    });
    expect(result.current.getState().assertiveMessage).toBe('Error: Connection failed');
  });

  it('announceConnectionChange maps known statuses', () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());

    act(() => { result.current.announceConnectionChange('connected'); });
    expect(result.current.getState().assertiveMessage).toBe('Connection restored');

    act(() => { result.current.announceConnectionChange('reconnecting'); });
    expect(result.current.getState().assertiveMessage).toBe('Connection lost, reconnecting');

    act(() => { result.current.announceConnectionChange('degraded'); });
    expect(result.current.getState().assertiveMessage).toBe('Connection degraded');

    act(() => { result.current.announceConnectionChange('offline'); });
    expect(result.current.getState().assertiveMessage).toBe('Connection offline');
  });

  it('announceConnectionChange falls back for unknown status', () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());

    act(() => { result.current.announceConnectionChange('unknown-state'); });
    expect(result.current.getState().assertiveMessage).toBe('Connection: unknown-state');
  });

  it('subscribe notifies listener on updates', () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());
    const listener = vi.fn();

    act(() => {
      result.current.subscribe(listener);
    });

    act(() => {
      result.current.announceAssertive('Test');
    });
    expect(listener).toHaveBeenCalled();
  });

  it('unsubscribe stops notifications', () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());
    const listener = vi.fn();

    let unsub: () => void;
    act(() => {
      unsub = result.current.subscribe(listener);
    });

    act(() => { unsub(); });
    listener.mockClear();

    act(() => {
      result.current.announceAssertive('After unsub');
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it('clearTimers cancels pending polite timer', () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());

    act(() => {
      result.current.announcePolite('First');
    });

    act(() => {
      result.current.announcePolite('Pending');
    });

    act(() => {
      result.current.clearTimers();
    });

    // Advance time — pending should NOT be delivered
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current.getState().politeMessage).toBe('First');
  });
});
