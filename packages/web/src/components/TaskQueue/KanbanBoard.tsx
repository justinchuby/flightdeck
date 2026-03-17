import { useMemo, useState, useCallback, useEffect } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { Plus, Search, Archive } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useSettingsStore } from '../../stores/settingsStore';
import type { DagStatus, DagTask, DagTaskStatus } from '../../types';
import { COLUMNS, UNDROP_TARGETS, REORDERABLE_COLUMNS, resolveColumnStatus, type FilterState, EMPTY_FILTERS, hasActiveFilters } from './kanbanConstants';
import { TaskCard } from './TaskCard';
import { FilterBar } from './FilterBar';
import { KanbanColumn, InlineToast } from './KanbanColumn';
import { AddTaskForm } from './AddTaskForm';

// ── Main KanbanBoard Component ──────────────────────────────────────

interface KanbanBoardProps {
  dagStatus: DagStatus | null;
  projectId?: string;
  onTaskUpdated?: () => void;
  scope?: 'global' | 'project';
  projectNameMap?: Map<string, string>;
  hasMore?: boolean;
  onLoadMore?: () => void;
  showArchived?: boolean;
  onShowArchivedChange?: (show: boolean) => void;
}

function KanbanBoard({ dagStatus, projectId, onTaskUpdated, scope = 'project', projectNameMap, hasMore, onLoadMore, showArchived = false, onShowArchivedChange }: KanbanBoardProps) {
  const storageKey = projectId ? `kanban-${projectId}` : 'kanban-global';
  const oversightLevel = useSettingsStore(s => s.oversightLevel);

  // Load persisted state
  const loadPersistedState = useCallback(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return {};
  }, [storageKey]);

  const persisted = loadPersistedState();

  const [collapsedColumns, setCollapsedColumns] = useState<Set<DagTaskStatus>>(
    new Set(persisted.collapsed ?? []),
  );
  const [hideEmpty, setHideEmpty] = useState(persisted.hideEmpty ?? false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [overColumnStatus, setOverColumnStatus] = useState<DagTaskStatus | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>({ ...EMPTY_FILTERS });
  const [showFilters, setShowFilters] = useState(false);

  // Persist view state
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        collapsed: [...collapsedColumns],
        hideEmpty,
      }));
    } catch { /* ignore */ }
  }, [collapsedColumns, hideEmpty, storageKey]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Extract filter options from tasks
  const availableRoles = useMemo(() => {
    const roles = new Set<string>();
    for (const t of dagStatus?.tasks ?? []) roles.add(t.role);
    return [...roles].sort();
  }, [dagStatus?.tasks]);

  const availablePriorities = useMemo(() => {
    const pris = new Set<number>();
    for (const t of dagStatus?.tasks ?? []) pris.add(t.priority);
    return [...pris];
  }, [dagStatus?.tasks]);

  const availableAgents = useMemo(() => {
    const agents = new Set<string>();
    for (const t of dagStatus?.tasks ?? []) {
      if (t.assignedAgentId) agents.add(t.assignedAgentId);
    }
    return [...agents].sort();
  }, [dagStatus?.tasks]);

  const tasksByStatus = useMemo(() => {
    const map = new Map<DagTaskStatus, DagTask[]>();
    for (const col of COLUMNS) {
      map.set(col.status, []);
    }
    if (dagStatus?.tasks) {
      for (const task of dagStatus.tasks) {
        // Apply filters
        if (filters.search) {
          const q = filters.search.toLowerCase();
          const matches = (task.title ?? '').toLowerCase().includes(q) ||
            task.description.toLowerCase().includes(q) ||
            task.id.toLowerCase().includes(q) ||
            task.role.toLowerCase().includes(q);
          if (!matches) continue;
        }
        if (filters.roles.size > 0 && !filters.roles.has(task.role)) continue;
        if (filters.priorities.size > 0 && !filters.priorities.has(task.priority)) continue;
        if (filters.statuses.size > 0 && !filters.statuses.has(task.dagStatus)) continue;
        if (filters.agents.size > 0 && !(task.assignedAgentId && filters.agents.has(task.assignedAgentId))) continue;

        const list = map.get(task.dagStatus);
        if (list) {
          list.push(task);
        }
      }
    }
    // Sort tasks within each column: by priority (desc), then createdAt (asc)
    for (const [, tasks] of map) {
      tasks.sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.createdAt.localeCompare(b.createdAt);
      });
    }
    return map;
  }, [dagStatus?.tasks, filters]);

  const allTasks = dagStatus?.tasks ?? [];
  const filteredTaskCount = useMemo(() => {
    let count = 0;
    for (const [, tasks] of tasksByStatus) count += tasks.length;
    return count;
  }, [tasksByStatus]);

  const taskLookup = useMemo(() => {
    const m = new Map<string, DagTask>();
    for (const t of allTasks) m.set(t.id, t);
    return m;
  }, [allTasks]);

  // Auto-collapse Done/Skipped when they dominate (R6)
  const activeCount = useMemo(() => {
    let c = 0;
    for (const s of ['running', 'ready', 'failed', 'blocked', 'pending'] as DagTaskStatus[]) {
      c += tasksByStatus.get(s)?.length ?? 0;
    }
    return c;
  }, [tasksByStatus]);

  const doneCount = (tasksByStatus.get('done')?.length ?? 0) + (tasksByStatus.get('skipped')?.length ?? 0);

  useEffect(() => {
    if (doneCount > activeCount && doneCount > 0) {
      setCollapsedColumns(prev => {
        const next = new Set(prev);
        next.add('done');
        next.add('skipped');
        return next;
      });
    }
  }, [doneCount, activeCount]);

  // AC-12.5: Failed column is NEVER hidden by "hide empty columns"
  const visibleColumns = useMemo(() => {
    if (!hideEmpty) return COLUMNS;
    return COLUMNS.filter(col =>
      col.status === 'failed' || (tasksByStatus.get(col.status)?.length ?? 0) > 0
    );
  }, [hideEmpty, tasksByStatus]);

  const toggleCollapse = useCallback((status: DagTaskStatus) => {
    setCollapsedColumns(prev => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  }, []);

  // ── Drag-and-drop handlers ────────────────────────────────────────

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveTaskId(String(event.active.id));
    setToastMessage(null);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    if (!over) {
      setOverColumnStatus(null);
      return;
    }
    const status = resolveColumnStatus(over.id, taskLookup);
    setOverColumnStatus(status);
  }, [taskLookup]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTaskId(null);
    setOverColumnStatus(null);

    if (!over || !projectId) return;

    const draggedTask = taskLookup.get(String(active.id));
    if (!draggedTask) return;

    const targetStatus = resolveColumnStatus(over.id, taskLookup);
    if (!targetStatus) return;

    const sourceStatus = draggedTask.dagStatus;

    // Cross-column drag is disabled — only the lead/system can change task status
    if (targetStatus !== sourceStatus) {
      setToastMessage('Only the lead can change task status');
      return;
    }

    // Same-column drag → reorder (only in pending/ready columns)
    if (String(active.id) !== String(over.id)) {
      if (!REORDERABLE_COLUMNS.has(sourceStatus)) {
        setToastMessage(`Reordering is not allowed in the "${sourceStatus}" column`);
        return;
      }
      const columnTasks = tasksByStatus.get(sourceStatus);
      if (!columnTasks) return;

      const oldIndex = columnTasks.findIndex(t => t.id === String(active.id));
      const newIndex = columnTasks.findIndex(t => t.id === String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(columnTasks, oldIndex, newIndex);
      // Fractional priority: midpoint between neighbors to avoid drift
      const draggedIdx = reordered.findIndex(t => t.id === String(active.id));
      const above = draggedIdx > 0 ? reordered[draggedIdx - 1].priority : reordered[draggedIdx].priority + 1;
      const below = draggedIdx < reordered.length - 1 ? reordered[draggedIdx + 1].priority : 0;
      const newPriority = Math.round(((above + below) / 2) * 100) / 100;

      apiFetch(`/projects/${projectId}/tasks/${draggedTask.id}/priority`, {
        method: 'PATCH',
        body: JSON.stringify({ priority: newPriority }),
      })
        .then(() => onTaskUpdated?.())
        .catch((err: unknown) => {
          console.warn('Priority update failed', err);
        });
    }
  }, [projectId, taskLookup, tasksByStatus, onTaskUpdated]);

  const handleDragCancel = useCallback(() => {
    setActiveTaskId(null);
    setOverColumnStatus(null);
  }, []);

  const activeTask = activeTaskId ? taskLookup.get(activeTaskId) ?? null : null;

  // ── Render ────────────────────────────────────────────────────────

  const isGlobalView = scope === 'global';

  if (!dagStatus || dagStatus.tasks.length === 0) {
    return (
      <div className="flex flex-col h-full" data-testid="kanban-board">
        {projectId && showAddForm && (
          <div className="px-3 pt-3">
            <AddTaskForm
              projectId={projectId}
              onCreated={() => onTaskUpdated?.()}
              onClose={() => setShowAddForm(false)}
            />
          </div>
        )}
        <div className="flex flex-col items-center justify-center h-64 gap-3 text-th-text-muted">
          <div className="text-sm">
            {isGlobalView ? 'No tasks across any projects' : 'No tasks in this project'}
          </div>
          {projectId && !showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 border border-blue-500/30 rounded px-3 py-1.5"
            >
              <Plus size={14} /> Create first task
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" data-testid="kanban-board">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-th-border/50">
        <div className="flex items-center gap-3">
          <div className="text-[11px] text-th-text-muted">
            {hasActiveFilters(filters)
              ? `${filteredTaskCount} of ${dagStatus.tasks.length} tasks`
              : `${dagStatus.tasks.length} tasks`
            }
            {isGlobalView && ' across all projects'}
          </div>
          {projectId && (
            <button
              onClick={() => setShowAddForm(v => !v)}
              className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300"
              data-testid="add-task-button"
            >
              <Plus size={12} /> Add
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`flex items-center gap-1 text-[11px] ${
              showFilters || hasActiveFilters(filters) ? 'text-blue-400' : 'text-th-text-muted hover:text-th-text'
            }`}
            data-testid="toggle-filters"
          >
            <Search size={11} />
            Filter
            {hasActiveFilters(filters) && (
              <span className="bg-blue-500/20 text-blue-400 text-[9px] px-1 rounded-full">
                {filters.roles.size + filters.priorities.size + filters.agents.size + (filters.search ? 1 : 0)}
              </span>
            )}
          </button>
          <label className="flex items-center gap-1.5 text-[11px] text-th-text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={hideEmpty}
              onChange={(e) => setHideEmpty(e.target.checked)}
              className="rounded border-th-border"
            />
            Hide empty
          </label>
          {onShowArchivedChange && oversightLevel !== 'autonomous' && (
            <label className="flex items-center gap-1.5 text-[11px] text-th-text-muted cursor-pointer" data-testid="show-archived-toggle">
              <Archive size={11} />
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => onShowArchivedChange(e.target.checked)}
                className="rounded border-th-border"
              />
              Show archived
            </label>
          )}
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <FilterBar
          filters={filters}
          onChange={setFilters}
          availableRoles={availableRoles}
          availablePriorities={availablePriorities}
          availableAgents={availableAgents}
        />
      )}

      {/* Add task form */}
      {showAddForm && projectId && (
        <div className="px-3 pt-3">
          <AddTaskForm
            projectId={projectId}
            onCreated={() => onTaskUpdated?.()}
            onClose={() => setShowAddForm(false)}
          />
        </div>
      )}

      {/* Toast */}
      {toastMessage && (
        <div className="px-3 pt-2">
          <InlineToast message={toastMessage} onDismiss={() => setToastMessage(null)} />
        </div>
      )}

      {/* Column grid with DnD */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex gap-3 p-3 overflow-x-auto flex-1 items-start">
          {visibleColumns.map(col => (
            <KanbanColumn
              key={col.status}
              column={col}
              tasks={tasksByStatus.get(col.status) ?? []}
              allTasks={allTasks}
              collapsed={collapsedColumns.has(col.status)}
              onToggleCollapse={() => toggleCollapse(col.status)}
              isDropTarget={overColumnStatus === col.status && !UNDROP_TARGETS.has(col.status)}
              isInvalidTarget={overColumnStatus === col.status && UNDROP_TARGETS.has(col.status)}
              projectId={projectId}
              onTaskUpdated={onTaskUpdated}
              showProjectName={isGlobalView}
              projectNameMap={projectNameMap}
              reorderable={REORDERABLE_COLUMNS.has(col.status)}
            />
          ))}
        </div>

        {/* Drag overlay – renders the dragged card above everything */}
        <DragOverlay>
          {activeTask ? (
            <TaskCard task={activeTask} allTasks={allTasks} isDragOverlay />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Load More button for paginated results */}
      {hasMore && onLoadMore && (
        <div className="px-3 pb-3">
          <button
            onClick={onLoadMore}
            className="w-full py-2 text-xs text-th-text-muted hover:text-th-text bg-th-bg-muted hover:bg-th-bg-muted/80 rounded border border-th-border/50 transition-colors"
            data-testid="load-more-tasks"
          >
            Load more tasks…
          </button>
        </div>
      )}
    </div>
  );
}

export { KanbanBoard };
export type { KanbanBoardProps, FilterState };
