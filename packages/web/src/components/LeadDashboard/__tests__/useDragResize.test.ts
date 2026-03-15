import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDragResize } from '../useDragResize';

function fireMouseEvent(type: string, props: Partial<MouseEvent> = {}) {
  const event = new MouseEvent(type, { bubbles: true, ...props });
  document.dispatchEvent(event);
  return event;
}

describe('useDragResize', () => {
  afterEach(() => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  it('returns a startResize function', () => {
    const setValue = vi.fn();
    const { result } = renderHook(() => useDragResize('x', 200, setValue, 100, 500));
    expect(typeof result.current).toBe('function');
  });

  it('sets col-resize cursor on mousedown for x axis', () => {
    const setValue = vi.fn();
    const { result } = renderHook(() => useDragResize('x', 200, setValue, 100, 500));
    act(() => {
      result.current({ preventDefault: vi.fn(), clientX: 100, clientY: 100 } as unknown as React.MouseEvent);
    });
    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.style.userSelect).toBe('none');
    fireMouseEvent('mouseup');
  });

  it('sets row-resize cursor for y axis', () => {
    const setValue = vi.fn();
    const { result } = renderHook(() => useDragResize('y', 200, setValue, 100, 500));
    act(() => {
      result.current({ preventDefault: vi.fn(), clientX: 100, clientY: 100 } as unknown as React.MouseEvent);
    });
    expect(document.body.style.cursor).toBe('row-resize');
    fireMouseEvent('mouseup');
  });

  it('calls setValue during mousemove for x-axis', () => {
    const setValue = vi.fn();
    const { result } = renderHook(() => useDragResize('x', 200, setValue, 100, 500));
    act(() => {
      result.current({ preventDefault: vi.fn(), clientX: 100, clientY: 0 } as unknown as React.MouseEvent);
    });
    act(() => { fireMouseEvent('mousemove', { clientX: 150, clientY: 0 }); });
    expect(setValue).toHaveBeenCalledWith(250);
    act(() => { fireMouseEvent('mousemove', { clientX: 50, clientY: 0 }); });
    expect(setValue).toHaveBeenCalledWith(150);
    fireMouseEvent('mouseup');
  });

  it('calls setValue during mousemove for y-axis', () => {
    const setValue = vi.fn();
    const { result } = renderHook(() => useDragResize('y', 300, setValue, 100, 600));
    act(() => {
      result.current({ preventDefault: vi.fn(), clientX: 0, clientY: 200 } as unknown as React.MouseEvent);
    });
    act(() => { fireMouseEvent('mousemove', { clientX: 0, clientY: 300 }); });
    expect(setValue).toHaveBeenCalledWith(400);
    fireMouseEvent('mouseup');
  });

  it('clamps to min and max', () => {
    const setValue = vi.fn();
    const { result } = renderHook(() => useDragResize('x', 200, setValue, 100, 300));
    act(() => {
      result.current({ preventDefault: vi.fn(), clientX: 100, clientY: 0 } as unknown as React.MouseEvent);
    });
    act(() => { fireMouseEvent('mousemove', { clientX: 500, clientY: 0 }); });
    expect(setValue).toHaveBeenCalledWith(300);
    act(() => { fireMouseEvent('mousemove', { clientX: -200, clientY: 0 }); });
    expect(setValue).toHaveBeenCalledWith(100);
    fireMouseEvent('mouseup');
  });

  it('inverts delta when invert is true', () => {
    const setValue = vi.fn();
    const { result } = renderHook(() => useDragResize('x', 200, setValue, 100, 500, true));
    act(() => {
      result.current({ preventDefault: vi.fn(), clientX: 100, clientY: 0 } as unknown as React.MouseEvent);
    });
    act(() => { fireMouseEvent('mousemove', { clientX: 150, clientY: 0 }); });
    expect(setValue).toHaveBeenCalledWith(150);
    fireMouseEvent('mouseup');
  });

  it('cleans up on mouseup', () => {
    const setValue = vi.fn();
    const { result } = renderHook(() => useDragResize('x', 200, setValue, 100, 500));
    act(() => {
      result.current({ preventDefault: vi.fn(), clientX: 100, clientY: 0 } as unknown as React.MouseEvent);
    });
    act(() => { fireMouseEvent('mouseup'); });
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
    setValue.mockClear();
    act(() => { fireMouseEvent('mousemove', { clientX: 200, clientY: 0 }); });
    expect(setValue).not.toHaveBeenCalled();
  });
});
