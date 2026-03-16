import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGlassTooltips } from '../useGlassTooltips';

describe('useGlassTooltips', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('registers event listeners on mount', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    renderHook(() => useGlassTooltips());
    const events = addSpy.mock.calls.map(c => c[0]);
    expect(events).toContain('mouseenter');
    expect(events).toContain('mouseleave');
    expect(events).toContain('scroll');
    addSpy.mockRestore();
  });

  it('removes event listeners on unmount', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useGlassTooltips());
    unmount();
    const events = removeSpy.mock.calls.map(c => c[0]);
    expect(events).toContain('mouseenter');
    expect(events).toContain('mouseleave');
    expect(events).toContain('scroll');
    removeSpy.mockRestore();
  });

  it('converts title to data-glass-title on mouseenter', () => {
    renderHook(() => useGlassTooltips());
    const el = document.createElement('div');
    el.setAttribute('title', 'Hello tooltip');
    document.body.appendChild(el);

    // Simulate mouseenter (captured)
    const event = new MouseEvent('mouseenter', { bubbles: true });
    Object.defineProperty(event, 'target', { value: el });
    document.dispatchEvent(event);

    expect(el.getAttribute('data-glass-title')).toBe('Hello tooltip');
    expect(el.hasAttribute('title')).toBe(false);
  });

  it('shows tooltip after delay', () => {
    renderHook(() => useGlassTooltips());
    const el = document.createElement('div');
    el.setAttribute('title', 'Delayed tip');
    el.getBoundingClientRect = () => ({ top: 100, left: 100, bottom: 120, right: 200, width: 100, height: 20, x: 100, y: 100, toJSON: () => {} });
    document.body.appendChild(el);

    const event = new MouseEvent('mouseenter', { bubbles: true });
    Object.defineProperty(event, 'target', { value: el });
    document.dispatchEvent(event);

    // Before delay — no tooltip visible
    let tooltip = document.querySelector('.glass-tooltip');
    if (tooltip) {
      expect((tooltip as HTMLElement).style.opacity).toBe('0');
    }

    // Advance past the 400ms delay
    act(() => { vi.advanceTimersByTime(500); });

    tooltip = document.querySelector('.glass-tooltip');
    expect(tooltip).toBeTruthy();
    expect((tooltip as HTMLElement).style.opacity).toBe('1');
  });

  it('hides tooltip on mouseleave', () => {
    renderHook(() => useGlassTooltips());
    const el = document.createElement('div');
    el.setAttribute('title', 'Temp');
    el.getBoundingClientRect = () => ({ top: 100, left: 100, bottom: 120, right: 200, width: 100, height: 20, x: 100, y: 100, toJSON: () => {} });
    document.body.appendChild(el);

    // Enter
    const enterEvent = new MouseEvent('mouseenter', { bubbles: true });
    Object.defineProperty(enterEvent, 'target', { value: el });
    document.dispatchEvent(enterEvent);
    act(() => { vi.advanceTimersByTime(500); });

    // Leave
    // The element now has data-glass-title, so closest('[data-glass-title]') should find it
    const leaveEvent = new MouseEvent('mouseleave', { bubbles: true });
    Object.defineProperty(leaveEvent, 'target', { value: el });
    document.dispatchEvent(leaveEvent);

    const tooltip = document.querySelector('.glass-tooltip');
    if (tooltip) {
      expect((tooltip as HTMLElement).style.opacity).toBe('0');
    }
    // title restored
    expect(el.getAttribute('title')).toBeTruthy();
  });

  it('hides tooltip on scroll', () => {
    renderHook(() => useGlassTooltips());
    const el = document.createElement('div');
    el.setAttribute('title', 'Scrollable');
    el.getBoundingClientRect = () => ({ top: 100, left: 100, bottom: 120, right: 200, width: 100, height: 20, x: 100, y: 100, toJSON: () => {} });
    document.body.appendChild(el);

    const enterEvent = new MouseEvent('mouseenter', { bubbles: true });
    Object.defineProperty(enterEvent, 'target', { value: el });
    document.dispatchEvent(enterEvent);
    act(() => { vi.advanceTimersByTime(500); });

    // Scroll
    document.dispatchEvent(new Event('scroll'));

    const tooltip = document.querySelector('.glass-tooltip');
    if (tooltip) {
      expect((tooltip as HTMLElement).style.opacity).toBe('0');
    }
  });
});

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
