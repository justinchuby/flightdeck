import { apiFetch } from '../../hooks/useApi';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore } from '../../stores/leadStore';
import { useTimelineData } from '../Timeline/useTimelineData';
import { FleetStats } from './FleetStats';
import { AgentActivityTable } from './AgentActivityTable';
import { ActivityFeed } from './ActivityFeed';
import { FileLockPanel } from './FileLockPanel';
import { CommHeatmap } from './CommHeatmap';
import type { HeatmapMessage } from './CommHeatmap';
import type { AgentInfo } from '../../types';
import { ProjectTabs } from '../ProjectTabs';
import { shortAgentId } from '../../utils/agentLabel';

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
  const agents = useAppStore((s) => s.agents);
  const [locks, setLocks] = useState<FileLock[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [selectedLeadFilter, setSelectedLeadFilter] = useState<string | null>(null);

  // Identify lead agents for project-level filtering
  const leads = useMemo(
    () => agents.filter((a) => a.role?.id === 'lead' && !a.parentId),
    [agents],
  );

  // Auto-select first lead if none selected
  const effectiveLeadId = selectedLeadFilter ?? (leads.length > 0 ? leads[0].id : null);

  // Filter agents by selected project (lead + their children)
  const projectAgents = useMemo(() => {
    if (!effectiveLeadId || leads.length <= 1) return agents;
    return agents.filter((a) => a.id === effectiveLeadId || a.parentId === effectiveLeadId);
  }, [agents, effectiveLeadId, leads.length]);

  const fetchCoordination = useCallback(async () => {
    try {
      const data: CoordinationStatus  = await apiFetch('/coordination/status');
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

  const filteredAgents: AgentInfo[] = selectedAgentFilter
    ? projectAgents.filter((a) => a.id === selectedAgentFilter)
    : projectAgents;

  const filteredActivity = selectedAgentFilter
    ? activity.filter((a) => a.agentId === selectedAgentFilter)
    : activity;

  const filteredLocks = selectedAgentFilter
    ? locks.filter((l) => l.agentId === selectedAgentFilter)
    : locks;

  // ── CommHeatmap data ─────────────────────────────────────────────────────
  // Prefer SSE-backed communications for real-time updates; fall back to
  // leadStore comms (WebSocket) when SSE data is not available.
  const selectedLeadId = useLeadStore((s) => s.selectedLeadId);
  const { data: timelineData } = useTimelineData(selectedLeadId);
  const projects = useLeadStore((s) => s.projects);

  const heatmapAgents = useMemo(
    () =>
      projectAgents.map((a) => ({
        id:   a.id,
        role: a.role.id,
        name: `${a.role.icon}${shortAgentId(a.id)}`,
      })),
    [projectAgents],
  );

  const heatmapMessages: HeatmapMessage[] = useMemo(() => {
    // Use SSE timeline communications when available
    if (timelineData?.communications?.length) {
      return timelineData.communications
        .filter(c => c.fromAgentId && (c.toAgentId || c.type === 'group_message'))
        .map(c => ({
          from: c.fromAgentId,
          to:   c.toAgentId ?? '',
          count: 1,
          type: c.type as HeatmapMessage['type'],
        }));
    }

    // Fallback: aggregate comms from leadStore (WebSocket-based)
    const result: HeatmapMessage[] = [];
    for (const proj of Object.values(projects)) {
      for (const comm of proj.comms) {
        if (comm.fromId && comm.toId) {
          result.push({
            from: comm.fromId,
            to:   comm.toId,
            count: 1,
            type: comm.type,
          });
        }
      }
    }
    return result;
  }, [timelineData, projects]);

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4 focus:outline-none" tabIndex={0}>
      {/* Project selection tabs (only when multiple leads exist) */}
      {leads.length > 1 && (
        <div className="border-b border-th-border">
          <ProjectTabs activeId={effectiveLeadId} onChange={setSelectedLeadFilter} />
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Fleet Overview</h2>
        {projectAgents.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-th-text-muted">Filter:</label>
            <select
              value={selectedAgentFilter ?? ''}
              onChange={(e) => setSelectedAgentFilter(e.target.value || null)}
              className="bg-surface-raised border border-th-border rounded px-2 py-1 text-xs text-th-text-alt"
            >
              <option value="">All agents</option>
              {projectAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.role.icon} {a.role.name} ({shortAgentId(a.id)})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <FleetStats agents={projectAgents} locks={locks} />

      <AgentActivityTable agents={filteredAgents} locks={locks} api={api} ws={ws} />

      {/* ── Communication Heatmap ── */}
      {projectAgents.length >= 2 && (
        <div className="border border-th-border rounded-lg bg-surface-raised overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-th-text hover:bg-th-bg-muted/30 transition-colors"
            onClick={() => setShowHeatmap(v => !v)}
          >
            <span className="flex items-center gap-2">
              <span className="text-base">🗺️</span>
              Communication Heatmap
              <span className="text-xs text-th-text-muted font-normal">
                — agent-to-agent message frequency
              </span>
            </span>
            <span className="text-th-text-muted text-xs">{showHeatmap ? '▲' : '▼'}</span>
          </button>
          {showHeatmap && (
            <div className="p-4 border-t border-th-border">
              <CommHeatmap agents={heatmapAgents} messages={heatmapMessages} />
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ActivityFeed activity={filteredActivity} agents={projectAgents} />
        <FileLockPanel locks={filteredLocks} agents={projectAgents} />
      </div>
    </div>
  );
}
