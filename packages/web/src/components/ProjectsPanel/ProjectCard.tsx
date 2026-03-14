import { Link } from 'react-router-dom';
import {
  FolderOpen,
  Users,
  ChevronRight,
  ChevronDown,
  Home,
  GitBranch,
  ListChecks,
} from 'lucide-react';
import { formatRelativeTime } from '../../utils/formatRelativeTime';
import { StatusBadge, projectStatusProps } from '../ui/StatusBadge';
import type { ViewableSession } from '../SessionHistory';
import { ProjectCardDetails } from './ProjectCardDetails';

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
        <ProjectCardDetails
          project={project}
          onResume={onResume}
          onArchive={onArchive}
          onStop={onStop}
          onDelete={onDelete}
          isConfirmingDelete={confirmingDeleteId === project.id}
          onConfirmDelete={onConfirmDelete}
          onCancelDelete={onCancelDelete}
          editingCwdId={editingCwdId}
          cwdValue={cwdValue}
          onEditCwd={onEditCwd}
          onCwdChange={onCwdChange}
          onSaveCwd={onSaveCwd}
          onCancelCwdEdit={onCancelCwdEdit}
          onViewSession={onViewSession}
        />
      )}
    </div>
  );
}
