import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useHistoricalAgents } from '../../hooks/useHistoricalAgents';
import { shortAgentId } from '../../utils/agentLabel';
import { SpawnDialog } from './SpawnDialog';
import { FleetStats } from '../FleetOverview/FleetStats';
import { AgentActivityTable } from '../FleetOverview/AgentActivityTable';
import { ActivityFeed } from '../FleetOverview/ActivityFeed';
import { FileLockPanel } from '../FleetOverview/FileLockPanel';
import type { FileLock, ActivityEntry } from '../FleetOverview/FleetOverview';
import { Plus, ChevronDown, ChevronRight, FolderOpen } from 'lucide-react';

interface CoordinationStatus {
  locks: FileLock[];
  recentActivity: ActivityEntry[];
}

interface Props {
  api: any;
  ws: any;
}

export function AgentDashboard({ api, ws }: Props) {
  const liveAgents = useAppStore((s) => s.agents);
  const setSelectedAgent = useAppStore((s) => s.setSelectedAgent);
  const [showSpawn, setShowSpawn] = useState(false);
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string | null>(null);
  const [locks, setLocks] = useState<FileLock[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [bottomOpen, setBottomOpen] = useState(false);
  const [groupByProject, setGroupByProject] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Derive historical agents from keyframe events when no live agents
  const { agents: historicalAgents } = useHistoricalAgents(liveAgents.length);

  const agents = liveAgents.length > 0 ? liveAgents : historicalAgents;

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
        msg.type === 'agent:terminated' ||
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

  // Group agents by project (root lead)
  const projectGroups = useMemo(() => {
    if (!groupByProject) return null;
    const findRootLead = (agentId: string): string | null => {
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) return null;
      if (agent.role.id === 'lead' && !agent.parentId) return agent.id;
      if (agent.parentId) return findRootLead(agent.parentId);
      return null;
    };
    const groups = new Map<string, typeof filteredAgents>();
    for (const agent of filteredAgents) {
      const leadId = findRootLead(agent.id) ?? '_unassigned';
      const list = groups.get(leadId) ?? [];
      list.push(agent);
      groups.set(leadId, list);
    }
    return groups;
  }, [groupByProject, filteredAgents, agents]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4 focus:outline-none" tabIndex={0}>
      {/* Stats bar */}
      <FleetStats agents={agents} locks={locks} />

      {/* Toolbar: filter + group + spawn */}
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setGroupByProject((g) => !g)}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
              groupByProject ? 'bg-blue-500/20 text-blue-600 dark:text-blue-300' : 'text-th-text-muted hover:text-th-text'
            }`}
            title="Group by project"
          >
            <FolderOpen size={13} />
            Group by project
          </button>
          {agents.length > 0 && (
            <select
              value={selectedAgentFilter ?? ''}
              onChange={(e) => setSelectedAgentFilter(e.target.value || null)}
              className="bg-surface-raised border border-th-border rounded px-2 py-1 text-xs text-th-text-alt"
            >
              <option value="">All agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.role.icon} {a.role.name} ({shortAgentId(a.id)})
                </option>
              ))}
            </select>
          )}
          <kbd className="hidden sm:inline-block text-[10px] text-th-text-muted bg-surface border border-th-border rounded px-1.5 py-0.5">N</kbd>
          <button
            onClick={() => setShowSpawn(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-black rounded-lg text-sm font-medium hover:bg-accent-muted transition-colors"
          >
            <Plus size={16} />
            Spawn Agent
          </button>
        </div>
      </div>

      {/* Agent list */}
      {groupByProject && projectGroups ? (
        Array.from(projectGroups.entries()).map(([leadId, groupAgents]) => {
          const lead = agents.find((a) => a.id === leadId);
          const label = lead?.projectName || lead?.task?.slice(0, 40) || (leadId === '_unassigned' ? 'Unassigned' : shortAgentId(leadId));
          const isCollapsed = collapsedGroups.has(leadId);
          return (
            <div key={leadId} className="border border-th-border rounded-lg bg-surface-raised">
              <button
                onClick={() => toggleGroup(leadId)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-th-text-alt hover:bg-surface/50 transition-colors"
              >
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <FolderOpen size={13} className="text-yellow-600 dark:text-yellow-400" />
                <span className="truncate">{label}</span>
                <span className="text-[10px] text-th-text-muted ml-1">({groupAgents.length})</span>
              </button>
              {!isCollapsed && (
                <div className="px-1 pb-1">
                  <AgentActivityTable agents={groupAgents} locks={locks} api={api} ws={ws} onSelectAgent={setSelectedAgent} />
                </div>
              )}
            </div>
          );
        })
      ) : (
        <AgentActivityTable agents={filteredAgents} locks={locks} api={api} ws={ws} onSelectAgent={setSelectedAgent} />
      )}

      {/* Bottom section: Activity Feed + File Locks (collapsible) */}
      <div className="border border-th-border rounded-lg bg-surface-raised">
        <button
          onClick={() => setBottomOpen((o) => !o)}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-th-text-alt uppercase tracking-wider hover:bg-surface/50 transition-colors"
        >
          {bottomOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Activity &amp; Locks
          {(filteredActivity.length > 0 || filteredLocks.length > 0) && (
            <span className="text-[10px] text-th-text-muted normal-case tracking-normal">
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
