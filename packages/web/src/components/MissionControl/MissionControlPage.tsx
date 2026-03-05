import { useMemo, useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { useLeadStore } from '../../stores/leadStore';
import { useAppStore } from '../../stores/appStore';
import { HealthSummary } from './HealthSummary';
import { AgentFleet } from './AgentFleet';
import { DagMinimap } from './DagMinimap';
import { ActivityFeed } from './ActivityFeed';
import { TokenEconomics } from '../TokenEconomics/TokenEconomics';
import { CostBreakdown } from '../TokenEconomics/CostBreakdown';
import { TimerDisplay } from '../TimerDisplay/TimerDisplay';
import { AlertsPanel } from './AlertsPanel';
import { CommHeatmap } from '../FleetOverview/CommHeatmap';
import { CommFlowGraph } from '../CommFlow';
import { DiffPreview } from '../DiffPreview';
import { useFocusAgent } from '../../hooks/useFocusAgent';
import { useDashboardLayout } from '../../hooks/useDashboardLayout';
import type { PanelConfig } from '../../hooks/useDashboardLayout';

// ── Panel renderer ────────────────────────────────────────────────────

function PanelSlot({ panel, leadId, agents }: { panel: PanelConfig; leadId: string; agents: any[] }) {
  switch (panel.id) {
    case 'alerts':
      return <AlertsPanel leadId={leadId} />;
    case 'health':
      return <HealthSummary leadId={leadId} />;
    case 'tokens':
      return <TokenEconomics />;
    case 'costs':
      return <CostBreakdown />;
    case 'timers':
      return <TimerDisplay />;
    case 'fleet':
      return <AgentFleet leadId={leadId} />;
    case 'dag':
      return <DagMinimap leadId={leadId} />;
    case 'activity':
      return <ActivityFeed leadId={leadId} />;
    case 'heatmap': {
      const heatmapAgents = agents.map((a) => ({
        id: a.id,
        role: a.role.id,
        name: `${a.role.icon}${a.id.slice(0, 5)}`,
      }));
      const heatmapMessages: Array<{ from: string; to: string; count: number }> = [];
      for (const agent of agents) {
        if (!agent.parentId) continue;
        const inbound = Math.max(1, agent.messages?.filter((m: any) => m.sender === 'external').length ?? 1);
        const outbound = Math.max(1, agent.messages?.filter((m: any) => m.sender === 'agent').length ?? 1);
        heatmapMessages.push({ from: agent.parentId, to: agent.id, count: inbound });
        heatmapMessages.push({ from: agent.id, to: agent.parentId, count: outbound });
      }
      return (
        <div className="bg-th-bg rounded-lg border border-th-border-muted p-4">
          <h3 className="text-sm font-semibold text-th-text-alt mb-3 flex items-center gap-2">🗺️ Comm Heatmap</h3>
          <CommHeatmap agents={heatmapAgents} messages={heatmapMessages} />
        </div>
      );
    }
    case 'scorecards': {
      const team = agents.filter((a) => a.parentId === leadId || a.id === leadId);
      const running = team.filter((a) => a.status === 'running').length;
      const idle = team.filter((a) => a.status === 'idle').length;
      const completed = team.filter((a) => a.status === 'completed').length;
      const total = team.length;
      return (
        <div className="bg-th-bg rounded-lg border border-th-border-muted p-4">
          <h3 className="text-sm font-semibold text-th-text-alt mb-3 flex items-center gap-2">📊 Performance</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="text-center p-2 bg-th-bg-alt rounded-md">
              <div className="text-2xl font-bold text-th-text">{total}</div>
              <div className="text-xs text-th-text-muted">Total Agents</div>
            </div>
            <div className="text-center p-2 bg-th-bg-alt rounded-md">
              <div className="text-2xl font-bold text-green-400">{running}</div>
              <div className="text-xs text-th-text-muted">Running</div>
            </div>
            <div className="text-center p-2 bg-th-bg-alt rounded-md">
              <div className="text-2xl font-bold text-yellow-400">{idle}</div>
              <div className="text-xs text-th-text-muted">Idle</div>
            </div>
            <div className="text-center p-2 bg-th-bg-alt rounded-md">
              <div className="text-2xl font-bold text-blue-400">{completed}</div>
              <div className="text-xs text-th-text-muted">Completed</div>
            </div>
          </div>
        </div>
      );
    }
    case 'commflow':
      return (
        <div className="bg-th-bg rounded-lg border border-th-border-muted p-4">
          <h3 className="text-sm font-semibold text-th-text-alt mb-3 flex items-center gap-2">🔀 Communication Flow</h3>
          <CommFlowGraph leadId={leadId} width={600} height={400} />
        </div>
      );
    case 'diff':
      return <AgentDiffPanel agents={agents} leadId={leadId} />;
    default:
      return null;
  }
}

// ── Agent Diff Panel (uses useFocusAgent to show live diffs) ─────────

function AgentDiffPanel({ agents, leadId }: { agents: any[]; leadId: string }) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const { data } = useFocusAgent(selectedAgentId);

  const team = agents.filter((a) => a.parentId === leadId || a.id === leadId);
  const agentsWithActivity = team.filter((a) => a.status === 'running' || a.status === 'idle');

  return (
    <div className="bg-th-bg rounded-lg border border-th-border-muted p-4">
      <h3 className="text-sm font-semibold text-th-text-alt mb-3 flex items-center gap-2">📝 Live Diffs</h3>
      {agentsWithActivity.length === 0 ? (
        <p className="text-xs text-th-text-muted">No active agents with file changes.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {agentsWithActivity.map((a) => {
              const roleName = typeof a.role === 'object' ? a.role.name : a.role;
              const icon = typeof a.role === 'object' ? a.role.icon : '🤖';
              return (
                <button
                  key={a.id}
                  onClick={() => setSelectedAgentId(selectedAgentId === a.id ? null : a.id)}
                  className={`px-2 py-1 text-[11px] rounded border transition-colors ${
                    selectedAgentId === a.id
                      ? 'bg-accent/15 border-accent/40 text-accent'
                      : 'bg-th-bg-alt border-th-border text-th-text-muted hover:text-th-text-alt'
                  }`}
                >
                  {icon} {roleName} ({a.id.slice(0, 8)})
                </button>
              );
            })}
          </div>
          {data?.diff ? (
            <DiffPreview diff={data.diff} />
          ) : selectedAgentId ? (
            <p className="text-xs text-th-text-muted">No file changes for this agent.</p>
          ) : (
            <p className="text-xs text-th-text-muted">Select an agent to view their diffs.</p>
          )}
        </>
      )}
    </div>
  );
}

