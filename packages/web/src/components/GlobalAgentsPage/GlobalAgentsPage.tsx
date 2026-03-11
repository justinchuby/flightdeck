import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Users,
  Search,
  RefreshCw,
  AlertTriangle,
  Zap,
  MessageSquare,
  Square,
  Send,
  ChevronDown,
  ChevronUp,
  Cpu,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { getRoleIcon } from '../../utils/getRoleIcon';
import { useToastStore } from '../Toast';
import type { AgentInfo } from '../../types';

// ── Types ─────────────────────────────────────────────────

type AgentStatus = 'creating' | 'running' | 'idle' | 'completed' | 'failed' | 'terminated';
type StatusFilter = AgentStatus | 'all';

const STATUS_OPTIONS: StatusFilter[] = ['all', 'running', 'idle', 'creating', 'completed', 'failed', 'terminated'];

// ── Helpers ───────────────────────────────────────────────

function statusBadge(status: AgentStatus): { bg: string; label: string } {
  switch (status) {
    case 'running':  return { bg: 'bg-green-500/20 text-green-400', label: 'Running' };
    case 'creating': return { bg: 'bg-yellow-500/20 text-yellow-400', label: 'Starting' };
    case 'idle':     return { bg: 'bg-cyan-500/20 text-cyan-400', label: 'Idle' };
    case 'completed':return { bg: 'bg-blue-500/20 text-blue-400', label: 'Completed' };
    case 'failed':   return { bg: 'bg-red-500/20 text-red-400', label: 'Failed' };
    case 'terminated':return { bg: 'bg-gray-500/20 text-gray-400', label: 'Terminated' };
    default:         return { bg: 'bg-gray-500/20 text-gray-400', label: status };
  }
}

function isAlive(status: AgentStatus): boolean {
  return status === 'running' || status === 'creating' || status === 'idle';
}

// ── Agent Card ────────────────────────────────────────────

