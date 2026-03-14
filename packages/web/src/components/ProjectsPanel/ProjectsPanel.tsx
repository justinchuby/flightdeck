import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FolderOpen, Plus } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToastStore } from '../Toast';
import { NewProjectModal } from '../LeadDashboard/NewProjectModal';
import { SessionViewer, type ViewableSession } from '../SessionHistory';
import { ProjectCard, type EnrichedProject } from './ProjectCard';
import { ProjectFilters } from './ProjectFilters';
import { ImportProjectDialog } from './ImportProjectDialog';
import { BatchActionBar } from './BatchActionBar';
import { useProjectActions } from './useProjectActions';

export function ProjectsPanel() {
  const [projects, setProjects] = useState<EnrichedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'archived'>('active');
  const [showNewProject, setShowNewProject] = useState(false);
  const [viewSession, setViewSession] = useState<ViewableSession | null>(null);
  const addToast = useToastStore((s) => s.add);
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

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const actions = useProjectActions(fetchProjects, projects);

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
        onImport={() => actions.setShowImportDialog(true)}
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
            selectedCount={actions.selectedIds.size}
            allSelectedArchived={actions.allSelectedArchived}
            onSelectAll={() => actions.selectAllVisible(filter)}
            onArchive={actions.handleBatchArchive}
            onDelete={actions.handleBatchDelete}
            onClear={actions.clearSelection}
          />
          {filtered.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              isExpanded={actions.expandedId === project.id}
              isSelected={actions.selectedIds.has(project.id)}
              onToggle={() => actions.handleToggle(project.id, setProjects)}
              onSelect={() => actions.toggleSelect(project.id)}
              onResume={actions.handleResume}
              onArchive={actions.handleArchive}
              onStop={actions.handleStop}
              onDelete={actions.handleRequestDelete}
              confirmingDeleteId={actions.confirmingDeleteId}
              onConfirmDelete={actions.handleConfirmDelete}
              onCancelDelete={actions.handleCancelDelete}
              editingCwdId={actions.editingCwdId}
              cwdValue={actions.cwdValue}
              onEditCwd={actions.handleEditCwd}
              onCwdChange={actions.setCwdValue}
              onSaveCwd={(id) => actions.handleSaveCwd(id, setProjects)}
              onCancelCwdEdit={actions.handleCancelCwdEdit}
              onViewSession={setViewSession}
            />
          ))}
        </div>
      )}
    </div>
    {showNewProject && <NewProjectModal onClose={() => { setShowNewProject(false); fetchProjects(); }} />}

    {actions.showImportDialog && (
      <ImportProjectDialog
        importPath={actions.importPath}
        onPathChange={actions.setImportPath}
        onImport={actions.handleImportProject}
        onClose={() => actions.setShowImportDialog(false)}
        loading={actions.importLoading}
      />
    )}

    {viewSession && (
      <SessionViewer
        session={viewSession}
        onClose={() => setViewSession(null)}
        onResume={viewSession.projectId ? () => {
          setViewSession(null);
          if (viewSession.projectId) actions.handleResume(viewSession.projectId);
        } : undefined}
      />
    )}
    </div>
  );
}
