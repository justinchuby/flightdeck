import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { shouldAutoScroll, useAutoScroll } from '../useAutoScroll';

describe('shouldAutoScroll', () => {
  it('always scrolls on initial render regardless of position', () => {
    expect(shouldAutoScroll({
      scrollHeight: 5000, scrollTop: 0, clientHeight: 500, isInitialRender: true,
    })).toBe(true);
  });

  it('scrolls on initial render even when far from bottom', () => {
    expect(shouldAutoScroll({
      scrollHeight: 10000, scrollTop: 0, clientHeight: 800, isInitialRender: true,
    })).toBe(true);
  });

  it('scrolls when near bottom (within threshold)', () => {
    expect(shouldAutoScroll({
      scrollHeight: 1000, scrollTop: 860, clientHeight: 100, isInitialRender: false,
    })).toBe(true);
  });

  it('does NOT scroll when far from bottom after initial render', () => {
    expect(shouldAutoScroll({
      scrollHeight: 5000, scrollTop: 0, clientHeight: 500, isInitialRender: false,
    })).toBe(false);
  });

  it('respects custom threshold', () => {
    expect(shouldAutoScroll({
      scrollHeight: 1000, scrollTop: 700, clientHeight: 200, isInitialRender: false, threshold: 50,
    })).toBe(false);
  });

  it('scrolls with custom threshold when within range', () => {
    expect(shouldAutoScroll({
      scrollHeight: 1000, scrollTop: 770, clientHeight: 200, isInitialRender: false, threshold: 50,
    })).toBe(true);
  });

  it('scrolls when exactly at bottom', () => {
    expect(shouldAutoScroll({
      scrollHeight: 1000, scrollTop: 500, clientHeight: 500, isInitialRender: false,
    })).toBe(true);
  });

  it('default threshold is 150', () => {
    expect(shouldAutoScroll({
      scrollHeight: 1000, scrollTop: 750, clientHeight: 100, isInitialRender: false,
    })).toBe(false);
    expect(shouldAutoScroll({
      scrollHeight: 1000, scrollTop: 751, clientHeight: 100, isInitialRender: false,
    })).toBe(true);
  });
});

describe('useAutoScroll', () => {
  const scrollIntoViewMock = vi.fn();

  function makeRef<T>(value: T) {
    return { current: value };
  }

  function makeContainerRef(overrides: Partial<HTMLElement> = {}) {
    return makeRef({
      scrollHeight: 2000, scrollTop: 1800, clientHeight: 200,
      ...overrides,
    } as unknown as HTMLElement);
  }

  function makeEndMarkerRef() {
    return makeRef({ scrollIntoView: scrollIntoViewMock } as unknown as HTMLElement);
  }

  beforeEach(() => { scrollIntoViewMock.mockClear(); });

  it('scrolls unconditionally on first render', () => {
    const containerRef = makeContainerRef();
    const endMarkerRef = makeEndMarkerRef();
    renderHook(() => useAutoScroll(containerRef, endMarkerRef, ['dep1']));
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });

  it('scrolls when near bottom after initial render', () => {
    const containerRef = makeContainerRef({ scrollHeight: 2000, scrollTop: 1800, clientHeight: 200 } as Partial<HTMLElement>);
    const endMarkerRef = makeEndMarkerRef();
    const { rerender } = renderHook(
      ({ deps }) => useAutoScroll(containerRef, endMarkerRef, deps),
      { initialProps: { deps: ['a'] } },
    );
    scrollIntoViewMock.mockClear();
    rerender({ deps: ['b'] });
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth' });
  });

  it('does NOT scroll when far from bottom after initial render', () => {
    const containerRef = makeContainerRef({ scrollHeight: 5000, scrollTop: 0, clientHeight: 500 } as Partial<HTMLElement>);
    const endMarkerRef = makeEndMarkerRef();
    const { rerender } = renderHook(
      ({ deps }) => useAutoScroll(containerRef, endMarkerRef, deps),
      { initialProps: { deps: ['a'] } },
    );
    scrollIntoViewMock.mockClear();
    rerender({ deps: ['b'] });
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('resets to initial-scroll mode when resetKey changes', () => {
    const containerRef = makeContainerRef({ scrollHeight: 5000, scrollTop: 0, clientHeight: 500 } as Partial<HTMLElement>);
    const endMarkerRef = makeEndMarkerRef();
    const { rerender } = renderHook(
      ({ deps, resetKey }) => useAutoScroll(containerRef, endMarkerRef, deps, { resetKey }),
      { initialProps: { deps: ['a'], resetKey: 'key1' as unknown } },
    );
    scrollIntoViewMock.mockClear();
    rerender({ deps: ['b'], resetKey: 'key2' });
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it('handles null container ref gracefully', () => {
    const containerRef = makeRef(null);
    const endMarkerRef = makeEndMarkerRef();
    renderHook(() => useAutoScroll(containerRef, endMarkerRef, ['dep']));
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('handles null end-marker ref on initial render', () => {
    const containerRef = makeContainerRef();
    const endMarkerRef = makeRef(null);
    renderHook(() => useAutoScroll(containerRef, endMarkerRef, ['dep']));
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });
});
