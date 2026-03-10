/**
 * FileTree — collapsible file browser sidebar for the Design tab.
 *
 * Fetches directory listings from the server API and renders them
 * as an expandable tree. Calls onSelectFile when a file is clicked.
 */
import { useState, useCallback, useEffect } from 'react';
import {
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  File,
  ChevronRight,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

// ── Types ─────────────────────────────────────────────────────────

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  ext?: string;
}

interface DirNode {
  entries: FileEntry[];
  loaded: boolean;
  expanded: boolean;
}

interface FileTreeProps {
  projectId: string;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}

// File icon based on extension
function fileIcon(ext?: string) {
  switch (ext) {
    case 'md': case 'mdx':
      return <FileText size={14} className="text-blue-400 shrink-0" />;
    case 'ts': case 'tsx': case 'js': case 'jsx': case 'py': case 'go': case 'rs':
      return <FileCode size={14} className="text-emerald-400 shrink-0" />;
    default:
      return <File size={14} className="text-th-text-muted shrink-0" />;
  }
}

// Indentation constants for tree nesting
const INDENT_PX = 12;
const BASE_PAD_PX = 8;

export function FileTree({ projectId, selectedPath, onSelectFile }: FileTreeProps) {
  const [dirs, setDirs] = useState<Record<string, DirNode>>({});
  const [loading, setLoading] = useState<string | null>(null);

  const fetchDir = useCallback(async (dirPath: string) => {
    setLoading(dirPath);
    try {
      const data = await apiFetch<{ path: string; items: FileEntry[] }>(
        `/projects/${projectId}/files?path=${encodeURIComponent(dirPath)}`,
      );
      setDirs((prev) => ({
        ...prev,
        [dirPath]: { entries: data.items, loaded: true, expanded: true },
      }));
    } catch {
      // Silently fail — directory might not be accessible
    } finally {
      setLoading(null);
    }
  }, [projectId]);

  const toggleDir = useCallback((dirPath: string) => {
    const node = dirs[dirPath];
    if (!node || !node.loaded) {
      fetchDir(dirPath);
    } else {
      setDirs((prev) => ({
        ...prev,
        [dirPath]: { ...node, expanded: !node.expanded },
      }));
    }
  }, [dirs, fetchDir]);

  // Initialize root on mount, re-fetch when projectId changes
  useEffect(() => {
    fetchDir('');
  }, [fetchDir]);

  function renderEntries(entries: FileEntry[], depth: number) {
    return entries.map((entry) => {
      const isSelected = selectedPath === entry.path;
      const isDir = entry.type === 'directory';
      const node = dirs[entry.path];
      const isExpanded = node?.expanded ?? false;
      const isLoading = loading === entry.path;

      return (
        <div key={entry.path}>
          <button
            onClick={() => isDir ? toggleDir(entry.path) : onSelectFile(entry.path)}
            className={`w-full text-left flex items-center gap-1.5 py-1 px-2 text-xs hover:bg-th-bg-alt/80 transition-colors rounded ${
              isSelected ? 'bg-accent/10 text-accent' : 'text-th-text-alt'
            }`}
            style={{ paddingLeft: `${depth * INDENT_PX + BASE_PAD_PX}px` }}
            title={entry.path}
          >
            {isDir && (
              isLoading
                ? <Loader2 size={12} className="animate-spin shrink-0" />
                : isExpanded
                  ? <ChevronDown size={12} className="shrink-0" />
                  : <ChevronRight size={12} className="shrink-0" />
            )}
            {isDir
              ? (isExpanded ? <FolderOpen size={14} className="text-amber-400 shrink-0" /> : <Folder size={14} className="text-amber-400 shrink-0" />)
              : fileIcon(entry.ext)
            }
            <span className="truncate">{entry.name}</span>
          </button>
          {isDir && isExpanded && node?.entries && (
            <div>{renderEntries(node.entries, depth + 1)}</div>
          )}
        </div>
      );
    });
  }

  const root = dirs[''];
  if (!root || !root.loaded) {
    return (
      <div className="flex items-center justify-center p-4 text-th-text-muted">
        <Loader2 size={16} className="animate-spin mr-2" />
        <span className="text-xs">Loading files…</span>
      </div>
    );
  }

  if (root.entries.length === 0) {
    return (
      <div className="p-4 text-xs text-th-text-muted text-center">
        No files in project directory
      </div>
    );
  }

  return <div className="py-1">{renderEntries(root.entries, 0)}</div>;
}
