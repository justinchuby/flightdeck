/**
 * ArtifactsPanel — browse agent-produced artifacts (specs, reports, audits).
 *
 * Shows markdown files from .flightdeck/shared/ grouped by agent.
 * Right pane: markdown preview (reused from DesignPanel).
 */
import { useState, useCallback, useEffect } from 'react';
import {
  FileText,
  Copy,
  Check,
  AlertTriangle,
  ScrollText,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Clock,
  User,
} from 'lucide-react';
import { useProjectId } from '../../contexts/ProjectContext';
import { apiFetch } from '../../hooks/useApi';
import { MarkdownContent } from '../../utils/markdown';
import { getRoleIcon } from '../../utils/getRoleIcon';

// ── Types ─────────────────────────────────────────────────────────

interface ArtifactFile {
  name: string;
  path: string;
  ext: string;
  title: string;
  modifiedAt: string;
}

interface ArtifactGroup {
  agentDir: string;
  role: string;
  agentId: string;
  files: ArtifactFile[];
}

interface FileData {
  path: string;
  content: string;
  size: number;
  ext: string;
}

// ── Component ─────────────────────────────────────────────────────

export function ArtifactsPanel() {
  const projectId = useProjectId();
  const [groups, setGroups] = useState<ArtifactGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchArtifacts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ groups: ArtifactGroup[] }>(
        `/projects/${projectId}/artifacts`,
      );
      setGroups(data.groups);
      // Auto-expand all groups
      setExpandedGroups(new Set(data.groups.map(g => g.agentDir)));
    } catch (err: any) {
      setError(err.message || 'Failed to load artifacts');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchArtifacts();
  }, [fetchArtifacts]);

  const loadFile = useCallback(async (path: string) => {
    setFileLoading(true);
    setFileError(null);
    try {
      const data = await apiFetch<FileData>(
        `/projects/${projectId}/file-contents?path=${encodeURIComponent(path)}`,
      );
      setFileData(data);
      setSelectedPath(path);
    } catch (err: any) {
      setFileError(err.message || 'Failed to load file');
      setFileData(null);
    } finally {
      setFileLoading(false);
    }
  }, [projectId]);

  const handleCopy = useCallback(async () => {
    if (!fileData) return;
    try {
      await navigator.clipboard.writeText(fileData.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  }, [fileData]);

  useEffect(() => { setCopied(false); }, [selectedPath]);

  const toggleGroup = (dir: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  const totalFiles = groups.reduce((sum, g) => sum + g.files.length, 0);

  return (
    <div className="flex flex-1 overflow-hidden" data-testid="artifacts-panel">
      {/* ── Sidebar: Agent artifact groups ────────────────────── */}
      <div className="w-72 shrink-0 border-r border-th-border bg-th-bg flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-th-border">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-th-text-alt">
            <ScrollText size={14} />
            Artifacts
            {!loading && <span className="text-th-text-muted ml-1">({totalFiles})</span>}
          </div>
          <button
            onClick={fetchArtifacts}
            className="p-0.5 rounded hover:bg-th-bg-alt text-th-text-muted transition-colors"
            aria-label="Refresh artifacts"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="flex-1 overflow-auto py-1">
          {loading && groups.length === 0 && (
            <div className="flex items-center justify-center p-4 text-th-text-muted">
              <RefreshCw size={14} className="animate-spin mr-2" />
              <span className="text-xs">Loading artifacts...</span>
            </div>
          )}

          {error && (
            <div className="p-3 text-xs text-red-400 flex items-center gap-1.5">
              <AlertTriangle size={12} />
              {error}
            </div>
          )}

          {!loading && !error && groups.length === 0 && (
            <div className="p-4 text-xs text-th-text-muted text-center">
              No agent artifacts yet
            </div>
          )}

          {groups.map(group => (
            <div key={group.agentDir}>
              <button
                onClick={() => toggleGroup(group.agentDir)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-th-bg-alt/80 transition-colors"
              >
                {expandedGroups.has(group.agentDir)
                  ? <ChevronDown size={12} className="shrink-0 text-th-text-muted" />
                  : <ChevronRight size={12} className="shrink-0 text-th-text-muted" />
                }
                <span>{getRoleIcon(group.role)}</span>
                <span className="font-medium text-th-text capitalize truncate">{group.role}</span>
                <span className="text-th-text-muted ml-auto">{group.files.length}</span>
              </button>

              {expandedGroups.has(group.agentDir) && group.files.map(file => (
                <button
                  key={file.path}
                  onClick={() => loadFile(file.path)}
                  className={`w-full text-left flex items-center gap-2 pl-8 pr-3 py-1.5 text-xs hover:bg-th-bg-alt/80 transition-colors ${
                    selectedPath === file.path ? 'bg-accent/10 text-accent' : 'text-th-text-alt'
                  }`}
                  title={file.path}
                >
                  <FileText size={12} className="shrink-0 text-blue-400" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{file.title || file.name}</div>
                    <div className="flex items-center gap-1 text-[10px] text-th-text-muted mt-0.5">
                      <Clock size={9} />
                      {new Date(file.modifiedAt).toLocaleDateString()}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── Main Content: Markdown Preview ───────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-th-bg">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-th-border shrink-0">
          <ScrollText size={14} className="text-th-text-muted" />
          <span className="text-sm font-semibold text-th-text-alt">Artifacts</span>
          {selectedPath && (
            <>
              <span className="text-xs text-th-text-muted font-mono ml-2 truncate">
                {selectedPath}
              </span>
              <button
                onClick={handleCopy}
                className="ml-auto p-1 rounded hover:bg-th-bg-alt text-th-text-muted transition-colors"
                aria-label="Copy file content"
                title="Copy to clipboard"
              >
                {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
              </button>
            </>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {fileLoading && (
            <div className="flex items-center justify-center h-full text-th-text-muted">
              <div className="animate-pulse text-sm">Loading artifact...</div>
            </div>
          )}

          {fileError && (
            <div className="flex items-center gap-2 p-4 rounded-lg bg-red-500/10 border border-red-400/20 text-red-400 text-sm">
              <AlertTriangle size={16} />
              {fileError}
            </div>
          )}

          {!fileLoading && !fileError && !fileData && (
            <EmptyState />
          )}

          {!fileLoading && !fileError && fileData && (
            <div className="max-w-4xl mx-auto">
              <div className="prose prose-sm dark:prose-invert max-w-none" data-testid="markdown-preview">
                <MarkdownContent text={fileData.content} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-th-text-muted" data-testid="artifacts-empty">
      <ScrollText size={48} className="mb-4 opacity-20" />
      <p className="text-sm font-medium mb-1">Agent Artifacts</p>
      <p className="text-xs">Select an artifact from the sidebar to preview it</p>
      <p className="text-xs mt-2 text-th-text-muted/60">
        Specs, reports, audits, and investigations from your agents
      </p>
    </div>
  );
}
