import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
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
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  Clock,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Pause,
  SkipForward,
  Play,
  Lock,
  ChevronDown,
  ChevronRight,
  User,
  GitBranch,
  FileText,
  Plus,
  X,
  Search,
  RotateCcw,
  RefreshCw,
  ExternalLink,
  ArrowUpDown,
  MoreHorizontal,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { formatRelativeTime } from '../../utils/formatRelativeTime';
import type { DagStatus, DagTask, DagTaskStatus } from '../../types';

// ── Column Definitions ──────────────────────────────────────────────

interface ColumnDef {
  status: DagTaskStatus;
  label: string;
  icon: React.ReactNode;
  accentClass: string;
  borderClass: string;
}

const COLUMNS: ColumnDef[] = [
  { status: 'pending',  label: 'Pending',  icon: <Clock size={14} />,        accentClass: 'text-th-text-muted',  borderClass: 'border-th-border' },
  { status: 'ready',    label: 'Ready',    icon: <Play size={14} />,         accentClass: 'text-green-400',      borderClass: 'border-green-500/30' },
  { status: 'running',  label: 'Running',  icon: <AlertCircle size={14} />,  accentClass: 'text-blue-400',       borderClass: 'border-blue-500/30' },
  { status: 'blocked',  label: 'Blocked',  icon: <Lock size={14} />,         accentClass: 'text-orange-400',     borderClass: 'border-orange-500/30' },
  { status: 'done',     label: 'Done',     icon: <CheckCircle2 size={14} />, accentClass: 'text-emerald-400',    borderClass: 'border-emerald-500/30' },
  { status: 'failed',   label: 'Failed',   icon: <XCircle size={14} />,      accentClass: 'text-red-400',        borderClass: 'border-red-500/30' },
  { status: 'paused',   label: 'Paused',   icon: <Pause size={14} />,        accentClass: 'text-yellow-400',     borderClass: 'border-yellow-500/30' },
  { status: 'skipped',  label: 'Skipped',  icon: <SkipForward size={14} />,  accentClass: 'text-th-text-muted',  borderClass: 'border-th-border border-dashed' },
];

const COLUMN_STATUSES = new Set<string>(COLUMNS.map(c => c.status));

// Statuses that cannot be set via drag – they are auto-managed
const UNDROP_TARGETS = new Set<DagTaskStatus>(['running', 'blocked']);

// ── Status background styles (matches DagGraph conventions) ─────────

const STATUS_BG: Record<DagTaskStatus, string> = {
  pending:  'bg-th-bg-muted/50',
  ready:    'bg-green-500/5',
  running:  'bg-blue-500/5',
  blocked:  'bg-orange-500/5',
  done:     'bg-emerald-500/5',
  failed:   'bg-red-500/5',
  paused:   'bg-yellow-500/5',
  skipped:  'bg-th-bg-muted/30',
};

// ── Helpers ──────────────────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

function priorityBadge(priority: number): React.ReactNode {
  if (priority <= 0) return null;
  const colors = priority >= 3 ? 'bg-red-500/20 text-red-400' :
                 priority === 2 ? 'bg-orange-500/20 text-orange-400' :
                 'bg-blue-500/20 text-blue-400';
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${colors}`}>
      P{priority}
    </span>
  );
}

/** Show time spent in current status, e.g. "Running: 12m" or "Blocked: 2h" */
function timeInStatus(task: DagTask): string {
  const refTime =
    task.dagStatus === 'running' ? task.startedAt :
    task.dagStatus === 'done' || task.dagStatus === 'failed' ? task.completedAt :
    task.createdAt;
  if (!refTime) return '';
  const diffMs = Date.now() - new Date(refTime.endsWith('Z') ? refTime : refTime.replace(' ', 'T') + 'Z').getTime();
  if (diffMs < 60_000) return '<1m';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h`;
  return `${Math.floor(diffMs / 86_400_000)}d`;
}

const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

function isStale(task: DagTask): boolean {
  if (task.dagStatus !== 'running' || !task.startedAt) return false;
  const elapsed = Date.now() - new Date(task.startedAt.endsWith('Z') ? task.startedAt : task.startedAt.replace(' ', 'T') + 'Z').getTime();
  return elapsed > STALE_THRESHOLD_MS;
}

