/**
 * Shared formatting for CREW_UPDATE and QUERY_CREW responses.
 *
 * Both messages use the same compact tabular layout so agents see a
 * consistent view of the crew.
 */

// ── Model shortname mapping ───────────────────────────────────────────

const MODEL_SHORT: Record<string, string> = {
  'claude-opus-4.6': 'opus',
  'claude-opus-4.5': 'opus-4.5',
  'claude-sonnet-4.6': 'sonnet',
  'claude-sonnet-4.5': 'sonnet-4.5',
  'claude-sonnet-4': 'sonnet-4',
  'claude-haiku-4.5': 'haiku',
  'gemini-3-pro-preview': 'gemini-pro',
  'gemini-3-flash-preview': 'gemini-flash',
  'gpt-5.4': 'gpt5.4',
  'gpt-5.3-codex': 'codex-5.3',
  'gpt-5.2-codex': 'codex',
  'gpt-5.2': 'gpt5.2',
  'gpt-5.1-codex-max': 'codex-max',
  'gpt-5.1-codex': 'codex-5.1',
  'gpt-5.1': 'gpt5.1',
  'gpt-5.1-codex-mini': 'codex-mini',
  'gpt-5-mini': 'gpt5-mini',
  'gpt-4.1': 'gpt4.1',
};

export function shortenModel(model: string | undefined): string {
  if (!model) return 'default';
  return MODEL_SHORT[model] ?? model.replace(/^claude-/, '').replace(/^gpt-/, 'gpt');
}

// ── Types ─────────────────────────────────────────────────────────────

export interface CrewMember {
  id: string;
  role: string;
  roleName: string;
  status: string;
  task?: string;
  model?: string;
  parentId?: string;
  isSystemAgent?: boolean;
  lockedFiles: string[];
  /** Number of queued messages waiting for this agent */
  pendingMessages?: number;
  /** ISO timestamp when agent was created */
  createdAt?: string;
  /** Context window: total size */
  contextWindowSize?: number;
  /** Context window: tokens used */
  contextWindowUsed?: number;
}

interface CrewFormatOptions {
  /** The agent receiving this message — excluded from the crew table */
  viewerId: string;
  /** Role of the viewer — controls what sections appear */
  viewerRole: string;
  /** Pre-built health header (from ContextRefresher.buildHealthHeader) */
  healthHeader?: string;
  /** Budget info */
  budget?: { running: number; max: number };
  /** Alerts (stuck agents, context warnings, etc.) */
  alerts?: string[];
  /** Whether to show the RECENT ACTIVITY section */
  recentActivity?: string[];
}

interface QueryCrewOptions extends CrewFormatOptions {
  /** Memory entries for QUERY_CREW only */
  memorySection?: string;
  /** Sibling leads section for sub-leads */
  siblingSection?: string;
  /** Unread human message warning */
  humanMessageAlert?: string;
}

// ── Status icons ──────────────────────────────────────────────────────

function statusIcon(status: string): string {
  switch (status) {
    case 'running': return '🔄';
    case 'idle': return '💤';
    case 'creating': return '🆕';
    case 'completed': return '✅';
    case 'failed': return '❌';
    case 'terminated': return '🛑';
    default: return '❓';
  }
}

// ── Time formatting ───────────────────────────────────────────────────

