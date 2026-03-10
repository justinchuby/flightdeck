import React from 'react';
import {
  Clock,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Pause,
  SkipForward,
  Play,
  Lock,
  Eye,
} from 'lucide-react';
import type { DagTask, DagTaskStatus } from '../../types';

// ── Column Definitions ──────────────────────────────────────────────

export interface ColumnDef {
  status: DagTaskStatus;
  label: string;
  icon: React.ReactNode;
  accentClass: string;
  borderClass: string;
}

export const COLUMNS: ColumnDef[] = [
  { status: 'pending',  label: 'Pending',  icon: React.createElement(Clock, { size: 14 }),        accentClass: 'text-th-text-muted',  borderClass: 'border-th-border' },
  { status: 'ready',    label: 'Ready',    icon: React.createElement(Play, { size: 14 }),         accentClass: 'text-green-400',      borderClass: 'border-green-500/30' },
  { status: 'running',  label: 'Running',  icon: React.createElement(AlertCircle, { size: 14 }),  accentClass: 'text-blue-400',       borderClass: 'border-blue-500/30' },
  { status: 'in_review', label: 'In Review', icon: React.createElement(Eye, { size: 14 }),        accentClass: 'text-violet-400',     borderClass: 'border-violet-500/30' },
  { status: 'blocked',  label: 'Blocked',  icon: React.createElement(Lock, { size: 14 }),         accentClass: 'text-orange-400',     borderClass: 'border-orange-500/30' },
  { status: 'done',     label: 'Done',     icon: React.createElement(CheckCircle2, { size: 14 }), accentClass: 'text-emerald-400',    borderClass: 'border-emerald-500/30' },
  { status: 'failed',   label: 'Failed',   icon: React.createElement(XCircle, { size: 14 }),      accentClass: 'text-red-400',        borderClass: 'border-red-500/30' },
  { status: 'paused',   label: 'Paused',   icon: React.createElement(Pause, { size: 14 }),        accentClass: 'text-yellow-400',     borderClass: 'border-yellow-500/30' },
  { status: 'skipped',  label: 'Skipped',  icon: React.createElement(SkipForward, { size: 14 }),  accentClass: 'text-th-text-muted',  borderClass: 'border-th-border border-dashed' },
];

export const COLUMN_STATUSES = new Set<string>(COLUMNS.map(c => c.status));

// Statuses that cannot be set via drag – they are auto-managed
export const UNDROP_TARGETS = new Set<DagTaskStatus>(['running', 'blocked']);

// Columns where within-column reorder (priority drag) is allowed
export const REORDERABLE_COLUMNS = new Set<DagTaskStatus>(['pending', 'ready']);

// ── Status background styles (matches DagGraph conventions) ─────────

export const STATUS_BG: Record<DagTaskStatus, string> = {
  pending:    'bg-th-bg-muted/50',
  ready:      'bg-green-500/5',
  running:    'bg-blue-500/5',
  in_review:  'bg-violet-500/5',
  blocked:    'bg-orange-500/5',
  done:       'bg-emerald-500/5',
  failed:     'bg-red-500/5',
  paused:     'bg-yellow-500/5',
  skipped:    'bg-th-bg-muted/30',
};

// ── Helpers ──────────────────────────────────────────────────────────

/** Max display lengths for truncated text across Kanban components */
export const TRUNCATE_LENGTHS = {
  projectName: 30,
  depLabel: 40,
  title: 80,
  description: 200,
  failureReason: 80,
} as const;

/** Number of tasks shown by default in completed columns (Done/Skipped) */
export const DEFAULT_VISIBLE = 5;

export function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

export function priorityBadge(priority: number): React.ReactNode {
  if (priority <= 0) return null;
  const colors = priority >= 3 ? 'bg-red-500/20 text-red-400' :
                 priority === 2 ? 'bg-orange-500/20 text-orange-400' :
                 'bg-blue-500/20 text-blue-400';
  return (
    React.createElement('span', {
      className: `text-[10px] px-1.5 py-0.5 rounded-full font-medium ${colors}`,
    }, `P${priority}`)
  );
}

/** Show time spent in current status, e.g. "Running: 12m" or "Blocked: 2h" */
export function timeInStatus(task: DagTask): string {
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


export const COLUMN_TOOLTIPS: Record<DagTaskStatus, string> = {
  pending: 'Tasks waiting for dependencies to complete',
  ready: 'Tasks ready to be picked up by an agent',
  running: 'Tasks currently being worked on by an agent',
  in_review: 'Tasks awaiting code review or approval',
  blocked: 'Tasks blocked by unresolved dependencies or failures',
  done: 'Successfully completed tasks',
  failed: 'Tasks that failed — click to retry or view error',
  paused: 'Tasks temporarily paused by user or system',
  skipped: 'Tasks that were skipped (not needed)',
};

/** Resolve which column (status) a droppable id belongs to */
export function resolveColumnStatus(id: string | number, taskLookup: Map<string, DagTask>): DagTaskStatus | null {
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

// ── Filter Types ────────────────────────────────────────────────────

export interface FilterState {
  search: string;
  roles: Set<string>;
  priorities: Set<number>;
  statuses: Set<DagTaskStatus>;
  agents: Set<string>;
}

export const EMPTY_FILTERS: FilterState = {
  search: '',
  roles: new Set(),
  priorities: new Set(),
  statuses: new Set(),
  agents: new Set(),
};

export function hasActiveFilters(f: FilterState): boolean {
  return f.search !== '' || f.roles.size > 0 || f.priorities.size > 0 || f.statuses.size > 0 || f.agents.size > 0;
}
