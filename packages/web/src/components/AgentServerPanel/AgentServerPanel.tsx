import { useState, useEffect, useCallback } from 'react';
import {
  Server,
  Activity,
  Power,
  RefreshCw,
  AlertTriangle,
  Cpu,
  Users,
  ChevronRight,
  ChevronDown,
  Square,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToastStore } from '../Toast';

// ── Types ─────────────────────────────────────────────────

type ConnectionState = 'connected' | 'disconnected' | 'reconnecting' | 'failed' | 'unavailable';
type DaemonAgentStatus = 'starting' | 'running' | 'idle' | 'stopping' | 'exited' | 'crashed';

interface DaemonStatus {
  running: boolean;
  connected: boolean;
  state: ConnectionState;
  agentCount: number | null;
  latencyMs: number | null;
  pendingRequests: number;
  trackedAgents: number;
}

interface DaemonAgent {
  agentId: string;
  role: string | null;
  model: string | null;
  status: DaemonAgentStatus;
  task: string | null;
  spawnedAt: string | null;
}

// ── Status helpers ────────────────────────────────────────

function statusColor(running: boolean, state: ConnectionState): string {
  if (!running) return 'bg-red-500';
  if (state === 'connected') return 'bg-green-500';
  if (state === 'reconnecting') return 'bg-yellow-500';
  return 'bg-red-500';
}

function statusLabel(running: boolean, state: ConnectionState): string {
  if (!running) return 'Stopped';
  if (state === 'connected') return 'Running';
  if (state === 'reconnecting') return 'Reconnecting';
  return 'Disconnected';
}

function agentStatusBadge(status: DaemonAgentStatus): { bg: string; text: string } {
  switch (status) {
    case 'running': return { bg: 'bg-green-500/20 text-green-400', text: 'Running' };
    case 'idle': return { bg: 'bg-blue-500/20 text-blue-400', text: 'Idle' };
    case 'starting': return { bg: 'bg-yellow-500/20 text-yellow-400', text: 'Starting' };
    case 'stopping': return { bg: 'bg-orange-500/20 text-orange-400', text: 'Stopping' };
    case 'exited': return { bg: 'bg-gray-500/20 text-gray-400', text: 'Exited' };
    case 'crashed': return { bg: 'bg-red-500/20 text-red-400', text: 'Crashed' };
    default: return { bg: 'bg-gray-500/20 text-gray-400', text: status };
  }
}

function connectionStateBadge(state: ConnectionState): { bg: string; label: string } {
  switch (state) {
    case 'connected': return { bg: 'bg-green-500/20 text-green-400', label: 'Connected' };
    case 'reconnecting': return { bg: 'bg-yellow-500/20 text-yellow-400', label: 'Reconnecting' };
    case 'disconnected': return { bg: 'bg-red-500/20 text-red-400', label: 'Disconnected' };
    case 'failed': return { bg: 'bg-red-500/20 text-red-400', label: 'Failed' };
    default: return { bg: 'bg-gray-500/20 text-gray-400', label: 'Unavailable' };
  }
}

// ── Sub-components ────────────────────────────────────────

function StatusCard({ status }: { status: DaemonStatus }) {
  const color = statusColor(status.running, status.state);
  const label = statusLabel(status.running, status.state);
  const connBadge = connectionStateBadge(status.state);

  return (
    <div className="bg-surface-raised rounded-lg border border-th-border p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-th-text-alt" />
          <h3 className="font-semibold text-th-text">Agent Server</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${color} animate-pulse`} />
          <span className="text-sm text-th-text-alt">{label}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <div>
          <span className="text-th-text-alt">Connection</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            {status.connected
              ? <Wifi className="w-3.5 h-3.5 text-green-400" />
              : <WifiOff className="w-3.5 h-3.5 text-red-400" />}
            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${connBadge.bg}`}>{connBadge.label}</span>
          </div>
        </div>
        <div>
          <span className="text-th-text-alt">Agents</span>
          <p className="font-medium text-th-text">{status.agentCount ?? '—'}</p>
        </div>
        <div>
          <span className="text-th-text-alt">Latency</span>
          <p className="font-medium text-th-text">{status.latencyMs != null ? `${status.latencyMs}ms` : '—'}</p>
        </div>
      </div>
    </div>
  );
}

