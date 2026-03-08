import { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Search,
  RefreshCw,
  AlertTriangle,
  ChevronRight,
  ArrowUpDown,
  User,
  Cpu,
  BookOpen,
  Wrench,
  Settings,
  Activity,
  Clock,
  PauseCircle,
  UserMinus,
  Server,
  Power,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useToastStore } from '../components/Toast';
import { AgentLifecycle } from '../components/AgentLifecycle';

// ── Types ─────────────────────────────────────────────────

type AgentStatus = 'idle' | 'busy' | 'terminated' | 'retired';
type LiveStatus = 'creating' | 'running' | 'idle' | 'completed' | 'failed' | 'terminated' | null;
type ProfileTab = 'overview' | 'history' | 'knowledge' | 'skills' | 'settings';
type SortField = 'role' | 'status' | 'updatedAt';
type SortDir = 'asc' | 'desc';
type StatusFilter = AgentStatus | 'all';

interface TeamInfo {
  teamId: string;
  agentCount: number;
  roles: string[];
}

interface RosterAgent {
  agentId: string;
  role: string;
  model: string;
  status: AgentStatus;
  liveStatus: LiveStatus;
  teamId: string;
  projectId: string | null;
  lastTaskSummary: string | null;
  createdAt: string;
  updatedAt: string;
  uptimeMs?: number;
  clonedFromId?: string;
}

/** Exported for AgentLifecycle compatibility */
export interface AgentHealthInfo {
  agentId: string;
  role: string;
  model: string;
  status: string;
  uptimeMs: number;
  lastTaskSummary?: string;
  retiredAt?: string;
  clonedFromId?: string;
}

interface AgentProfile {
  agentId: string;
  role: string;
  model: string;
  status: AgentStatus;
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
    autopilot: boolean;
    model: string | null;
  } | null;
}

interface HealthData {
  teamId: string;
  totalAgents: number;
  statusCounts: Record<string, number>;
  massFailurePaused: boolean;
  agents: AgentHealthInfo[];
}

interface ServerStatus {
  running: boolean;
  connected: boolean;
  state: string;
  agentCount: number | null;
  latencyMs: number | null;
  pendingRequests: number;
  trackedAgents: number;
}

// ── Helpers ───────────────────────────────────────────────

function agentBadge(status: AgentStatus, liveStatus: LiveStatus): { bg: string; label: string } {
  if (liveStatus === 'running') return { bg: 'bg-green-500/20 text-green-400', label: 'Running' };
  if (liveStatus === 'creating') return { bg: 'bg-yellow-500/20 text-yellow-400', label: 'Starting' };
  if (status === 'busy') return { bg: 'bg-blue-500/20 text-blue-400', label: 'Busy' };
  if (status === 'retired') return { bg: 'bg-gray-500/20 text-gray-400', label: 'Retired' };
  if (status === 'terminated') return { bg: 'bg-red-500/20 text-red-400', label: 'Terminated' };
  if (status === 'idle') return { bg: 'bg-cyan-500/20 text-cyan-400', label: 'Idle' };
  return { bg: 'bg-gray-500/20 text-gray-400', label: status };
}

function formatUptime(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}

function serverStateBadge(running: boolean, state: string): { color: string; label: string } {
  if (!running) return { color: 'bg-red-400', label: 'Stopped' };
  if (state === 'connected') return { color: 'bg-green-400', label: 'Online' };
  if (state === 'reconnecting') return { color: 'bg-yellow-400', label: 'Reconnecting' };
  return { color: 'bg-red-400', label: 'Disconnected' };
}

// ── Sub-components ────────────────────────────────────────

function OverviewCard({ label, count, icon, color, testId }: {
  label: string;
  count: number;
  icon: React.ReactNode;
  color: string;
  testId?: string;
}) {
  return (
    <div className="bg-th-bg-alt border border-th-border rounded-lg p-4" data-testid={testId}>
      <div className={`flex items-center gap-2 ${color}`}>
        {icon}
        <span className="text-2xl font-bold">{count}</span>
      </div>
      <span className="text-xs text-th-text-muted mt-1 block">{label}</span>
    </div>
  );
}

