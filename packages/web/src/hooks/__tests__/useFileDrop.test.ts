import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { classifyFileExtension, MAX_IMAGE_SIZE, useFileDrop } from '../useFileDrop';

describe('classifyFileExtension', () => {
  it('classifies common image extensions', () => {
    expect(classifyFileExtension('photo.png')).toBe('image');
    expect(classifyFileExtension('photo.jpg')).toBe('image');
    expect(classifyFileExtension('photo.jpeg')).toBe('image');
    expect(classifyFileExtension('photo.gif')).toBe('image');
    expect(classifyFileExtension('icon.svg')).toBe('image');
    expect(classifyFileExtension('photo.webp')).toBe('image');
  });

  it('classifies common code/text extensions', () => {
    expect(classifyFileExtension('app.ts')).toBe('code');
    expect(classifyFileExtension('app.tsx')).toBe('code');
    expect(classifyFileExtension('index.js')).toBe('code');
    expect(classifyFileExtension('main.py')).toBe('code');
    expect(classifyFileExtension('main.go')).toBe('code');
    expect(classifyFileExtension('style.css')).toBe('code');
    expect(classifyFileExtension('config.json')).toBe('code');
    expect(classifyFileExtension('config.yaml')).toBe('code');
    expect(classifyFileExtension('readme.md')).toBe('code');
    expect(classifyFileExtension('notes.txt')).toBe('code');
    expect(classifyFileExtension('data.csv')).toBe('code');
    expect(classifyFileExtension('build.sh')).toBe('code');
    expect(classifyFileExtension('query.sql')).toBe('code');
  });

  it('returns unknown for files without extensions', () => {
    expect(classifyFileExtension('Makefile')).toBe('unknown');
    expect(classifyFileExtension('LICENSE')).toBe('unknown');
  });

  it('returns unknown for unrecognized extensions', () => {
    expect(classifyFileExtension('archive.zip')).toBe('unknown');
    expect(classifyFileExtension('binary.exe')).toBe('unknown');
    expect(classifyFileExtension('document.pdf')).toBe('unknown');
  });

  it('is case-insensitive', () => {
    expect(classifyFileExtension('Photo.PNG')).toBe('image');
    expect(classifyFileExtension('App.TSX')).toBe('code');
    expect(classifyFileExtension('IMAGE.JPEG')).toBe('image');
  });

  it('classifies additional code extensions', () => {
    expect(classifyFileExtension('lib.rs')).toBe('code');
    expect(classifyFileExtension('Main.java')).toBe('code');
    expect(classifyFileExtension('app.swift')).toBe('code');
    expect(classifyFileExtension('module.mjs')).toBe('code');
    expect(classifyFileExtension('server.cjs')).toBe('code');
    expect(classifyFileExtension('page.vue')).toBe('code');
    expect(classifyFileExtension('page.svelte')).toBe('code');
    expect(classifyFileExtension('schema.graphql')).toBe('code');
  });

  it('classifies additional image extensions', () => {
    expect(classifyFileExtension('favicon.bmp')).toBe('image');
    expect(classifyFileExtension('favicon.ico')).toBe('image');
  });
});

describe('MAX_IMAGE_SIZE', () => {
  it('is set to 10 MB', () => {
    expect(MAX_IMAGE_SIZE).toBe(10 * 1024 * 1024);
  });
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
  const items = files.map((f) => ({
    kind: 'file' as const,
    getAsFile: () => f,
  }));
  return {
    preventDefault: vi.fn(),
    clipboardData: { items: items as unknown as DataTransferItemList },
  } as unknown as React.ClipboardEvent;
}

describe('useFileDrop hook', () => {
  it('returns initial state with isDragOver false', () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    expect(result.current.isDragOver).toBe(false);
    expect(result.current.dropZoneClassName).toBe('');
  });

  it('handleDragOver sets drag state and prevents default', () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    const event = makeDragEvent();
    act(() => { result.current.handleDragOver(event); });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(result.current.isDragOver).toBe(true);
    expect(result.current.dropZoneClassName).toContain('ring-2');
  });

  it('handleDragLeave clears drag state', () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    act(() => { result.current.handleDragOver(makeDragEvent()); });
    expect(result.current.isDragOver).toBe(true);
    act(() => { result.current.handleDragLeave(makeDragEvent()); });
    expect(result.current.isDragOver).toBe(false);
    expect(result.current.dropZoneClassName).toBe('');
  });

  it('handleDrop resets drag state and prevents default', () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    act(() => { result.current.handleDragOver(makeDragEvent()); });
    const dropEvent = makeDragEvent({
      dataTransfer: { dropEffect: '', files: [] as unknown as FileList } as DataTransfer,
    });
    act(() => { result.current.handleDrop(dropEvent); });
    expect(result.current.isDragOver).toBe(false);
    expect(dropEvent.preventDefault).toHaveBeenCalled();
  });

  it('handleDrop calls onAttach for a code file', async () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    const file = new File(['console.log("hi")'], 'script.ts', { type: 'text/typescript' });
    const dropEvent = makeDragEvent({
      dataTransfer: { dropEffect: '', files: [file] as unknown as FileList } as unknown as DataTransfer,
    });
    act(() => { result.current.handleDrop(dropEvent); });
    await vi.waitFor(() => expect(onAttach).toHaveBeenCalledTimes(1));
    expect(onAttach.mock.calls[0][0]).toMatchObject({ kind: 'file', name: 'script.ts' });
  });

  it('does nothing when disabled', () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach, enabled: false }));
    const event = makeDragEvent();
    act(() => { result.current.handleDragOver(event); });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(result.current.isDragOver).toBe(false);
  });

  it('handlePaste processes clipboard files', async () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    const file = new File(['data'], 'notes.txt', { type: 'text/plain' });
    const pasteEvent = makeClipboardEvent([file]);
    act(() => { result.current.handlePaste(pasteEvent); });
    await vi.waitFor(() => expect(onAttach).toHaveBeenCalledTimes(1));
    expect(pasteEvent.preventDefault).toHaveBeenCalled();
    expect(onAttach.mock.calls[0][0]).toMatchObject({ kind: 'file', name: 'notes.txt' });
  });

  it('handlePaste ignores empty clipboard', () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    const pasteEvent = makeClipboardEvent([]);
    act(() => { result.current.handlePaste(pasteEvent); });
    expect(pasteEvent.preventDefault).not.toHaveBeenCalled();
    expect(onAttach).not.toHaveBeenCalled();
  });

  it('handlePaste is no-op when disabled', () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach, enabled: false }));
    const file = new File(['data'], 'photo.png', { type: 'image/png' });
    const pasteEvent = makeClipboardEvent([file]);
    act(() => { result.current.handlePaste(pasteEvent); });
    expect(onAttach).not.toHaveBeenCalled();
  });
});
