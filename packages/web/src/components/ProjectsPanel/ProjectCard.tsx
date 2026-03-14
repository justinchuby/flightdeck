import { Link } from 'react-router-dom';
import {
  FolderOpen,
  Trash2,
  Play,
  Users,
  HardDrive,
  Clock,
  ChevronRight,
  ChevronDown,
  Home,
  GitBranch,
  Archive,
  AlertTriangle,
  ListChecks,
  Pencil,
  Square,
  ArrowRight,
} from 'lucide-react';
import { formatRelativeTime } from '../../utils/formatRelativeTime';
import { formatDate } from '../../utils/format';
import { StatusBadge, projectStatusProps } from '../ui/StatusBadge';
import { sessionStatusDot } from '../../utils/statusColors';
import type { ViewableSession } from '../SessionHistory';
import { shortAgentId } from '../../utils/agentLabel';

/** Extended project type with storage and agent count info from the enriched API */
export interface EnrichedProject {
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
  tokenUsage?: { inputTokens: number; outputTokens: number; costUsd: number };
}

/** Format a token count for display (e.g., 1234 → "1.2K", 1234567 → "1.2M") */
function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
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

export function ProjectCard({
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
            {project.tokenUsage && (project.tokenUsage.inputTokens > 0 || project.tokenUsage.outputTokens > 0) && (
              <div>
                <span className="text-th-text-muted">Token Usage</span>
                <div className="text-th-text-alt text-xs">
                  {formatTokenCount(project.tokenUsage.inputTokens)} in / {formatTokenCount(project.tokenUsage.outputTokens)} out
                  {project.tokenUsage.costUsd > 0 && (
                    <span className="text-th-text-muted ml-1">(${project.tokenUsage.costUsd.toFixed(2)})</span>
                  )}
                </div>
              </div>
            )}
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
                      {shortAgentId(s.leadId)}
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
            <Link
              to={`/projects/${project.id}`}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-th-bg-muted text-th-text-alt rounded-md hover:bg-th-border transition-colors font-medium no-underline"
              onClick={(e) => e.stopPropagation()}
            >
              <ArrowRight className="w-3 h-3" />
              Enter Project
            </Link>
            {(() => {
              const effectiveStatus = projectStatusProps(project);
              const isLive = effectiveStatus.variant === 'success' || effectiveStatus.variant === 'warning';
              return (
                <>
                  {isLive && (
                    <Link
                      to={`/projects/${project.id}/session`}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent/20 text-accent rounded-md hover:bg-accent/30 transition-colors font-medium no-underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Play className="w-3 h-3" />
                      Go to Session
                    </Link>
                  )}
                  {project.status !== 'archived' && !isLive && (
                    <button
                      onClick={() => onResume(project.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent/20 text-accent rounded-md hover:bg-accent/30 transition-colors font-medium"
                    >
                      <Play className="w-3 h-3" />
                      Resume
                    </button>
                  )}
                  {isLive && (
                    <button
                      onClick={() => onArchive(project.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-th-text-muted rounded-md hover:bg-th-bg-muted transition-colors"
                    >
                      <Archive className="w-3 h-3" />
                      Archive
                    </button>
                  )}
                </>
              );
            })()}
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
