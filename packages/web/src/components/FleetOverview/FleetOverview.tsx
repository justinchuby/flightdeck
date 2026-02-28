import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { FleetStats } from './FleetStats';
import { AgentActivityTable } from './AgentActivityTable';
import { ActivityFeed } from './ActivityFeed';
import { FileLockPanel } from './FileLockPanel';
import type { AgentInfo } from '../../types';

interface CoordinationStatus {
  locks: FileLock[];
  recentActivity: ActivityEntry[];
}

export interface FileLock {
  agentId: string;
  agentRole: string;
  filePath: string;
  reason?: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface ActivityEntry {
  id: number;
  agentId: string;
  agentRole: string;
  actionType: string;
  filePath?: string;
  details?: string | Record<string, unknown>;
  timestamp: string;
}

interface Props {
  api: any;
  ws: any;
}

export function FleetOverview({ api, ws }: Props) {
  const { agents } = useAppStore();
  const [locks, setLocks] = useState<FileLock[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string | null>(null);

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

  // Poll coordination status every 3 seconds for live updates
  useEffect(() => {
    fetchCoordination();
    const interval = setInterval(fetchCoordination, 3000);
    return () => clearInterval(interval);
  }, [fetchCoordination]);

  // Also refresh on agent events
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

  const filteredAgents: AgentInfo[] = selectedAgentFilter
    ? agents.filter((a) => a.id === selectedAgentFilter)
    : agents;

  const filteredActivity = selectedAgentFilter
    ? activity.filter((a) => a.agentId === selectedAgentFilter)
    : activity;

  const filteredLocks = selectedAgentFilter
    ? locks.filter((l) => l.agentId === selectedAgentFilter)
    : locks;

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Fleet Overview</h2>
        {agents.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Filter:</label>
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
          </div>
        )}
      </div>

      <FleetStats agents={agents} locks={locks} />

      <AgentActivityTable agents={filteredAgents} locks={locks} api={api} ws={ws} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ActivityFeed activity={filteredActivity} agents={agents} />
        <FileLockPanel locks={filteredLocks} agents={agents} />
      </div>
    </div>
  );
}
