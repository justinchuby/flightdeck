import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCommandPalette } from '../useCommandPalette';

describe('useCommandPalette', () => {
  it('starts closed', () => {
    const { result } = renderHook(() => useCommandPalette());
    expect(result.current.isOpen).toBe(false);
  });

  it('open() sets isOpen to true', () => {
    const { result } = renderHook(() => useCommandPalette());

    act(() => { result.current.open(); });
    expect(result.current.isOpen).toBe(true);
  });

  it('close() sets isOpen to false', () => {
    const { result } = renderHook(() => useCommandPalette());

    act(() => { result.current.open(); });
    expect(result.current.isOpen).toBe(true);

    act(() => { result.current.close(); });
    expect(result.current.isOpen).toBe(false);
  });

  it('toggle() toggles the state', () => {
    const { result } = renderHook(() => useCommandPalette());

    act(() => { result.current.toggle(); });
    expect(result.current.isOpen).toBe(true);

    act(() => { result.current.toggle(); });
    expect(result.current.isOpen).toBe(false);
  });

  it('Cmd+K toggles open', () => {
    const { result } = renderHook(() => useCommandPalette());

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    });
    expect(result.current.isOpen).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    });
    expect(result.current.isOpen).toBe(false);
  });

  it('Ctrl+K toggles open', () => {
    const { result } = renderHook(() => useCommandPalette());

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    });
    expect(result.current.isOpen).toBe(true);
  });

  it('plain K key does not toggle', () => {
    const { result } = renderHook(() => useCommandPalette());

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));
    });
    expect(result.current.isOpen).toBe(false);
  });

  it('removes keydown listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useCommandPalette());

    unmount();

    const removedEvents = removeSpy.mock.calls.map(([e]) => e);
    expect(removedEvents).toContain('keydown');
    removeSpy.mockRestore();
  });
});
