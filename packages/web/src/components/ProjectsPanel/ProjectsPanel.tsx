import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FolderOpen, Plus } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToastStore } from '../Toast';
import { NewProjectModal } from '../LeadDashboard/NewProjectModal';
import { SessionViewer, type ViewableSession } from '../SessionHistory';
import { ProjectCard, type EnrichedProject } from './ProjectCard';
import { ProjectFilters } from './ProjectFilters';
import { ImportProjectDialog } from './ImportProjectDialog';
import { BatchActionBar } from './BatchActionBar';

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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addToast('error', `Failed to load projects: ${message}`);
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
        const response = await apiFetch<{ id: string }>(`/projects/${id}/resume`, { method: 'POST', body: JSON.stringify({ resumeAll: true }) });
        addToast('success', 'Project resumed — lead agent spawned');
        if (response?.id) {
          navigate(`/projects/${id}/session`);
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
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        addToast('error', `Failed to archive: ${message}`);
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
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        addToast('error', `Failed to stop agents: ${message}`);
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
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        addToast('error', `Failed to delete: ${message}`);
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addToast('error', `Failed to update path: ${message}`);
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addToast('error', `Import failed: ${message}`);
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
      <ProjectFilters
        totalProjects={projects.length}
        totalAgents={totalAgents}
        activeProjects={projects.filter((p) => p.status === 'active').length}
        filter={filter}
        onFilterChange={setFilter}
        activeCt={projects.filter((p) => p.status === 'active').length}
        archivedCt={projects.filter((p) => p.status === 'archived').length}
        loading={loading}
        onNewProject={() => setShowNewProject(true)}
        onImport={() => setShowImportDialog(true)}
        onRefresh={fetchProjects}
      />

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
          <BatchActionBar
            selectedCount={selectedIds.size}
            allSelectedArchived={allSelectedArchived}
            onSelectAll={selectAllVisible}
            onArchive={handleBatchArchive}
            onDelete={handleBatchDelete}
            onClear={clearSelection}
          />
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

    {showImportDialog && (
      <ImportProjectDialog
        importPath={importPath}
        onPathChange={setImportPath}
        onImport={handleImportProject}
        onClose={() => setShowImportDialog(false)}
        loading={importLoading}
      />
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
