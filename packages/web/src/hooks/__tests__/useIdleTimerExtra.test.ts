// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIdleTimer } from '../useIdleTimer';

describe('useIdleTimer — visibilitychange handler (lines 55-56)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls handleActivity when visibilityState changes to visible', () => {
    const onIdle = vi.fn();
    const onReturn = vi.fn();
    renderHook(() => useIdleTimer({ timeout: 500, onIdle, onReturn }));

    // First, become idle
    act(() => { vi.advanceTimersByTime(500); });
    expect(onIdle).toHaveBeenCalledOnce();

    // Now simulate tab becoming visible
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // handleActivity should detect idle → not idle transition and call onReturn
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it('resets the idle timer when tab becomes visible before timeout', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimer({ timeout: 1000, onIdle }));

    // Advance 800ms (not yet idle)
    act(() => { vi.advanceTimersByTime(800); });

    // Simulate visibilitychange to visible — resets timer
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // 800ms more — total 1600ms from start but only 800ms since reset
    act(() => { vi.advanceTimersByTime(800); });
    expect(onIdle).not.toHaveBeenCalled();

    // Now pass the full timeout after reset
    act(() => { vi.advanceTimersByTime(200); });
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('does nothing when visibilityState is not visible', () => {
    const onReturn = vi.fn();
    renderHook(() => useIdleTimer({ timeout: 500, onReturn }));

    // Become idle
    act(() => { vi.advanceTimersByTime(500); });

    // Fire visibilitychange with hidden state
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // onReturn should not be called since state is 'hidden'
    expect(onReturn).not.toHaveBeenCalled();
  });
});
