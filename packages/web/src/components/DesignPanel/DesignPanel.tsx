/**
 * DesignPanel — project design files browser with markdown preview.
 *
 * Left sidebar: file tree browser for the project's CWD.
 * Right pane: file content preview (markdown rendered, code syntax highlighted).
 *
 * Useful for browsing design specs, skills, and project files.
 */
import { useState, useCallback, useEffect } from 'react';
import {
  Paintbrush,
  FileText,
  Code2,
  Copy,
  Check,
  FolderOpen,
  AlertTriangle,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useProjectId } from '../../contexts/ProjectContext';
import { apiFetch } from '../../hooks/useApi';
import { Markdown } from '../ui/Markdown';
import { FileTree } from './FileTree';

// ── Types ─────────────────────────────────────────────────────────

interface FileData {
  path: string;
  content: string;
  size: number;
  ext: string;
}

// Extensions that get markdown rendering
const MARKDOWN_EXTS = new Set(['md', 'mdx']);
// Extensions that get syntax-highlighted code rendering
const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'json', 'yaml', 'yml', 'toml',
  'py', 'go', 'rs', 'sh', 'bash', 'css', 'html', 'sql',
]);

// ── Component ─────────────────────────────────────────────────────

export function DesignPanel() {
  const projectId = useProjectId();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const loadFile = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<FileData>(
        `/projects/${projectId}/file-contents?path=${encodeURIComponent(path)}`,
      );
      setFileData(data);
      setSelectedPath(path);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to load file');
      setFileData(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Copy file content to clipboard
  const handleCopy = useCallback(async () => {
    if (!fileData) return;
    try {
      await navigator.clipboard.writeText(fileData.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard might be unavailable
    }
  }, [fileData]);

  // Reset copied state when file changes
  useEffect(() => { setCopied(false); }, [selectedPath]);

  const isMarkdown = fileData && MARKDOWN_EXTS.has(fileData.ext);
  const isCode = fileData && CODE_EXTS.has(fileData.ext);

  return (
    <div className="flex flex-1 overflow-hidden" data-testid="design-panel">
      {/* ── Sidebar: File Tree ───────────────────────────────── */}
      {sidebarOpen && (
        <div className="w-64 shrink-0 border-r border-th-border bg-th-bg flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-th-border">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-th-text-alt">
              <FolderOpen size={14} />
              Files
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-0.5 rounded hover:bg-th-bg-alt text-th-text-muted transition-colors"
              aria-label="Close sidebar"
            >
              <PanelLeftClose size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-auto">
            <FileTree
              projectId={projectId}
              selectedPath={selectedPath}
              onSelectFile={loadFile}
            />
          </div>
        </div>
      )}

      {/* ── Main Content: File Preview ───────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-th-bg">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-th-border shrink-0">
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1 rounded hover:bg-th-bg-alt text-th-text-muted transition-colors"
              aria-label="Open sidebar"
            >
              <PanelLeftOpen size={14} />
            </button>
          )}
          <Paintbrush size={14} className="text-th-text-muted" />
          <span className="text-sm font-semibold text-th-text-alt">Design</span>
          {selectedPath && (
            <>
              <span className="text-xs text-th-text-muted font-mono ml-2 truncate">
                {selectedPath}
              </span>
              <div className="ml-auto flex items-center gap-1">
                {isMarkdown && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-medium">
                    <FileText size={10} className="inline mr-0.5" />MD
                  </span>
                )}
                {isCode && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">
                    <Code2 size={10} className="inline mr-0.5" />{fileData?.ext.toUpperCase()}
                  </span>
                )}
                <button
                  onClick={handleCopy}
                  className="p-1 rounded hover:bg-th-bg-alt text-th-text-muted transition-colors"
                  aria-label="Copy file content"
                  title="Copy to clipboard"
                >
                  {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-auto p-6">
          {loading && (
            <div className="flex items-center justify-center h-full text-th-text-muted">
              <div className="text-center">
                <div className="animate-pulse text-sm">Loading file…</div>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-4 rounded-lg bg-red-500/10 border border-red-400/20 text-red-400 text-sm">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}

          {!loading && !error && !fileData && (
            <EmptyState />
          )}

          {!loading && !error && fileData && (
            <div className="max-w-4xl mx-auto">
              {isMarkdown ? (
                <div data-testid="markdown-preview">
                  <Markdown text={fileData.content} />
                </div>
              ) : (
                <pre
                  className="font-mono text-xs text-th-text-alt whitespace-pre-wrap break-words leading-relaxed"
                  data-testid="code-preview"
                >
                  {fileData.content}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-th-text-muted" data-testid="design-empty">
      <Paintbrush size={48} className="mb-4 opacity-20" />
      <p className="text-sm font-medium mb-1">Design Files</p>
      <p className="text-xs">Select a file from the sidebar to preview it</p>
      <p className="text-xs mt-2 text-th-text-muted/60">
        Browse design specs, skills, and shared files
      </p>
    </div>
  );
}