// ── MissionControlPage ───────────────────────────────────────────────

export function MissionControlPage() {
  const selectedLeadId = useLeadStore((s) => s.selectedLeadId);
  const projects = useLeadStore((s) => s.projects);
  const agents = useAppStore((s) => s.agents);
  const { panels } = useDashboardLayout();

  const projectKeys = Object.keys(projects);

  // Auto-discover lead agents from appStore if leadStore has no projects yet
  const leadAgents = useMemo(
    () => agents.filter((a) => a.role?.id === 'lead' && !a.parentId),
    [agents],
  );

  // Auto-select: prefer selectedLeadId, then leadStore projects, then any live lead agent
  const leadId = selectedLeadId ?? projectKeys[0] ?? leadAgents[0]?.id ?? null;

  // Auto-register discovered leads into leadStore so panels can use them (run once per leadId)
  const registeredRef = useRef<string | null>(null);
  useEffect(() => {
    if (leadId && leadId !== registeredRef.current && !projects[leadId]) {
      registeredRef.current = leadId;
      useLeadStore.getState().addProject(leadId);
      useLeadStore.getState().selectLead(leadId);
    }
  }, [leadId, projects]);

  const teamAgents = useMemo(() => {
    if (!leadId) return [];
    return agents.filter((a) => a.parentId === leadId || a.id === leadId);
  }, [agents, leadId]);

  if (!leadId) {
    return (
      <div className="h-full flex items-center justify-center text-th-text-muted">
        <div className="text-center space-y-2">
          <Activity size={48} className="mx-auto text-th-text-muted" />
          <p className="text-lg font-medium">Mission Control</p>
          <p className="text-sm">No active project. Start a project from the Lead page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0">
        <Activity size={20} className="text-th-text-muted" />
        <h1 className="text-lg font-semibold text-th-text-alt">Mission Control</h1>
        <span className="text-xs text-th-text-muted font-mono">Lead: {leadId.slice(0, 8)}</span>
      </div>

      {/* Render all visible panels in user-defined order */}
      {panels.map((panel) => (
        <div key={panel.id} className="shrink-0">
          <PanelSlot panel={panel} leadId={leadId} agents={teamAgents} />
        </div>
      ))}
    </div>
  );
}
