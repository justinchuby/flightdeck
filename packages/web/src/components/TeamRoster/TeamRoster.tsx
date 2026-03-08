import { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Search,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  AlertTriangle,
  CircleDot,
  Clock,
  ArrowUpDown,
  User,
  Cpu,
  BookOpen,
  Wrench,
  Settings,
  Activity,
  X,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { getRoleIcon } from '../../utils/getRoleIcon';
import { useToastStore } from '../Toast';
import { Tabs } from '../ui/Tabs';
import type { TabItem } from '../ui/Tabs';

// ── Types ─────────────────────────────────────────────────

type RosterStatus = 'idle' | 'busy' | 'terminated';
type LiveStatus = 'creating' | 'running' | 'idle' | 'completed' | 'failed' | 'terminated' | null;
type ProfileTab = 'overview' | 'history' | 'knowledge' | 'skills' | 'settings';
type SortField = 'role' | 'status' | 'updatedAt';
type SortDir = 'asc' | 'desc';

interface RosterAgent {
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
    autopilot: boolean;
    model: string | null;
    sessionId: string | null;
  } | null;
}

interface TeamInfo {
  teamId: string;
  agentCount: number;
  roles: string[];
}

// ── Helpers ───────────────────────────────────────────────

function statusBadge(status: RosterStatus, liveStatus: LiveStatus): { bg: string; label: string } {
  if (liveStatus === 'running') return { bg: 'bg-green-500/20 text-green-400', label: 'Running' };
  if (liveStatus === 'creating') return { bg: 'bg-yellow-500/20 text-yellow-400', label: 'Starting' };
  if (status === 'busy') return { bg: 'bg-blue-500/20 text-blue-400', label: 'Busy' };
  if (status === 'terminated') return { bg: 'bg-gray-500/20 text-gray-400', label: 'Terminated' };
  if (status === 'idle') return { bg: 'bg-cyan-500/20 text-cyan-400', label: 'Idle' };
  return { bg: 'bg-gray-500/20 text-gray-400', label: status };
}

// ── Agent Card ────────────────────────────────────────────

function AgentCard({ agent, onSelect }: { agent: RosterAgent; onSelect: (id: string) => void }) {
  const badge = statusBadge(agent.status, agent.liveStatus);

  return (
    <button
      onClick={() => onSelect(agent.agentId)}
      className="w-full bg-surface-raised rounded-lg border border-th-border p-4 text-left hover:bg-th-bg-alt/50 transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-th-bg-alt flex items-center justify-center">
          <span className="text-lg">{getRoleIcon(agent.role)}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-th-text capitalize">{agent.role}</span>
            <span className="text-xs font-mono text-th-text-alt">{agent.agentId.slice(0, 8)}</span>
          </div>
          <div className="text-xs text-th-text-alt truncate">
            {agent.lastTaskSummary ?? 'No recent task'}
          </div>
        </div>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.bg}`}>{badge.label}</span>
        <ChevronRight className="w-4 h-4 text-th-text-alt" />
      </div>
    </button>
  );
}

// ── Agent Profile Panel ───────────────────────────────────

function ProfilePanel({ agentId, teamId, onClose }: { agentId: string; teamId: string; onClose: () => void }) {
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

  const badge = statusBadge(profile.status, profile.liveStatus);
  const tabs: TabItem[] = [
    { id: 'overview', label: 'Overview', icon: <User className="w-3.5 h-3.5" /> },
    { id: 'history', label: 'History', icon: <Clock className="w-3.5 h-3.5" /> },
    { id: 'knowledge', label: 'Knowledge', icon: <BookOpen className="w-3.5 h-3.5" /> },
    { id: 'skills', label: 'Skills', icon: <Wrench className="w-3.5 h-3.5" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="bg-surface-raised rounded-lg border border-th-border">
      {/* Profile Header */}
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
              <div><span className="text-th-text-alt">Team:</span> <span className="text-th-text">{profile.teamId}</span></div>
              <div><span className="text-th-text-alt">Project:</span> <span className="text-th-text">{profile.projectId ?? '—'}</span></div>
              <div><span className="text-th-text-alt">Knowledge:</span> <span className="text-th-text">{profile.knowledgeCount} entries</span></div>
              <div><span className="text-th-text-alt">Created:</span> <span className="text-th-text">{new Date(profile.createdAt).toLocaleDateString()}</span></div>
              <div><span className="text-th-text-alt">Last Active:</span> <span className="text-th-text">{new Date(profile.updatedAt).toLocaleDateString()}</span></div>
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
            Skills and training data will be available when AS23 migration completes
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

export function TeamRoster() {
  const addToast = useToastStore(s => s.add);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string>('default');
  const [agents, setAgents] = useState<RosterAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<RosterStatus | 'all'>('all');
  const [sortField, setSortField] = useState<SortField>('role');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const fetchTeams = useCallback(async () => {
    try {
      const data = await apiFetch<{ teams: TeamInfo[] }>('/teams');
      setTeams(data.teams ?? []);
      if (data.teams?.length && !data.teams.find(t => t.teamId === selectedTeam)) {
        setSelectedTeam(data.teams[0].teamId);
      }
    } catch { /* ignore */ }
  }, [selectedTeam]);

  const fetchAgents = useCallback(async () => {
    try {
      setError(null);
      const url = statusFilter === 'all'
        ? `/teams/${selectedTeam}/agents`
        : `/teams/${selectedTeam}/agents?status=${statusFilter}`;
      const data = await apiFetch<RosterAgent[]>(url);
      setAgents(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message ?? 'Failed to fetch team roster');
    } finally {
      setLoading(false);
    }
  }, [selectedTeam, statusFilter]);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  useEffect(() => {
    setLoading(true);
    fetchAgents();
  }, [fetchAgents]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  // Filter and sort
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

  if (loading && agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-th-text-alt">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Loading team roster…
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
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-th-accent" />
          <h1 className="text-xl font-bold text-th-text">Team Roster</h1>
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
          onClick={() => { setLoading(true); fetchAgents(); }}
          className="px-3 py-1.5 text-sm rounded bg-th-bg-alt hover:bg-th-border text-th-text-alt transition-colors flex items-center gap-1"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

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
          {(['all', 'idle', 'busy', 'terminated'] as const).map(s => (
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

      {/* Content: List + Profile */}
      <div className="flex gap-6">
        {/* Agent List */}
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
                onSelect={setSelectedAgent}
              />
            ))
          )}
        </div>

        {/* Profile Panel */}
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
    </div>
  );
}
