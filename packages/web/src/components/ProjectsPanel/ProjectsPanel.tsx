import { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { formatRelativeTime } from '../../utils/formatRelativeTime';
import { useToastStore } from '../Toast';

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
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
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

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-500/10 text-green-600 dark:text-green-400',
    archived: 'bg-gray-500/10 text-gray-500',
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${colors[status] ?? colors.active}`}>
      {status}
    </span>
  );
}

function ProjectCard({
  project,
  isExpanded,
  onToggle,
  onResume,
  onArchive,
  onDelete,
  confirmingDeleteId,
  onConfirmDelete,
  onCancelDelete,
}: {
  project: EnrichedProject;
  isExpanded: boolean;
  onToggle: () => void;
  onResume: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  confirmingDeleteId: string | null;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
}) {
  const isConfirmingDelete = confirmingDeleteId === project.id;
  return (
    <div className="bg-surface-raised border border-th-border rounded-lg overflow-hidden transition-colors hover:border-th-border-hover">
      {/* Card header */}
      <div
        className="flex items-center gap-3 p-3 cursor-pointer"
        onClick={onToggle}
        role="button"
        aria-expanded={isExpanded}
        aria-label={`${project.name} project details`}
      >
        <FolderOpen className="w-5 h-5 text-accent shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-th-text-alt">{project.name}</span>
            <StatusBadge status={project.status} />
            <StorageBadge mode={project.storageMode} />
          </div>
          {project.description && (
            <div className="text-xs text-th-text-muted truncate mt-0.5">{project.description}</div>
          )}
        </div>

        {/* Agent count badge */}
        {project.activeAgentCount > 0 && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-accent bg-accent/10 px-2 py-0.5 rounded-full shrink-0">
            <Users className="w-2.5 h-2.5" />
            {project.activeAgentCount}
          </span>
        )}

        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-th-text-muted shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-th-text-muted shrink-0" />
        )}
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
            {project.cwd && (
              <div className="col-span-2">
                <span className="text-th-text-muted">Working directory</span>
                <div className="font-mono text-th-text-alt truncate" title={project.cwd}>
                  {project.cwd}
                </div>
              </div>
            )}
            <div>
              <span className="text-th-text-muted">Storage mode</span>
              <div className="flex items-center gap-1.5 text-th-text-alt">
                <HardDrive className="w-3 h-3" />
                {project.storageMode === 'user' ? 'User (~/.flightdeck/)' : 'Local (.flightdeck/)'}
              </div>
            </div>
            <div>
              <span className="text-th-text-muted">Active agents</span>
              <div className="text-th-text-alt flex items-center gap-1">
                <Users className="w-3 h-3" />
                {project.activeAgentCount}
              </div>
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
                {project.sessions.slice(-5).reverse().map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-[11px]">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        s.status === 'active'
                          ? 'bg-green-400'
                          : s.status === 'completed'
                            ? 'bg-blue-400'
                            : s.status === 'crashed'
                              ? 'bg-red-400'
                              : 'bg-gray-400'
                      }`}
                    />
                    <span className="font-mono text-th-text-muted">{s.leadId.slice(0, 8)}</span>
                    <span className="text-th-text-alt truncate">{s.task || s.status}</span>
                    <span className="text-th-text-muted ml-auto shrink-0">
                      {formatRelativeTime(s.startedAt)}
                    </span>
                  </div>
                ))}
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
            ) : (
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
  const [filter, setFilter] = useState<'all' | 'active' | 'archived'>('all');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const addToast = useToastStore((s) => s.add);

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
        await apiFetch(`/projects/${id}/resume`, { method: 'POST', body: JSON.stringify({}) });
        addToast('success', 'Project resumed — lead agent spawned');
        await fetchProjects();
      } catch (err: any) {
        addToast('error', `Failed to resume: ${err.message}`);
      }
    },
    [addToast, fetchProjects],
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
    <div className="flex-1 overflow-auto p-6 max-w-5xl mx-auto">
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
          <p className="text-sm text-th-text-muted">
            {filter === 'all'
              ? 'No projects yet. Start a new session to create your first project.'
              : `No ${filter} projects.`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              isExpanded={expandedId === project.id}
              onToggle={() => handleToggle(project.id)}
              onResume={handleResume}
              onArchive={handleArchive}
              onDelete={handleRequestDelete}
              confirmingDeleteId={confirmingDeleteId}
              onConfirmDelete={handleConfirmDelete}
              onCancelDelete={handleCancelDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
