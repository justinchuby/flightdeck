import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  FolderOpen,
  Plus,
  Trash2,
  Play,
  Users,
  HardDrive,
  Clock,
  ChevronRight,
  ChevronDown,
  FolderCog,
  Home,
  GitBranch,
  RefreshCw,
  Archive,
  AlertTriangle,
  ListChecks,
  Pencil,
  Square,
  Upload,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { formatRelativeTime } from '../../utils/formatRelativeTime';
import { formatDate } from '../../utils/format';
import { useToastStore } from '../Toast';
import { NewProjectModal } from '../LeadDashboard/NewProjectModal';
import { StatusBadge, projectStatusProps } from '../ui/StatusBadge';
import { sessionStatusDot } from '../../utils/statusColors';
import { SessionViewer, type ViewableSession } from '../SessionHistory';

/** Extended project type with storage and agent count info from the enriched API */
interface EnrichedProject {
  id: string;
  name: string;
  description: string;
  cwd: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  activeAgentCount: number;
  runningAgentCount?: number;
  idleAgentCount?: number;
  failedAgentCount?: number;
  storageMode: 'user' | 'local';
  sessions?: Array<{
    id: number;
    projectId: string;
    leadId: string;
    status: string;
    startedAt: string;
    endedAt: string | null;
    task: string | null;
  }>;
  activeLeadId?: string;
  taskProgress?: { done: number; total: number };
}

