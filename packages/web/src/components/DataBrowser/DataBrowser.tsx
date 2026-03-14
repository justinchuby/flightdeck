import { apiFetch } from '../../hooks/useApi';
import { useState, useEffect, useCallback } from 'react';
import { Database, Brain, MessageSquare, CheckCircle, Activity, Trash2, ChevronDown, ChevronRight, RefreshCw, BarChart3 } from 'lucide-react';
import { decisionStatusText } from '../../utils/statusColors';
import { SkeletonCard } from '../Shared';
import { Tabs } from '../ui/Tabs';
import type { TabItem } from '../ui/Tabs';
import { shortAgentId } from '../../utils/agentLabel';

interface DbStats {
  memory: number;
  conversations: number;
  messages: number;
  decisions: number;
  activity: number;
  dagTasks: number;
}

type TabId = 'stats' | 'memory' | 'conversations' | 'decisions' | 'activity';

async function dbFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  return apiFetch(`/db${path}`, opts);
}

export function DataBrowser() {
  const [tab, setTab] = useState<TabId>('stats');
  const [stats, setStats] = useState<DbStats | null>(null);
  const [_loading, _setLoading] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      setStats(await dbFetch<DbStats>('/stats'));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  const tabs: TabItem[] = [
    { id: 'stats', label: 'Overview', icon: <BarChart3 size={14} /> },
    { id: 'memory', label: 'Memory', icon: <Brain size={14} />, count: stats?.memory },
    { id: 'conversations', label: 'Conversations', icon: <MessageSquare size={14} />, count: stats?.conversations },
    { id: 'decisions', label: 'Decisions', icon: <CheckCircle size={14} />, count: stats?.decisions },
    { id: 'activity', label: 'Activity Log', icon: <Activity size={14} />, count: stats?.activity },
  ];

  return (
    <div className="flex-1 overflow-auto focus:outline-none" tabIndex={0}>
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Database className="w-6 h-6 text-th-text-muted" />
        <h2 className="text-xl font-semibold">Database</h2>
        <button type="button" aria-label="Refresh database stats" onClick={loadStats} className="ml-auto p-1.5 text-th-text-muted hover:text-th-text rounded hover:bg-th-bg-muted transition-colors" title="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Tabs */}
      <Tabs
        tabs={tabs}
        activeTab={tab}
        onTabChange={(id) => setTab(id as TabId)}
        className="mb-4"
      />

      {tab === 'stats' && <StatsPanel stats={stats} />}
      {tab === 'memory' && <MemoryPanel onCountChange={loadStats} />}
      {tab === 'conversations' && <ConversationsPanel onCountChange={loadStats} />}
      {tab === 'decisions' && <DecisionsPanel onCountChange={loadStats} />}
      {tab === 'activity' && <ActivityPanel onCountChange={loadStats} />}
    </div>
    </div>
  );
}

/* ── Stats Overview ─────────────────────────────────────────────── */

