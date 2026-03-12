import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import { AgentLifecycle } from '../components/AgentLifecycle';
import { EmptyState } from '../components/ui/EmptyState';
import { formatAgentId } from '../utils/format';
import {
  Activity,
  AlertTriangle,
  Users,
  Clock,
  PauseCircle,
  XCircle,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { shortAgentId } from '../utils/agentLabel';

// ── Types ───────────────────────────────────────────────────────────

export interface CrewHealthData {
  teamId: string;
  totalAgents: number;
  statusCounts: Record<string, number>;
  massFailurePaused: boolean;
  agents: AgentHealthInfo[];
}

export interface AgentHealthInfo {
  agentId: string;
  role: string;
  model: string;
  status: string;
  uptimeMs: number;
  lastTaskSummary?: string;
  clonedFromId?: string;
}

interface Props {
  teamId?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatUptime(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'running': return 'bg-green-400';
    case 'idle': return 'bg-blue-400';
    case 'terminated': return 'bg-red-400';
    case 'failed': return 'bg-orange-400';
    default: return 'bg-yellow-400';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'running': return 'Running';
    case 'idle': return 'Idle';
    case 'terminated': return 'Terminated';
    case 'failed': return 'Failed';
    default: return status;
  }
}

// ── Component ───────────────────────────────────────────────────────

export function CrewHealth({ teamId = 'default' }: Props) {
  const [health, setHealth] = useState<CrewHealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetch<CrewHealthData>(`/teams/${encodeURIComponent(teamId)}/health`);
      setHealth(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load crew health');
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 15_000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  // Listen for team WS events
  useEffect(() => {
    function onWsMessage(event: Event) {
      try {
        const raw = (event as MessageEvent).data;
        const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (msg.type === 'team:agent_cloned') {
          fetchHealth();
        }
      } catch { /* ignore parse errors */ }
    }
    window.addEventListener('ws-message', onWsMessage);
    return () => window.removeEventListener('ws-message', onWsMessage);
  }, [fetchHealth]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="crew-health-loading">
        <div className="w-6 h-6 border-2 border-th-text-muted/30 border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    // Friendly empty state for team-not-found or no data
    if (error.includes('404') || error.includes('not found') || error.toLowerCase().includes('no team')) {
      return (
        <div className="p-6" data-testid="crew-health-empty">
          <EmptyState
            icon={<Users className="w-10 h-10 text-th-text-muted/40" />}
            title="No crew found"
            description={`Team "${teamId}" doesn't exist yet. Create a crew to see health data.`}
          />
        </div>
      );
    }
    return (
      <div className="p-6" data-testid="crew-health-error">
        <EmptyState
          icon={<AlertTriangle className="w-10 h-10 text-red-400" />}
          title="Unable to load health data"
          description={error}
        />
      </div>
    );
  }

  if (!health) return null;

  const { statusCounts, massFailurePaused, agents } = health;

  return (
    <div className="p-6 space-y-6 overflow-auto" data-testid="crew-health-dashboard">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-th-text">Crew Health — {teamId}</h1>
        <button
          onClick={fetchHealth}
          className="text-xs text-th-text-muted hover:text-th-text px-2 py-1 rounded border border-th-border"
        >
          Refresh
        </button>
      </header>

      {/* Mass failure warning */}
      {massFailurePaused && (
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

      {/* Status cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="status-cards">
        <StatusCard
          label="Total"
          count={health.totalAgents}
          icon={<Users className="w-4 h-4" />}
          color="text-th-text"
        />
        <StatusCard
          label="Running"
          count={statusCounts.running ?? 0}
          icon={<Activity className="w-4 h-4" />}
          color="text-green-400"
        />
        <StatusCard
          label="Idle"
          count={statusCounts.idle ?? 0}
          icon={<PauseCircle className="w-4 h-4" />}
          color="text-blue-400"
        />
      </div>

      {/* Connection status */}
      <div className="flex items-center gap-2 text-xs text-th-text-muted" data-testid="connection-status">
        {massFailurePaused
          ? <WifiOff className="w-3.5 h-3.5 text-red-400" />
          : <Wifi className="w-3.5 h-3.5 text-green-400" />}
        <span>
          {massFailurePaused ? 'Spawning paused' : 'Agent server healthy'}
        </span>
      </div>

      {/* Agent table */}
      <div className="border border-th-border rounded-lg overflow-hidden">
        <table className="w-full text-sm" data-testid="agent-table">
          <thead className="bg-th-bg-alt text-th-text-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Agent</th>
              <th className="px-3 py-2 text-left font-medium">Role</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-left font-medium">Uptime</th>
              <th className="px-3 py-2 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-th-border">
            {agents.map((agent) => (
              <tr key={agent.agentId} className="hover:bg-th-bg-alt/50">
                <td className="px-3 py-2 text-th-text font-mono text-xs">
                  {formatAgentId(agent.role, agent.agentId)}
                  {agent.clonedFromId && (
                    <span className="ml-1 text-th-text-muted" title={`Cloned from ${agent.clonedFromId}`}>
                      🧬
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-th-text-muted">{agent.role}</td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${statusColor(agent.status)}`} />
                    <span className="text-th-text-muted">{statusLabel(agent.status)}</span>
                  </span>
                </td>
                <td className="px-3 py-2 text-th-text-muted">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatUptime(agent.uptimeMs)}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => setSelectedAgent(agent.agentId)}
                    className="text-xs text-accent hover:underline"
                    data-testid={`manage-${shortAgentId(agent.agentId)}`}
                  >
                    Manage
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Agent lifecycle slide-over */}
      {selectedAgent && (
        <AgentLifecycle
          agentId={selectedAgent}
          teamId={teamId}
          agent={agents.find((a) => a.agentId === selectedAgent)}
          onClose={() => setSelectedAgent(null)}
          onActionComplete={fetchHealth}
        />
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function StatusCard({
  label,
  count,
  icon,
  color,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="bg-th-bg-alt border border-th-border rounded-lg p-4" data-testid={`card-${label.toLowerCase()}`}>
      <div className={`flex items-center gap-2 ${color}`}>
        {icon}
        <span className="text-2xl font-bold">{count}</span>
      </div>
      <span className="text-xs text-th-text-muted mt-1 block">{label}</span>
    </div>
  );
}