function formatElapsed(createdAt: string | undefined): string {
  if (!createdAt) return '—';
  const ms = Date.now() - new Date(createdAt).getTime();
  if (isNaN(ms) || ms < 0) return '—';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h${remMins}m` : `${hours}h`;
}

// ── Context percentage ────────────────────────────────────────────────

function formatCtxPercent(size: number | undefined, used: number | undefined): string {
  if (!size || size === 0) return '—';
  return `${Math.round(((used ?? 0) / size) * 100)}%`;
}

// ── Crew table ────────────────────────────────────────────────────────

function buildCrewTable(members: CrewMember[]): string {
  if (members.length === 0) return '  (no agents)';

  const rows = members.map((m) => ({
    id: m.id.slice(0, 8),
    role: m.roleName,
    model: shortenModel(m.model),
    status: `${statusIcon(m.status)} ${m.status}`,
    time: m.status === 'running' ? formatElapsed(m.createdAt) : '—',
    queued: String(m.pendingMessages ?? 0),
    ctx: formatCtxPercent(m.contextWindowSize, m.contextWindowUsed),
    task: m.task?.slice(0, 50) || '—',
  }));

  // Calculate column widths
  const cols = {
    id: Math.max(2, ...rows.map(r => r.id.length)),
    role: Math.max(4, ...rows.map(r => r.role.length)),
    model: Math.max(5, ...rows.map(r => r.model.length)),
    status: Math.max(6, ...rows.map(r => r.status.length)),
    time: Math.max(4, ...rows.map(r => r.time.length)),
    queued: Math.max(1, ...rows.map(r => r.queued.length)),
    ctx: Math.max(3, ...rows.map(r => r.ctx.length)),
  };

  const header = `  ${'ID'.padEnd(cols.id)}  ${'Role'.padEnd(cols.role)}  ${'Model'.padEnd(cols.model)}  ${'Status'.padEnd(cols.status)}  ${'Time'.padEnd(cols.time)}  ${'Q'.padEnd(cols.queued)}  ${'Ctx'.padEnd(cols.ctx)}  Task`;
  const lines = rows.map((r) =>
    `  ${r.id.padEnd(cols.id)}  ${r.role.padEnd(cols.role)}  ${r.model.padEnd(cols.model)}  ${r.status.padEnd(cols.status)}  ${r.time.padEnd(cols.time)}  ${r.queued.padEnd(cols.queued)}  ${r.ctx.padEnd(cols.ctx)}  ${r.task}`,
  );

  return [header, ...lines].join('\n');
}

// ── File locks section ────────────────────────────────────────────────

function buildLockSection(members: CrewMember[]): string {
  const lockedFiles: { file: string; agentId: string; roleName: string }[] = [];
  for (const m of members) {
    for (const f of m.lockedFiles) {
      lockedFiles.push({ file: f, agentId: m.id.slice(0, 8), roleName: m.roleName });
    }
  }
  if (lockedFiles.length === 0) return '== FILE LOCKS ==\n  None';
  const lines = lockedFiles.map(l => `  ${l.file} → ${l.agentId} (${l.roleName})`);
  return `== FILE LOCKS ==\n${lines.join('\n')}`;
}

// ── Budget section ────────────────────────────────────────────────────

function buildBudgetSection(budget?: { running: number; max: number }): string {
  if (!budget) return '';
  const available = Math.max(0, budget.max - budget.running);
  const warning = budget.running >= budget.max ? ' | ⚠ AT CAPACITY' : '';
  return `== BUDGET ==\n  ${budget.running} / ${budget.max} slots · ${available} available${warning}`;
}

// ── Alerts section ────────────────────────────────────────────────────

function buildAlertSection(alerts?: string[]): string {
  if (!alerts || alerts.length === 0) return '';
  const lines = alerts.map(a => `  ⚠️ ${a}`);
  return `== ALERTS ==\n${lines.join('\n')}`;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Format the crew status for CREW_UPDATE messages.
 * Used by ContextRefresher → Agent.injectContextUpdate.
 */
export function formatCrewUpdate(members: CrewMember[], opts: CrewFormatOptions): string {
  const visibleMembers = members.filter(m => m.id !== opts.viewerId);

  const sections: string[] = [];

  if (opts.healthHeader) sections.push(opts.healthHeader);

  sections.push(`== CREW ==\n${buildCrewTable(visibleMembers)}`);

  sections.push(buildLockSection(visibleMembers));

  if (opts.budget) sections.push(buildBudgetSection(opts.budget));

  const alertSection = buildAlertSection(opts.alerts);
  if (alertSection) sections.push(alertSection);

  return sections.join('\n\n');
}

/**
 * Format the crew status for QUERY_CREW / CREW_ROSTER responses.
 * Same base as CREW_UPDATE plus MEMORY section.
 */
export function formatQueryCrew(members: CrewMember[], opts: QueryCrewOptions): string {
  // For leads: show own agents. For sub-leads: show own children.
  const isLead = opts.viewerRole === 'lead';

  const sections: string[] = [];

  if (opts.humanMessageAlert) sections.push(opts.humanMessageAlert);

  if (opts.healthHeader) sections.push(opts.healthHeader);

  // Determine which agents to show in the table
  const visibleMembers = members.filter(m => m.id !== opts.viewerId);
  sections.push(`== YOUR CREW (you can DELEGATE to these) ==\n${buildCrewTable(visibleMembers)}`);

  sections.push(buildLockSection(visibleMembers));

  if (opts.budget && isLead) sections.push(buildBudgetSection(opts.budget));

  if (opts.siblingSection) sections.push(opts.siblingSection);

  if (opts.memorySection) sections.push(opts.memorySection);

  const alertSection = buildAlertSection(opts.alerts);
  if (alertSection) sections.push(alertSection);

  sections.push(
    `⚠️ You can only DELEGATE to agents you created (your crew). Agents from other projects will return "Agent not found".
To assign a task to an agent, use their ID:
\`⟦⟦ DELEGATE {"to": "agent-id", "task": "your task"} ⟧⟧\`
To create a new agent:
\`⟦⟦ CREATE_AGENT {"role": "developer", "model": "claude-opus-4.6", "task": "optional task"} ⟧⟧\`
To terminate an agent and free a slot:
\`⟦⟦ TERMINATE_AGENT {"agentId": "agent-id", "reason": "no longer needed"} ⟧⟧\``
  );

  return sections.join('\n\n');
}
