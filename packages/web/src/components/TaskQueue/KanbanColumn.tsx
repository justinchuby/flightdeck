import { useMemo, useState } from 'react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import type { DagTask } from '../../types';
import { type ColumnDef, STATUS_BG, COLUMN_TOOLTIPS, DEFAULT_VISIBLE } from './kanbanConstants';
import { SortableTaskCard } from './TaskCard';

// ── Kanban Column Component ─────────────────────────────────────────

export interface KanbanColumnProps {
  column: ColumnDef;
  tasks: DagTask[];
  allTasks: DagTask[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  isDropTarget: boolean;
  isInvalidTarget: boolean;
  projectId?: string;
  onTaskUpdated?: () => void;
  showProjectName?: boolean;
  projectNameMap?: Map<string, string>;
  reorderable?: boolean;
}

export function KanbanColumn({ column, tasks, allTasks, collapsed, onToggleCollapse, isDropTarget, isInvalidTarget, projectId, onTaskUpdated, showProjectName, projectNameMap, reorderable = true }: KanbanColumnProps) {
  const { setNodeRef } = useDroppable({ id: `column-${column.status}` });
  const [showAll, setShowAll] = useState(false);

  // Done/Skipped columns show only recent tasks by default
  const isCompletedColumn = column.status === 'done' || column.status === 'skipped';
  const visibleTasks = isCompletedColumn && !showAll && tasks.length > DEFAULT_VISIBLE
    ? tasks.slice(0, DEFAULT_VISIBLE)
    : tasks;
  const hiddenCount = tasks.length - visibleTasks.length;

  const taskIds = useMemo(() => visibleTasks.map(t => t.id), [visibleTasks]);

  const highlightClass = isInvalidTarget
    ? 'ring-2 ring-red-500/40'
    : isDropTarget
    ? 'ring-2 ring-blue-500/40'
    : '';

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-lg border ${column.borderClass} ${STATUS_BG[column.status]} min-w-[220px] max-w-[300px] flex-1 ${highlightClass}`}
      data-testid={`kanban-column-${column.status}`}
    >
      {/* Column header */}
      <button
        className="flex items-center gap-2 px-3 py-2.5 border-b border-th-border/50 w-full text-left"
        onClick={onToggleCollapse}
        title={COLUMN_TOOLTIPS[column.status]}
      >
        <span className={column.accentClass}>{column.icon}</span>
        <span className="text-xs font-medium text-th-text">{column.label}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tasks.length > 0 ? column.accentClass + ' bg-th-bg-muted' : 'text-th-text-muted'}`}>
          {tasks.length}
        </span>
        <span className="ml-auto text-th-text-muted">
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </span>
      </button>

      {/* Task cards */}
      {!collapsed && (
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          <div className="p-2 space-y-2 overflow-y-auto flex-1 min-h-0">
            {tasks.length === 0 ? (
              <div className="text-[10px] text-th-text-muted text-center py-4 italic">
                No tasks
              </div>
            ) : (
              <>
                {visibleTasks.map(task => (
                  <SortableTaskCard
                    key={task.id}
                    task={task}
                    allTasks={allTasks}
                    projectId={projectId}
                    onTaskUpdated={onTaskUpdated}
                    showProjectName={showProjectName}
                    projectName={projectNameMap?.get(task.projectId ?? '') ?? task.projectId}
                    reorderable={reorderable}
                  />
                ))}
                {hiddenCount > 0 && (
                  <button
                    onClick={() => setShowAll(true)}
                    className="w-full text-[10px] text-th-text-muted hover:text-th-text py-1.5 text-center"
                    data-testid="show-all-toggle"
                  >
                    Show all {tasks.length} tasks
                  </button>
                )}
                {showAll && isCompletedColumn && tasks.length > DEFAULT_VISIBLE && (
                  <button
                    onClick={() => setShowAll(false)}
                    className="w-full text-[10px] text-th-text-muted hover:text-th-text py-1.5 text-center"
                    data-testid="show-less-toggle"
                  >
                    Show recent {DEFAULT_VISIBLE}
                  </button>
                )}
              </>
            )}
          </div>
        </SortableContext>
      )}
    </div>
  );
}

// ── Inline Error Toast ──────────────────────────────────────────────

export function InlineToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded text-[11px] text-red-400">
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} className="hover:text-red-300"><X size={12} /></button>
    </div>
  );
}
