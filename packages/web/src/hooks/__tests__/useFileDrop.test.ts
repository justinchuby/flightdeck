import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { classifyFileExtension, MAX_IMAGE_SIZE, useFileDrop, generateThumbnail } from '../useFileDrop';

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

  it('handleDrop is no-op when disabled', () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach, enabled: false }));
    const file = new File(['data'], 'test.ts');
    const e = makeDragEvent({ dataTransfer: { dropEffect: '', files: [file] as unknown as FileList } as unknown as DataTransfer });
    act(() => { result.current.handleDrop(e); });
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(onAttach).not.toHaveBeenCalled();
  });

  it('handleDragLeave is no-op when disabled', () => {
    const { result } = renderHook(() => useFileDrop({ onAttach: vi.fn(), enabled: false }));
    const e = makeDragEvent();
    act(() => { result.current.handleDragLeave(e); });
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('handleDragLeave clamps counter to zero when called without prior enter', () => {
    const { result } = renderHook(() => useFileDrop({ onAttach: vi.fn() }));
    act(() => { result.current.handleDragLeave(makeDragEvent()); });
    expect(result.current.isDragOver).toBe(false);
  });
});

// ── generateThumbnail browser environment tests ──────────────────────────

describe('generateThumbnail — browser environment', () => {
  let mockCtx: Record<string, ReturnType<typeof vi.fn>>;
  let mockCanvas: Record<string, unknown>;

  beforeEach(() => {
    mockCtx = { drawImage: vi.fn() };
    mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockCtx),
      toDataURL: vi.fn(() => 'data:image/png;base64,thumb'),
    };

    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, opts?: ElementCreationOptions) => {
      if (tag === 'canvas') return mockCanvas as unknown as HTMLCanvasElement;
      return origCreate(tag, opts);
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubImage(trigger: 'onload' | 'onerror', width = 200, height = 100) {
    const MockImage = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      const self = this;
      self.width = width;
      self.height = height;
      self.onload = null;
      self.onerror = null;
      Object.defineProperty(self, 'src', {
        set: () => { queueMicrotask(() => (self[trigger] as (() => void) | null)?.()); },
      });
    });
    vi.stubGlobal('Image', MockImage);
  }

  it('generates a thumbnail data URL from an image', async () => {
    stubImage('onload');
    const file = new File(['x'], 'test.png', { type: 'image/png' });
    const result = await generateThumbnail(file);

    expect(result).toBe('data:image/png;base64,thumb');
    expect(mockCanvas.getContext).toHaveBeenCalledWith('2d');
    expect(mockCtx.drawImage).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('scales down large images to fit THUMBNAIL_SIZE', async () => {
    stubImage('onload', 400, 200);
    const file = new File(['x'], 'big.png', { type: 'image/png' });
    await generateThumbnail(file);

    // THUMBNAIL_SIZE=96, scale = min(96/400, 96/200, 1) = 0.24
    expect(mockCanvas.width).toBe(Math.round(400 * 0.24));
    expect(mockCanvas.height).toBe(Math.round(200 * 0.24));
  });

  it('does not upscale small images', async () => {
    stubImage('onload', 40, 30);
    const file = new File(['x'], 'tiny.png', { type: 'image/png' });
    await generateThumbnail(file);

    // scale = min(96/40, 96/30, 1) = 1 — no upscale
    expect(mockCanvas.width).toBe(40);
    expect(mockCanvas.height).toBe(30);
  });

  it('resolves undefined when canvas getContext returns null', async () => {
    (mockCanvas.getContext as ReturnType<typeof vi.fn>).mockReturnValue(null);
    stubImage('onload');
    const file = new File(['x'], 'test.png', { type: 'image/png' });
    const result = await generateThumbnail(file);
    expect(result).toBeUndefined();
  });

  it('resolves undefined on image load error', async () => {
    stubImage('onerror');
    const file = new File(['x'], 'bad.png', { type: 'image/png' });
    const result = await generateThumbnail(file);
    expect(result).toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('resolves undefined in non-browser environment', async () => {
    const origDoc = globalThis.document;
    // @ts-expect-error simulate non-browser
    delete globalThis.document;
    const result = await generateThumbnail(new File(['x'], 'test.png'));
    expect(result).toBeUndefined();
    globalThis.document = origDoc;
  });
});

// ── Image file drop end-to-end tests ─────────────────────────────────────

describe('image file drop processing', () => {
  beforeEach(() => {
    // Mock canvas + thumbnail generation
    const mockCtx = { drawImage: vi.fn() };
    const mockCanvas = {
      width: 0, height: 0,
      getContext: vi.fn(() => mockCtx),
      toDataURL: vi.fn(() => 'data:image/png;base64,thumb'),
    };
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, opts?: ElementCreationOptions) => {
      if (tag === 'canvas') return mockCanvas as unknown as HTMLCanvasElement;
      return origCreate(tag, opts);
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    // Mock Image to trigger onload
    const MockImage = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      const self = this;
      self.width = 200;
      self.height = 100;
      self.onload = null;
      self.onerror = null;
      Object.defineProperty(self, 'src', {
        set: () => { queueMicrotask(() => (self.onload as (() => void) | null)?.()); },
      });
    });
    vi.stubGlobal('Image', MockImage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates image attachment with base64 data and thumbnail', async () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    const file = new File(['fake-image'], 'photo.png', { type: 'image/png' });

    const de = makeDragEvent({ dataTransfer: { dropEffect: '', files: [file] as unknown as FileList } as unknown as DataTransfer });
    await act(async () => { result.current.handleDrop(de); });
    await vi.waitFor(() => expect(onAttach).toHaveBeenCalledTimes(1));

    const att = onAttach.mock.calls[0][0];
    expect(att.kind).toBe('image');
    expect(att.name).toBe('photo.png');
    expect(att.mimeType).toBe('image/png');
    expect(att.data).toBeDefined();
    expect(typeof att.data).toBe('string');
    expect(att.thumbnailDataUrl).toBe('data:image/png;base64,thumb');
    expect(att.id).toBeDefined();
    expect(att.size).toBe(file.size);
  });

  it('uses default mimeType "image/png" when file.type is empty for images', async () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    const file = new File(['data'], 'img.png', { type: '' });

    const de = makeDragEvent({ dataTransfer: { dropEffect: '', files: [file] as unknown as FileList } as unknown as DataTransfer });
    await act(async () => { result.current.handleDrop(de); });
    await vi.waitFor(() => expect(onAttach).toHaveBeenCalledTimes(1));

    expect(onAttach.mock.calls[0][0].mimeType).toBe('image/png');
  });

  it('sets localPath for image file with Electron path property', async () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'path', { value: '/Users/me/photo.jpg' });

    const de = makeDragEvent({ dataTransfer: { dropEffect: '', files: [file] as unknown as FileList } as unknown as DataTransfer });
    await act(async () => { result.current.handleDrop(de); });
    await vi.waitFor(() => expect(onAttach).toHaveBeenCalledTimes(1));

    expect(onAttach.mock.calls[0][0].localPath).toBe('/Users/me/photo.jpg');
  });

  it('omits localPath when file.path equals file.name', async () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    const file = new File(['data'], 'photo.png', { type: 'image/png' });
    // path same as name → localPath should be undefined
    Object.defineProperty(file, 'path', { value: 'photo.png' });

    const de = makeDragEvent({ dataTransfer: { dropEffect: '', files: [file] as unknown as FileList } as unknown as DataTransfer });
    await act(async () => { result.current.handleDrop(de); });
    await vi.waitFor(() => expect(onAttach).toHaveBeenCalledTimes(1));

    expect(onAttach.mock.calls[0][0].localPath).toBeUndefined();
  });

  it('falls back to file attachment when readFileAsBase64 rejects', async () => {
    // Override FileReader to trigger error
    vi.stubGlobal('FileReader', class {
      result: null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      error = new Error('Read failed');
      readAsDataURL() { queueMicrotask(() => this.onerror?.()); }
    });

    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    const file = new File(['data'], 'broken.png', { type: 'image/png' });

    const de = makeDragEvent({ dataTransfer: { dropEffect: '', files: [file] as unknown as FileList } as unknown as DataTransfer });
    await act(async () => { result.current.handleDrop(de); });
    await vi.waitFor(() => expect(onAttach).toHaveBeenCalledTimes(1));

    const att = onAttach.mock.calls[0][0];
    expect(att.kind).toBe('file'); // fallback, not 'image'
    expect(att.name).toBe('broken.png');
    expect(att.mimeType).toBe('image/png');
  });

  it('skips oversized images with console.warn', async () => {
    const onAttach = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    const file = new File(['x'], 'huge.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 });

    const de = makeDragEvent({ dataTransfer: { dropEffect: '', files: [file] as unknown as FileList } as unknown as DataTransfer });
    await act(async () => { result.current.handleDrop(de); });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('exceeds 10MB'));
    expect(onAttach).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('processes multiple files including images and code', async () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    const codeFile = new File(['console.log()'], 'app.ts', { type: 'text/typescript' });
    const imgFile = new File(['img-data'], 'logo.png', { type: 'image/png' });

    const de = makeDragEvent({ dataTransfer: { dropEffect: '', files: [codeFile, imgFile] as unknown as FileList } as unknown as DataTransfer });
    await act(async () => { result.current.handleDrop(de); });
    await vi.waitFor(() => expect(onAttach).toHaveBeenCalledTimes(2));

    expect(onAttach.mock.calls[0][0].kind).toBe('file');
    expect(onAttach.mock.calls[0][0].name).toBe('app.ts');
    expect(onAttach.mock.calls[1][0].kind).toBe('image');
    expect(onAttach.mock.calls[1][0].name).toBe('logo.png');
  });

  it('processes unknown file type as file attachment', async () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    const file = new File(['data'], 'archive.zip', { type: 'application/zip' });

    const de = makeDragEvent({ dataTransfer: { dropEffect: '', files: [file] as unknown as FileList } as unknown as DataTransfer });
    await act(async () => { result.current.handleDrop(de); });
    await vi.waitFor(() => expect(onAttach).toHaveBeenCalledTimes(1));

    const att = onAttach.mock.calls[0][0];
    expect(att.kind).toBe('file');
    expect(att.name).toBe('archive.zip');
    expect(att.mimeType).toBe('application/zip');
  });

  it('sets localPath for code file with Electron path', async () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    const file = new File(['code'], 'main.py', { type: 'text/python' });
    Object.defineProperty(file, 'path', { value: '/home/user/main.py' });

    const de = makeDragEvent({ dataTransfer: { dropEffect: '', files: [file] as unknown as FileList } as unknown as DataTransfer });
    await act(async () => { result.current.handleDrop(de); });
    await vi.waitFor(() => expect(onAttach).toHaveBeenCalledTimes(1));

    expect(onAttach.mock.calls[0][0].localPath).toBe('/home/user/main.py');
  });

  it('uses fallback mimeType for code file with empty type', async () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    const file = new File(['data'], 'script.sh', { type: '' });

    const de = makeDragEvent({ dataTransfer: { dropEffect: '', files: [file] as unknown as FileList } as unknown as DataTransfer });
    await act(async () => { result.current.handleDrop(de); });
    await vi.waitFor(() => expect(onAttach).toHaveBeenCalledTimes(1));

    expect(onAttach.mock.calls[0][0].mimeType).toBe('application/octet-stream');
  });

  it('handlePaste processes pasted image files', async () => {
    const onAttach = vi.fn();
    const { result } = renderHook(() => useFileDrop({ onAttach }));
    const file = new File(['img-data'], 'screenshot.png', { type: 'image/png' });
    const pe = makeClipboardEvent([file]);

    await act(async () => { result.current.handlePaste(pe); });
    await vi.waitFor(() => expect(onAttach).toHaveBeenCalledTimes(1));

    expect(onAttach.mock.calls[0][0].kind).toBe('image');
    expect(pe.preventDefault).toHaveBeenCalled();
  });
});
