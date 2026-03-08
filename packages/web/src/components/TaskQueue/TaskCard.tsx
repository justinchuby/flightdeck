import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronDown,
  ChevronRight,
  User,
  GitBranch,
  FileText,
  RotateCcw,
  RefreshCw,
  Pause,
  Play,
  SkipForward,
  MoreHorizontal,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useSettingsStore } from '../../stores/settingsStore';
import type { DagTask } from '../../types';
import { truncate, priorityBadge, timeInStatus, isStale, TRUNCATE_LENGTHS } from './kanbanConstants';

// ── Task Card Component ─────────────────────────────────────────────

export interface TaskCardProps {
  task: DagTask;
  allTasks: DagTask[];
  isDragOverlay?: boolean;
  projectId?: string;
  onTaskUpdated?: () => void;
  showProjectName?: boolean;
  projectName?: string;
}

export function TaskCard({ task, allTasks, isDragOverlay, projectId, onTaskUpdated, showProjectName, projectName }: TaskCardProps) {
  const oversightLevel = useSettingsStore((s) => s.oversightLevel);
  const isMinimal = oversightLevel === 'minimal';
  const isDetailed = oversightLevel === 'detailed';
  const [expanded, setExpanded] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const title = task.title || task.description || task.id;
  const hasDetails = task.dependsOn.length > 0 || task.files.length > 0 || task.assignedAgentId;
  const stale = isStale(task);
  const statusTime = timeInStatus(task);
  const isArchived = !!task.archivedAt;

  // Auto-expand in detailed mode (AC-16.4)
  useEffect(() => {
    if (isDetailed && hasDetails) setExpanded(true);
  }, [isDetailed, hasDetails]);

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

  const handleTaskAction = useCallback(async (action: string) => {
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
        case 'restore':
          await apiFetch(`/tasks/${task.leadId}/${task.id}/unarchive`, { method: 'PATCH' });
          break;
      }
      onTaskUpdated?.();
    } catch (err: any) {
      console.warn(`Action ${action} failed`, err);
    }
  }, [projectId, task.id, onTaskUpdated]);

  // Build context menu items based on current status
  const contextMenuItems = useMemo(() => {
    if (isArchived) return [{ label: 'Restore', action: 'restore', icon: <RotateCcw size={12} /> }];
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
      } ${isMinimal ? 'p-1.5' : 'p-2.5'} shadow-sm transition-all ${
        isDragOverlay ? 'opacity-80 shadow-lg ring-2 ring-blue-500/30' : 'hover:border-th-text-muted/30 cursor-pointer'
      } ${isArchived ? 'opacity-50' : ''}`}
      onClick={() => !isDragOverlay && hasDetails && setExpanded(!expanded)}
      onContextMenu={!isDragOverlay ? handleContextMenu : undefined}
      data-testid={`kanban-card-${task.id}`}
    >
      {/* Project name (shown in global scope) */}
      {showProjectName && projectName && (
        <div className="text-[10px] text-th-text-muted mb-0.5 flex items-center gap-1">
          📁 {truncate(projectName, TRUNCATE_LENGTHS.projectName)}
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
            {truncate(title, TRUNCATE_LENGTHS.title)}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {stale && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium" data-testid="stale-badge">
              STALE
            </span>
          )}
          {isArchived && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-th-bg-muted text-th-text-muted font-medium" data-testid="archived-badge">
              ARCHIVED
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

      {/* Meta row: role + agent + time-in-status (hidden in minimal mode, AC-16.4) */}
      {!isMinimal && (
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
      )}

      {/* Failure reason (shown inline for failed tasks) */}
      {task.dagStatus === 'failed' && task.failureReason && (
        <div className="mt-1.5 text-[10px] text-red-400 bg-red-500/10 px-1.5 py-1 rounded" data-testid="failure-reason">
          {truncate(task.failureReason, TRUNCATE_LENGTHS.failureReason)}
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
                  {truncate(dep.label, TRUNCATE_LENGTHS.depLabel)}
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
                  {truncate(file, TRUNCATE_LENGTHS.depLabel)}
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
              {truncate(task.description, TRUNCATE_LENGTHS.description)}
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
              onClick={(e) => { e.stopPropagation(); handleTaskAction(item.action); }}
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

export interface SortableTaskCardProps {
  task: DagTask;
  allTasks: DagTask[];
  projectId?: string;
  onTaskUpdated?: () => void;
  showProjectName?: boolean;
  projectName?: string;
}

export function SortableTaskCard({ task, allTasks, projectId, onTaskUpdated, showProjectName, projectName }: SortableTaskCardProps) {
  const isArchived = !!task.archivedAt;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: isArchived });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...(isArchived ? {} : listeners)}>
      <TaskCard task={task} allTasks={allTasks} projectId={projectId} onTaskUpdated={onTaskUpdated} showProjectName={showProjectName} projectName={projectName} />
    </div>
  );
}