const COLUMN_TOOLTIPS: Record<DagTaskStatus, string> = {
  pending: 'Tasks waiting for dependencies to complete',
  ready: 'Tasks ready to be picked up by an agent',
  running: 'Tasks currently being worked on by an agent',
  blocked: 'Tasks blocked by unresolved dependencies or failures',
  done: 'Successfully completed tasks',
  failed: 'Tasks that failed — click to retry or view error',
  paused: 'Tasks temporarily paused by user or system',
  skipped: 'Tasks that were skipped (not needed)',
};

/** Resolve which column (status) a droppable id belongs to */
function resolveColumnStatus(id: string | number, taskLookup: Map<string, DagTask>): DagTaskStatus | null {
  const strId = String(id);
  // Direct column id (e.g. "column-done")
  if (strId.startsWith('column-')) {
    const status = strId.slice(7) as DagTaskStatus;
    return COLUMN_STATUSES.has(status) ? status : null;
  }
  // Task id – look up the task's current column
  const task = taskLookup.get(strId);
  return task ? task.dagStatus : null;
}

// ── Add Task Form ───────────────────────────────────────────────────

interface AddTaskFormProps {
  projectId: string;
  onCreated: () => void;
  onClose: () => void;
}

function AddTaskForm({ projectId, onCreated, onClose }: AddTaskFormProps) {
  const [title, setTitle] = useState('');
  const [role, setRole] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !role.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/projects/${projectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          role: role.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
        }),
      });
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message ?? 'Failed to create task');
      console.warn('Failed to create task', err);
    } finally {
      setSubmitting(false);
    }
  }, [title, role, description, projectId, onCreated, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      className="bg-th-bg border border-th-border rounded-lg p-3 space-y-2"
      data-testid="add-task-form"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-th-text">New Task</span>
        <button type="button" onClick={onClose} className="text-th-text-muted hover:text-th-text">
          <X size={14} />
        </button>
      </div>
      <input
        autoFocus
        required
        aria-label="Task title"
        placeholder="Title *"
        value={title}
        onChange={e => setTitle(e.target.value)}
        className="w-full text-xs bg-th-bg-muted border border-th-border rounded px-2 py-1.5 text-th-text placeholder:text-th-text-muted focus:outline-none focus:border-blue-500/50"
      />
      <input
        required
        aria-label="Task role"
        placeholder="Role *"
        value={role}
        onChange={e => setRole(e.target.value)}
        className="w-full text-xs bg-th-bg-muted border border-th-border rounded px-2 py-1.5 text-th-text placeholder:text-th-text-muted focus:outline-none focus:border-blue-500/50"
      />
      <textarea
        aria-label="Task description"
        placeholder="Description (optional)"
        value={description}
        onChange={e => setDescription(e.target.value)}
        rows={2}
        className="w-full text-xs bg-th-bg-muted border border-th-border rounded px-2 py-1.5 text-th-text placeholder:text-th-text-muted focus:outline-none focus:border-blue-500/50 resize-none"
      />
      {error && <div className="text-[10px] text-red-400">{error}</div>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] px-2 py-1 rounded text-th-text-muted hover:text-th-text"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !title.trim() || !role.trim()}
          className="text-[11px] px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
        >
          {submitting ? 'Adding…' : 'Add Task'}
        </button>
      </div>
    </form>
  );
}

// ── Task Card Component ─────────────────────────────────────────────

interface TaskCardProps {
  task: DagTask;
  allTasks: DagTask[];
  isDragOverlay?: boolean;
  projectId?: string;
  onTaskUpdated?: () => void;
  showProjectName?: boolean;
  projectName?: string;
}