function StatsPanel({ stats }: { stats: DbStats | null }) {
  if (!stats) return <SkeletonCard lines={3} />;

  const cards = [
    { label: 'Memory Entries', value: stats.memory, icon: <Brain size={18} />, color: 'text-purple-400' },
    { label: 'Conversations', value: stats.conversations, icon: <MessageSquare size={18} />, color: 'text-blue-400' },
    { label: 'Messages', value: stats.messages, icon: <MessageSquare size={18} />, color: 'text-cyan-400' },
    { label: 'Decisions', value: stats.decisions, icon: <CheckCircle size={18} />, color: 'text-green-400' },
    { label: 'Activity Events', value: stats.activity, icon: <Activity size={18} />, color: 'text-orange-400' },
    { label: 'DAG Tasks', value: stats.dagTasks, icon: <BarChart3 size={18} />, color: 'text-yellow-600 dark:text-yellow-400' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {cards.map((c) => (
        <div key={c.label} className="bg-surface-raised border border-th-border rounded-lg p-4">
          <div className={`flex items-center gap-2 mb-2 ${c.color}`}>
            {c.icon}
            <span className="text-xs font-medium text-th-text-muted uppercase tracking-wider">{c.label}</span>
          </div>
          <div className="text-2xl font-bold text-th-text">{c.value.toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Memory Panel ───────────────────────────────────────────────── */

function MemoryPanel({ onCountChange }: { onCountChange: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await dbFetch('/memory')); } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: number) => {
    await dbFetch(`/memory/${id}`, { method: 'DELETE' });
    setRows((r) => r.filter((row) => row.id !== id));
    onCountChange();
  };

  if (loading) return <Loading />;
  if (rows.length === 0) return <Empty label="No memory entries yet" />;

  return (
    <div className="space-y-2">
      <div className="text-xs text-th-text-muted mb-2">{rows.length} entries</div>
      {rows.map((row) => (
        <div key={row.id} className="bg-surface-raised border border-th-border rounded-lg p-3 flex items-start gap-3 group">
          <Brain size={14} className="text-purple-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-th-text-alt">{row.key}</span>
              <span className="text-[10px] text-th-text-muted font-mono">{shortAgentId(row.agentId)}</span>
              <span className="text-[10px] text-th-text-muted">{row.createdAt}</span>
            </div>
            <div className="text-xs text-th-text-muted whitespace-pre-wrap break-words">{row.value}</div>
            <div className="text-[10px] text-th-text-muted mt-1">Lead: {shortAgentId(row.leadId)}</div>
          </div>
          <button
            onClick={() => handleDelete(row.id)}
            className="p-1 text-th-text-muted hover:text-red-400 rounded opacity-0 group-hover:opacity-100 transition-all shrink-0"
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ── Conversations Panel ────────────────────────────────────────── */

function ConversationsPanel({ onCountChange }: { onCountChange: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await dbFetch('/conversations')); } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      setMessages([]);
      return;
    }
    setExpanded(id);
    try { setMessages(await dbFetch(`/conversations/${id}/messages?limit=50`)); } catch { setMessages([]); }
  };

  const handleDelete = async (id: string) => {
    await dbFetch(`/conversations/${id}`, { method: 'DELETE' });
    setRows((r) => r.filter((row) => row.id !== id));
    if (expanded === id) { setExpanded(null); setMessages([]); }
    onCountChange();
  };

  if (loading) return <Loading />;
  if (rows.length === 0) return <Empty label="No conversations yet" />;

  return (
    <div className="space-y-2">
      <div className="text-xs text-th-text-muted mb-2">{rows.length} conversations</div>
      {rows.map((row) => (
        <div key={row.id} className="bg-surface-raised border border-th-border rounded-lg overflow-hidden group">
          <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={() => toggleExpand(row.id)}>
            {expanded === row.id ? <ChevronDown size={14} className="text-th-text-muted" /> : <ChevronRight size={14} className="text-th-text-muted" />}
            <MessageSquare size={14} className="text-blue-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm text-th-text-alt font-mono">{row.agentId?.slice(0, 12)}</span>
              {row.taskId && <span className="text-xs text-th-text-muted ml-2 truncate">{row.taskId.slice(0, 60)}</span>}
            </div>
            <span className="text-[10px] text-th-text-muted">{row.createdAt}</span>
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(row.id); }}
              className="p-1 text-th-text-muted hover:text-red-400 rounded opacity-0 group-hover:opacity-100 transition-all shrink-0"
              title="Delete conversation"
            >
              <Trash2 size={13} />
            </button>
          </div>
          {expanded === row.id && (
            <div className="border-t border-th-border px-4 py-2 bg-th-bg-alt/30 max-h-80 overflow-y-auto space-y-1.5">
              {messages.length === 0 ? (
                <div className="text-xs text-th-text-muted py-2">No messages</div>
              ) : messages.map((m: any) => (
                <div key={m.id} className="flex gap-2">
                  <span className={`text-[10px] font-medium shrink-0 w-12 ${
                    m.sender === 'user' ? 'text-accent' : m.sender === 'system' ? 'text-yellow-500' : 'text-th-text-muted'
                  }`}>{m.sender}</span>
                  <span className="text-xs text-th-text-alt break-words whitespace-pre-wrap flex-1">{m.content.slice(0, 500)}{m.content.length > 500 ? '…' : ''}</span>
                  <span className="text-[9px] text-th-text-muted shrink-0">{m.timestamp?.slice(11, 19)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Decisions Panel ────────────────────────────────────────────── */

function DecisionsPanel({ onCountChange }: { onCountChange: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await dbFetch('/decisions')); } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    await dbFetch(`/decisions/${id}`, { method: 'DELETE' });
    setRows((r) => r.filter((row) => row.id !== id));
    onCountChange();
  };

  if (loading) return <Loading />;
  if (rows.length === 0) return <Empty label="No decisions recorded" />;

  return (
    <div className="space-y-2">
      <div className="text-xs text-th-text-muted mb-2">{rows.length} decisions</div>
      {rows.map((row) => (
        <div key={row.id} className="bg-surface-raised border border-th-border rounded-lg p-3 flex items-start gap-3 group">
          <CheckCircle size={14} className={`mt-0.5 shrink-0 ${decisionStatusText(row.status)}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-th-text-alt">{row.title}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${decisionStatusText(row.status)} bg-th-bg-alt`}>{row.status}</span>
              {row.needsConfirmation === 1 && <span className="text-[10px] text-yellow-500 bg-yellow-900/30 px-1.5 py-0.5 rounded">needs confirmation</span>}
            </div>
            {row.rationale && <div className="text-xs text-th-text-muted mb-1">{row.rationale}</div>}
            <div className="flex gap-3 text-[10px] text-th-text-muted">
              <span>Agent: {shortAgentId(row.agentId)}</span>
              <span>Role: {row.agentRole}</span>
              {row.leadId && <span>Lead: {shortAgentId(row.leadId)}</span>}
              <span>{row.createdAt}</span>
            </div>
          </div>
          <button
            onClick={() => handleDelete(row.id)}
            className="p-1 text-th-text-muted hover:text-red-400 rounded opacity-0 group-hover:opacity-100 transition-all shrink-0"
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ── Activity Panel ─────────────────────────────────────────────── */

function ActivityPanel({ onCountChange }: { onCountChange: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await dbFetch('/activity?limit=200')); } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: number) => {
    await dbFetch(`/activity/${id}`, { method: 'DELETE' });
    setRows((r) => r.filter((row) => row.id !== id));
    onCountChange();
  };

  if (loading) return <Loading />;
  if (rows.length === 0) return <Empty label="No activity recorded" />;

  return (
    <div className="space-y-1">
      <div className="text-xs text-th-text-muted mb-2">{rows.length} events (most recent 200)</div>
      {rows.map((row) => (
        <div key={row.id} className="bg-surface-raised border border-th-border rounded-lg px-3 py-2 flex items-center gap-3 group text-xs">
          <Activity size={12} className="text-orange-400 shrink-0" />
          <span className="text-th-text-muted font-mono w-16 shrink-0">{row.agentRole}</span>
          <span className="text-th-text-muted w-24 shrink-0">{row.actionType}</span>
          <span className="text-th-text-alt flex-1 truncate">{row.summary}</span>
          <span className="text-[10px] text-th-text-muted shrink-0">{row.timestamp?.slice(11, 19)}</span>
          <button
            onClick={() => handleDelete(row.id)}
            className="p-1 text-th-text-muted hover:text-red-400 rounded opacity-0 group-hover:opacity-100 transition-all shrink-0"
            title="Delete"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ── Shared Components ──────────────────────────────────────────── */

function Loading() {
  return <SkeletonCard lines={3} />;
}

function Empty({ label }: { label: string }) {
  return <div className="text-center text-th-text-muted text-sm py-12">{label}</div>;
}
