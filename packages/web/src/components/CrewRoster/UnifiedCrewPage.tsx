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
  Cpu,
  Activity,
  Heart,
  X,
  CheckCircle,
  CheckCircle2,
  Info,
  PauseCircle,
  MessageSquare,
  Zap,
  Square,
  Send,
  User,
  Clock,
  Settings,
  ArrowLeft,
  Trash2,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { getRoleIcon } from '../../utils/getRoleIcon';
import { sessionStatusDot } from '../../utils/statusColors';
import { useToastStore } from '../Toast';
import { formatRelativeTime } from '../../utils/formatRelativeTime';
import { StatusBadge, agentStatusProps, connectionStatusProps } from '../ui/StatusBadge';
import { Tabs } from '../ui/Tabs';
import type { TabItem } from '../ui/Tabs';
import { useEffectiveProjectId } from '../../hooks/useEffectiveProjectId';
import { AgentChatPanel } from '../AgentChatPanel';
import { useAppStore } from '../../stores/appStore';
import { AgentDetailModal } from '../AgentDetailModal';

// ── Types (shared with CrewRoster) ─────────────────────────

const AVAILABLE_MODELS = [
  'claude-opus-4.6',
  'claude-sonnet-4.6',
  'claude-sonnet-4.5',
  'claude-haiku-4.5',
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'gpt-5.2',
  'gpt-5.1-codex',
  'gemini-3-pro-preview',
  'gpt-4.1',
];

type RosterStatus = 'idle' | 'running' | 'terminated' | 'failed';
type LiveStatus = 'creating' | 'running' | 'idle' | 'completed' | 'failed' | 'terminated' | null;
type ProfileTab = 'overview' | 'chat' | 'settings';

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
}