function StorageBadge({ mode }: { mode: 'user' | 'local' }) {
  const isUser = mode === 'user';
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${
        isUser
          ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
          : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      }`}
      title={isUser ? 'Stored in ~/.flightdeck/projects/' : 'Stored in project .flightdeck/'}
    >
      {isUser ? <Home className="w-2.5 h-2.5" /> : <GitBranch className="w-2.5 h-2.5" />}
      {isUser ? 'user' : 'local'}
    </span>
  );
}


function ProjectCard({
  project,
  isExpanded,
  isSelected,
  onToggle,
  onSelect,
  onResume,
  onArchive,
  onStop,
  onDelete,
  confirmingDeleteId,
  onConfirmDelete,
  onCancelDelete,
  editingCwdId,
  cwdValue,
  onEditCwd,
  onCwdChange,
  onSaveCwd,
  onCancelCwdEdit,
  onViewSession,
}: {
  project: EnrichedProject;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onResume: (id: string) => void;
  onArchive: (id: string) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
  confirmingDeleteId: string | null;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
  editingCwdId: string | null;
  cwdValue: string;
  onEditCwd: (id: string, currentCwd: string) => void;
  onCwdChange: (value: string) => void;
  onSaveCwd: (id: string) => void;
  onCancelCwdEdit: () => void;
  onViewSession: (session: ViewableSession) => void;
}) {
  const isConfirmingDelete = confirmingDeleteId === project.id;
  return (
    <div className="bg-surface-raised border border-th-border rounded-lg overflow-hidden transition-colors hover:border-th-border-hover">
      {/* Card header — click to expand/collapse, name link navigates */}
      <div
        onClick={onToggle}
        className="flex items-center gap-3 p-3 cursor-pointer"
        role="button"
        aria-expanded={isExpanded}
        aria-label={`Toggle details for ${project.name}`}
      >
        {/* Batch selection checkbox */}
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => { e.stopPropagation(); onSelect(); }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="w-3.5 h-3.5 rounded border-th-border shrink-0 accent-accent"
        />
        <FolderOpen className="w-5 h-5 text-accent shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              to={`/projects/${project.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-sm font-medium text-th-text-alt hover:text-accent hover:underline transition-colors no-underline"
            >
              {project.name}
            </Link>
            <StatusBadge {...projectStatusProps(project)} dot />
            <StorageBadge mode={project.storageMode} />
          </div>
          {project.description && (
            <div className="text-xs text-th-text-muted truncate mt-0.5">{project.description}</div>
          )}
          <div className="flex items-center gap-3 mt-1 text-[10px] text-th-text-muted">
            {project.activeAgentCount > 0 && (
              <span className="flex items-center gap-1">
                <Users className="w-2.5 h-2.5" />
                {project.activeAgentCount} agent{project.activeAgentCount !== 1 ? 's' : ''}
              </span>
            )}
            {project.taskProgress && project.taskProgress.total > 0 && (
              <span className="flex items-center gap-1">
                <ListChecks className="w-2.5 h-2.5" />
                {project.taskProgress.done}/{project.taskProgress.total} tasks
              </span>
            )}
            <span>{formatRelativeTime(project.updatedAt)}</span>
          </div>
        </div>

        {/* Agent count badge */}
        {project.activeAgentCount > 0 && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-accent bg-accent/10 px-2 py-0.5 rounded-full shrink-0">
            <Users className="w-2.5 h-2.5" />
            {project.activeAgentCount}
          </span>
        )}

        <div className="p-1 shrink-0">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-th-text-muted" />
          ) : (
            <ChevronRight className="w-4 h-4 text-th-text-muted" />
          )}
        </div>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="border-t border-th-border px-4 py-3 bg-th-bg-alt/30 space-y-3">
          {/* Detail grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <div>
              <span className="text-th-text-muted">ID</span>
              <div className="font-mono text-th-text-alt">{project.id}</div>
            </div>
            <div>
              <span className="text-th-text-muted">Created</span>
              <div className="text-th-text-alt flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatDate(project.createdAt)}
              </div>
            </div>
            {/* Working directory — inline editable */}
            <div className="col-span-2">
              <span className="text-th-text-muted">Working directory</span>
              {editingCwdId === project.id ? (
                <div className="flex items-center gap-1 mt-0.5">
                  <input
                    value={cwdValue}
                    onChange={(e) => onCwdChange(e.target.value)}
                    className="flex-1 text-xs font-mono bg-th-bg border border-th-border rounded px-2 py-1 text-th-text-alt focus:outline-none focus:border-accent"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onSaveCwd(project.id);
                      if (e.key === 'Escape') onCancelCwdEdit();
                    }}
                  />
                  <button onClick={() => onSaveCwd(project.id)} className="text-xs text-green-500 hover:text-green-400 font-medium">Save</button>
                  <button onClick={onCancelCwdEdit} className="text-xs text-th-text-muted hover:text-th-text">Cancel</button>
                </div>
              ) : (
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="font-mono text-th-text-alt truncate" title={project.cwd || 'Not set'}>
                    {project.cwd || 'Not set'}
                  </span>
                  <button
                    onClick={() => onEditCwd(project.id, project.cwd || '')}
                    className="text-th-text-muted hover:text-th-text transition-colors p-0.5 rounded"
                    title="Edit working directory"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
            <div>
              <span className="text-th-text-muted">Storage mode</span>
              <div className="flex items-center gap-1.5 text-th-text-alt">
                <HardDrive className="w-3 h-3" />
                {project.storageMode === 'user' ? 'User (~/.flightdeck/)' : 'Local (.flightdeck/)'}
              </div>
            </div>
            <div>
              <span className="text-th-text-muted">Crew</span>
              <div className="text-th-text-alt flex items-center gap-1">
                <Users className="w-3 h-3" />
                {project.activeAgentCount} total
                {(project.runningAgentCount || project.idleAgentCount || project.failedAgentCount) ? (
                  <span className="text-th-text-muted ml-1">
                    ({[
                      project.runningAgentCount ? `${project.runningAgentCount} running` : '',
                      project.idleAgentCount ? `${project.idleAgentCount} idle` : '',
                      project.failedAgentCount ? `${project.failedAgentCount} failed` : '',
                    ].filter(Boolean).join(', ')})
                  </span>
                ) : null}
              </div>
            </div>
            <div>
              <span className="text-th-text-muted">Sessions</span>
              <div className="text-th-text-alt">{project.sessions?.length ?? 0}</div>
            </div>
            <div>
              <span className="text-th-text-muted">Updated</span>
              <div className="text-th-text-alt">{formatRelativeTime(project.updatedAt)}</div>
            </div>
          </div>

          {/* Sessions summary */}
          {project.sessions && project.sessions.length > 0 && (
            <div>
              <span className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium">
                Sessions ({project.sessions.length})
              </span>
              <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
                {project.sessions.slice(-5).reverse().map((s) => {
                  const isRunning = s.status === 'active' && s.leadId === project.activeLeadId;
                  return (
                  <div key={s.id}
                    className="flex items-center gap-2 text-[11px] cursor-pointer hover:bg-th-bg-hover/30 rounded px-1 -mx-1 transition-colors"
                    onClick={(e) => { e.stopPropagation(); onViewSession({ leadId: s.leadId, task: s.task, startedAt: s.startedAt, endedAt: s.endedAt, projectId: project.id, status: s.status }); }}
                    title="Click to view session summary"
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        isRunning
                          ? 'bg-blue-400 animate-pulse'
                          : sessionStatusDot(s.status)
                      }`}
                    />
                    <span
                      className="font-mono text-th-text-muted hover:text-th-text cursor-pointer"
                      title={`Session: ${s.leadId} — click to copy`}
                      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(s.leadId); }}
                    >
                      {s.leadId.slice(0, 8)}
                    </span>
                    <span className="text-th-text-alt truncate">{s.task || s.status}</span>
                    <span className="text-th-text-muted ml-auto shrink-0">
                      {formatRelativeTime(s.startedAt)}
                    </span>
                  </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {project.status !== 'archived' && (
              <button
                onClick={() => onResume(project.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent/20 text-accent rounded-md hover:bg-accent/30 transition-colors font-medium"
              >
                <Play className="w-3 h-3" />
                Resume
              </button>
            )}
            {project.status === 'active' && (
              <button
                onClick={() => onArchive(project.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-th-text-muted rounded-md hover:bg-th-bg-muted transition-colors"
              >
                <Archive className="w-3 h-3" />
                Archive
              </button>
            )}
            {(project.runningAgentCount ?? 0) > 0 && (
              <button
                onClick={() => onStop(project.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-orange-500 rounded-md hover:bg-orange-500/10 transition-colors"
              >
                <Square className="w-3 h-3" />
                Stop All Agents
              </button>
            )}
            {isConfirmingDelete ? (
              <div className="flex items-center gap-2 w-full bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                <span className="text-xs text-red-600 dark:text-red-400 flex-1">
                  Delete <strong>{project.name}</strong>? This cannot be undone.
                </span>
                <button
                  onClick={() => onConfirmDelete(project.id)}
                  className="px-2.5 py-1 text-xs bg-red-500 text-white rounded font-medium hover:bg-red-600 transition-colors"
                >
                  Delete
                </button>
                <button
                  onClick={onCancelDelete}
                  className="px-2.5 py-1 text-xs text-th-text-muted rounded hover:bg-th-bg-muted transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : project.status === 'archived' && (
              <button
                onClick={() => onDelete(project.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-500/80 rounded-md hover:bg-red-500/10 transition-colors ml-auto"
              >
                <Trash2 className="w-3 h-3" />
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ProjectsPanel() {
  const [projects, setProjects] = useState<EnrichedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'archived'>('active');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingCwdId, setEditingCwdId] = useState<string | null>(null);
  const [cwdValue, setCwdValue] = useState('');
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importPath, setImportPath] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [viewSession, setViewSession] = useState<ViewableSession | null>(null);
  const addToast = useToastStore((s) => s.add);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Consume ?action=new param — auto-open the new project modal
  useEffect(() => {
    if (searchParams.get('action') === 'new') {
      setShowNewProject(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch<EnrichedProject[]>('/projects');
      setProjects(Array.isArray(data) ? data : []);
    } catch (err: any) {
      addToast('error', `Failed to load projects: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  // Fetch task progress for each project after loading
  useEffect(() => {
    if (projects.length === 0) return;
    const fetchProgress = async () => {
      const updates = await Promise.all(
        projects.map(async (p) => {
          if (p.taskProgress) return null; // already fetched
          try {
            const dag = await apiFetch<{ summary?: Record<string, number> }>(`/projects/${p.id}/dag`);
            if (!dag?.summary) return null;
            const total = Object.values(dag.summary).reduce((a, b) => a + b, 0);
            const done = dag.summary.done ?? 0;
            return { id: p.id, done, total };
          } catch { return null; }
        }),
      );
      const valid = updates.filter(Boolean) as { id: string; done: number; total: number }[];
      if (valid.length > 0) {
        setProjects(prev => prev.map(p => {
          const match = valid.find(v => v.id === p.id);
          return match ? { ...p, taskProgress: { done: match.done, total: match.total } } : p;
        }));
      }
    };
    fetchProgress();
  }, [projects.length]);

  // Fetch detailed project info when expanding
  const handleToggle = useCallback(
    async (id: string) => {
      if (expandedId === id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(id);
      try {
        const detail = await apiFetch<EnrichedProject>(`/projects/${id}`);
        setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...detail } : p)));
      } catch {
        // Non-critical — the list data is still valid
      }
    },
    [expandedId],
  );

  const handleResume = useCallback(
    async (id: string) => {
      try {
        const response = await apiFetch<{ id: string }>(`/projects/${id}/resume`, { method: 'POST', body: JSON.stringify({}) });
        addToast('success', 'Project resumed — lead agent spawned');
        if (response?.id) {
          navigate(`/projects/${id}`);
        } else {
          await fetchProjects();
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        addToast('error', `Failed to resume: ${msg}`);
      }
    },
    [addToast, fetchProjects, navigate],
  );

  const handleArchive = useCallback(
    async (id: string) => {
      try {
        await apiFetch(`/projects/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'archived' }),
        });
        addToast('success', 'Project archived');
        await fetchProjects();
      } catch (err: any) {
        addToast('error', `Failed to archive: ${err.message}`);
      }
    },
    [addToast, fetchProjects],
  );

  const handleStop = useCallback(
    async (id: string) => {
      try {
        const data = await apiFetch<{ terminated: number }>(`/projects/${id}/stop`, { method: 'POST' });
        addToast('success', `Stopped ${data.terminated ?? 0} agent(s)`);
        await fetchProjects();
      } catch (err: any) {
        addToast('error', `Failed to stop agents: ${err.message}`);
      }
    },
    [addToast, fetchProjects],
  );

  // Step 1: Show confirmation UI
  const handleRequestDelete = useCallback((id: string) => {
    setConfirmingDeleteId(id);
  }, []);

  // Step 2: Actually delete after confirmation
  const handleConfirmDelete = useCallback(
    async (id: string) => {
      try {
        await apiFetch(`/projects/${id}`, { method: 'DELETE' });
        addToast('success', 'Project deleted');
        setProjects((prev) => prev.filter((p) => p.id !== id));
        if (expandedId === id) setExpandedId(null);
        setConfirmingDeleteId(null);
      } catch (err: any) {
        addToast('error', `Failed to delete: ${err.message}`);
      }
    },
    [addToast, expandedId],
  );

  const handleCancelDelete = useCallback(() => {
    setConfirmingDeleteId(null);
  }, []);

  // ── Batch operations ──────────────────────────────────────
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    const visible = projects.filter(p => {
      if (filter === 'active') return p.status === 'active';
      if (filter === 'archived') return p.status === 'archived';
      return true;
    });
    setSelectedIds(new Set(visible.map(p => p.id)));
  }, [projects, filter]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const handleBatchArchive = useCallback(async () => {
    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(
      ids.map(id => apiFetch(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) })),
    );
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    addToast('success', `Archived ${succeeded} project(s)`);
    clearSelection();
    await fetchProjects();
  }, [selectedIds, addToast, clearSelection, fetchProjects]);

  const handleBatchDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    // Only delete projects that are archived
    const archiveOnly = ids.filter(id => projects.find(p => p.id === id)?.status === 'archived');
    if (archiveOnly.length === 0) {
      addToast('error', 'Only archived projects can be batch-deleted');
      return;
    }
    const results = await Promise.allSettled(
      archiveOnly.map(id => apiFetch(`/projects/${id}`, { method: 'DELETE' })),
    );
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    addToast('success', `Deleted ${succeeded} project(s)`);
    clearSelection();
    await fetchProjects();
  }, [selectedIds, projects, addToast, clearSelection, fetchProjects]);

  const allSelectedArchived = Array.from(selectedIds).every(
    id => projects.find(p => p.id === id)?.status === 'archived',
  );

  // ── Edit CWD ──────────────────────────────────────────────
  const handleEditCwd = useCallback((id: string, currentCwd: string) => {
    setEditingCwdId(id);
    setCwdValue(currentCwd);
  }, []);

  const handleSaveCwd = useCallback(async (id: string) => {
    try {
      await apiFetch(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ cwd: cwdValue }) });
      setProjects(prev => prev.map(p => p.id === id ? { ...p, cwd: cwdValue } : p));
      setEditingCwdId(null);
      addToast('success', 'Working directory updated');
    } catch (err: any) {
      addToast('error', `Failed to update path: ${err.message}`);
    }
  }, [cwdValue, addToast]);

  const handleCancelCwdEdit = useCallback(() => {
    setEditingCwdId(null);
  }, []);

  // ── Import project ────────────────────────────────────────
  const handleImportProject = useCallback(async () => {
    if (!importPath.trim()) return;
    setImportLoading(true);
    try {
      const result = await apiFetch<{ id: string; name: string; imported?: { hasShared: boolean; sharedAgentCount: number } }>('/projects/import', {
        method: 'POST',
        body: JSON.stringify({ cwd: importPath.trim() }),
      });
      const extra = result.imported?.sharedAgentCount
        ? ` (${result.imported.sharedAgentCount} shared artifacts found)`
        : '';
      addToast('success', `Imported "${result.name}"${extra}`);
      setShowImportDialog(false);
      setImportPath('');
      await fetchProjects();
    } catch (err: any) {
      addToast('error', `Import failed: ${err.message}`);
    } finally {
      setImportLoading(false);
    }
  }, [importPath, addToast, fetchProjects]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const filtered = projects.filter((p) => {
    if (filter === 'active') return p.status === 'active';
    if (filter === 'archived') return p.status === 'archived';
    return true;
  });

  const totalAgents = projects.reduce((sum, p) => sum + p.activeAgentCount, 0);

  return (
    <div className="flex-1 overflow-auto focus:outline-none" tabIndex={0}>
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FolderCog className="w-6 h-6 text-th-text-muted" />
          <h2 className="text-xl font-semibold">Projects</h2>
          <span className="text-sm text-th-text-muted">
            {projects.length} project{projects.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNewProject(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent text-black rounded-lg hover:bg-accent/90 transition-colors"
            data-testid="new-project-btn"
          >
            <Plus className="w-3.5 h-3.5" />
            New Project
          </button>
          <button
            onClick={() => setShowImportDialog(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-th-text-alt border border-th-border rounded-lg hover:bg-th-bg-muted transition-colors"
            data-testid="import-project-btn"
          >
            <Upload className="w-3.5 h-3.5" />
            Import
          </button>
          <button
            onClick={fetchProjects}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-th-text-muted hover:text-th-text rounded-lg hover:bg-th-bg-muted transition-colors"
            title="Refresh projects"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-surface-raised border border-th-border rounded-lg p-4">
          <div className="text-xs text-th-text-muted uppercase tracking-wider mb-1">Total Projects</div>
          <div className="text-2xl font-semibold text-th-text-alt">{projects.length}</div>
        </div>
        <div className="bg-surface-raised border border-th-border rounded-lg p-4">
          <div className="text-xs text-th-text-muted uppercase tracking-wider mb-1">Active Agents</div>
          <div className="text-2xl font-semibold text-accent">{totalAgents}</div>
        </div>
        <div className="bg-surface-raised border border-th-border rounded-lg p-4">
          <div className="text-xs text-th-text-muted uppercase tracking-wider mb-1">Active Projects</div>
          <div className="text-2xl font-semibold text-th-text-alt">
            {projects.filter((p) => p.status === 'active').length}
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4">
        {(['all', 'active', 'archived'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              filter === f
                ? 'bg-accent text-black font-medium'
                : 'text-th-text-muted hover:text-th-text hover:bg-th-bg-muted'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f !== 'all' && (
              <span className="ml-1 opacity-70">
                ({projects.filter((p) => (f === 'active' ? p.status === 'active' : p.status === 'archived')).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Project list */}
      {loading && projects.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-6 h-6 border-2 border-th-text-muted/30 border-t-accent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-surface-raised border border-th-border rounded-lg p-12 text-center">
          <FolderOpen className="w-12 h-12 text-th-text-muted/30 mx-auto mb-3" />
          <p className="text-sm text-th-text-muted mb-3">
            {filter === 'all'
              ? 'No projects yet. Create your first project to get started.'
              : `No ${filter} projects.`}
          </p>
          {filter === 'all' && (
            <button
              onClick={() => setShowNewProject(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-accent text-black rounded-lg hover:bg-accent/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Project
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Batch action bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 px-3 py-2 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <span className="text-xs font-medium text-th-text-alt">{selectedIds.size} selected</span>
              <button onClick={selectAllVisible} className="text-xs text-blue-400 hover:underline">Select all</button>
              <div className="flex-1" />
              <button
                onClick={handleBatchArchive}
                className="text-xs px-2 py-1 rounded bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors"
              >
                Archive selected
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={!allSelectedArchived}
                className="text-xs px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={allSelectedArchived ? 'Delete selected projects' : 'Only archived projects can be deleted'}
              >
                Delete selected
              </button>
              <button onClick={clearSelection} className="text-xs text-th-text-muted hover:text-th-text transition-colors">
                ✕
              </button>
            </div>
          )}
          {filtered.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              isExpanded={expandedId === project.id}
              isSelected={selectedIds.has(project.id)}
              onToggle={() => handleToggle(project.id)}
              onSelect={() => toggleSelect(project.id)}
              onResume={handleResume}
              onArchive={handleArchive}
              onStop={handleStop}
              onDelete={handleRequestDelete}
              confirmingDeleteId={confirmingDeleteId}
              onConfirmDelete={handleConfirmDelete}
              onCancelDelete={handleCancelDelete}
              editingCwdId={editingCwdId}
              cwdValue={cwdValue}
              onEditCwd={handleEditCwd}
              onCwdChange={setCwdValue}
              onSaveCwd={handleSaveCwd}
              onCancelCwdEdit={handleCancelCwdEdit}
              onViewSession={setViewSession}
            />
          ))}
        </div>
      )}
    </div>
    {showNewProject && <NewProjectModal onClose={() => { setShowNewProject(false); fetchProjects(); }} />}

    {/* Import Project Dialog */}
    {showImportDialog && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowImportDialog(false)}>
        <div className="bg-surface-raised border border-th-border rounded-xl shadow-xl w-full max-w-md mx-4 p-5" onClick={e => e.stopPropagation()}>
          <h3 className="text-lg font-semibold text-th-text mb-1">Import Project</h3>
          <p className="text-xs text-th-text-muted mb-4">
            Enter the path to a directory containing a <code className="bg-th-bg-alt px-1 rounded">.flightdeck/</code> folder.
            Shared artifacts will be available. Knowledge and memory from a previous database are not included.
          </p>
          <input
            type="text"
            value={importPath}
            onChange={e => setImportPath(e.target.value)}
            placeholder="/path/to/your/project"
            className="w-full bg-th-bg border border-th-border rounded-md px-3 py-2 text-sm font-mono text-th-text-alt focus:outline-none focus:border-accent mb-4"
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && importPath.trim()) handleImportProject(); }}
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setShowImportDialog(false); setImportPath(''); }}
              className="px-3 py-1.5 text-xs text-th-text-muted rounded-md hover:bg-th-bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleImportProject}
              disabled={!importPath.trim() || importLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent text-black rounded-md hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {importLoading ? (
                <div className="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              Import
            </button>
          </div>
        </div>
      </div>
    )}

    {viewSession && (
      <SessionViewer
        session={viewSession}
        onClose={() => setViewSession(null)}
        onResume={viewSession.projectId ? () => {
          setViewSession(null);
          if (viewSession.projectId) handleResume(viewSession.projectId);
        } : undefined}
      />
    )}
    </div>
  );
}
