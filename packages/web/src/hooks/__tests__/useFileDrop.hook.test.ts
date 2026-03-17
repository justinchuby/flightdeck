import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFileDrop, generateThumbnail } from '../useFileDrop';

describe('useFileDrop hook', () => {
  const onAttach = vi.fn();

  function makeDragEvent(overrides: Record<string, unknown> = {}): React.DragEvent {
    return {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { dropEffect: '', files: [] },
      ...overrides,
    } as unknown as React.DragEvent;
  }

  beforeEach(() => { vi.clearAllMocks(); });

  it('returns isDragOver=false initially', () => {
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    expect(result.current.isDragOver).toBe(false);
    expect(result.current.dropZoneClassName).toBe('');
  });

  it('handleDragOver prevents default and sets dropEffect', () => {
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    const e = makeDragEvent();
    act(() => { result.current.handleDragOver(e); });
    expect(e.preventDefault).toHaveBeenCalled();
    expect((e.dataTransfer as { dropEffect: string }).dropEffect).toBe('copy');
  });

  it('handleDragOver sets isDragOver=true', () => {
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    act(() => { result.current.handleDragOver(makeDragEvent()); });
    expect(result.current.isDragOver).toBe(true);
    expect(result.current.dropZoneClassName).toContain('ring-2');
  });

  it('handleDragLeave sets isDragOver=false', () => {
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    act(() => { result.current.handleDragOver(makeDragEvent()); });
    expect(result.current.isDragOver).toBe(true);
    act(() => { result.current.handleDragLeave(makeDragEvent()); });
    expect(result.current.isDragOver).toBe(false);
  });

  it('nested drag enter/leave manages counter', () => {
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    act(() => { result.current.handleDragOver(makeDragEvent()); });
    act(() => { result.current.handleDragOver(makeDragEvent()); });
    expect(result.current.isDragOver).toBe(true);
    act(() => { result.current.handleDragLeave(makeDragEvent()); });
    expect(result.current.isDragOver).toBe(true);
    act(() => { result.current.handleDragLeave(makeDragEvent()); });
    expect(result.current.isDragOver).toBe(false);
  });

  it('handleDrop resets isDragOver', () => {
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    act(() => { result.current.handleDragOver(makeDragEvent()); });
    const dropEvent = makeDragEvent({ dataTransfer: { files: [], dropEffect: '' } });
    act(() => { result.current.handleDrop(dropEvent); });
    expect(result.current.isDragOver).toBe(false);
  });

  it('handleDrop processes code files', async () => {
    const file = new File(['console.log("hi")'], 'test.ts', { type: 'text/typescript' });
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    const dropEvent = makeDragEvent({ dataTransfer: { files: [file], dropEffect: '' } });
    await act(async () => { result.current.handleDrop(dropEvent); });
    expect(onAttach).toHaveBeenCalledWith(expect.objectContaining({ kind: 'file', name: 'test.ts' }));
  });

  it('handlePaste extracts files from clipboard', async () => {
    const file = new File(['data'], 'code.py', { type: 'text/python' });
    const clipEvent = {
      preventDefault: vi.fn(),
      clipboardData: { items: [{ kind: 'file', getAsFile: () => file }] },
    } as unknown as React.ClipboardEvent;
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    await act(async () => { result.current.handlePaste(clipEvent); });
    expect(onAttach).toHaveBeenCalledWith(expect.objectContaining({ name: 'code.py' }));
  });

  it('does nothing when enabled=false', () => {
    const { result } = renderHook(() => useFileDrop({ onAttach, enabled: false }));
    const e = makeDragEvent();
    act(() => { result.current.handleDragOver(e); });
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(result.current.isDragOver).toBe(false);
  });

  it('skips images over MAX_IMAGE_SIZE', async () => {
    const largeFile = new File(['x'], 'huge.png', { type: 'image/png' });
    Object.defineProperty(largeFile, 'size', { value: 11 * 1024 * 1024 });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    await act(async () => {
      result.current.handleDrop(makeDragEvent({ dataTransfer: { files: [largeFile], dropEffect: '' } }));
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('exceeds 10MB'));
    expect(onAttach).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('generateThumbnail', () => {
  it('resolves undefined in non-browser environment', async () => {
    const origDoc = globalThis.document;
    // @ts-expect-error simulate non-browser
    delete globalThis.document;
    const result = await generateThumbnail(new File(['x'], 'test.png'));
    expect(result).toBeUndefined();
    globalThis.document = origDoc;
  });
});