interface AgentProfile {
  agentId: string;
  role: string;
  model: string;
  status: RosterStatus;
  liveStatus: LiveStatus;
  teamId: string;
  projectId: string | null;
  lastTaskSummary: string | null;
  createdAt: string;
  updatedAt: string;
  knowledgeCount: number;
  live: {
    task: string | null;
    outputPreview: string | null;
    model: string | null;
    sessionId: string | null;
    provider: string | null;
    backend: string | null;
    exitError: string | null;
  } | null;
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

// ── Profile Panel ─────────────────────────────────────────

function ProfilePanel({ agentId, teamId, onClose }: { agentId: string; teamId: string; onClose: () => void }) {
  const addToast = useToastStore(s => s.add);
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');
  const [confirmStop, setConfirmStop] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [showMessageInput, setShowMessageInput] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const ActivityIcon = Activity;
  const liveAgent = useAppStore(s => s.agents.find(a => a.id === agentId));

  useEffect(() => {
    setLoading(true);
    apiFetch<AgentProfile>(`/teams/${teamId}/agents/${agentId}/profile`)
      .then(data => setProfile(data))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [agentId, teamId]);

  const isAlive = profile?.liveStatus === 'running' || profile?.liveStatus === 'creating' || profile?.liveStatus === 'idle';

  const handleAction = async (action: string, endpoint: string, method = 'POST', body?: string) => {
    setActionLoading(action);
    try {
      await apiFetch(endpoint, { method, ...(body ? { body, headers: { 'Content-Type': 'application/json' } } : {}) });
      addToast('success', action === 'stop' ? 'Agent terminated' : action === 'interrupt' ? 'Interrupt sent' : 'Message sent');
      if (action === 'stop') {
        const data = await apiFetch<AgentProfile>(`/teams/${teamId}/agents/${agentId}/profile`);
        setProfile(data);
        setConfirmStop(false);
      }
      if (action === 'message') { setMessageText(''); setShowMessageInput(false); }
    } catch (err: any) {
      addToast('error', `Failed: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-48 text-th-text-alt"><RefreshCw className="w-4 h-4 animate-spin mr-2" />Loading profile…</div>;
  if (!profile) return <div className="flex items-center justify-center h-48 text-red-400"><AlertTriangle className="w-4 h-4 mr-2" />Profile not found</div>;

  const tabs: TabItem[] = [
    { id: 'overview', label: 'Overview', icon: <User className="w-3.5 h-3.5" /> },
    { id: 'chat', label: 'Chat', icon: <MessageSquare className="w-3.5 h-3.5" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="bg-surface-raised rounded-lg border border-th-border w-full">
      <div className="p-4 border-b border-th-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-th-bg-alt flex items-center justify-center">
              <span className="text-xl">{getRoleIcon(profile.role)}</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-th-text capitalize">{profile.role}</h2>
                <StatusBadge {...agentStatusProps(profile.status, profile.liveStatus)} />
              </div>
              <span className="text-xs font-mono text-th-text-alt">{profile.agentId.slice(0, 12)}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-th-bg-alt text-th-text-alt"><X className="w-4 h-4" /></button>
        </div>

        {isAlive && (
          <div className="flex items-center gap-2 mt-3">
            <button onClick={() => setShowMessageInput(v => !v)} disabled={actionLoading !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors disabled:opacity-50">
              <MessageSquare className="w-3.5 h-3.5" />Message
            </button>
            <button onClick={() => handleAction('interrupt', `/agents/${agentId}/interrupt`)} disabled={actionLoading !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/20 transition-colors disabled:opacity-50">
              {actionLoading === 'interrupt' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}Interrupt
            </button>
            <button onClick={() => setConfirmStop(true)} disabled={actionLoading !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50">
              <Square className="w-3.5 h-3.5" />Stop
            </button>
          </div>
        )}

        {confirmStop && (
          <div className="mt-2 p-3 rounded bg-red-500/10 border border-red-500/30">
            <p className="text-xs text-red-300 mb-2">Terminate this agent? This cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => handleAction('stop', `/agents/${agentId}/terminate`)} disabled={actionLoading === 'stop'}
                className="px-3 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50">
                {actionLoading === 'stop' ? 'Stopping...' : 'Confirm'}
              </button>
              <button onClick={() => setConfirmStop(false)} className="px-3 py-1 text-xs rounded bg-th-bg-alt text-th-text-alt hover:bg-th-border transition-colors">Cancel</button>
            </div>
          </div>
        )}

        {showMessageInput && (
          <div className="mt-2 flex gap-2">
            <input type="text" value={messageText} onChange={e => setMessageText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAction('message', `/agents/${agentId}/message`, 'POST', JSON.stringify({ content: messageText.trim() })); } }}
              placeholder="Type a message…" className="flex-1 px-3 py-1.5 text-sm rounded bg-th-bg-alt border border-th-border text-th-text placeholder:text-th-text-alt" autoFocus />
            <button onClick={() => handleAction('message', `/agents/${agentId}/message`, 'POST', JSON.stringify({ content: messageText.trim() }))}
              disabled={!messageText.trim() || actionLoading === 'message'}
              className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-1">
              {actionLoading === 'message' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}Send
            </button>
          </div>
        )}
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={(id) => setActiveTab(id as ProfileTab)} className="px-4" />

      <div className="p-4">
        {activeTab === 'overview' && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-th-text-alt">Model:</span> <span className="text-th-text">{profile.model}</span></div>
              <div><span className="text-th-text-alt">Project:</span> <span className="text-th-text">{profile.projectId ?? '—'}</span></div>
              <div><span className="text-th-text-alt">Knowledge:</span> <span className="text-th-text">{profile.knowledgeCount} entries</span></div>
              <div><span className="text-th-text-alt">Created:</span> <span className="text-th-text">{new Date(profile.createdAt).toLocaleString()}</span></div>
              <div><span className="text-th-text-alt">Last Active:</span> <span className="text-th-text">{new Date(profile.updatedAt).toLocaleString()} ({formatRelativeTime(profile.updatedAt)})</span></div>
              {profile.live?.provider && (
                <div><span className="text-th-text-alt">CLI:</span> <span className="text-th-text capitalize">{profile.live.provider}{profile.live.backend && profile.live.backend !== 'acp' ? ` (${profile.live.backend})` : ''}</span></div>
              )}
              {profile.live?.sessionId && (
                <div className="col-span-2">
                  <span className="text-th-text-alt">Session:</span>{' '}
                  <button className="font-mono text-xs text-th-text bg-th-bg-alt/60 px-1.5 py-0.5 rounded hover:bg-th-bg-alt transition-colors"
                    title="Click to copy" onClick={() => navigator.clipboard.writeText(profile.live!.sessionId!)}>
                    {profile.live.sessionId.slice(0, 12)}…
                  </button>
                </div>
              )}
            </div>
            {/* Token Usage */}
            {liveAgent && (liveAgent.inputTokens || liveAgent.outputTokens) && (
              <div className="p-3 rounded bg-th-bg-alt/50 border border-th-border/50">
                <div className="flex items-center gap-2 text-th-text-alt text-xs mb-2">
                  <Zap className="w-3.5 h-3.5" />Token Usage
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-th-text-alt">Input:</span> <span className="text-th-text font-medium">{(liveAgent.inputTokens ?? 0).toLocaleString()}</span></div>
                  <div><span className="text-th-text-alt">Output:</span> <span className="text-th-text font-medium">{(liveAgent.outputTokens ?? 0).toLocaleString()}</span></div>
                  {(liveAgent.cacheReadTokens ?? 0) > 0 && (
                    <div><span className="text-th-text-alt">Cache Read:</span> <span className="text-th-text font-medium">{liveAgent.cacheReadTokens!.toLocaleString()}</span></div>
                  )}
                  {(liveAgent.cacheWriteTokens ?? 0) > 0 && (
                    <div><span className="text-th-text-alt">Cache Write:</span> <span className="text-th-text font-medium">{liveAgent.cacheWriteTokens!.toLocaleString()}</span></div>
                  )}
                  <div className="col-span-2"><span className="text-th-text-alt">Total:</span> <span className="text-th-text font-medium">{((liveAgent.inputTokens ?? 0) + (liveAgent.outputTokens ?? 0)).toLocaleString()}</span></div>
                </div>
              </div>
            )}
            {profile.lastTaskSummary && (
              <div><span className="text-th-text-alt">Last Task:</span><p className="text-th-text mt-1">{profile.lastTaskSummary}</p></div>
            )}
            {profile.live?.exitError && (
              <div className="mt-3 p-3 rounded bg-red-500/10 border border-red-500/20">
                <div className="flex items-center gap-2 text-red-400 text-xs font-medium mb-1"><AlertTriangle className="w-3.5 h-3.5" />Exit Error</div>
                <pre className="text-xs font-mono text-red-400 whitespace-pre-wrap break-words">{profile.live.exitError}</pre>
              </div>
            )}
            {profile.live && (
              <div className="mt-3 p-3 rounded bg-green-500/10 border border-green-500/20">
                <div className="flex items-center gap-2 text-green-400 text-xs mb-1"><ActivityIcon className="w-3.5 h-3.5" />Live Session</div>
                {profile.live.task && <p className="text-sm text-th-text">{profile.live.task}</p>}
              </div>
            )}
          </div>
        )}
        {activeTab === 'chat' && (
          <div className="flex-1 min-h-0" style={{ minHeight: 200 }}>
            <AgentChatPanel agentId={agentId} readOnly={!isAlive} maxHeight="400px" />
          </div>
        )}
        {activeTab === 'settings' && (
          <div className="space-y-3 text-sm">
            <div className="space-y-3">
              <div>
                <label className="text-th-text-alt text-xs block mb-1">Model</label>
                {isAlive ? (
                  <select
                    value={profile.live?.model || profile.model}
                    onChange={async (e) => {
                      try {
                        await apiFetch(`/agents/${agentId}`, { method: 'PATCH', body: JSON.stringify({ model: e.target.value }) });
                        setProfile(p => p ? { ...p, model: e.target.value, live: p.live ? { ...p.live, model: e.target.value } : p.live } : p);
                        addToast('success', 'Model updated');
                      } catch (err: any) {
                        addToast('error', `Failed to update model: ${err.message}`);
                      }
                    }}
                    className="w-full text-sm bg-th-bg-alt border border-th-border text-th-text rounded px-2 py-1.5 focus:outline-none focus:border-accent cursor-pointer"
                  >
                    {(() => {
                      const current = profile.live?.model || profile.model;
                      const options = AVAILABLE_MODELS.includes(current) ? AVAILABLE_MODELS : [current, ...AVAILABLE_MODELS];
                      return options.map(m => <option key={m} value={m}>{m}</option>);
                    })()}
                  </select>
                ) : (
                  <span className="text-th-text">{profile.model}</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {profile.live?.provider && <div><span className="text-th-text-alt">CLI Provider:</span> <span className="text-th-text capitalize">{profile.live.provider}</span></div>}
                {profile.live?.backend && <div><span className="text-th-text-alt">Backend:</span> <span className="text-th-text">{profile.live.backend}</span></div>}
              </div>
            </div>
          </div>
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
    <div className="flex flex-col h-full min-h-0 p-6 max-w-5xl mx-auto">
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
        <div className={`space-y-3 w-full max-w-full md:min-w-[320px] lg:min-w-[400px] overflow-y-auto ${selectedAgent ? 'md:w-[60%]' : 'w-full'}`}>
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

        {/* Agent Detail — global: centered modal; project: side panel */}
        {scope === 'global' ? (
          selectedAgent && (
            <AgentDetailModal agentId={selectedAgent} onClose={() => setSelectedAgent(null)} />
          )
        ) : (
          <div
            className={`
              fixed inset-0 z-40 bg-th-bg transform transition-transform duration-150 ease-out
              md:static md:inset-auto md:z-auto md:bg-transparent md:transform-none md:transition-none
              ${selectedAgent ? 'translate-x-0' : 'translate-x-full'}
              ${selectedAgent ? 'md:w-[40%] md:min-w-[360px] md:max-w-[480px]' : 'md:w-0 md:hidden'}
              md:self-start md:sticky md:top-0 md:max-h-full
            `}
          >
            {selectedAgent && (
              <div className="h-full overflow-y-auto">
                <button
                  onClick={() => setSelectedAgent(null)}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs text-th-text-alt hover:text-th-text transition-colors md:hidden"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />Back
                </button>
                <ProfilePanel agentId={selectedAgent} teamId={selectedAgentTeamId} onClose={() => setSelectedAgent(null)} />
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
