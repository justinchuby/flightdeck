// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGlassTooltips } from '../useGlassTooltips';

describe('useGlassTooltips — right-edge clamping (lines 59-60)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('clamps tooltip left when it overflows the right edge of the viewport', () => {
    // Set viewport width to 400
    Object.defineProperty(window, 'innerWidth', { value: 400, writable: true });

    renderHook(() => useGlassTooltips());

    const el = document.createElement('div');
    el.setAttribute('title', 'Right overflow tooltip');
    el.getBoundingClientRect = () => ({
      top: 100, left: 350, bottom: 120, right: 450,
      width: 100, height: 20, x: 350, y: 100, toJSON: () => {},
    });
    document.body.appendChild(el);

    // Trigger mouseenter
    const enterEvent = new MouseEvent('mouseenter', { bubbles: true });
    Object.defineProperty(enterEvent, 'target', { value: el });
    document.dispatchEvent(enterEvent);

    // Advance exactly to fire the 400ms delay but use advanceTimersToNextTimer
    // to control each timer step
    act(() => { vi.advanceTimersToNextTimer(); }); // fires the 400ms setTimeout → show()

    // Now the tooltip element exists and show() has been called.
    // show() scheduled a requestAnimationFrame.
    const tooltip = document.querySelector('.glass-tooltip') as HTMLDivElement;
    expect(tooltip).toBeTruthy();

    // Mock getBoundingClientRect BEFORE the rAF fires
    tooltip.getBoundingClientRect = () => ({
      top: 80, left: 350, bottom: 100, right: 500,
      width: 150, height: 20, x: 350, y: 80, toJSON: () => {},
    });

    // Fire the requestAnimationFrame callback
    act(() => { vi.advanceTimersToNextTimer(); });

    // After clamping: left -= (tr.right - (vw - 8)) = 500 - 392 = 108
    // Original left was 400, so new left = 400 - 108 = 292
    const leftVal = parseFloat(tooltip.style.left);
    expect(leftVal).toBe(292);
    expect(tooltip.style.opacity).toBe('1');
  });
});
