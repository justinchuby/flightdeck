/**
 * UnifiedCrewPage — Merged Agents + Crews page.
 *
 * Uses CrewRoster's grouping as foundation. Adds:
 * - scope prop: 'project' (single project) or 'global' (all crews)
 * - Collapsible health strip from CrewPage
 * - Project-scoped filtering when scope='project'
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users,
  Search,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
  Activity,
  Heart,
  X,
  CheckCircle2,
  PauseCircle,
  Trash2,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { getRoleIcon } from '../../utils/getRoleIcon';
import { sessionStatusDot } from '../../utils/statusColors';
import { useToastStore } from '../Toast';
import { formatRelativeTime } from '../../utils/formatRelativeTime';
import { formatTokens } from '../../utils/format';
import { StatusBadge, agentStatusProps, connectionStatusProps } from '../ui/StatusBadge';
import { useEffectiveProjectId } from '../../hooks/useEffectiveProjectId';
import { useAppStore } from '../../stores/appStore';
import { AgentDetailPanel } from '../AgentDetailPanel';

// ── Types (shared with CrewRoster) ─────────────────────────

type RosterStatus = 'idle' | 'running' | 'terminated' | 'failed';
type LiveStatus = 'creating' | 'running' | 'idle' | 'completed' | 'failed' | 'terminated' | null;

interface RosterAgent {
  agentId: string;
  role: string;
  model: string;
  status: RosterStatus;
  liveStatus: LiveStatus;
  teamId: string;
  projectId: string | null;
  parentId: string | null;
  sessionId: string | null;
  lastTaskSummary: string | null;
  createdAt: string;
  updatedAt: string;
  provider: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  contextWindowSize: number | null;
  contextWindowUsed: number | null;
  task: string | null;
  outputPreview: string | null;
}

interface TeamInfo {
  teamId: string;
  agentCount: number;
  roles: string[];
}

interface CrewSummary {
  leadId: string;
  projectId: string | null;
  projectName: string | null;
  agentCount: number;
  activeAgentCount: number;
  sessionCount: number;
  lastActivity: string;
}

interface SessionDetail {
  id: string;
  leadId: string;
  status: string;
  task: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  taskSummary: { total: number; done: number; failed: number };
  hasRetro: boolean;
}

interface UnifiedCrewPageProps {
  scope?: 'project' | 'global';
}

// ── Helpers ───────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

// ── Crew Group (collapsible) ──────────────────────────────

function CrewGroup({ leadId, agents, summary, defaultExpanded = true, onSelectAgent, selectedAgentId, onDeleteCrew, onRemoveAgent }: {
  leadId: string;
  agents: RosterAgent[];
  summary: CrewSummary | null;
  defaultExpanded?: boolean;
  onSelectAgent: (id: string) => void;
  selectedAgentId: string | null;
  onDeleteCrew: (leadId: string) => Promise<void>;
  onRemoveAgent?: (agentId: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [sessions, setSessions] = useState<SessionDetail[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!expanded || sessionsLoaded || !summary?.projectId) return;
    setSessionsLoaded(true);
    apiFetch<SessionDetail[]>(`/projects/${summary.projectId}/sessions/detail`)
      .then(data => {
        const crewSessions = Array.isArray(data)
          ? data.filter(s => s.leadId === leadId)
          : [];
        setSessions(crewSessions);
      })
      .catch(() => {});
  }, [expanded, sessionsLoaded, summary?.projectId, leadId]);

  const sorted = [...agents].sort((a, b) => {
    if (a.agentId === leadId) return -1;
    if (b.agentId === leadId) return 1;
    const aIsLead = a.role === 'lead' ? 0 : 1;
    const bIsLead = b.role === 'lead' ? 0 : 1;
    if (aIsLead !== bIsLead) return aIsLead - bIsLead;
    return a.role.localeCompare(b.role);
  });

  const lead = sorted.find(a => a.agentId === leadId || a.role === 'lead');
  const activeCount = summary?.activeAgentCount ?? agents.filter(a =>
    a.liveStatus === 'running' || a.liveStatus === 'idle'
  ).length;
  const isActive = activeCount > 0;
  const latestActivity = summary?.lastActivity ??
    agents.reduce((latest, a) => a.updatedAt > latest ? a.updatedAt : latest, '');
  const displayName = summary?.projectName ?? (lead?.projectId ? `Project ${lead.projectId.slice(0, 8)}` : `Crew ${leadId.slice(0, 8)}`);

  const handleDeleteCrew = async () => {
    setDeleting(true);
    try {
      await onDeleteCrew(leadId);
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <div className="border border-th-border rounded-lg overflow-hidden bg-surface-raised md:min-w-[280px]">
      {/* Group header */}
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-th-bg-alt/30 transition-colors">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          <ChevronRight className={`w-4 h-4 text-th-text-muted shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-th-text text-sm">{displayName}</span>
              {activeCount > 0 ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400">
                  {activeCount}/{agents.length} active
                </span>
              ) : (
                <span className="text-[10px] text-th-text-muted">
                  {agents.length} agent{agents.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-[10px] text-th-text-muted mt-0.5">
              {lead && <span>🎖️ Lead: {lead.agentId.slice(0, 8)}{lead.provider ? ` · ${lead.provider}` : ''} · {lead.model}</span>}
              {latestActivity && <span>{formatRelativeTime(latestActivity)}</span>}
            </div>
          </div>
        </button>
        {!isActive && (
          <button
            onClick={() => setConfirmingDelete(true)}
            title="Delete crew"
            className="p-1.5 rounded text-th-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Delete confirmation */}
      {confirmingDelete && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-t border-red-500/20">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <span className="text-xs text-red-600 dark:text-red-400 flex-1">
            Delete <strong>{displayName}</strong> and all {agents.length} agents? This cannot be undone.
          </span>
          <button
            onClick={handleDeleteCrew}
            disabled={deleting}
            className="px-2.5 py-1 text-xs bg-red-500 text-white rounded font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
          <button
            onClick={() => setConfirmingDelete(false)}
            disabled={deleting}
            className="px-2.5 py-1 text-xs text-th-text-muted rounded hover:bg-th-bg-muted transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {expanded && (
        <div className="border-t border-th-border/50 divide-y divide-th-border/30">
          {sorted.map(agent => (
            <AgentRow
              key={agent.agentId}
              agent={agent}
              isLead={agent.agentId === leadId || agent.role === 'lead'}
              isSelected={selectedAgentId === agent.agentId}
              onSelect={() => onSelectAgent(agent.agentId)}
              onRemove={onRemoveAgent}
              crewAgents={agents}
            />
          ))}
        </div>
      )}

      {expanded && sessions.length > 0 && (
        <div className="border-t border-th-border/50 px-3 py-2 bg-th-bg-alt/10">
          <div className="text-[10px] font-medium text-th-text-muted mb-1.5 uppercase tracking-wide">Sessions</div>
          <div className="space-y-1.5">
            {sessions.slice(0, 5).map(s => (
              <div key={s.id} className="flex items-start gap-2 text-[11px]">
                <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${sessionStatusDot(s.status)}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-th-text truncate">{s.task ?? 'No task description'}</div>
                  <div className="flex items-center gap-2 text-[10px] text-th-text-muted">
                    <span>{formatRelativeTime(s.startedAt)}</span>
                    {s.durationMs != null && <span>{formatDuration(s.durationMs)}</span>}
                    {s.taskSummary.total > 0 && (
                      <span>
                        {s.taskSummary.done}/{s.taskSummary.total} tasks
                        {s.taskSummary.failed > 0 && ` · ${s.taskSummary.failed} failed`}
                      </span>
                    )}
                    {s.hasRetro && <span title="Session retro available">📝</span>}
                  </div>
                </div>
              </div>
            ))}
            {sessions.length > 5 && (
              <div className="text-[10px] text-th-text-muted">+ {sessions.length - 5} more</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Agent Row ─────────────────────────────────────────────

function AgentRow({ agent, isLead, isSelected, onSelect, onRemove, crewAgents }: {
  agent: RosterAgent; isLead?: boolean; isSelected: boolean; onSelect: () => void; onRemove?: (agentId: string) => void; crewAgents?: RosterAgent[];
}) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Check if this is a lead with children
  const hasChildren = isLead && crewAgents && crewAgents.some(a => a.parentId === agent.agentId && a.agentId !== agent.agentId);

  // Only show remove button for terminated agents that aren't leads with children
  const canRemove = !hasChildren &&
                    (agent.status === 'terminated' || agent.status === 'failed') &&
                    (!agent.liveStatus || agent.liveStatus === 'terminated' || agent.liveStatus === 'failed' || agent.liveStatus === 'completed');

  const handleRemove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onRemove) return;

    if (!confirmingRemove) {
      setConfirmingRemove(true);
      return;
    }

    setRemoving(true);
    try {
      await onRemove(agent.agentId);
    } finally {
      setRemoving(false);
      setConfirmingRemove(false);
    }
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmingRemove(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  };

  return (
    <div className="relative">
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={handleKeyDown}
        className={`w-full flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-th-bg-alt/30 transition-colors
          ${isSelected ? 'bg-th-bg-alt/40 border-l-2 border-blue-500' : ''}
          ${isLead ? 'font-medium' : ''}`}
      >
        <span className="w-4 text-center text-xs">{isLead ? '🎖️' : getRoleIcon(agent.role)}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs capitalize">{agent.role}</span>
            <code className="text-[10px] text-th-text-muted">{agent.agentId.slice(0, 8)}</code>
            {agent.sessionId && (
              <button
                className="text-[10px] font-mono text-th-text-muted bg-th-bg-alt/60 px-1 rounded hover:bg-th-bg-alt transition-colors truncate max-w-[120px]"
                title={`Session: ${agent.sessionId} — click to copy`}
                onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(agent.sessionId!); }}
              >
                {agent.sessionId}
              </button>
            )}
            {agent.provider && (
              <span className="text-[10px] bg-blue-500/15 text-blue-400 px-1 py-px rounded">{agent.provider}</span>
            )}
            <span className="text-[10px] text-th-text-muted">{agent.model}</span>
          </div>
          {agent.lastTaskSummary && (
            <div className="text-[10px] text-th-text-muted truncate">{agent.lastTaskSummary}</div>
          )}
          {agent.task && (
            <div className="text-[10px] text-th-text-alt truncate">📋 {agent.task}</div>
          )}
          {(agent.inputTokens || agent.outputTokens) ? (
            <div className="flex items-center gap-2 text-[10px] text-th-text-muted">
              <span>↓{formatTokens(agent.inputTokens)}</span>
              <span>↑{formatTokens(agent.outputTokens)}</span>
              {agent.contextWindowSize && agent.contextWindowUsed ? (
                <span className={agent.contextWindowUsed / agent.contextWindowSize > 0.85 ? 'text-red-400' : agent.contextWindowUsed / agent.contextWindowSize > 0.6 ? 'text-yellow-400' : ''}>
                  ctx {Math.round((agent.contextWindowUsed / agent.contextWindowSize) * 100)}%
                </span>
              ) : null}
            </div>
          ) : null}
          {agent.outputPreview && (
            <div className="text-[10px] text-th-text-muted font-mono truncate opacity-60">{agent.outputPreview.trim().split('\n').pop()}</div>
          )}
        </div>
        <StatusBadge {...agentStatusProps(agent.status, agent.liveStatus)} />
        {canRemove && onRemove && (
          <button
            onClick={handleRemove}
            disabled={removing}
            title={confirmingRemove ? "Confirm removal" : "Remove agent from roster"}
            className={`p-1 rounded transition-colors shrink-0 ${
              confirmingRemove
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'text-th-text-muted hover:text-red-400 hover:bg-red-500/10'
            } ${removing ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {removing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
          </button>
        )}
        {confirmingRemove && canRemove && onRemove && (
          <button
            onClick={handleCancel}
            title="Cancel"
            className="p-1 rounded text-th-text-muted hover:bg-th-bg-alt transition-colors shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        )}
        {hasChildren && (
          <span className="text-[10px] text-th-text-muted px-1.5 py-0.5 rounded bg-th-bg-alt border border-th-border shrink-0" title="Delete crew to remove lead with children">
            Lead with children
          </span>
        )}
      </div>
    </div>
  );
}


// ── Health Strip (collapsible footer) ─────────────────────

function HealthStrip({ teamId: _teamId }: { teamId: string }) {
  const [expanded, setExpanded] = useState(false);
  const liveAgents = useAppStore(s => s.agents);

  // Derive counts from live agent data (same source as StatusPopover)
  const statusCounts = useMemo(() => {
    const running = liveAgents.filter(a => a.status === 'running' || a.status === 'creating').length;
    const idle = liveAgents.filter(a => a.status === 'idle').length;
    const completed = liveAgents.filter(a => a.status === 'completed' || a.status === 'terminated').length;
    const failed = liveAgents.filter(a => a.status === 'failed').length;
    return { running, idle, completed, failed, total: liveAgents.length };
  }, [liveAgents]);

  return (
    <div className="border border-th-border rounded-lg bg-surface-raised overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 text-xs text-th-text-muted hover:bg-th-bg-alt/30 transition-colors"
      >
        <Heart className="w-3.5 h-3.5" />
        <span>Health</span>
        <span className="text-[10px]">
          {`${statusCounts.total} total · ${statusCounts.running} running · ${statusCounts.idle} idle`}
        </span>
        <ChevronRight className={`w-3 h-3 ml-auto transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="border-t border-th-border/50 px-4 py-3 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="flex items-center gap-2 text-xs">
              <Users className="w-3.5 h-3.5 text-th-text-muted" />
              <span className="font-bold">{statusCounts.total}</span>
              <span className="text-th-text-muted">Total</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Activity className="w-3.5 h-3.5 text-green-400" />
              <span className="font-bold text-green-400">{statusCounts.running}</span>
              <span className="text-th-text-muted">Running</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <PauseCircle className="w-3.5 h-3.5 text-blue-400" />
              <span className="font-bold text-blue-400">{statusCounts.idle}</span>
              <span className="text-th-text-muted">Idle</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <CheckCircle2 className="w-3.5 h-3.5 text-gray-400" />
              <span className="font-bold text-gray-400">{statusCounts.completed}</span>
              <span className="text-th-text-muted">Done</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



// ── Main Component ────────────────────────────────────────

export function UnifiedCrewPage({ scope = 'global' }: UnifiedCrewPageProps) {
  const addToast = useToastStore(s => s.add);
  const [agents, setAgents] = useState<RosterAgent[]>([]);
  const [crewSummaries, setCrewSummaries] = useState<CrewSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<RosterStatus | 'all'>('all');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const effectiveProjectId = useEffectiveProjectId();
  const projectId = scope === 'project' ? effectiveProjectId : null;

  const selectedAgentTeamId = agents.find(a => a.agentId === selectedAgent)?.teamId ?? 'default';

  const fetchAll = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);

      const [summaryResult, teamsResult] = await Promise.allSettled([
        apiFetch<CrewSummary[]>('/crews/summary'),
        apiFetch<{ teams: TeamInfo[] }>('/teams'),
      ]);

      const summaries = summaryResult.status === 'fulfilled' && Array.isArray(summaryResult.value)
        ? summaryResult.value : [];
      setCrewSummaries(summaries);

      const teamList = teamsResult.status === 'fulfilled' ? (teamsResult.value.teams ?? []) : [];
      const statusQ = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const agentResults = await Promise.allSettled(
        teamList.map(t => apiFetch<RosterAgent[]>(`/teams/${t.teamId}/agents${statusQ}`))
      );

      const allAgents: RosterAgent[] = [];
      let failCount = 0;
      for (const r of agentResults) {
        if (r.status === 'fulfilled' && Array.isArray(r.value)) {
          allAgents.push(...r.value);
        } else {
          failCount++;
        }
      }

      if (failCount === agentResults.length && agentResults.length > 0) {
        const firstFail = agentResults.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
        throw new Error(firstFail?.reason?.message ?? 'Failed to fetch agents');
      }

      // Filter to project scope if needed
      if (projectId) {
        const projectLeadIds = new Set(summaries.filter(s => s.projectId === projectId).map(s => s.leadId));
        const filtered = allAgents.filter(a => {
          if (a.projectId === projectId) return true;
          if (projectLeadIds.has(a.agentId)) return true;
          if (a.parentId && projectLeadIds.has(a.parentId)) return true;
          return false;
        });
        setAgents(filtered);
      } else {
        // Global scope: only show active agents
        const activeStatuses = new Set(['running', 'idle', 'creating']);
        const active = allAgents.filter(a => a.liveStatus && activeStatuses.has(a.liveStatus));
        setAgents(active);
      }
    } catch (err: any) {
      setError(err.message ?? 'Failed to fetch crew roster');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, projectId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleDeleteCrew = useCallback(async (leadId: string) => {
    try {
      if (leadId === 'unassigned') {
        // Unassigned agents have no lead — remove each individually
        const unassigned = agents.filter(a => !a.parentId && a.role !== 'lead');
        await Promise.all(unassigned.map(a => apiFetch(`/roster/${a.agentId}`, { method: 'DELETE' })));
        addToast('success', `Removed ${unassigned.length} unassigned agent(s)`);
        setAgents(prev => prev.filter(a => a.parentId || a.role === 'lead'));
      } else {
        await apiFetch(`/crews/${leadId}`, { method: 'DELETE' });
        addToast('success', 'Crew deleted');
        setAgents(prev => prev.filter(a => a.agentId !== leadId && a.parentId !== leadId));
      }
      if (selectedAgent) {
        const deletedAgent = agents.find(a => a.agentId === selectedAgent);
        if (deletedAgent && (leadId === 'unassigned'
          ? (!deletedAgent.parentId && deletedAgent.role !== 'lead')
          : (deletedAgent.agentId === leadId || deletedAgent.parentId === leadId))) {
          setSelectedAgent(null);
        }
      }
      setCrewSummaries(prev => prev.filter(s => s.leadId !== leadId));
    } catch (err: any) {
      addToast('error', `Failed to delete crew: ${err.message}`);
    }
  }, [addToast, agents, selectedAgent]);

  const handleRemoveAgent = useCallback(async (agentId: string) => {
    try {
      await apiFetch(`/roster/${agentId}`, { method: 'DELETE' });
      addToast('success', 'Agent removed from roster');
      setAgents(prev => prev.filter(a => a.agentId !== agentId));
      if (selectedAgent === agentId) {
        setSelectedAgent(null);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      addToast('error', `Failed to remove agent: ${message}`);
    }
  }, [addToast, selectedAgent]);

  // Filter agents by search
  const filtered = agents.filter(a => {
    if (!search) return true;
    const q = search.toLowerCase();
    return a.role.toLowerCase().includes(q)
      || a.agentId.toLowerCase().includes(q)
      || (a.lastTaskSummary?.toLowerCase().includes(q) ?? false);
  });

  // Group by lead
  const crewGroups = (() => {
    const map = new Map<string, RosterAgent[]>();
    for (const a of filtered) {
      const leadId = a.role === 'lead' ? a.agentId : (a.parentId ?? 'unassigned');
      if (!map.has(leadId)) map.set(leadId, []);
      map.get(leadId)!.push(a);
    }
    return [...map.entries()].sort((a, b) => {
      const aActive = a[1].some(ag => ag.liveStatus === 'running' || ag.liveStatus === 'idle');
      const bActive = b[1].some(ag => ag.liveStatus === 'running' || ag.liveStatus === 'idle');
      if (aActive !== bActive) return aActive ? -1 : 1;
      const aTime = a[1].reduce((max, ag) => ag.updatedAt > max ? ag.updatedAt : max, '');
      const bTime = b[1].reduce((max, ag) => ag.updatedAt > max ? ag.updatedAt : max, '');
      return bTime.localeCompare(aTime);
    });
  })();

  const summaryMap = new Map(crewSummaries.map(s => [s.leadId, s]));

  const hasActiveAgents = agents.some(a =>
    a.status === 'idle' || a.status === 'running' || a.liveStatus === 'running' || a.liveStatus === 'creating' || a.liveStatus === 'idle'
  );
  const allTerminated = agents.length > 0 && !hasActiveAgents;

  if (loading && agents.length === 0) {
    return <div className="flex items-center justify-center h-64 text-th-text-alt"><RefreshCw className="w-5 h-5 animate-spin mr-2" />Loading crew roster…</div>;
  }

  if (error) {
    return <div className="flex items-center justify-center h-64 text-red-400"><AlertTriangle className="w-5 h-5 mr-2" />{error}</div>;
  }

  return (
    <div className="flex flex-col h-full min-h-0 p-6 max-w-screen-2xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-th-accent" />
          <h1 className="text-xl font-bold text-th-text">
            {scope === 'project' ? 'Crew' : 'Agents'}
          </h1>
          <span className="text-sm text-th-text-muted">
            {filtered.length} agent{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => fetchAll()}
            className="px-3 py-1.5 text-sm rounded bg-th-bg-alt hover:bg-th-border text-th-text-alt transition-colors flex items-center gap-1">
            <RefreshCw className="w-3.5 h-3.5" />Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mt-4 shrink-0">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-th-text-alt" />
          <input type="text" placeholder="Search agents..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded bg-th-bg-alt border border-th-border text-th-text placeholder:text-th-text-alt" />
        </div>
        {scope === 'project' && (
          <div className="flex gap-1">
            {(['all', 'idle', 'running', 'terminated', 'failed'] as const).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 text-xs rounded capitalize transition-colors ${
                  statusFilter === s
                    ? 'bg-th-accent/20 text-th-accent border border-th-accent/30'
                    : 'bg-th-bg-alt text-th-text-alt border border-th-border hover:bg-th-border'
                }`}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content: Grouped List + Profile */}
      <div className="flex flex-col md:flex-row gap-6 flex-1 min-h-0 mt-4">
        <div className={`space-y-3 min-w-0 overflow-y-auto ${selectedAgent ? 'flex-1' : 'w-full'}`}>
          {/* Empty: no agents at all */}
          {agents.length === 0 && !loading && (
            <div className="text-center py-12 text-th-text-alt text-sm bg-surface-raised rounded-lg border border-th-border">
              <span className="text-4xl block mb-2">🤖</span>
              <p className="font-medium text-th-text">{scope === 'global' ? 'No active agents' : 'No agents yet'}</p>
              <p className="text-th-text-muted mt-1">{scope === 'global' ? 'All agents are idle or terminated.' : 'Start a session to spawn your first crew.'}</p>
            </div>
          )}

          {/* Empty: search returns nothing */}
          {agents.length > 0 && filtered.length === 0 && search && (
            <div className="text-center py-8 text-th-text-alt text-sm bg-surface-raised rounded-lg border border-th-border flex items-center justify-center gap-2">
              <span>No agents match &ldquo;{search}&rdquo;</span>
              <button onClick={() => setSearch('')} className="px-2 py-0.5 text-xs rounded bg-th-bg-alt hover:bg-th-border text-th-text-alt border border-th-border transition-colors">Clear</button>
            </div>
          )}

          {/* Banner: all terminated */}
          {allTerminated && filtered.length > 0 && (
            <div className="text-center py-4 text-th-text-alt text-sm bg-surface-raised rounded-lg border border-th-border">
              <span className="text-2xl block mb-1">💤</span>
              <p className="font-medium text-th-text">No active agents</p>
              <p className="text-th-text-muted text-xs mt-0.5">All agents from previous sessions are shown below.</p>
            </div>
          )}

          {crewGroups.length > 0 && crewGroups.map(([leadId, groupAgents]) => (
            <CrewGroup
              key={leadId}
              leadId={leadId}
              agents={groupAgents}
              summary={summaryMap.get(leadId) ?? null}
              defaultExpanded
              onSelectAgent={setSelectedAgent}
              selectedAgentId={selectedAgent}
              onDeleteCrew={handleDeleteCrew}
              onRemoveAgent={handleRemoveAgent}
            />
          ))}
        </div>

        {/* Agent Detail — global: centered modal; project: inline side panel */}
        {scope === 'global' ? (
          selectedAgent && (
            <AgentDetailPanel agentId={selectedAgent} mode="modal" onClose={() => setSelectedAgent(null)} />
          )
        ) : (
          <div
            className={`
              fixed inset-0 z-40 bg-th-bg transform transition-transform duration-150 ease-out
              md:static md:inset-auto md:z-auto md:bg-transparent md:transform-none md:transition-none
              ${selectedAgent ? 'translate-x-0' : 'translate-x-full'}
              ${selectedAgent ? 'md:w-[400px] lg:w-[480px] md:shrink-0' : 'md:w-0 md:hidden'}
              md:self-start md:sticky md:top-0 md:max-h-full
            `}
          >
            {selectedAgent && (
              <div className="h-full overflow-y-auto">
                <AgentDetailPanel agentId={selectedAgent} teamId={selectedAgentTeamId} mode="inline" onClose={() => setSelectedAgent(null)} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Health Strip (collapsed at bottom) */}
      <div className="mt-3 shrink-0">
        <HealthStrip teamId="default" />
      </div>
    </div>
  );
}
