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
  MessageSquare,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { dagTaskText } from '../../utils/statusColors';
import { useSettingsStore } from '../../stores/settingsStore';
import type { DagTask } from '../../types';
import { truncate, priorityBadge, timeInStatus, TRUNCATE_LENGTHS } from './kanbanConstants';
import { AgentDetailPanel } from '../AgentDetailPanel';

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
  const isMinimal = oversightLevel === 'autonomous';
  const isDetailed = oversightLevel === 'supervised';
  const [expanded, setExpanded] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showCommentDialog, setShowCommentDialog] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentSending, setCommentSending] = useState(false);
  const [detailAgentId, setDetailAgentId] = useState<string | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const title = task.title || task.description || task.id;
  const hasDetails = task.dependsOn.length > 0 || task.files.length > 0 || task.assignedAgentId;
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
    } catch (err: unknown) {
      console.error(`Action ${action} failed`, err);
    }
  }, [projectId, task.id, onTaskUpdated]);

  const handleCommentSubmit = useCallback(async () => {
    if (!commentText.trim() || !task.leadId) return;
    setCommentSending(true);
    try {
      const taskLabel = task.title || task.id;
      const text = `[Task Comment] Re: "${taskLabel}" (${task.id})\n\n${commentText.trim()}`;
      await apiFetch(`/lead/${task.leadId}/message`, {
        method: 'POST',
        body: JSON.stringify({ text, mode: 'queue' }),
      });
      setCommentText('');
      setShowCommentDialog(false);
      onTaskUpdated?.(); // refresh to show toast externally if needed
    } catch (err: unknown) {
      console.error('Failed to send comment to lead', err);
    } finally {
      setCommentSending(false);
    }
  }, [commentText, task.leadId, task.title, task.id, onTaskUpdated]);

  // Focus comment textarea when dialog opens
  useEffect(() => {
    if (showCommentDialog && commentInputRef.current) {
      commentInputRef.current.focus();
    }
  }, [showCommentDialog]);

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
        'border-th-border'
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
          {isArchived && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-th-bg-muted text-th-text-muted font-medium" data-testid="archived-badge">
              ARCHIVED
            </span>
          )}
          {priorityBadge(task.priority)}
          {!isDragOverlay && !isArchived && task.leadId && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowCommentDialog(prev => !prev);
              }}
              className="opacity-0 group-hover/card:opacity-100 focus:opacity-100 p-0.5 rounded hover:bg-th-bg-muted text-th-text-muted hover:text-th-text transition-opacity"
              aria-label="Comment on task"
              data-testid="comment-trigger"
              title="Send comment to lead"
            >
              <MessageSquare size={12} />
            </button>
          )}
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
            <button
              className="flex items-center gap-0.5 hover:text-th-text-accent hover:underline cursor-pointer"
              data-testid="agent-badge"
              onClick={(e) => { e.stopPropagation(); setDetailAgentId(task.assignedAgentId!); }}
              title="View agent details"
            >
              <User size={9} />
              {truncate(task.assignedAgentId, 4)}
            </button>
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
                  <span className={dagTaskText(dep.status ?? 'pending')}>
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

      {/* Comment dialog */}
      {showCommentDialog && (
        <div
          className="mt-2 p-2 bg-th-bg-muted rounded border border-th-border"
          onClick={(e) => e.stopPropagation()}
          data-testid="comment-dialog"
        >
          <textarea
            ref={commentInputRef}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Send a comment to the lead..."
            className="w-full text-[11px] bg-th-bg border border-th-border rounded px-2 py-1.5 text-th-text placeholder-th-text-muted resize-none focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleCommentSubmit();
              }
              if (e.key === 'Escape') {
                setShowCommentDialog(false);
                setCommentText('');
              }
            }}
            data-testid="comment-input"
          />
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[9px] text-th-text-muted">⌘+Enter to send</span>
            <div className="flex gap-1.5">
              <button
                onClick={() => { setShowCommentDialog(false); setCommentText(''); }}
                className="text-[10px] px-2 py-0.5 rounded text-th-text-muted hover:text-th-text hover:bg-th-bg"
                data-testid="comment-cancel"
              >
                Cancel
              </button>
              <button
                onClick={handleCommentSubmit}
                disabled={!commentText.trim() || commentSending}
                className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="comment-send"
              >
                {commentSending ? 'Sending…' : 'Send to Lead'}
              </button>
            </div>
          </div>
        </div>
      )}
      {detailAgentId && (
        <AgentDetailPanel agentId={detailAgentId} mode="modal" onClose={() => setDetailAgentId(null)} />
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
  reorderable?: boolean;
}

export function SortableTaskCard({ task, allTasks, projectId, onTaskUpdated, showProjectName, projectName, reorderable = true }: SortableTaskCardProps) {
  const isArchived = !!task.archivedAt;
  const dragDisabled = isArchived || !reorderable;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: dragDisabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...(dragDisabled ? {} : listeners)}>
      <TaskCard task={task} allTasks={allTasks} projectId={projectId} onTaskUpdated={onTaskUpdated} showProjectName={showProjectName} projectName={projectName} />
    </div>
  );
}
