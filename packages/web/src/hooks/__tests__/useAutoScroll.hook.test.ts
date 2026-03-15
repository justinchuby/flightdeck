import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAutoScroll } from '../useAutoScroll';

describe('useAutoScroll hook', () => {
  function makeRefs(containerProps?: Partial<{ scrollHeight: number; scrollTop: number; clientHeight: number }>) {
    const scrollIntoView = vi.fn();
    const containerRef = {
      current: containerProps
        ? { scrollHeight: 2000, scrollTop: 1800, clientHeight: 200, ...containerProps }
        : null,
    };
    const endMarkerRef = { current: { scrollIntoView } };
    return { containerRef, endMarkerRef, scrollIntoView };
  }

  it('scrolls to end marker on first render', () => {
    const { containerRef, endMarkerRef, scrollIntoView } = makeRefs({});
    renderHook(() => useAutoScroll(containerRef as never, endMarkerRef as never, ['dep1']));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith();
  });

  it('scrolls smoothly when near bottom after initial render', () => {
    const { containerRef, endMarkerRef, scrollIntoView } = makeRefs({ scrollTop: 1850 });
    const { rerender } = renderHook(
      ({ deps }) => useAutoScroll(containerRef as never, endMarkerRef as never, deps),
      { initialProps: { deps: ['dep1'] } },
    );
    scrollIntoView.mockClear();
    rerender({ deps: ['dep2'] });
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' });
  });

  it('does NOT scroll when far from bottom', () => {
    const { containerRef, endMarkerRef, scrollIntoView } = makeRefs({ scrollTop: 1000 });
    const { rerender } = renderHook(
      ({ deps }) => useAutoScroll(containerRef as never, endMarkerRef as never, deps),
      { initialProps: { deps: ['dep1'] } },
    );
    scrollIntoView.mockClear();
    rerender({ deps: ['dep2'] });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('scrolls after resetKey changes', () => {
    const { containerRef, endMarkerRef, scrollIntoView } = makeRefs({ scrollTop: 1000 });
    const { rerender } = renderHook(
      ({ deps, resetKey }: { deps: unknown[]; resetKey: unknown }) =>
        useAutoScroll(containerRef as never, endMarkerRef as never, deps, { resetKey }),
      { initialProps: { deps: ['dep1'] as unknown[], resetKey: 'a' as unknown } },
    );
    scrollIntoView.mockClear();
    rerender({ deps: ['dep2'], resetKey: 'b' });
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('handles null container ref gracefully', () => {
    const { containerRef, endMarkerRef } = makeRefs();
    expect(() => {
      renderHook(() => useAutoScroll(containerRef as never, endMarkerRef as never, ['dep1']));
    }).not.toThrow();
  });

  it('handles null endMarker ref gracefully', () => {
    const containerRef = { current: { scrollHeight: 2000, scrollTop: 1800, clientHeight: 200 } };
    const endMarkerRef = { current: null };
    expect(() => {
      renderHook(() => useAutoScroll(containerRef as never, endMarkerRef as never, ['dep1']));
    }).not.toThrow();
  });

  it('respects custom threshold', () => {
    const { containerRef, endMarkerRef, scrollIntoView } = makeRefs({ scrollTop: 1700 });
    const { rerender } = renderHook(
      ({ deps }) => useAutoScroll(containerRef as never, endMarkerRef as never, deps, { threshold: 50 }),
      { initialProps: { deps: ['dep1'] } },
    );
    scrollIntoView.mockClear();
    rerender({ deps: ['dep2'] });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
