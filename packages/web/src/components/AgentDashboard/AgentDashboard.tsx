import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { AgentCard } from './AgentCard';
import { AgentTimeline } from './AgentTimeline';
import { SpawnDialog } from './SpawnDialog';
import { FleetStats } from '../FleetOverview/FleetStats';
import { AgentActivityTable } from '../FleetOverview/AgentActivityTable';
import { ActivityFeed } from '../FleetOverview/ActivityFeed';
import { FileLockPanel } from '../FleetOverview/FileLockPanel';
import type { FileLock, ActivityEntry } from '../FleetOverview/FleetOverview';
import { Plus, LayoutGrid, Table, ChevronDown, ChevronRight } from 'lucide-react';
import { SkeletonCard } from '../Skeleton';

interface CoordinationStatus {
  locks: FileLock[];
  recentActivity: ActivityEntry[];
}

interface Props {
  api: any;
  ws: any;
}

export function AgentDashboard({ api, ws }: Props) {
  const { agents, tasks, loading } = useAppStore();
  const [showSpawn, setShowSpawn] = useState(false);
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string | null>(null);
  const [locks, setLocks] = useState<FileLock[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [bottomOpen, setBottomOpen] = useState(false);

  // Keyboard shortcut: 'n' to spawn new agent
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        setShowSpawn(true);
      }
      if (e.key === 'Escape') {
        setShowSpawn(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Fetch coordination status (locks + activity)
  const fetchCoordination = useCallback(async () => {
    try {
      const res = await fetch('/api/coordination/status');
      const data: CoordinationStatus = await res.json();
      setLocks(data.locks);
      setActivity(data.recentActivity);
    } catch {
      // silent
    }
  }, []);

  // Poll coordination status every 3 seconds
  useEffect(() => {
    fetchCoordination();
    const interval = setInterval(fetchCoordination, 3000);
    return () => clearInterval(interval);
  }, [fetchCoordination]);

  // Refresh on agent events
  useEffect(() => {
    const handler = (event: Event) => {
      const msg = JSON.parse((event as MessageEvent).data);
      if (
        msg.type === 'agent:spawned' ||
        msg.type === 'agent:exit' ||
        msg.type === 'agent:killed' ||
        msg.type === 'agent:tool_call' ||
        msg.type === 'agent:plan' ||
        msg.type === 'lock:acquired' ||
        msg.type === 'lock:released'
      ) {
        fetchCoordination();
      }
    };
    window.addEventListener('ws-message', handler);
    return () => window.removeEventListener('ws-message', handler);
  }, [fetchCoordination]);

  const filteredAgents = selectedAgentFilter
    ? agents.filter((a) => a.id === selectedAgentFilter)
    : agents;

  const filteredActivity = selectedAgentFilter
    ? activity.filter((a) => a.agentId === selectedAgentFilter)
    : activity;

  const filteredLocks = selectedAgentFilter
    ? locks.filter((l) => l.agentId === selectedAgentFilter)
    : locks;

  const hasChildren = filteredAgents.some((a) => a.parentId);
  const activeAgents = filteredAgents.filter((a) => a.status !== 'completed' && a.status !== 'failed');
  const stoppedAgents = filteredAgents.filter((a) => a.status === 'completed' || a.status === 'failed');

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      {/* Stats bar */}
      <FleetStats agents={agents} tasks={tasks} locks={locks} />

      {/* Toolbar: view toggle, filter, spawn */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setView('cards')}
            className={`p-1.5 rounded transition-colors ${view === 'cards' ? 'bg-accent/20 text-accent' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'}`}
            title="Card view"
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => setView('table')}
            className={`p-1.5 rounded transition-colors ${view === 'table' ? 'bg-accent/20 text-accent' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'}`}
            title="Table view"
          >
            <Table size={16} />
          </button>
        </div>

        <div className="flex items-center gap-3">
          {agents.length > 0 && (
            <select
              value={selectedAgentFilter ?? ''}
              onChange={(e) => setSelectedAgentFilter(e.target.value || null)}
              className="bg-surface-raised border border-gray-700 rounded px-2 py-1 text-xs text-gray-300"
            >
              <option value="">All agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.role.icon} {a.role.name} ({a.id.slice(0, 8)})
                </option>
              ))}
            </select>
          )}
          <kbd className="hidden sm:inline-block text-[10px] text-gray-500 bg-surface border border-gray-700 rounded px-1.5 py-0.5">N</kbd>
          <button
            onClick={() => setShowSpawn(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-black rounded-lg text-sm font-medium hover:bg-accent-muted transition-colors"
          >
            <Plus size={16} />
            Spawn Agent
          </button>
        </div>
      </div>

      {/* Main content: cards or table */}
      {view === 'cards' ? (
        loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="text-center text-gray-500 py-20">
            <p className="text-lg mb-2">No agents running</p>
            <p className="text-sm">Spawn an agent to get started — press <kbd className="bg-surface border border-gray-700 rounded px-1.5 py-0.5 text-xs">N</kbd></p>
          </div>
        ) : (
          <>
            {/* Active agents */}
            {activeAgents.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {activeAgents.map((agent) => (
                  <AgentCard key={agent.id} agent={agent} api={api} ws={ws} />
                ))}
              </div>
            )}

            {/* Stopped / completed agents */}
            {stoppedAgents.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">
                  Stopped ({stoppedAgents.length})
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 opacity-70">
                  {stoppedAgents.map((agent) => (
                    <AgentCard key={agent.id} agent={agent} api={api} ws={ws} />
                  ))}
                </div>
              </div>
            )}

            {hasChildren && <AgentTimeline />}
          </>
        )
      ) : (
        <AgentActivityTable agents={filteredAgents} tasks={tasks} locks={locks} api={api} ws={ws} />
      )}

      {/* Bottom section: Activity Feed + File Locks (collapsible) */}
      <div className="border border-gray-700 rounded-lg bg-surface-raised">
        <button
          onClick={() => setBottomOpen((o) => !o)}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-300 uppercase tracking-wider hover:bg-surface/50 transition-colors"
        >
          {bottomOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Activity &amp; Locks
          {(filteredActivity.length > 0 || filteredLocks.length > 0) && (
            <span className="text-[10px] text-gray-500 normal-case tracking-normal">
              ({filteredActivity.length} events, {filteredLocks.length} locks)
            </span>
          )}
        </button>
        {bottomOpen && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-3 pt-0">
            <ActivityFeed activity={filteredActivity} agents={agents} />
            <FileLockPanel locks={filteredLocks} agents={agents} />
          </div>
        )}
      </div>

      {showSpawn && <SpawnDialog api={api} onClose={() => setShowSpawn(false)} />}
    </div>
  );
}
