import { useState, useCallback, useRef } from 'react';

// ── File type classification ────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico',
]);

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cpp', '.h',
  '.css', '.scss', '.less', '.html', '.vue', '.svelte',
  '.json', '.yaml', '.yml', '.toml', '.xml',
  '.sh', '.bash', '.zsh', '.fish',
  '.sql', '.graphql', '.gql',
  '.md', '.mdx', '.txt', '.csv', '.log',
  '.dockerfile', '.env', '.gitignore', '.editorconfig',
]);

export type FileDropKind = 'image' | 'code' | 'unknown';

export interface DroppedFile {
  kind: FileDropKind;
  name: string;
  path: string;
  /** Only set for image files — base64 data URL */
  dataUrl?: string;
  file: File;
}

export function classifyFileExtension(filename: string): FileDropKind {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex === -1) return 'unknown';
  const ext = filename.slice(dotIndex).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  return 'unknown';
}

/**
 * Build the text to insert into the textarea for a dropped file.
 * Images get `![filename](dataUrl)`, code/text files get `@filename`.
 */
export function buildInsertText(file: DroppedFile): string {
  if (file.kind === 'image' && file.dataUrl) {
    return `![${file.name}](${file.dataUrl})`;
  }
  // For code files and unknown files, insert as a mention
  return `@${file.path || file.name}`;
}

// ── Hook ────────────────────────────────────────────────────────────────

export interface UseFileDropOptions {
  /** Called with text to insert into the textarea */
  onInsertText: (text: string) => void;
  /** Whether the drop zone is enabled (default: true) */
  enabled?: boolean;
}

export interface UseFileDropResult {
  /** True while a file is being dragged over the drop zone */
  isDragOver: boolean;
  /** Attach to the drop zone wrapper's onDragOver */
  handleDragOver: (e: React.DragEvent) => void;
  /** Attach to the drop zone wrapper's onDragLeave */
  handleDragLeave: (e: React.DragEvent) => void;
  /** Attach to the drop zone wrapper's onDrop */
  handleDrop: (e: React.DragEvent) => void;
  /** CSS class string for the drop zone indicator */
  dropZoneClassName: string;
}

export function useFileDrop({ onInsertText, enabled = true }: UseFileDropOptions): UseFileDropResult {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!enabled) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    },
    [enabled],
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!enabled) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current += 1;
      if (dragCounterRef.current === 1) {
        setIsDragOver(true);
      }
    },
    [enabled],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!enabled) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDragOver(false);
      }
    },
    [enabled],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!enabled) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      processDroppedFiles(files, onInsertText);
    },
    [enabled, onInsertText],
  );

  const dropZoneClassName = isDragOver
    ? 'ring-2 ring-accent bg-accent/5 border-accent'
    : '';

  return {
    isDragOver,
    /**
     * Handles both dragOver and dragEnter events. Attach this to the drop zone's
     * `onDragOver` — do NOT attach a separate `onDragEnter` handler, as this
     * already tracks enter/leave counts for proper isDragOver state management.
     */
    handleDragOver: (e: React.DragEvent) => {
      handleDragEnter(e);
      handleDragOver(e);
    },
    handleDragLeave,
    handleDrop,
    dropZoneClassName,
  };
}

// ── File processing ─────────────────────────────────────────────────────

function processDroppedFiles(files: File[], onInsertText: (text: string) => void): void {
  const insertions: Promise<string>[] = files.map((file) => {
    const kind = classifyFileExtension(file.name);
    const path = (file as any).path || file.name;

    if (kind === 'image') {
      return readFileAsDataUrl(file)
        .then((dataUrl) =>
          buildInsertText({ kind, name: file.name, path, dataUrl, file }),
        )
        .catch(() => {
          // Fall back to a file mention if the image can't be read
          return buildInsertText({ kind: 'code', name: file.name, path, file });
        });
    }

    return Promise.resolve(
      buildInsertText({ kind, name: file.name, path, file }),
    );
  });

  Promise.all(insertions).then((texts) => {
    const combined = texts.filter(Boolean).join(' ');
    if (combined) onInsertText(combined);
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