function AgentCard({ agent }: { agent: AgentInfo }) {
  const addToast = useToastStore(s => s.add);
  const [expanded, setExpanded] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [showMessageInput, setShowMessageInput] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const badge = statusBadge(agent.status);
  const alive = isAlive(agent.status);

  const handleInterrupt = async () => {
    setActionLoading('interrupt');
    try {
      await apiFetch(`/agents/${agent.id}/interrupt`, { method: 'POST' });
      addToast('success', `Interrupted ${agent.role.name}`);
    } catch (err: any) {
      addToast('error', `Failed to interrupt: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendMessage = async () => {
    if (!messageText.trim()) return;
    setActionLoading('message');
    try {
      await apiFetch(`/agents/${agent.id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: messageText.trim() }),
      });
      addToast('success', 'Message sent');
      setMessageText('');
      setShowMessageInput(false);
    } catch (err: any) {
      addToast('error', `Failed to send message: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStop = async () => {
    setActionLoading('stop');
    try {
      await apiFetch(`/agents/${agent.id}/terminate`, { method: 'POST' });
      addToast('success', `Terminated ${agent.role.name}`);
      setConfirmStop(false);
    } catch (err: any) {
      addToast('error', `Failed to stop: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="bg-surface-raised rounded-lg border border-th-border">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(v => !v)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); } }}
        className="w-full p-4 text-left hover:bg-th-bg-alt/50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-th-bg-alt flex items-center justify-center shrink-0">
            <span className="text-lg">{agent.role.icon || getRoleIcon(agent.role.id)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-th-text capitalize">{agent.role.name}</span>
              <span className="text-xs font-mono text-th-text-alt">{agent.id.slice(0, 8)}</span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.bg}`}>{badge.label}</span>
              {agent.provider && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-th-bg-alt text-th-text-alt border border-th-border capitalize">
                  {agent.provider}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-th-text-alt mt-0.5">
              {agent.projectName && (
                <Link
                  to={`/projects/${agent.projectId}/overview`}
                  onClick={e => e.stopPropagation()}
                  className="hover:text-th-accent transition-colors"
                >
                  📁 {agent.projectName}
                </Link>
              )}
              {agent.sessionId && (
                <button
                  onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(agent.sessionId!); }}
                  className="font-mono hover:text-th-accent transition-colors"
                  title="Click to copy session ID"
                >
                  🔗 {agent.sessionId.slice(0, 10)}
                </button>
              )}
              <span className="truncate">{agent.task ?? 'No active task'}</span>
            </div>
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-th-text-alt shrink-0" /> : <ChevronDown className="w-4 h-4 text-th-text-alt shrink-0" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-th-border pt-3 space-y-3">
          {/* Details grid */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-th-text-alt">Model:</span> <span className="text-th-text">{agent.model}</span></div>
            {agent.provider && (
              <div><span className="text-th-text-alt">CLI:</span> <span className="text-th-text capitalize">{agent.provider}{agent.backend && agent.backend !== 'acp' ? ` (${agent.backend})` : ''}</span></div>
            )}
            <div><span className="text-th-text-alt">Created:</span> <span className="text-th-text">{new Date(agent.createdAt).toLocaleString()}</span></div>
            {agent.projectId && (
              <div><span className="text-th-text-alt">Project:</span> <span className="text-th-text">{agent.projectName ?? agent.projectId}</span></div>
            )}
          </div>

          {/* Action Buttons */}
          {alive && (
            <div className="flex items-center gap-2">
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

          {/* Confirm Stop */}
          {confirmStop && (
            <div className="p-3 rounded bg-red-500/10 border border-red-500/30">
              <p className="text-xs text-red-300 mb-2">Terminate this agent? This cannot be undone.</p>
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
            <div className="flex gap-2">
              <input
                type="text"
                value={messageText}
                onChange={e => setMessageText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                placeholder="Type a message..."
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
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────

export function GlobalAgentsPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const fetchAgents = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetch<AgentInfo[]>('/agents');
      setAgents(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message ?? 'Failed to fetch agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const filtered = agents
    .filter(a => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return a.role.name.toLowerCase().includes(q)
        || a.id.toLowerCase().includes(q)
        || (a.task?.toLowerCase().includes(q) ?? false)
        || (a.projectName?.toLowerCase().includes(q) ?? false);
    })
    .sort((a, b) => {
      // Live agents first, then by role name
      const aAlive = isAlive(a.status) ? 0 : 1;
      const bAlive = isAlive(b.status) ? 0 : 1;
      if (aAlive !== bAlive) return aAlive - bAlive;
      return a.role.name.localeCompare(b.role.name);
    });

  const counts = {
    total: agents.length,
    alive: agents.filter(a => isAlive(a.status)).length,
  };

  if (loading && agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-th-text-alt">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Loading agents...
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
    <div className="flex flex-col h-full min-h-0 p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-th-accent" />
          <h1 className="text-xl font-bold text-th-text">All Agents</h1>
          <span className="text-sm text-th-text-alt">
            {counts.alive} active / {counts.total} total
          </span>
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
      <div className="flex flex-wrap items-center gap-3 mt-6 shrink-0">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-th-text-alt" />
          <input
            type="text"
            placeholder="Search agents, projects..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded bg-th-bg-alt border border-th-border text-th-text placeholder:text-th-text-alt"
          />
        </div>

        <div className="flex gap-1 flex-wrap">
          {STATUS_OPTIONS.map(s => (
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

      {/* Agent List */}
      <div className="flex-1 min-h-0 overflow-y-auto mt-6 space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-th-text-alt text-sm bg-surface-raised rounded-lg border border-th-border">
            <Cpu className="w-8 h-8 mx-auto mb-2 opacity-50" />
            {search || statusFilter !== 'all' ? 'No agents match your filters' : 'No agents running'}
          </div>
        ) : (
          filtered.map(agent => (
            <AgentCard key={agent.id} agent={agent} />
          ))
        )}
      </div>
    </div>
  );
}
