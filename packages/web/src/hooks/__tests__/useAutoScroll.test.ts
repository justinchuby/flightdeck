import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { shouldAutoScroll, useAutoScroll } from '../useAutoScroll';

describe('shouldAutoScroll', () => {
  it('always scrolls on initial render', () => {
    expect(shouldAutoScroll({ scrollHeight: 5000, scrollTop: 0, clientHeight: 500, isInitialRender: true })).toBe(true);
  });

  it('scrolls when near bottom', () => {
    expect(shouldAutoScroll({ scrollHeight: 1000, scrollTop: 860, clientHeight: 100, isInitialRender: false })).toBe(true);
  });

  it('does NOT scroll when far from bottom', () => {
    expect(shouldAutoScroll({ scrollHeight: 5000, scrollTop: 0, clientHeight: 500, isInitialRender: false })).toBe(false);
  });

  it('respects custom threshold', () => {
    expect(shouldAutoScroll({ scrollHeight: 1000, scrollTop: 700, clientHeight: 200, isInitialRender: false, threshold: 50 })).toBe(false);
    expect(shouldAutoScroll({ scrollHeight: 1000, scrollTop: 770, clientHeight: 200, isInitialRender: false, threshold: 50 })).toBe(true);
  });

  it('scrolls when exactly at bottom', () => {
    expect(shouldAutoScroll({ scrollHeight: 1000, scrollTop: 500, clientHeight: 500, isInitialRender: false })).toBe(true);
  });

  it('default threshold is 150', () => {
    expect(shouldAutoScroll({ scrollHeight: 1000, scrollTop: 750, clientHeight: 100, isInitialRender: false })).toBe(false);
    expect(shouldAutoScroll({ scrollHeight: 1000, scrollTop: 751, clientHeight: 100, isInitialRender: false })).toBe(true);
  });
});

describe('useAutoScroll', () => {
  const scrollIntoViewMock = vi.fn();
  function makeRef<T>(v: T) { return { current: v }; }
  function makeContainer(o: Partial<HTMLElement> = {}) {
    return makeRef({ scrollHeight: 2000, scrollTop: 1800, clientHeight: 200, ...o } as unknown as HTMLElement);
  }
  function makeMarker() { return makeRef({ scrollIntoView: scrollIntoViewMock } as unknown as HTMLElement); }

  beforeEach(() => { scrollIntoViewMock.mockClear(); });

  it('scrolls unconditionally on first render', () => {
    renderHook(() => useAutoScroll(makeContainer(), makeMarker(), ['dep1']));
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });

  it('scrolls when near bottom after initial render', () => {
    const c = makeContainer({ scrollHeight: 2000, scrollTop: 1800, clientHeight: 200 } as Partial<HTMLElement>);
    const m = makeMarker();
    const { rerender } = renderHook(({ deps }) => useAutoScroll(c, m, deps), { initialProps: { deps: ['a'] } });
    scrollIntoViewMock.mockClear();
    rerender({ deps: ['b'] });
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth' });
  });

  it('does NOT scroll when far from bottom after initial render', () => {
    const c = makeContainer({ scrollHeight: 5000, scrollTop: 0, clientHeight: 500 } as Partial<HTMLElement>);
    const m = makeMarker();
    const { rerender } = renderHook(({ deps }) => useAutoScroll(c, m, deps), { initialProps: { deps: ['a'] } });
    scrollIntoViewMock.mockClear();
    rerender({ deps: ['b'] });
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('resets to initial-scroll mode when resetKey changes', () => {
    const c = makeContainer({ scrollHeight: 5000, scrollTop: 0, clientHeight: 500 } as Partial<HTMLElement>);
    const m = makeMarker();
    const { rerender } = renderHook(
      ({ deps, resetKey }) => useAutoScroll(c, m, deps, { resetKey }),
      { initialProps: { deps: ['a'], resetKey: 'k1' as unknown } },
    );
    scrollIntoViewMock.mockClear();
    rerender({ deps: ['b'], resetKey: 'k2' });
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it('handles null container ref gracefully', () => {
    renderHook(() => useAutoScroll(makeRef(null), makeMarker(), ['dep']));
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('handles null end-marker ref', () => {
    renderHook(() => useAutoScroll(makeContainer(), makeRef(null), ['dep']));
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });
});
