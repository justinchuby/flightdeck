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
  X,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useToastStore } from '../components/Toast';
import { AgentLifecycle } from '../components/AgentLifecycle';
import { StatusBadge, agentStatusProps } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { Tabs } from '../components/ui/Tabs';
import type { TabItem } from '../components/ui/Tabs';
import { shortAgentId } from '../utils/agentLabel';

// ── Types ─────────────────────────────────────────────────

type CrewTab = 'roster' | 'health';
type AgentStatus = 'idle' | 'running' | 'terminated' | 'failed';
type LiveStatus = 'creating' | 'running' | 'idle' | 'completed' | 'failed' | 'terminated' | null;
type ProfileTab = 'overview' | 'history' | 'knowledge' | 'skills' | 'settings';
type SortField = 'role' | 'status' | 'updatedAt';
type SortDir = 'asc' | 'desc';
type StatusFilter = AgentStatus | 'all';

interface CrewInfo {
  crewId: string;
  agentCount: number;
  roles: string[];
}

interface RosterAgent {
  agentId: string;
  role: string;
  model: string;
  provider?: string;
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
  clonedFromId?: string;
}

interface AgentProfile {
  agentId: string;
  role: string;
  model: string;
  provider?: string;
  status: AgentStatus;
  liveStatus: LiveStatus;
  crewId: string;
  projectId: string | null;
  lastTaskSummary: string | null;
  createdAt: string;
  updatedAt: string;
  knowledgeCount: number;
  live: {
    task: string | null;
    outputPreview: string | null;
    model: string | null;
  } | null;
}

interface HealthData {
  crewId: string;
  totalAgents: number;
  statusCounts: Record<string, number>;
  massFailurePaused: boolean;
  agents: AgentHealthInfo[];
}

interface CrewDetail {
  crewId: string;
  agentCount: number;
  agents: Array<{ agentId: string; role: string; model: string; status: string }>;
  knowledgeCount: number;
  trainingSummary: { corrections?: number; feedback?: number } | null;
}

// ── Helpers ───────────────────────────────────────────────

function formatUptime(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
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

function AgentCard({ agent, selected, onSelect, onManage }: {
  agent: RosterAgent;
  selected: boolean;
  onSelect: (id: string) => void;
  onManage: (id: string) => void;
}) {
  const badge = agentStatusProps(agent.status, agent.liveStatus);

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
              <span className="text-xs font-mono text-th-text-alt">{shortAgentId(agent.agentId)}</span>
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
          <StatusBadge variant={badge.variant} label={badge.label} className="flex-shrink-0" />
          <ChevronRight className="w-4 h-4 text-th-text-alt flex-shrink-0" />
        </button>
        <button
          onClick={() => onManage(agent.agentId)}
          className="text-xs text-accent hover:underline flex-shrink-0"
          data-testid={`manage-${shortAgentId(agent.agentId)}`}
        >
          Manage
        </button>
      </div>
    </div>
  );
}

