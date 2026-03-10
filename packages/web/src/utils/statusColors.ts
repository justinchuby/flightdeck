/**
 * Canonical status → color mapping for the entire web UI.
 *
 * Every component should import from here instead of defining
 * its own inline mapping. This prevents contradictions like
 * "running = green" in one place and "running = blue" in another.
 *
 * Canonical colors:
 *   running   = BLUE
 *   done      = PURPLE
 *   idle      = GRAY
 *   blocked   = AMBER
 *   failed    = RED
 *   waiting   = YELLOW
 */

// ── Agent statuses (used in Timeline, AgentFleet, AgentCard, etc.) ────

export type AgentStatus =
  | 'creating'
  | 'running'
  | 'idle'
  | 'completed'
  | 'failed'
  | 'terminated';

interface StatusStyle {
  /** Tailwind dot/badge background class */
  dot: string;
  /** Tailwind text color class */
  text: string;
}

const AGENT_STATUS_STYLES: Record<AgentStatus, StatusStyle> = {
  creating:   { dot: 'bg-yellow-400',  text: 'text-yellow-600 dark:text-yellow-400' },
  running:    { dot: 'bg-blue-400',    text: 'text-blue-400' },
  idle:       { dot: 'bg-gray-400',    text: 'text-gray-400' },
  completed:  { dot: 'bg-purple-400',  text: 'text-purple-400' },
  failed:     { dot: 'bg-red-400',     text: 'text-red-400' },
  terminated: { dot: 'bg-orange-400',  text: 'text-orange-400' },
};

/** Get the dot/badge background class for an agent status. */
export function agentStatusDot(status: string): string {
  return (AGENT_STATUS_STYLES as Record<string, StatusStyle>)[status]?.dot ?? 'bg-gray-400';
}

/** Get the text color class for an agent status. */
export function agentStatusText(status: string): string {
  return (AGENT_STATUS_STYLES as Record<string, StatusStyle>)[status]?.text ?? 'text-th-text-muted';
}

// ── DAG task statuses (used in DagGraph, DagGantt, DagMinimap, etc.) ──

export type DagTaskStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'in_review'
  | 'done'
  | 'failed'
  | 'blocked'
  | 'paused'
  | 'skipped';

const DAG_STATUS_BAR: Record<DagTaskStatus, string> = {
  done:      'bg-purple-500 dark:bg-purple-600',
  running:   'bg-blue-500 dark:bg-blue-600',
  in_review: 'bg-violet-500 dark:bg-violet-600',
  ready:     'bg-emerald-400',
  pending:   'bg-yellow-500 dark:bg-yellow-600',
  blocked:   'bg-amber-500 dark:bg-amber-600',
  failed:    'bg-red-500 dark:bg-red-600',
  paused:    'bg-yellow-500',
  skipped:   'bg-th-text-muted/30',
};

/** Get the Tailwind bar/badge class for a DAG task status. */
export function dagStatusBar(status: string): string {
  return (DAG_STATUS_BAR as Record<string, string>)[status] ?? 'bg-gray-400';
}

/** Status dot colors for DagMinimap segments. */
const DAG_MINIMAP_COLORS: Record<string, string> = {
  done:      'bg-purple-500',
  running:   'bg-blue-500',
  in_review: 'bg-violet-500',
  ready:     'bg-emerald-400',
  blocked:   'bg-amber-500',
  paused:    'bg-yellow-500',
  pending:   'bg-zinc-600',
  skipped:   'bg-th-bg-muted',
  failed:    'bg-red-600',
};

/** Get the minimap segment color for a DAG task status. */
export function dagMinimapColor(status: string): string {
  return DAG_MINIMAP_COLORS[status] ?? 'bg-zinc-600';
}

/** Text-color classes for DAG task statuses (TaskDagPanel, etc.) */
const DAG_TASK_TEXT: Record<DagTaskStatus, string> = {
  pending:    'text-th-text-muted',
  ready:      'text-green-400',
  running:    'text-blue-400',
  in_review:  'text-violet-400',
  done:       'text-purple-400',
  failed:     'text-red-400',
  blocked:    'text-amber-400',
  paused:     'text-yellow-600 dark:text-yellow-400',
  skipped:    'text-th-text-muted',
};

/** Get the text color class for a DAG task status. */
export function dagTaskText(status: string): string {
  return (DAG_TASK_TEXT as Record<string, string>)[status] ?? 'text-th-text-muted';
}

// ── Decision statuses (used in OverviewPage, DataBrowser) ─────────────

/** Get the text color class for a decision status. */
export function decisionStatusText(status: string): string {
  if (status === 'confirmed') return 'text-green-400';
  if (status === 'rejected') return 'text-red-400';
  if (status === 'pending') return 'text-yellow-600 dark:text-yellow-400';
  return 'text-th-text-muted';
}

/** Get the border + bg class for a decision card. */
export function decisionStatusCard(status: string, isPending: boolean): string {
  if (status === 'confirmed') return 'border-green-500/40 bg-green-900/10';
  if (status === 'rejected') return 'border-red-500/40 bg-red-900/10';
  if (isPending) return 'border-yellow-500/40 bg-yellow-900/10';
  return 'border-th-border bg-th-bg-alt/50';
}

// ── Session statuses (used in CrewRoster, ProjectsPanel, etc.) ────────

const SESSION_STATUS_DOTS: Record<string, string> = {
  active:    'bg-green-400',
  running:   'bg-blue-400 animate-pulse',
  completed: 'bg-purple-400',
  failed:    'bg-red-400',
  crashed:   'bg-red-400',
  stopped:   'bg-gray-400',
};

/** Get the dot background class for a session status. */
export function sessionStatusDot(status: string): string {
  return SESSION_STATUS_DOTS[status] ?? 'bg-gray-400';
}
