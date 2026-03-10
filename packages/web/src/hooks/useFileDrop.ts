import { useState, useCallback, useRef } from 'react';
import type { Attachment } from './useAttachments';

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

export function classifyFileExtension(filename: string): FileDropKind {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex === -1) return 'unknown';
  const ext = filename.slice(dotIndex).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  return 'unknown';
}

// ── Thumbnail generation ────────────────────────────────────────────────

const THUMBNAIL_SIZE = 96; // 2x for retina, displayed at 48x48

/**
 * Generate a small thumbnail data URL from an image file via canvas downscale.
 * Returns undefined if generation fails (e.g., in non-browser environments).
 */
export function generateThumbnail(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(undefined);
      return;
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(THUMBNAIL_SIZE / img.width, THUMBNAIL_SIZE / img.height, 1);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(undefined);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(undefined);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(undefined);
    };

    img.src = objectUrl;
  });
}

// ── Hook ────────────────────────────────────────────────────────────────

export interface UseFileDropOptions {
  /** Called with a structured Attachment when a file is dropped */
  onAttach: (attachment: Attachment) => void;
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
  /** Attach to the chat container's onPaste for clipboard image support */
  handlePaste: (e: React.ClipboardEvent) => void;
  /** CSS class string for the drop zone indicator */
  dropZoneClassName: string;
}

export function useFileDrop({ onAttach, enabled = true }: UseFileDropOptions): UseFileDropResult {
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

      processDroppedFilesAsAttachments(files, onAttach);
    },
    [enabled, onAttach],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!enabled) return;
      const items = Array.from(e.clipboardData.items);
      const files = items
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
      if (files.length === 0) return;
      e.preventDefault();
      processDroppedFilesAsAttachments(files, onAttach);
    },
    [enabled, onAttach],
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
    handlePaste,
    dropZoneClassName,
  };
}

// ── File processing (attachment mode) ───────────────────────────────────

/** Max image file size for attachment (10 MB) */
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix to get raw base64
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function processDroppedFilesAsAttachments(
  files: File[],
  onAttach: (attachment: Attachment) => void,
): Promise<void> {
  for (const file of files) {
    const kind = classifyFileExtension(file.name);
    const filePath = (file as any).path || file.name;

    if (kind === 'image') {
      if (file.size > MAX_IMAGE_SIZE) {
        console.warn(`Image "${file.name}" exceeds 10MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB). Skipped.`);
        continue;
      }

      try {
        const [data, thumbnailDataUrl] = await Promise.all([
          readFileAsBase64(file),
          generateThumbnail(file),
        ]);

        onAttach({
          id: generateId(),
          kind: 'image',
          name: file.name,
          mimeType: file.type || 'image/png',
          data,
          localPath: filePath !== file.name ? filePath : undefined,
          thumbnailDataUrl,
          size: file.size,
        });
      } catch {
        // Fall back to file attachment without data
        onAttach({
          id: generateId(),
          kind: 'file',
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          localPath: filePath !== file.name ? filePath : undefined,
          size: file.size,
        });
      }
    } else {
      onAttach({
        id: generateId(),
        kind: 'file',
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        localPath: filePath !== file.name ? filePath : undefined,
        size: file.size,
      });
    }
  }
}