function ProfilePanel({ agentId, crewId, onClose }: {
  agentId: string;
  crewId: string;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');

  useEffect(() => {
    setLoading(true);
    apiFetch<AgentProfile>(`/crews/${crewId}/agents/${agentId}/profile`)
      .then(data => setProfile(data))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [agentId, crewId]);

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

  const badge = agentStatusProps(profile.status, profile.liveStatus);
  const tabs: TabItem[] = [
    { id: 'overview', label: 'Overview', icon: <User className="w-3.5 h-3.5" /> },
    { id: 'history', label: 'History', icon: <Clock className="w-3.5 h-3.5" /> },
    { id: 'knowledge', label: 'Knowledge', icon: <BookOpen className="w-3.5 h-3.5" /> },
    { id: 'skills', label: 'Skills', icon: <Wrench className="w-3.5 h-3.5" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-3.5 h-3.5" /> },
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
                <StatusBadge variant={badge.variant} label={badge.label} />
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
      <Tabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as ProfileTab)}
        className="px-4"
      />

      {/* Tab content */}
      <div className="p-4">
        {activeTab === 'overview' && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              {profile.provider && <div><span className="text-th-text-alt">Provider:</span> <span className="text-blue-400">{profile.provider}</span></div>}
              <div><span className="text-th-text-alt">Model:</span> <span className="text-th-text">{profile.model}</span></div>
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
              {profile.provider && <div><span className="text-th-text-alt">Provider:</span> <span className="text-blue-400">{profile.provider}</span></div>}
              <div><span className="text-th-text-alt">Model:</span> <span className="text-th-text">{profile.model}</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────

export function CrewPage() {
  const _addToast = useToastStore(s => s.add);

  // Data state
  const [crews, setCrews] = useState<CrewInfo[]>([]);
  const [selectedCrew, setSelectedCrew] = useState('default');
  const [agents, setAgents] = useState<RosterAgent[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [crewDetail, setCrewDetail] = useState<CrewDetail | null>(null);

  // UI state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortField, setSortField] = useState<SortField>('role');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [managingAgent, setManagingAgent] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CrewTab>('roster');

  // ── Data fetching ────────────────────────────────────────

  const fetchCrews = useCallback(async () => {
    try {
      const data = await apiFetch<{ crews: CrewInfo[] }>('/crews');
      setCrews(data.crews ?? []);
      if (data.crews?.length && !data.crews.find(t => t.crewId === selectedCrew)) {
        setSelectedCrew(data.crews[0].crewId);
      }
    } catch { /* teams list is non-critical */ }
  }, [selectedCrew]);

  const fetchData = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      setError(null);
      const agentUrl = statusFilter === 'all'
        ? `/crews/${selectedCrew}/agents`
        : `/crews/${selectedCrew}/agents?status=${statusFilter}`;

      const [agentData, healthData, crewDetailData] = await Promise.allSettled([
        apiFetch<RosterAgent[]>(agentUrl),
        apiFetch<HealthData>(`/crews/${encodeURIComponent(selectedCrew)}/health`),
        apiFetch<CrewDetail>(`/crews/${encodeURIComponent(selectedCrew)}`),
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
      if (crewDetailData.status === 'fulfilled') setCrewDetail(crewDetailData.value);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message ?? 'Failed to load crew data');
    } finally {
      setLoading(false);
    }
  }, [selectedCrew, statusFilter]);

  useEffect(() => { fetchCrews(); }, [fetchCrews]);

  // Fetch crew data on mount + when selection/filter changes
  useEffect(() => { fetchData(); }, [selectedCrew, statusFilter]);

  // Polling (silent — no loading spinner)
  useEffect(() => {
    const interval = setInterval(() => fetchData(false), 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // WebSocket events
  useEffect(() => {
    function onWsMessage(event: Event) {
      try {
        const raw = (event as MessageEvent).data;
        const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (msg.type === 'team:agent_cloned') {
          fetchData();
        }
      } catch { /* ignore */ }
    }
    window.addEventListener('ws-message', onWsMessage);
    return () => window.removeEventListener('ws-message', onWsMessage);
  }, [fetchData]);

  // ── Actions ──────────────────────────────────────────────

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
        Loading crew…
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
    <div className="p-6 space-y-6 max-w-screen-2xl mx-auto w-full">
      {/* Header with team identity and actions */}
      <div className="bg-surface-raised rounded-lg border border-th-border p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-th-accent/20 flex items-center justify-center">
              <Users className="w-6 h-6 text-th-accent" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-th-text capitalize">{selectedCrew}</h1>
                {crews.length > 1 && (
                  <select
                    value={selectedCrew}
                    onChange={e => setSelectedCrew(e.target.value)}
                    className="px-2 py-0.5 text-xs rounded bg-th-bg-alt border border-th-border text-th-text"
                  >
                    {crews.map(t => (
                      <option key={t.crewId} value={t.crewId}>{t.crewId}</option>
                    ))}
                  </select>
                )}
              </div>
              <p className="text-sm text-th-text-alt">Persistent crew — agents, knowledge, and training data</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setLoading(true); fetchData(); }}
              className="px-3 py-1.5 text-sm rounded bg-th-bg-alt hover:bg-th-border text-th-text-alt transition-colors flex items-center gap-1"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          </div>
        </div>

        {/* Team stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm" data-testid="crew-identity">
          <div>
            <span className="text-th-text-alt">Agents</span>
            <p className="font-semibold text-th-text text-lg">{crewDetail?.agentCount ?? agents.length}</p>
          </div>
          <div>
            <span className="text-th-text-alt">Knowledge</span>
            <p className="font-semibold text-th-text text-lg">{crewDetail?.knowledgeCount ?? 0} entries</p>
          </div>
          <div>
            <span className="text-th-text-alt">Training</span>
            <p className="font-semibold text-th-text text-lg">
              {crewDetail?.trainingSummary
                ? `${crewDetail.trainingSummary.corrections ?? 0} corrections`
                : '—'}
            </p>
          </div>
          <div>
            <span className="text-th-text-alt">Crew ID</span>
            <p className="font-mono text-th-text text-sm">{selectedCrew}</p>
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-th-border" data-testid="crew-tabs">
        {([
          { id: 'roster' as const, label: 'Roster', icon: Users },
          { id: 'health' as const, label: 'Health', icon: Activity },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-th-accent text-th-accent'
                : 'border-transparent text-th-text-alt hover:text-th-text'
            }`}
            data-testid={`tab-${tab.id}`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Roster tab ──────────────────────────────────────── */}
      {activeTab === 'roster' && (
        <>
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
              {(['all', 'running', 'idle', 'terminated', 'failed'] as const).map(s => (
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
                <EmptyState
                  icon={<Cpu className="w-10 h-10 opacity-50" />}
                  title={search ? 'No agents match your search' : 'No agents in this crew'}
                  description={search ? 'Try a different search term.' : 'Agents will appear here when they join the crew.'}
                  compact
                />
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
                  crewId={selectedCrew}
                  onClose={() => setSelectedAgent(null)}
                />
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Health tab ──────────────────────────────────────── */}
      {activeTab === 'health' && (
        <>
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
              label="Running"
              count={statusCounts.running ?? 0}
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
          </div>
        </>
      )}

      {/* Lifecycle modal */}
      {managingAgent && (
        <AgentLifecycle
          agentId={managingAgent}
          crewId={selectedCrew}
          agent={health?.agents.find(a => a.agentId === managingAgent)}
          onClose={() => setManagingAgent(null)}
          onActionComplete={() => { fetchData(); setManagingAgent(null); }}
        />
      )}
    </div>
  );
}