function TaskCard({ task, allTasks, isDragOverlay, projectId, onTaskUpdated, showProjectName, projectName }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const title = task.title || task.description || task.id;
  const hasDetails = task.dependsOn.length > 0 || task.files.length > 0 || task.assignedAgentId;
  const stale = isStale(task);
  const statusTime = timeInStatus(task);

  const dependencyNames = useMemo(() => {
    if (task.dependsOn.length === 0) return [];
    return task.dependsOn.map(depId => {
      const dep = allTasks.find(t => t.id === depId);
      return { id: depId, label: dep?.title || dep?.id || depId, status: dep?.dagStatus };
    });
  }, [task.dependsOn, allTasks]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [contextMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const doAction = useCallback(async (action: string) => {
    setContextMenu(null);
    if (!projectId) return;
    try {
      switch (action) {
        case 'retry':
          await apiFetch(`/projects/${projectId}/tasks/${task.id}/status`, {
            method: 'PATCH', body: JSON.stringify({ status: 'ready' }),
          });
          break;
        case 'pause':
          await apiFetch(`/projects/${projectId}/tasks/${task.id}/status`, {
            method: 'PATCH', body: JSON.stringify({ status: 'paused' }),
          });
          break;
        case 'resume':
          await apiFetch(`/projects/${projectId}/tasks/${task.id}/status`, {
            method: 'PATCH', body: JSON.stringify({ status: 'ready' }),
          });
          break;
        case 'skip':
          await apiFetch(`/projects/${projectId}/tasks/${task.id}/status`, {
            method: 'PATCH', body: JSON.stringify({ status: 'skipped' }),
          });
          break;
        case 'force-ready':
          await apiFetch(`/projects/${projectId}/tasks/${task.id}/status`, {
            method: 'PATCH', body: JSON.stringify({ status: 'ready' }),
          });
          break;
      }
      onTaskUpdated?.();
    } catch (err: any) {
      console.warn(`Action ${action} failed`, err);
    }
  }, [projectId, task.id, onTaskUpdated]);

  // Build context menu items based on current status
  const contextMenuItems = useMemo(() => {
    const items: Array<{ label: string; action: string; icon: React.ReactNode }> = [];
    const s = task.dagStatus;
    if (s === 'failed') items.push({ label: 'Retry', action: 'retry', icon: <RotateCcw size={12} /> });
    if (s === 'running') items.push({ label: 'Pause', action: 'pause', icon: <Pause size={12} /> });
    if (s === 'paused') items.push({ label: 'Resume', action: 'resume', icon: <RefreshCw size={12} /> });
    if (s === 'blocked' || s === 'pending') items.push({ label: 'Force Ready', action: 'force-ready', icon: <Play size={12} /> });
    if (s !== 'done' && s !== 'skipped') items.push({ label: 'Skip', action: 'skip', icon: <SkipForward size={12} /> });
    return items;
  }, [task.dagStatus]);

  return (
    <div
      className={`group/card bg-th-bg rounded-md border ${
        stale ? 'border-l-2 border-l-amber-400 border-t-th-border border-r-th-border border-b-th-border' : 'border-th-border'
      } p-2.5 shadow-sm transition-colors ${
        isDragOverlay ? 'opacity-80 shadow-lg ring-2 ring-blue-500/30' : 'hover:border-th-text-muted/30 cursor-pointer'
      }`}
      onClick={() => !isDragOverlay && hasDetails && setExpanded(!expanded)}
      onContextMenu={!isDragOverlay ? handleContextMenu : undefined}
      data-testid={`kanban-card-${task.id}`}
    >
      {/* Project name (shown in global scope) */}
      {showProjectName && projectName && (
        <div className="text-[10px] text-th-text-muted mb-0.5 flex items-center gap-1">
          📁 {truncate(projectName, 30)}
        </div>
      )}

      {/* Header row: title + priority */}
      <div className="flex items-start justify-between gap-1.5">
        <div className="flex items-start gap-1 min-w-0 flex-1">
          {hasDetails && (
            <span className="mt-0.5 text-th-text-muted flex-shrink-0">
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
          )}
          <span className="text-xs font-medium text-th-text leading-tight break-words">
            {truncate(title, 80)}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {stale && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium" data-testid="stale-badge">
              STALE
            </span>
          )}
          {priorityBadge(task.priority)}
          {!isDragOverlay && contextMenuItems.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setContextMenu({ x: rect.right, y: rect.bottom });
              }}
              className="opacity-0 group-hover/card:opacity-100 focus:opacity-100 p-0.5 rounded hover:bg-th-bg-muted text-th-text-muted hover:text-th-text transition-opacity"
              aria-label="Task actions"
              data-testid="context-menu-trigger"
            >
              <MoreHorizontal size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Meta row: role + agent + time-in-status */}
      <div className="flex items-center gap-2 mt-1.5 text-[10px] text-th-text-muted">
        <span className="bg-th-bg-muted px-1.5 py-0.5 rounded text-th-text-alt">{task.role}</span>
        {task.assignedAgentId && (
          <span className="flex items-center gap-0.5" data-testid="agent-badge">
            <User size={9} />
            {truncate(task.assignedAgentId, 4)}
          </span>
        )}
        {statusTime && (
          <span className="ml-auto" title={task.startedAt || task.createdAt}>
            {task.dagStatus === 'running' ? '⏱' : task.dagStatus === 'blocked' ? '⏳' : ''} {statusTime}
          </span>
        )}
      </div>

      {/* Failure reason (shown inline for failed tasks) */}
      {task.dagStatus === 'failed' && task.failureReason && (
        <div className="mt-1.5 text-[10px] text-red-400 bg-red-500/10 px-1.5 py-1 rounded" data-testid="failure-reason">
          {truncate(task.failureReason, 80)}
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="mt-2 pt-2 border-t border-th-border space-y-1.5">
          {/* Dependencies */}
          {dependencyNames.length > 0 && (
            <div className="space-y-0.5">
              <div className="flex items-center gap-1 text-[10px] text-th-text-muted">
                <GitBranch size={10} />
                <span>Dependencies:</span>
              </div>
              {dependencyNames.map(dep => (
                <div key={dep.id} className="ml-3 text-[10px] text-th-text-alt flex items-center gap-1">
                  <span className={dep.status === 'done' ? 'text-emerald-400' : dep.status === 'running' ? 'text-blue-400' : 'text-th-text-muted'}>
                    {dep.status === 'done' ? '✓' : dep.status === 'running' ? '●' : '○'}
                  </span>
                  {truncate(dep.label, 40)}
                </div>
              ))}
            </div>
          )}

          {/* Files */}
          {task.files.length > 0 && (
            <div className="space-y-0.5">
              <div className="flex items-center gap-1 text-[10px] text-th-text-muted">
                <FileText size={10} />
                <span>Files ({task.files.length}):</span>
              </div>
              {task.files.slice(0, 3).map(file => (
                <div key={file} className="ml-3 text-[10px] text-th-text-alt font-mono">
                  {truncate(file, 40)}
                </div>
              ))}
              {task.files.length > 3 && (
                <div className="ml-3 text-[10px] text-th-text-muted">
                  +{task.files.length - 3} more
                </div>
              )}
            </div>
          )}

          {/* Full description if different from title */}
          {task.description && task.description !== title && (
            <div className="text-[10px] text-th-text-alt mt-1">
              {truncate(task.description, 200)}
            </div>
          )}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && contextMenuItems.length > 0 && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-th-bg border border-th-border rounded-lg shadow-xl py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          data-testid="context-menu"
        >
          {contextMenuItems.map(item => (
            <button
              key={item.action}
              onClick={(e) => { e.stopPropagation(); doAction(item.action); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-th-text hover:bg-th-bg-muted text-left"
            >
              <span className="text-th-text-muted">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sortable Task Card Wrapper ──────────────────────────────────────

interface SortableTaskCardProps {
  task: DagTask;
  allTasks: DagTask[];
  projectId?: string;
  onTaskUpdated?: () => void;
  showProjectName?: boolean;
  projectName?: string;
}

function SortableTaskCard({ task, allTasks, projectId, onTaskUpdated, showProjectName, projectName }: SortableTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard task={task} allTasks={allTasks} projectId={projectId} onTaskUpdated={onTaskUpdated} showProjectName={showProjectName} projectName={projectName} />
    </div>
  );
}

// ── Kanban Column Component ─────────────────────────────────────────

interface KanbanColumnProps {
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
}

function KanbanColumn({ column, tasks, allTasks, collapsed, onToggleCollapse, isDropTarget, isInvalidTarget, projectId, onTaskUpdated, showProjectName, projectNameMap }: KanbanColumnProps) {
  const { setNodeRef } = useDroppable({ id: `column-${column.status}` });
  const [showAll, setShowAll] = useState(false);

  // Done/Skipped columns show only 5 most recent by default
  const isCompletedColumn = column.status === 'done' || column.status === 'skipped';
  const DEFAULT_VISIBLE = 5;
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
          <div className="p-2 space-y-2 overflow-y-auto flex-1 max-h-[calc(100vh-220px)]">
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

function InlineToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded text-[11px] text-red-400">
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} className="hover:text-red-300"><X size={12} /></button>
    </div>
  );
}

// ── Filter Types ────────────────────────────────────────────────────

interface FilterState {
  search: string;
  roles: Set<string>;
  priorities: Set<number>;
  statuses: Set<DagTaskStatus>;
  agents: Set<string>;
}

const EMPTY_FILTERS: FilterState = {
  search: '',
  roles: new Set(),
  priorities: new Set(),
  statuses: new Set(),
  agents: new Set(),
};

function hasActiveFilters(f: FilterState): boolean {
  return f.search !== '' || f.roles.size > 0 || f.priorities.size > 0 || f.statuses.size > 0 || f.agents.size > 0;
}

// ── Filter Bar Component ────────────────────────────────────────────

interface FilterBarProps {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  availableRoles: string[];
  availablePriorities: number[];
  availableAgents: string[];
}

function FilterBar({ filters, onChange, availableRoles, availablePriorities, availableAgents }: FilterBarProps) {
  const toggleSetItem = <T,>(set: Set<T>, item: T): Set<T> => {
    const next = new Set(set);
    if (next.has(item)) next.delete(item);
    else next.add(item);
    return next;
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-th-border/50 overflow-x-auto" data-testid="filter-bar">
      {/* Search */}
      <div className="flex items-center gap-1 bg-th-bg-muted rounded px-2 py-1 min-w-[120px]">
        <Search size={11} className="text-th-text-muted flex-shrink-0" />
        <input
          type="text"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Search tasks…"
          aria-label="Search tasks"
          className="bg-transparent text-[11px] text-th-text outline-none w-full placeholder:text-th-text-muted"
          data-testid="filter-search"
        />
      </div>

      {/* Role chips */}
      {availableRoles.length > 1 && (
        <div className="flex items-center gap-1">
          {availableRoles.map(role => (
            <button
              key={role}
              onClick={() => onChange({ ...filters, roles: toggleSetItem(filters.roles, role) })}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                filters.roles.has(role)
                  ? 'bg-blue-500/20 border-blue-500/40 text-blue-400'
                  : 'border-th-border text-th-text-muted hover:text-th-text hover:border-th-text-muted'
              }`}
              data-testid={`filter-role-${role}`}
            >
              {role}
            </button>
          ))}
        </div>
      )}

      {/* Priority chips */}
      {availablePriorities.filter(p => p > 0).length > 0 && (
        <div className="flex items-center gap-1">
          {availablePriorities.filter(p => p > 0).sort((a, b) => b - a).map(p => (
            <button
              key={p}
              onClick={() => onChange({ ...filters, priorities: toggleSetItem(filters.priorities, p) })}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                filters.priorities.has(p)
                  ? 'bg-orange-500/20 border-orange-500/40 text-orange-400'
                  : 'border-th-border text-th-text-muted hover:text-th-text hover:border-th-text-muted'
              }`}
              data-testid={`filter-priority-${p}`}
            >
              P{p}
            </button>
          ))}
        </div>
      )}

      {/* Clear filters */}
      {hasActiveFilters(filters) && (
        <button
          onClick={() => onChange({ ...EMPTY_FILTERS })}
          className="text-[10px] text-th-text-muted hover:text-th-text flex items-center gap-0.5"
          data-testid="filter-clear"
        >
          <X size={10} /> Clear
        </button>
      )}
    </div>
  );
}

// ── Main KanbanBoard Component ──────────────────────────────────────

interface KanbanBoardProps {
  dagStatus: DagStatus | null;
  projectId?: string;
  onTaskUpdated?: () => void;
  scope?: 'global' | 'project';
  projectNameMap?: Map<string, string>;
}

function KanbanBoard({ dagStatus, projectId, onTaskUpdated, scope = 'project', projectNameMap }: KanbanBoardProps) {
  const storageKey = projectId ? `kanban-${projectId}` : 'kanban-global';

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

    // Cross-column drag → status change
    if (targetStatus !== sourceStatus) {
      if (UNDROP_TARGETS.has(targetStatus)) {
        setToastMessage(`Cannot manually move tasks to "${targetStatus}" – it is auto-managed`);
        return;
      }

      apiFetch(`/projects/${projectId}/tasks/${draggedTask.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: targetStatus }),
      })
        .then(() => onTaskUpdated?.())
        .catch((err: any) => {
          const msg = err.message?.includes('409')
            ? `Invalid transition: ${sourceStatus} → ${targetStatus}`
            : err.message ?? 'Failed to update task status';
          setToastMessage(msg);
          console.warn('Status update failed', err);
        });
      return;
    }

    // Same-column drag → reorder (priority change)
    if (String(active.id) !== String(over.id)) {
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
        .catch((err: any) => {
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
    </div>
  );
}

export { KanbanBoard };
export type { KanbanBoardProps, FilterState };