function ServerCard({ status, onStop }: { status: ServerStatus | null; onStop: () => void }) {
  if (!status) return null;
  const badge = serverStateBadge(status.running, status.state);

  return (
    <div className="bg-th-bg-alt border border-th-border rounded-lg p-4" data-testid="card-server">
      <div className="flex items-center gap-2 text-th-text mb-1">
        <Server className="w-4 h-4" />
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${badge.color}`} />
          <span className="text-sm font-medium">{badge.label}</span>
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-th-text-muted">
        {status.connected
          ? <Wifi className="w-3 h-3 text-green-400" />
          : <WifiOff className="w-3 h-3 text-red-400" />}
        <span>{status.agentCount ?? 0} agents</span>
        {status.latencyMs != null && <span>{status.latencyMs}ms</span>}
      </div>
      {status.running && (
        <button
          onClick={onStop}
          className="mt-2 px-2 py-1 text-xs rounded bg-red-600/20 hover:bg-red-600/40 text-red-400 transition-colors flex items-center gap-1"
          data-testid="stop-server-btn"
        >
          <Power className="w-3 h-3" />
          Stop Server
        </button>
      )}
    </div>
  );
}

function AgentCard({ agent, selected, onSelect, onManage }: {
  agent: RosterAgent;
  selected: boolean;
  onSelect: (id: string) => void;
  onManage: (id: string) => void;
}) {
  const badge = agentBadge(agent.status, agent.liveStatus);

  return (
    <div
      className={`bg-surface-raised rounded-lg border p-4 transition-colors ${
        selected ? 'border-th-accent' : 'border-th-border hover:bg-th-bg-alt/50'
      }`}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={() => onSelect(agent.agentId)}
          className="flex-1 flex items-center gap-3 text-left min-w-0"
        >
          <div className="w-8 h-8 rounded-full bg-th-bg-alt flex items-center justify-center flex-shrink-0">
            <User className="w-4 h-4 text-th-text-alt" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-th-text capitalize">{agent.role}</span>
              <span className="text-xs font-mono text-th-text-alt">{agent.agentId.slice(0, 8)}</span>
              {agent.clonedFromId && <span title="Cloned agent">🧬</span>}
            </div>
            <div className="flex items-center gap-2 text-xs text-th-text-alt truncate">
              <span className="truncate">{agent.lastTaskSummary ?? 'No recent task'}</span>
              {agent.uptimeMs != null && (
                <span className="flex items-center gap-0.5 flex-shrink-0">
                  <Clock className="w-3 h-3" />
                  {formatUptime(agent.uptimeMs)}
                </span>
              )}
            </div>
          </div>
          <span className={`px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${badge.bg}`}>{badge.label}</span>
          <ChevronRight className="w-4 h-4 text-th-text-alt flex-shrink-0" />
        </button>
        <button
          onClick={() => onManage(agent.agentId)}
          className="text-xs text-accent hover:underline flex-shrink-0"
          data-testid={`manage-${agent.agentId.slice(0, 8)}`}
        >
          Manage
        </button>
      </div>
    </div>
  );
}

function ProfilePanel({ agentId, teamId, onClose }: {
  agentId: string;
  teamId: string;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');

  useEffect(() => {
    setLoading(true);
    apiFetch<AgentProfile>(`/teams/${teamId}/agents/${agentId}/profile`)
      .then(data => setProfile(data))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [agentId, teamId]);

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

  const badge = agentBadge(profile.status, profile.liveStatus);
  const tabs: Array<{ id: ProfileTab; label: string; icon: typeof User }> = [
    { id: 'overview', label: 'Overview', icon: User },
    { id: 'history', label: 'History', icon: Clock },
    { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
    { id: 'skills', label: 'Skills', icon: Wrench },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="bg-surface-raised rounded-lg border border-th-border">
      {/* Header */}
      <div className="p-4 border-b border-th-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-th-bg-alt flex items-center justify-center">
              <User className="w-5 h-5 text-th-text-alt" />
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
      </div>

      {/* Tabs */}
      <div className="flex border-b border-th-border px-4">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-th-accent text-th-accent'
                : 'border-transparent text-th-text-alt hover:text-th-text'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-4">
        {activeTab === 'overview' && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-th-text-alt">Model:</span> <span className="text-th-text">{profile.model}</span></div>
              <div><span className="text-th-text-alt">Team:</span> <span className="text-th-text">{profile.teamId}</span></div>
              <div><span className="text-th-text-alt">Project:</span> <span className="text-th-text">{profile.projectId ?? '—'}</span></div>
              <div><span className="text-th-text-alt">Knowledge:</span> <span className="text-th-text">{profile.knowledgeCount} entries</span></div>
              <div><span className="text-th-text-alt">Created:</span> <span className="text-th-text">{new Date(profile.createdAt).toLocaleDateString()}</span></div>
              <div><span className="text-th-text-alt">Last Active:</span> <span className="text-th-text">{new Date(profile.updatedAt).toLocaleDateString()}</span></div>
            </div>
            {profile.lastTaskSummary && (
              <div>
                <span className="text-th-text-alt">Last Task:</span>
                <p className="text-th-text mt-1">{profile.lastTaskSummary}</p>
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
            Task history will be available when migration completes
          </div>
        )}

        {activeTab === 'knowledge' && (
          <div className="text-sm text-th-text-alt text-center py-6">
            <BookOpen className="w-6 h-6 mx-auto mb-2 opacity-50" />
            {profile.knowledgeCount > 0
              ? `${profile.knowledgeCount} knowledge entries — use Knowledge panel for details`
              : 'No knowledge entries yet'}
          </div>
        )}

        {activeTab === 'skills' && (
          <div className="text-sm text-th-text-alt text-center py-6">
            <Wrench className="w-6 h-6 mx-auto mb-2 opacity-50" />
            Skills and training data will be available when migration completes
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-th-text-alt">Model:</span> <span className="text-th-text">{profile.model}</span></div>
              <div><span className="text-th-text-alt">Autopilot:</span> <span className="text-th-text">{profile.live?.autopilot ? 'On' : 'Off'}</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────

export function TeamPage() {
  const addToast = useToastStore(s => s.add);

  // Data state
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [selectedTeam, setSelectedTeam] = useState('default');
  const [agents, setAgents] = useState<RosterAgent[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortField, setSortField] = useState<SortField>('role');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [managingAgent, setManagingAgent] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);

  // ── Data fetching ────────────────────────────────────────

  const fetchTeams = useCallback(async () => {
    try {
      const data = await apiFetch<{ teams: TeamInfo[] }>('/teams');
      setTeams(data.teams ?? []);
      if (data.teams?.length && !data.teams.find(t => t.teamId === selectedTeam)) {
        setSelectedTeam(data.teams[0].teamId);
      }
    } catch { /* teams list is non-critical */ }
  }, [selectedTeam]);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const agentUrl = statusFilter === 'all'
        ? `/teams/${selectedTeam}/agents`
        : `/teams/${selectedTeam}/agents?status=${statusFilter}`;

      const [agentData, healthData, serverData] = await Promise.allSettled([
        apiFetch<RosterAgent[]>(agentUrl),
        apiFetch<HealthData>(`/teams/${encodeURIComponent(selectedTeam)}/health`),
        apiFetch<ServerStatus>('/agent-server/status'),
      ]);

      if (agentData.status === 'fulfilled') {
        const roster = Array.isArray(agentData.value) ? agentData.value : [];
        // Enrich roster with health data (uptime, clone info)
        if (healthData.status === 'fulfilled') {
          const healthMap = new Map(healthData.value.agents.map(a => [a.agentId, a]));
          for (const agent of roster) {
            const h = healthMap.get(agent.agentId);
            if (h) {
              agent.uptimeMs = h.uptimeMs;
              agent.clonedFromId = h.clonedFromId;
            }
          }
        }
        setAgents(roster);
      } else {
        throw agentData.reason;
      }

      if (healthData.status === 'fulfilled') setHealth(healthData.value);
      if (serverData.status === 'fulfilled') setServerStatus(serverData.value);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load team data');
    } finally {
      setLoading(false);
    }
  }, [selectedTeam, statusFilter]);

  useEffect(() => { fetchTeams(); }, [fetchTeams]);
  useEffect(() => { setLoading(true); fetchData(); }, [fetchData]);

  // Polling
  useEffect(() => {
    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // WebSocket events
  useEffect(() => {
    function onWsMessage(event: Event) {
      try {
        const raw = (event as MessageEvent).data;
        const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (msg.type === 'team:agent_retired' || msg.type === 'team:agent_cloned') {
          fetchData();
        }
      } catch { /* ignore */ }
    }
    window.addEventListener('ws-message', onWsMessage);
    return () => window.removeEventListener('ws-message', onWsMessage);
  }, [fetchData]);

  // ── Actions ──────────────────────────────────────────────

  const handleStopServer = async () => {
    try {
      await apiFetch('/agent-server/stop', { method: 'POST' });
      addToast('success', 'Agent server stop requested');
      setConfirmStop(false);
      setTimeout(fetchData, 1000);
    } catch (err: any) {
      addToast('error', err.message ?? 'Failed to stop server');
    }
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  // ── Filter & sort ────────────────────────────────────────

  const filtered = agents
    .filter(a => {
      if (!search) return true;
      const q = search.toLowerCase();
      return a.role.toLowerCase().includes(q)
        || a.agentId.toLowerCase().includes(q)
        || (a.lastTaskSummary?.toLowerCase().includes(q) ?? false);
    })
    .sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortField === 'role') return a.role.localeCompare(b.role) * dir;
      if (sortField === 'status') return a.status.localeCompare(b.status) * dir;
      return (a.updatedAt > b.updatedAt ? 1 : -1) * dir;
    });

  // ── Render ───────────────────────────────────────────────

  if (loading && agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-th-text-alt">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Loading team…
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

  const statusCounts = health?.statusCounts ?? {};

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-th-accent" />
          <h1 className="text-xl font-bold text-th-text">Team</h1>
          {teams.length > 1 && (
            <select
              value={selectedTeam}
              onChange={e => setSelectedTeam(e.target.value)}
              className="ml-2 px-2 py-1 text-sm rounded bg-th-bg-alt border border-th-border text-th-text"
            >
              {teams.map(t => (
                <option key={t.teamId} value={t.teamId}>{t.teamId} ({t.agentCount})</option>
              ))}
            </select>
          )}
        </div>
        <button
          onClick={() => { setLoading(true); fetchData(); }}
          className="px-3 py-1.5 text-sm rounded bg-th-bg-alt hover:bg-th-border text-th-text-alt transition-colors flex items-center gap-1"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Mass failure alert */}
      {health?.massFailurePaused && (
        <div
          className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2"
          role="alert"
          data-testid="mass-failure-alert"
        >
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="text-sm text-red-400">
            Mass failure detected — agent spawning is paused
          </span>
        </div>
      )}

      {/* Overview cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <OverviewCard
          label="Total"
          count={health?.totalAgents ?? agents.length}
          icon={<Users className="w-4 h-4" />}
          color="text-th-text"
          testId="card-total"
        />
        <OverviewCard
          label="Active"
          count={statusCounts.busy ?? 0}
          icon={<Activity className="w-4 h-4" />}
          color="text-green-400"
          testId="card-active"
        />
        <OverviewCard
          label="Idle"
          count={statusCounts.idle ?? 0}
          icon={<PauseCircle className="w-4 h-4" />}
          color="text-blue-400"
          testId="card-idle"
        />
        <OverviewCard
          label="Retired"
          count={statusCounts.retired ?? 0}
          icon={<UserMinus className="w-4 h-4" />}
          color="text-gray-400"
          testId="card-retired"
        />
        <ServerCard
          status={serverStatus}
          onStop={() => setConfirmStop(true)}
        />
      </div>

      {/* Stop server confirmation */}
      {confirmStop && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="text-sm text-red-400">Stop agent server? All agents will be terminated.</span>
          <button
            onClick={handleStopServer}
            className="ml-auto px-3 py-1 text-xs rounded bg-red-600 hover:bg-red-500 text-white"
            data-testid="confirm-stop-btn"
          >
            Confirm Stop
          </button>
          <button
            onClick={() => setConfirmStop(false)}
            className="px-3 py-1 text-xs rounded bg-th-bg-alt hover:bg-th-border text-th-text-alt"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-th-text-alt" />
          <input
            type="text"
            placeholder="Search agents..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded bg-th-bg-alt border border-th-border text-th-text placeholder:text-th-text-alt"
          />
        </div>

        <div className="flex gap-1">
          {(['all', 'busy', 'idle', 'retired', 'terminated'] as const).map(s => (
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

        <button
          onClick={() => toggleSort(sortField === 'role' ? 'status' : sortField === 'status' ? 'updatedAt' : 'role')}
          className="px-3 py-1.5 text-xs rounded bg-th-bg-alt border border-th-border text-th-text-alt hover:bg-th-border flex items-center gap-1"
        >
          <ArrowUpDown className="w-3 h-3" />
          {sortField}
        </button>
      </div>

      {/* Agent list + profile */}
      <div className="flex gap-6">
        <div className={`space-y-2 ${selectedAgent ? 'w-1/2' : 'w-full'}`}>
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-th-text-alt text-sm bg-surface-raised rounded-lg border border-th-border">
              <Cpu className="w-8 h-8 mx-auto mb-2 opacity-50" />
              {search ? 'No agents match your search' : 'No agents in this team'}
            </div>
          ) : (
            filtered.map(agent => (
              <AgentCard
                key={agent.agentId}
                agent={agent}
                selected={agent.agentId === selectedAgent}
                onSelect={setSelectedAgent}
                onManage={setManagingAgent}
              />
            ))
          )}
        </div>

        {selectedAgent && (
          <div className="w-1/2">
            <ProfilePanel
              agentId={selectedAgent}
              teamId={selectedTeam}
              onClose={() => setSelectedAgent(null)}
            />
          </div>
        )}
      </div>

      {/* Lifecycle modal */}
      {managingAgent && (
        <AgentLifecycle
          agentId={managingAgent}
          teamId={selectedTeam}
          agent={health?.agents.find(a => a.agentId === managingAgent)}
          onClose={() => setManagingAgent(null)}
          onActionComplete={() => { fetchData(); setManagingAgent(null); }}
        />
      )}
    </div>
  );
}
