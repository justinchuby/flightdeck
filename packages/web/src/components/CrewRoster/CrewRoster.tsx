import { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Search,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
  Clock,
  User,
  Cpu,
  Settings,
  Activity,
  X,
  Zap,
  MessageSquare,
  Square,
  Send,
  Trash2,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { getRoleIcon } from '../../utils/getRoleIcon';
import { sessionStatusDot } from '../../utils/statusColors';
import { useToastStore } from '../Toast';
import { formatRelativeTime } from '../../utils/formatRelativeTime';
import { formatTokens } from '../../utils/format';
import { Tabs } from '../ui/Tabs';
import type { TabItem } from '../ui/Tabs';
import { useModels, deriveModelName } from '../../hooks/useModels';
import { shortAgentId } from '../../utils/agentLabel';

// ── Types ─────────────────────────────────────────────────

type RosterStatus = 'idle' | 'running' | 'terminated' | 'failed';
type LiveStatus = 'creating' | 'running' | 'idle' | 'completed' | 'failed' | 'terminated' | null;
type ProfileTab = 'overview' | 'history' | 'settings';

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

interface CrewInfo {
  crewId: string;
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

// ── Helpers ───────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

function statusBadge(status: RosterStatus, liveStatus: LiveStatus): { bg: string; label: string } {
  // Live agent states take priority — these come from AgentManager (in-memory)
  if (liveStatus === 'running') return { bg: 'bg-green-500/20 text-green-400', label: 'Running' };
  if (liveStatus === 'creating') return { bg: 'bg-yellow-500/20 text-yellow-400', label: 'Starting' };
  if (liveStatus === 'idle') return { bg: 'bg-cyan-500/20 text-cyan-400', label: 'Idle' };
  if (liveStatus === 'completed') return { bg: 'bg-gray-500/20 text-gray-400', label: 'Completed' };
  if (liveStatus === 'failed') return { bg: 'bg-red-500/20 text-red-400', label: 'Failed' };
  if (liveStatus === 'terminated') return { bg: 'bg-gray-500/20 text-gray-400', label: 'Terminated' };
  // liveStatus is null — agent not in memory. Fall back to DB status.
  if (status === 'terminated') return { bg: 'bg-gray-500/20 text-gray-400', label: 'Terminated' };
  if (status === 'failed') return { bg: 'bg-red-500/20 text-red-400', label: 'Failed' };
  // DB says idle/running but agent not found in live manager → offline
  return { bg: 'bg-gray-500/20 text-gray-400', label: 'Offline' };
}

// ── Crew Group (collapsible) ──────────────────────────────

interface CrewGroupProps {
  leadId: string;
  agents: RosterAgent[];
  summary: CrewSummary | null;
  defaultExpanded?: boolean;
  onSelectAgent: (id: string) => void;
  selectedAgentId: string | null;
  onDeleteCrew: (leadId: string) => Promise<void>;
}

function CrewGroup({ leadId, agents, summary, defaultExpanded = true, onSelectAgent, selectedAgentId, onDeleteCrew }: CrewGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [sessions, setSessions] = useState<SessionDetail[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Lazy-load session details when expanded and project is known
  useEffect(() => {
    if (!expanded || sessionsLoaded || !summary?.projectId) return;
    setSessionsLoaded(true);
    apiFetch<SessionDetail[]>(`/projects/${summary.projectId}/sessions/detail`)
      .then(data => {
        // Filter to sessions belonging to this crew's lead
        const crewSessions = Array.isArray(data)
          ? data.filter(s => s.leadId === leadId)
          : [];
        setSessions(crewSessions);
      })
      .catch(() => { /* silently ignore — sessions section just won't show */ });
  }, [expanded, sessionsLoaded, summary?.projectId, leadId]);

  // Lead first, then sorted by role
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
  const displayName = summary?.projectName ?? (lead?.projectId ? `Project ${shortAgentId(lead.projectId)}` : `Crew ${shortAgentId(leadId)}`);

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
              {lead && <span>🎖️ Lead: {shortAgentId(lead.agentId)}{lead.provider ? ` · ${lead.provider}` : ''} · {lead.model}</span>}
              {summary?.sessionCount ? <span>📋 {summary.sessionCount} session{summary.sessionCount !== 1 ? 's' : ''}</span> : null}
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

      {/* Agent rows */}
      {expanded && (
        <div className="border-t border-th-border/50 divide-y divide-th-border/30">
          {sorted.map(agent => (
            <AgentRow
              key={agent.agentId}
              agent={agent}
              isLead={agent.agentId === leadId || agent.role === 'lead'}
              isSelected={selectedAgentId === agent.agentId}
              onSelect={() => onSelectAgent(agent.agentId)}
            />
          ))}
        </div>
      )}

      {/* Session history */}
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
              <div className="text-[10px] text-th-text-muted">+ {sessions.length - 5} more session{sessions.length - 5 !== 1 ? 's' : ''}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Agent Row (compact, within crew group) ────────────────

function AgentRow({ agent, isLead, isSelected, onSelect }: {
  agent: RosterAgent; isLead?: boolean; isSelected: boolean; onSelect: () => void;
}) {
  const badge = statusBadge(agent.status, agent.liveStatus);
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-th-bg-alt/30 transition-colors
        ${isSelected ? 'bg-th-bg-alt/40 border-l-2 border-blue-500' : ''}
        ${isLead ? 'font-medium' : ''}`}
    >
      <span className="w-4 text-center text-xs">{isLead ? '🎖️' : getRoleIcon(agent.role)}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs capitalize">{agent.role}</span>
          <code className="text-[10px] text-th-text-muted">{shortAgentId(agent.agentId)}</code>
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
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${badge.bg}`}>{badge.label}</span>
    </button>
  );
}

// ── Agent Profile Panel ───────────────────────────────────

function ProfilePanel({ agentId, crewId, onClose }: { agentId: string; crewId: string; onClose: () => void }) {
  const addToast = useToastStore(s => s.add);
  const { models: availableModels } = useModels();
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');
  const [confirmStop, setConfirmStop] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [showMessageInput, setShowMessageInput] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    apiFetch<AgentProfile>(`/crews/${crewId}/agents/${agentId}/profile`)
      .then(data => setProfile(data))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [agentId, crewId]);

  const isAlive = profile?.liveStatus === 'running' || profile?.liveStatus === 'creating' || profile?.liveStatus === 'idle';

  const handleInterrupt = async () => {
    setActionLoading('interrupt');
    try {
      await apiFetch(`/agents/${agentId}/interrupt`, { method: 'POST' });
      addToast('success', 'Interrupt sent');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addToast('error', `Failed to interrupt agent: ${message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendMessage = async () => {
    if (!messageText.trim()) return;
    setActionLoading('message');
    try {
      await apiFetch(`/agents/${agentId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: messageText.trim() }),
      });
      addToast('success', 'Message sent');
      setMessageText('');
      setShowMessageInput(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addToast('error', `Failed to send message: ${message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStop = async () => {
    setActionLoading('stop');
    try {
      await apiFetch(`/agents/${agentId}/terminate`, { method: 'POST' });
      addToast('success', 'Agent terminated');
      setConfirmStop(false);
      // Refresh profile to reflect new status
      const data = await apiFetch<AgentProfile>(`/crews/${crewId}/agents/${agentId}/profile`);
      setProfile(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addToast('error', `Failed to stop agent: ${message}`);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-th-text-alt">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
        Loading profile…
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center h-48 text-red-400">
        <AlertTriangle className="w-4 h-4 mr-2" />
        Profile not found
      </div>
    );
  }

  const badge = statusBadge(profile.status, profile.liveStatus);
  const tabs: TabItem[] = [
    { id: 'overview', label: 'Overview', icon: <User className="w-3.5 h-3.5" /> },
    { id: 'history', label: 'History', icon: <Clock className="w-3.5 h-3.5" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="bg-surface-raised rounded-lg border border-th-border w-full">
      {/* Profile Header */}
      <div className="p-4 border-b border-th-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-th-bg-alt flex items-center justify-center">
              <span className="text-xl">{getRoleIcon(profile.role)}</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-th-text capitalize">{profile.role}</h2>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.bg}`}>{badge.label}</span>
              </div>
              <span className="text-xs font-mono text-th-text-alt">{profile.agentId.slice(0, 12)}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-th-bg-alt text-th-text-alt">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action Buttons */}
        {isAlive && (
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => setShowMessageInput(v => !v)}
              disabled={actionLoading !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Message
            </button>
            <button
              onClick={handleInterrupt}
              disabled={actionLoading !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
            >
              {actionLoading === 'interrupt' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              Interrupt
            </button>
            <button
              onClick={() => setConfirmStop(true)}
              disabled={actionLoading !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50"
            >
              <Square className="w-3.5 h-3.5" />
              Stop
            </button>
          </div>
        )}

        {/* Confirm Stop Dialog */}
        {confirmStop && (
          <div className="mt-2 p-3 rounded bg-red-500/10 border border-red-500/30">
            <p className="text-xs text-red-300 mb-2">Are you sure you want to terminate this agent? This cannot be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={handleStop}
                disabled={actionLoading === 'stop'}
                className="px-3 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {actionLoading === 'stop' ? 'Stopping...' : 'Confirm Stop'}
              </button>
              <button
                onClick={() => setConfirmStop(false)}
                className="px-3 py-1 text-xs rounded bg-th-bg-alt text-th-text-alt hover:bg-th-border transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Message Input */}
        {showMessageInput && (
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={messageText}
              onChange={e => setMessageText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
              placeholder="Type a message to this agent..."
              className="flex-1 px-3 py-1.5 text-sm rounded bg-th-bg-alt border border-th-border text-th-text placeholder:text-th-text-alt"
              autoFocus
            />
            <button
              onClick={handleSendMessage}
              disabled={!messageText.trim() || actionLoading === 'message'}
              className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              {actionLoading === 'message' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Send
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as ProfileTab)}
        className="px-4"
      />

      {/* Tab Content */}
      <div className="p-4">
        {activeTab === 'overview' && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-th-text-alt">Model:</span> <span className="text-th-text">{profile.model}</span></div>
              <div><span className="text-th-text-alt">Project:</span> <span className="text-th-text">{profile.projectId ?? '—'}</span></div>
              <div><span className="text-th-text-alt">Knowledge:</span> <span className="text-th-text">{profile.knowledgeCount} entries</span></div>
              <div><span className="text-th-text-alt">Created:</span> <span className="text-th-text">{new Date(profile.createdAt).toLocaleDateString()}</span></div>
              <div><span className="text-th-text-alt">Last Active:</span> <span className="text-th-text">{new Date(profile.updatedAt).toLocaleDateString()}</span></div>
              {profile.live?.provider && (
                <div><span className="text-th-text-alt">CLI:</span> <span className="text-th-text capitalize">{profile.live.provider}{profile.live.backend && profile.live.backend !== 'acp' ? ` (${profile.live.backend})` : ''}</span></div>
              )}
              {profile.live?.sessionId && (
                <div className="col-span-2">
                  <span className="text-th-text-alt">Session:</span>{' '}
                  <button
                    className="font-mono text-xs text-th-text bg-th-bg-alt/60 px-1.5 py-0.5 rounded hover:bg-th-bg-alt transition-colors"
                    title="Click to copy session ID"
                    onClick={() => { navigator.clipboard.writeText(profile.live!.sessionId!); }}
                  >
                    {profile.live.sessionId.slice(0, 12)}…
                  </button>
                </div>
              )}
            </div>
            {profile.lastTaskSummary && (
              <div>
                <span className="text-th-text-alt">Last Task:</span>
                <p className="text-th-text mt-1">{profile.lastTaskSummary}</p>
              </div>
            )}
            {profile.live?.exitError && (
              <div className="mt-3 p-3 rounded bg-red-500/10 border border-red-500/20">
                <div className="flex items-center gap-2 text-red-400 text-xs font-medium mb-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Exit Error
                </div>
                <pre className="text-xs font-mono text-red-400 whitespace-pre-wrap break-words">{profile.live.exitError}</pre>
              </div>
            )}
            {profile.live && (
              <div className="mt-3 p-3 rounded bg-green-500/10 border border-green-500/20">
                <div className="flex items-center gap-2 text-green-400 text-xs mb-1">
                  <Activity className="w-3.5 h-3.5" />
                  Live Session
                </div>
                {profile.live.task && <p className="text-sm text-th-text">{profile.live.task}</p>}
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="text-sm text-th-text-alt text-center py-6">
            <Clock className="w-6 h-6 mx-auto mb-2 opacity-50" />
            Task history will be available when AS23 migration completes
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
                      } catch (err: unknown) {
                        const message = err instanceof Error ? err.message : String(err);
                        addToast('error', `Failed to update model: ${message}`);
                      }
                    }}
                    className="w-full text-sm bg-th-bg-alt border border-th-border text-th-text rounded px-2 py-1.5 focus:outline-none focus:border-accent cursor-pointer"
                  >
                    {(() => {
                      const current = profile.live?.model || profile.model;
                      const options = availableModels.includes(current) ? availableModels : [current, ...availableModels];
                      return options.map(m => <option key={m} value={m}>{deriveModelName(m)}</option>);
                    })()}
                  </select>
                ) : (
                  <span className="text-th-text">{profile.model}</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {profile.live?.provider && (
                  <div><span className="text-th-text-alt">CLI Provider:</span> <span className="text-th-text capitalize">{profile.live.provider}</span></div>
                )}
                {profile.live?.backend && (
                  <div><span className="text-th-text-alt">Backend:</span> <span className="text-th-text">{profile.live.backend}</span></div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────

export function CrewRoster() {
  const addToast = useToastStore(s => s.add);
  const [agents, setAgents] = useState<RosterAgent[]>([]);
  const [crewSummaries, setCrewSummaries] = useState<CrewSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<RosterStatus | 'all'>('all');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  // Resolve crewId for the profile panel
  const selectedAgentCrewId = agents.find(a => a.agentId === selectedAgent)?.teamId ?? 'default';

  const fetchAll = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);

      // Fetch crew summaries + all crew agents in parallel
      const [summaryResult, crewsResult] = await Promise.allSettled([
        apiFetch<CrewSummary[]>('/crews/summary'),
        apiFetch<{ crews: CrewInfo[] }>('/crews'),
      ]);

      // Crew summaries (for project names, session counts)
      const summaries = summaryResult.status === 'fulfilled' && Array.isArray(summaryResult.value)
        ? summaryResult.value : [];
      setCrewSummaries(summaries);

      // Fetch agents from all crews (gives full data with crewId for profile lookups)
      const crewList = crewsResult.status === 'fulfilled' ? (crewsResult.value.crews ?? []) : [];
      const statusQ = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const agentResults = await Promise.allSettled(
        crewList.map(t => apiFetch<RosterAgent[]>(`/crews/${t.crewId}/agents${statusQ}`))
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

      setAgents(allAgents);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message ?? 'Failed to fetch crew roster');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleDeleteCrew = useCallback(async (leadId: string) => {
    try {
      await apiFetch(`/crews/${leadId}`, { method: 'DELETE' });
      addToast('success', 'Crew deleted');
      // Remove deleted agents from local state and deselect if needed
      setAgents(prev => {
        const remaining = prev.filter(a => {
          if (a.agentId === leadId) return false;
          const meta = a.parentId;
          return meta !== leadId;
        });
        return remaining;
      });
      if (selectedAgent) {
        const deletedAgent = agents.find(a => a.agentId === selectedAgent);
        if (deletedAgent && (deletedAgent.agentId === leadId || deletedAgent.parentId === leadId)) {
          setSelectedAgent(null);
        }
      }
      setCrewSummaries(prev => prev.filter(s => s.leadId !== leadId));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addToast('error', `Failed to delete crew: ${message}`);
    }
  }, [addToast, agents, selectedAgent]);

  // Filter agents
  const filtered = agents.filter(a => {
    if (!search) return true;
    const q = search.toLowerCase();
    return a.role.toLowerCase().includes(q)
      || a.agentId.toLowerCase().includes(q)
      || (a.lastTaskSummary?.toLowerCase().includes(q) ?? false);
  });

  // Group by lead (parentId). Leads group under themselves; members under their parent.
  const crewGroups = (() => {
    const map = new Map<string, RosterAgent[]>();
    for (const a of filtered) {
      const leadId = a.role === 'lead' ? a.agentId : (a.parentId ?? 'unassigned');
      if (!map.has(leadId)) map.set(leadId, []);
      map.get(leadId)!.push(a);
    }
    // Sort: active crews first, then by last activity
    return [...map.entries()].sort((a, b) => {
      const aActive = a[1].some(ag => ag.liveStatus === 'running' || ag.liveStatus === 'idle');
      const bActive = b[1].some(ag => ag.liveStatus === 'running' || ag.liveStatus === 'idle');
      if (aActive !== bActive) return aActive ? -1 : 1;
      const aTime = a[1].reduce((max, ag) => ag.updatedAt > max ? ag.updatedAt : max, '');
      const bTime = b[1].reduce((max, ag) => ag.updatedAt > max ? ag.updatedAt : max, '');
      return bTime.localeCompare(aTime);
    });
  })();

  // Build summary lookup by leadId
  const summaryMap = new Map(crewSummaries.map(s => [s.leadId, s]));

  if (loading && agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-th-text-alt">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Loading crew roster…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-red-400">
        <AlertTriangle className="w-5 h-5 mr-2" />
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 p-6 max-w-screen-2xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-th-accent" />
          <h1 className="text-xl font-bold text-th-text">Crew Roster</h1>
          <span className="text-sm text-th-text-muted">
            {crewGroups.length} crew{crewGroups.length !== 1 ? 's' : ''} · {filtered.length} agent{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          onClick={() => fetchAll()}
          className="px-3 py-1.5 text-sm rounded bg-th-bg-alt hover:bg-th-border text-th-text-alt transition-colors flex items-center gap-1"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mt-4 shrink-0">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-th-text-alt" />
          <input
            type="text"
            placeholder="Search crews, agents, tasks..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded bg-th-bg-alt border border-th-border text-th-text placeholder:text-th-text-alt"
          />
        </div>

        <div className="flex gap-1">
          {(['all', 'idle', 'running', 'terminated', 'failed'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs rounded capitalize transition-colors ${
                statusFilter === s
                  ? 'bg-th-accent/20 text-th-accent border border-th-accent/30'
                  : 'bg-th-bg-alt text-th-text-alt border border-th-border hover:bg-th-border'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Content: Grouped List + Profile */}
      <div className="flex flex-col md:flex-row gap-6 flex-1 min-h-0 overflow-y-auto mt-4">
        {/* Crew Groups — stable width at desktop/tablet, full-width responsive on mobile */}
        <div className={`space-y-3 min-w-0 ${selectedAgent ? 'flex-1' : 'w-full'}`}>
          {crewGroups.length === 0 ? (
            <div className="text-center py-8 text-th-text-alt text-sm bg-surface-raised rounded-lg border border-th-border">
              <Cpu className="w-8 h-8 mx-auto mb-2 opacity-50" />
              {search ? 'No agents match your search' : 'No agents in any crew'}
            </div>
          ) : (
            crewGroups.map(([leadId, groupAgents]) => (
              <div key={leadId} className="cv-auto-lg">
              <CrewGroup
                leadId={leadId}
                agents={groupAgents}
                summary={summaryMap.get(leadId) ?? null}
                defaultExpanded
                onSelectAgent={setSelectedAgent}
                selectedAgentId={selectedAgent}
                onDeleteCrew={handleDeleteCrew}
              />
              </div>
            ))
          )}
        </div>

        {/* Profile Panel */}
        {selectedAgent && (
          <div className="w-full max-w-full md:w-[400px] lg:w-[480px] shrink-0">
            <ProfilePanel
              agentId={selectedAgent}
              crewId={selectedAgentCrewId}
              onClose={() => setSelectedAgent(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
