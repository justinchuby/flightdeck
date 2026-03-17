import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIdleTimer } from '../useIdleTimer';

describe('useIdleTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fires onIdle after timeout', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimer({ timeout: 1000, onIdle }));

    expect(onIdle).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('does not fire onIdle before timeout', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimer({ timeout: 1000, onIdle }));

    act(() => { vi.advanceTimersByTime(999); });
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('fires onReturn when user interacts after being idle', () => {
    const onIdle = vi.fn();
    const onReturn = vi.fn();
    renderHook(() => useIdleTimer({ timeout: 500, onIdle, onReturn }));

    // Become idle
    act(() => { vi.advanceTimersByTime(500); });
    expect(onIdle).toHaveBeenCalledOnce();
    expect(onReturn).not.toHaveBeenCalled();

    // Interact after idle
    act(() => {
      window.dispatchEvent(new Event('mousemove'));
    });
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it('resets the timer on user activity before idle', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimer({ timeout: 1000, onIdle }));

    // Advance 800ms, then interact to reset
    act(() => { vi.advanceTimersByTime(800); });
    act(() => { window.dispatchEvent(new Event('keydown')); });
    expect(onIdle).not.toHaveBeenCalled();

    // Another 800ms — still under the reset timeout
    act(() => { vi.advanceTimersByTime(800); });
    expect(onIdle).not.toHaveBeenCalled();

    // Full timeout after last interaction
    act(() => { vi.advanceTimersByTime(200); });
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('does not fire when disabled', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimer({ timeout: 500, onIdle, disabled: true }));

    act(() => { vi.advanceTimersByTime(1000); });
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('cleans up listeners and timers on unmount', () => {
    const onIdle = vi.fn();
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useIdleTimer({ timeout: 1000, onIdle }));

    unmount();

    // Timer should be cleared — advancing should not fire onIdle
    act(() => { vi.advanceTimersByTime(2000); });
    expect(onIdle).not.toHaveBeenCalled();

    // Check that event listeners were removed
    const removedEvents = removeSpy.mock.calls.map(([e]) => e);
    expect(removedEvents).toContain('mousemove');
    expect(removedEvents).toContain('keydown');
    expect(removedEvents).toContain('click');
    expect(removedEvents).toContain('scroll');
    expect(removedEvents).toContain('touchstart');
  });

  it('fires onReturn only once per idle cycle', () => {
    const onReturn = vi.fn();
    renderHook(() => useIdleTimer({ timeout: 500, onReturn }));

    // Become idle
    act(() => { vi.advanceTimersByTime(500); });

    // Multiple interactions
    act(() => { window.dispatchEvent(new Event('mousemove')); });
    act(() => { window.dispatchEvent(new Event('click')); });
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it('handles click and scroll events', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimer({ timeout: 1000, onIdle }));

    act(() => { vi.advanceTimersByTime(800); });
    act(() => { window.dispatchEvent(new Event('click')); });

    act(() => { vi.advanceTimersByTime(800); });
    act(() => { window.dispatchEvent(new Event('scroll')); });

    act(() => { vi.advanceTimersByTime(800); });
    expect(onIdle).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(200); });
    expect(onIdle).toHaveBeenCalledOnce();
  });
});

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
