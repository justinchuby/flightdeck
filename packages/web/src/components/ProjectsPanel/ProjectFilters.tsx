import { FolderCog, Plus, Upload, RefreshCw } from 'lucide-react';

interface ProjectFiltersProps {
  totalProjects: number;
  totalAgents: number;
  activeProjects: number;
  filter: 'all' | 'active' | 'archived';
  onFilterChange: (f: 'all' | 'active' | 'archived') => void;
  /** Counts per filter status for display in the tab labels */
  activeCt: number;
  archivedCt: number;
  loading: boolean;
  onNewProject: () => void;
  onImport: () => void;
  onRefresh: () => void;
}

/** Header, summary cards, and filter tabs for the projects panel. */
export function ProjectFilters({
  totalProjects,
  totalAgents,
  activeProjects,
  filter,
  onFilterChange,
  activeCt,
  archivedCt,
  loading,
  onNewProject,
  onImport,
  onRefresh,
}: ProjectFiltersProps) {
  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FolderCog className="w-6 h-6 text-th-text-muted" />
          <h2 className="text-xl font-semibold">Projects</h2>
          <span className="text-sm text-th-text-muted">
            {totalProjects} project{totalProjects !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onNewProject}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent text-black rounded-lg hover:bg-accent/90 transition-colors"
            data-testid="new-project-btn"
          >
            <Plus className="w-3.5 h-3.5" />
            New Project
          </button>
          <button
            onClick={onImport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-th-text-alt border border-th-border rounded-lg hover:bg-th-bg-muted transition-colors"
            data-testid="import-project-btn"
          >
            <Upload className="w-3.5 h-3.5" />
            Import
          </button>
          <button
            onClick={onRefresh}
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
          <div className="text-2xl font-semibold text-th-text-alt">{totalProjects}</div>
        </div>
        <div className="bg-surface-raised border border-th-border rounded-lg p-4">
          <div className="text-xs text-th-text-muted uppercase tracking-wider mb-1">Active Agents</div>
          <div className="text-2xl font-semibold text-accent">{totalAgents}</div>
        </div>
        <div className="bg-surface-raised border border-th-border rounded-lg p-4">
          <div className="text-xs text-th-text-muted uppercase tracking-wider mb-1">Active Projects</div>
          <div className="text-2xl font-semibold text-th-text-alt">{activeProjects}</div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4">
        {(['all', 'active', 'archived'] as const).map((f) => (
          <button
            key={f}
            onClick={() => onFilterChange(f)}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              filter === f
                ? 'bg-accent text-black font-medium'
                : 'text-th-text-muted hover:text-th-text hover:bg-th-bg-muted'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f !== 'all' && (
              <span className="ml-1 opacity-70">
                ({f === 'active' ? activeCt : archivedCt})
              </span>
            )}
          </button>
        ))}
      </div>
    </>
  );
}
