import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { classifyFileExtension, MAX_IMAGE_SIZE, useFileDrop } from '../useFileDrop';

describe('classifyFileExtension', () => {
  it('classifies image extensions', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico']) {
      expect(classifyFileExtension(`file.${ext}`)).toBe('image');
    }
  });

  it('classifies code extensions', () => {
    for (const ext of ['ts', 'tsx', 'js', 'py', 'go', 'rs', 'css', 'json', 'yaml', 'md', 'txt', 'sh', 'sql']) {
      expect(classifyFileExtension(`file.${ext}`)).toBe('code');
    }
  });

  it('returns unknown for no extension', () => {
    expect(classifyFileExtension('Makefile')).toBe('unknown');
  });

  it('returns unknown for unrecognized extensions', () => {
    expect(classifyFileExtension('a.zip')).toBe('unknown');
    expect(classifyFileExtension('b.exe')).toBe('unknown');
  });

  it('is case-insensitive', () => {
    expect(classifyFileExtension('Photo.PNG')).toBe('image');
    expect(classifyFileExtension('App.TSX')).toBe('code');
  });

  it('classifies additional code extensions', () => {
    for (const ext of ['mjs', 'cjs', 'vue', 'svelte', 'graphql', 'java', 'swift']) {
      expect(classifyFileExtension(`f.${ext}`)).toBe('code');
    }
  });
});

describe('MAX_IMAGE_SIZE', () => {
  it('is 10 MB', () => { expect(MAX_IMAGE_SIZE).toBe(10 * 1024 * 1024); });
});

function makeDragEvent(overrides: Partial<React.DragEvent> = {}): React.DragEvent {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: { dropEffect: '', files: [] as unknown as FileList },
    ...overrides,
  } as unknown as React.DragEvent;
}

function makeClipboardEvent(files: File[] = []): React.ClipboardEvent {
  const items = files.map((f) => ({ kind: 'file' as const, getAsFile: () => f }));
  return {
    preventDefault: vi.fn(),
    clipboardData: { items: items as unknown as DataTransferItemList },
  } as unknown as React.ClipboardEvent;
}

describe('useFileDrop hook', () => {
  it('returns initial state with isDragOver false', () => {
    const { result } = renderHook(() => useFileDrop({ onAttach: vi.fn() }));
    expect(result.current.isDragOver).toBe(false);
    expect(result.current.dropZoneClassName).toBe('');
  });

  it('handleDragOver sets drag state', () => {
    const { result } = renderHook(() => useFileDrop({ onAttach: vi.fn() }));
    const e = makeDragEvent();
    act(() => { result.current.handleDragOver(e); });
    expect(e.preventDefault).toHaveBeenCalled();
    expect(result.current.isDragOver).toBe(true);
    expect(result.current.dropZoneClassName).toContain('ring-2');
  });

  it('handleDragLeave clears drag state', () => {
    const { result } = renderHook(() => useFileDrop({ onAttach: vi.fn() }));
    act(() => { result.current.handleDragOver(makeDragEvent()); });
    act(() => { result.current.handleDragLeave(makeDragEvent()); });
    expect(result.current.isDragOver).toBe(false);
  });

  it('handleDrop resets state', () => {
    const { result } = renderHook(() => useFileDrop({ onAttach: vi.fn() }));
    act(() => { result.current.handleDragOver(makeDragEvent()); });
    const de = makeDragEvent({ dataTransfer: { dropEffect: '', files: [] as unknown as FileList } as DataTransfer });
    act(() => { result.current.handleDrop(de); });
    expect(result.current.isDragOver).toBe(false);
  });

  it('handleDrop calls onAttach for code file', async () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    const file = new File(['x'], 'script.ts', { type: 'text/typescript' });
    const de = makeDragEvent({ dataTransfer: { dropEffect: '', files: [file] as unknown as FileList } as unknown as DataTransfer });
    act(() => { result.current.handleDrop(de); });
    await vi.waitFor(() => expect(onAttach).toHaveBeenCalledTimes(1));
    expect(onAttach.mock.calls[0][0]).toMatchObject({ kind: 'file', name: 'script.ts' });
  });

  it('does nothing when disabled', () => {
    const { result } = renderHook(() => useFileDrop({ onAttach: vi.fn(), enabled: false }));
    const e = makeDragEvent();
    act(() => { result.current.handleDragOver(e); });
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(result.current.isDragOver).toBe(false);
  });

  it('handlePaste processes clipboard files', async () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    const pe = makeClipboardEvent([new File(['d'], 'notes.txt', { type: 'text/plain' })]);
    act(() => { result.current.handlePaste(pe); });
    await vi.waitFor(() => expect(onAttach).toHaveBeenCalledTimes(1));
    expect(pe.preventDefault).toHaveBeenCalled();
  });

  it('handlePaste ignores empty clipboard', () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    const pe = makeClipboardEvent([]);
    act(() => { result.current.handlePaste(pe); });
    expect(onAttach).not.toHaveBeenCalled();
  });

  it('handlePaste no-op when disabled', () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach, enabled: false }));
    act(() => { result.current.handlePaste(makeClipboardEvent([new File(['x'], 'a.png')])); });
    expect(onAttach).not.toHaveBeenCalled();
  });
});