function AgentRow({ agent, onTerminate }: { agent: DaemonAgent; onTerminate: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const badge = agentStatusBadge(agent.status);
  const [confirmingTerminate, setConfirmingTerminate] = useState(false);

  return (
    <div className="bg-surface-raised rounded-lg border border-th-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-th-bg-alt/50 transition-colors"
      >
        {expanded ? <ChevronDown className="w-4 h-4 text-th-text-alt" /> : <ChevronRight className="w-4 h-4 text-th-text-alt" />}
        <span className="font-mono text-sm text-th-text">{agent.agentId.slice(0, 8)}</span>
        {agent.role && <span className="text-sm text-th-text-alt capitalize">{agent.role}</span>}
        <span className={`ml-auto px-2 py-0.5 rounded text-xs font-medium ${badge.bg}`}>{badge.text}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 border-t border-th-border/50 pt-3 space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            {agent.model && (
              <div>
                <span className="text-th-text-alt">Model: </span>
                <span className="text-th-text">{agent.model}</span>
              </div>
            )}
            {agent.spawnedAt && (
              <div>
                <span className="text-th-text-alt">Spawned: </span>
                <span className="text-th-text">{new Date(agent.spawnedAt).toLocaleTimeString()}</span>
              </div>
            )}
          </div>
          {agent.task && (
            <div>
              <span className="text-th-text-alt">Task: </span>
              <span className="text-th-text">{agent.task}</span>
            </div>
          )}

          {!confirmingTerminate ? (
            <button
              onClick={() => setConfirmingTerminate(true)}
              className="mt-2 px-3 py-1 text-xs rounded bg-red-600/20 hover:bg-red-600/40 text-red-400 transition-colors flex items-center gap-1"
            >
              <Square className="w-3 h-3" />
              Terminate
            </button>
          ) : (
            <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded bg-red-500/10 border border-red-500/30">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span className="text-xs text-red-400">Terminate agent {agent.agentId.slice(0, 8)}?</span>
              <button
                onClick={() => { onTerminate(agent.agentId); setConfirmingTerminate(false); }}
                className="ml-auto px-2 py-0.5 text-xs rounded bg-red-600 hover:bg-red-500 text-white"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmingTerminate(false)}
                className="px-2 py-0.5 text-xs rounded bg-th-bg-alt hover:bg-th-border text-th-text-alt"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────

export function AgentServerPanel() {
  const addToast = useToastStore(s => s.add);
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [agents, setAgents] = useState<DaemonAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      setError(null);
      const [statusData, agentsData] = await Promise.all([
        apiFetch<DaemonStatus>('/agent-server/status'),
        apiFetch<DaemonAgent[]>('/agent-server/agents'),
      ]);
      setStatus(statusData);
      setAgents(Array.isArray(agentsData) ? agentsData : []);
    } catch (err: any) {
      setError(err.message ?? 'Failed to fetch agent server status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const handleStop = async () => {
    try {
      await apiFetch('/agent-server/stop', { method: 'POST' });
      addToast('success', 'Agent server stop requested');
      setConfirmStop(false);
      setTimeout(fetchAll, 1000);
    } catch (err: any) {
      addToast('error', err.message ?? 'Failed to stop agent server');
    }
  };

  const handleTerminateAgent = async (agentId: string) => {
    try {
      await apiFetch(`/agent-server/terminate/${agentId}`, { method: 'POST' });
      addToast('success', `Agent ${agentId.slice(0, 8)} terminated`);
      setTimeout(fetchAll, 500);
    } catch (err: any) {
      addToast('error', err.message ?? 'Failed to terminate agent');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-th-text-alt">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Loading agent server status…
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
          <Server className="w-6 h-6 text-th-accent" />
          <h1 className="text-xl font-bold text-th-text">Agent Server</h1>
        </div>
        <button
          onClick={fetchAll}
          className="px-3 py-1.5 text-sm rounded bg-th-bg-alt hover:bg-th-border text-th-text-alt transition-colors flex items-center gap-1"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Status */}
      {status && <StatusCard status={status} />}

      {/* Lifecycle Controls */}
      {status?.running && (
        <div className="bg-surface-raised rounded-lg border border-th-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-5 h-5 text-th-text-alt" />
            <h3 className="font-semibold text-th-text">Controls</h3>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Stop button */}
            {!confirmStop ? (
              <button
                onClick={() => setConfirmStop(true)}
                className="px-3 py-1.5 text-sm rounded bg-red-600/20 hover:bg-red-600/40 text-red-400 transition-colors flex items-center gap-1"
              >
                <Power className="w-3.5 h-3.5" />
                Stop Server
              </button>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 rounded bg-red-500/10 border border-red-500/30">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <span className="text-sm text-red-400">Stop agent server? All agents will be terminated.</span>
                <button
                  onClick={handleStop}
                  className="px-2 py-1 text-xs rounded bg-red-600 hover:bg-red-500 text-white"
                >
                  Confirm Stop
                </button>
                <button
                  onClick={() => setConfirmStop(false)}
                  className="px-2 py-1 text-xs rounded bg-th-bg-alt hover:bg-th-border text-th-text-alt"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Agent List */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-5 h-5 text-th-text-alt" />
          <h3 className="font-semibold text-th-text">
            Agents {agents.length > 0 && <span className="text-th-text-alt font-normal">({agents.length})</span>}
          </h3>
        </div>
        {agents.length === 0 ? (
          <div className="text-center py-8 text-th-text-alt text-sm bg-surface-raised rounded-lg border border-th-border">
            <Cpu className="w-8 h-8 mx-auto mb-2 opacity-50" />
            No agents currently managed by the agent server
          </div>
        ) : (
          <div className="space-y-2">
            {agents.map(agent => (
              <AgentRow key={agent.agentId} agent={agent} onTerminate={handleTerminateAgent} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
