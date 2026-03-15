import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpotlight } from '../useSpotlight';

describe('useSpotlight', () => {
  let addSpy: ReturnType<typeof vi.spyOn>;
  let removeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    addSpy = vi.spyOn(window, 'addEventListener');
    removeSpy = vi.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when selector is null', () => {
    const { result } = renderHook(() => useSpotlight(null));
    expect(result.current).toBeNull();
  });

  it('returns null when element is not found', () => {
    vi.spyOn(document, 'querySelector').mockReturnValue(null);
    const { result } = renderHook(() => useSpotlight('.nonexistent'));
    expect(result.current).toBeNull();
  });

  it('returns padded rect for a matched element', () => {
    const mockRect = { top: 100, left: 200, width: 300, height: 50 } as DOMRect;
    const mockEl = { getBoundingClientRect: () => mockRect } as Element;
    vi.spyOn(document, 'querySelector').mockReturnValue(mockEl);

    const { result } = renderHook(() => useSpotlight('.target'));

    expect(result.current).toEqual({
      top: 92,    // 100 - 8
      left: 192,  // 200 - 8
      width: 316, // 300 + 16
      height: 66, // 50 + 16
    });
  });

  it('registers resize and scroll event listeners', () => {
    vi.spyOn(document, 'querySelector').mockReturnValue(null);
    renderHook(() => useSpotlight('.target'));

    const resizeCalls = addSpy.mock.calls.filter(([e]) => e === 'resize');
    const scrollCalls = addSpy.mock.calls.filter(([e]) => e === 'scroll');
    expect(resizeCalls.length).toBeGreaterThanOrEqual(1);
    expect(scrollCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('removes listeners on unmount', () => {
    vi.spyOn(document, 'querySelector').mockReturnValue(null);
    const { unmount } = renderHook(() => useSpotlight('.target'));

    unmount();

    const resizeRemoved = removeSpy.mock.calls.filter(([e]) => e === 'resize');
    const scrollRemoved = removeSpy.mock.calls.filter(([e]) => e === 'scroll');
    expect(resizeRemoved.length).toBeGreaterThanOrEqual(1);
    expect(scrollRemoved.length).toBeGreaterThanOrEqual(1);
  });

  it('re-measures on resize event', () => {
    const mockRect = { top: 10, left: 20, width: 30, height: 40 } as DOMRect;
    const mockEl = { getBoundingClientRect: vi.fn().mockReturnValue(mockRect) } as unknown as Element;
    vi.spyOn(document, 'querySelector').mockReturnValue(mockEl);

    const { result } = renderHook(() => useSpotlight('.target'));
    expect(result.current).not.toBeNull();

    // Update rect and trigger resize
    const updatedRect = { top: 50, left: 60, width: 70, height: 80 } as DOMRect;
    (mockEl.getBoundingClientRect as ReturnType<typeof vi.fn>).mockReturnValue(updatedRect);

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(result.current).toEqual({
      top: 42,   // 50 - 8
      left: 52,  // 60 - 8
      width: 86, // 70 + 16
      height: 96, // 80 + 16
    });
  });
});
