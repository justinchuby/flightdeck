/**
 * ArtifactsPanel — browse agent-produced artifacts (specs, reports, audits).
 *
 * Shows markdown files grouped by session (newest first).
 * Right pane: markdown preview.
 */
import { useState, useCallback, useEffect, useMemo } from 'react';
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
  Layers,
} from 'lucide-react';
import { useProjectId } from '../../contexts/ProjectContext';
import { apiFetch } from '../../hooks/useApi';
import { Markdown } from '../ui/Markdown';
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
  sessionId?: string;
  files: ArtifactFile[];
}

interface SessionArtifact extends ArtifactFile {
  role: string;
  agentId: string;
  agentDir: string;
}

interface SessionGroup {
  sessionId: string;
  label: string;
  latestAt: string;
  artifacts: SessionArtifact[];
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
  const [sharedPath, setSharedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pathCopied, setPathCopied] = useState(false);

  const fetchArtifacts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ groups: ArtifactGroup[]; sharedPath?: string }>(
        `/projects/${projectId}/artifacts`,
      );
      setGroups(data.groups);
      if (data.sharedPath) setSharedPath(data.sharedPath);
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

  const copyPath = useCallback(async () => {
    if (!sharedPath) return;
    try {
      await navigator.clipboard.writeText(sharedPath);
      setPathCopied(true);
      setTimeout(() => setPathCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  }, [sharedPath]);

  // Derive session-grouped view from flat agent groups
  const sessionGroups = useMemo(() => {
    const map = new Map<string, SessionArtifact[]>();
    for (const g of groups) {
      const sid = g.sessionId || '__workspace__';
      if (!map.has(sid)) map.set(sid, []);
      const bucket = map.get(sid)!;
      for (const f of g.files) {
        bucket.push({ ...f, role: g.role, agentId: g.agentId, agentDir: g.agentDir });
      }
    }

    const result: SessionGroup[] = [];
    for (const [sid, artifacts] of map) {
      artifacts.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
      const latestAt = artifacts[0]?.modifiedAt || '';
      let label: string;
      if (sid === '__workspace__') {
        label = 'Workspace';
      } else if (sid === 'unknown') {
        label = 'Untracked';
      } else if (/^[0-9a-f-]{20,}$/i.test(sid)) {
        label = sid.replace(/-/g, '').slice(0, 8);
      } else {
        label = sid;
      }
      result.push({ sessionId: sid, label, latestAt, artifacts });
    }

    result.sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime());
    return result;
  }, [groups]);

  // Auto-expand all session groups when data loads
  useEffect(() => {
    if (sessionGroups.length > 0) {
      setExpandedGroups(new Set(sessionGroups.map(s => s.sessionId)));
    }
  }, [sessionGroups]);

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

        {/* Path info bar */}
        {sharedPath && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-th-border bg-th-bg-alt/30" data-testid="artifacts-path-bar">
            <span className="text-[10px] text-th-text-muted">📁</span>
            <span className="text-[10px] font-mono text-th-text-muted truncate flex-1" title={sharedPath}>
              {sharedPath}
            </span>
            <button
              onClick={copyPath}
              className="p-0.5 rounded hover:bg-th-bg-alt text-th-text-muted transition-colors shrink-0"
              aria-label="Copy artifacts path"
              title="Copy path to clipboard"
            >
              {pathCopied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            </button>
          </div>
        )}

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

          {sessionGroups.map(session => (
            <div key={session.sessionId}>
              {/* Session header */}
              <button
                onClick={() => toggleGroup(session.sessionId)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs border-b border-th-border/50 bg-th-bg-alt/40 hover:bg-th-bg-alt/60 transition-colors"
              >
                {expandedGroups.has(session.sessionId)
                  ? <ChevronDown size={12} className="shrink-0 text-th-text-muted" />
                  : <ChevronRight size={12} className="shrink-0 text-th-text-muted" />
                }
                <Layers size={12} className="shrink-0 text-th-text-muted" />
                <span className="font-semibold text-th-text truncate">{session.label}</span>
                <span className="text-th-text-muted ml-auto flex items-center gap-1.5 shrink-0">
                  {session.latestAt && (
                    <>
                      <Clock size={9} />
                      <span>{new Date(session.latestAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                      <span className="mx-0.5">·</span>
                    </>
                  )}
                  <span>{session.artifacts.length}</span>
                </span>
              </button>

              {expandedGroups.has(session.sessionId) && session.artifacts.map(art => (
                <button
                  key={art.path}
                  onClick={() => loadFile(art.path)}
                  className={`w-full text-left flex items-center gap-2 pl-7 pr-3 py-1.5 text-xs hover:bg-th-bg-alt/80 transition-colors ${
                    selectedPath === art.path ? 'bg-accent/10 text-accent' : 'text-th-text-alt'
                  }`}
                  title={art.path}
                >
                  <FileText size={12} className="shrink-0 text-blue-400" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{art.title || art.name}</div>
                    <div className="flex items-center gap-1.5 text-[10px] text-th-text-muted mt-0.5">
                      <span>{getRoleIcon(art.role)}</span>
                      <span className="capitalize">{art.role}</span>
                      <span>·</span>
                      <Clock size={9} />
                      {new Date(art.modifiedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
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
              <div data-testid="markdown-preview">
                <Markdown text={fileData.content} />
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
