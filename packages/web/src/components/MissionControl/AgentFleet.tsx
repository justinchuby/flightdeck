import { useMemo } from 'react';
import { Users } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { agentStatusDot } from '../../utils/statusColors';
import type { AgentInfo } from '../../types';

// ── Constants ────────────────────────────────────────────────────────

const STATUS_ORDER: Record<string, number> = {
  running: 0,
  idle: 1,
  creating: 2,
  completed: 3,
  failed: 4,
  terminated: 5,
};

// ── Agent row ────────────────────────────────────────────────────────

function AgentRow({ agent }: { agent: AgentInfo }) {
  const statusColor = agentStatusDot(agent.status);
  const ctxPct = agent.contextWindowSize
    ? Math.round(((agent.contextWindowUsed ?? 0) / agent.contextWindowSize) * 100)
    : null;
  const ctxColor = ctxPct === null ? 'bg-th-bg-muted'
    : ctxPct > 90 ? 'bg-red-500'
    : ctxPct > 80 ? 'bg-yellow-500'
    : 'bg-blue-500';

  const modelShort = (agent.model || agent.role.model || '')
    .split('/').pop()?.split('-').slice(-2).join('-') || '—';

  return (
    <div className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-th-bg-alt/50">
      {/* Role icon + name */}
      <span className="text-sm w-5 text-center">{agent.role.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-th-text-muted truncate">
            {agent.id.slice(0, 8)}
          </span>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor} ${
            agent.status === 'running' ? 'motion-safe:animate-pulse' : ''
          }`} />
          <span className="text-xs text-th-text-muted">{agent.status}</span>
        </div>
        {/* Task preview */}
        {agent.task && (
          <div className="text-[10px] text-th-text-muted truncate mt-0.5">
            {agent.task.slice(0, 60)}
          </div>
        )}
        {/* Context pressure bar */}
        {ctxPct !== null && (
          <div className="flex items-center gap-2 mt-0.5">
            <div className="flex-1 h-1 bg-th-bg-alt rounded-full overflow-hidden">
              <div
                className={`h-full ${ctxColor} rounded-full`}
                style={{ width: `${ctxPct}%` }}
              />
            </div>
            <span className={`text-[10px] font-mono ${
              ctxPct > 90 ? 'text-red-400' : ctxPct > 80 ? 'text-yellow-600 dark:text-yellow-400' : 'text-th-text-muted'
            }`}>
              {ctxPct}%
            </span>
          </div>
        )}
      </div>
      {/* Model badge */}
      <span className="text-[10px] text-th-text-muted font-mono shrink-0">{modelShort}</span>
    </div>
  );
}

// ── AgentFleet ───────────────────────────────────────────────────────

interface AgentFleetProps {
  leadId: string;
}

export function AgentFleet({ leadId }: AgentFleetProps) {
  const agents = useAppStore((s) => s.agents);

  const { teamAgents, activeCount } = useMemo(() => {
    const team = agents
      .filter((a) => a.parentId === leadId || a.id === leadId)
      .sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99));
    return {
      teamAgents: team,
      activeCount: team.filter((a) => a.status === 'running').length,
    };
  }, [agents, leadId]);

  return (
    <div className="bg-th-bg rounded-lg border border-th-border-muted p-4 flex flex-col h-full">
      <h3 className="text-sm font-semibold text-th-text-alt flex items-center gap-2 mb-2">
        <Users size={14} className="text-th-text-muted" />
        Agent Fleet
        <span className="text-xs font-normal text-th-text-muted ml-auto">
          {activeCount}/{teamAgents.length} active
        </span>
      </h3>
      <div className="flex-1 overflow-y-auto space-y-0.5 -mx-2">
        {teamAgents.length === 0 && (
          <div className="text-xs text-th-text-muted px-2 py-4 text-center">No agents yet</div>
        )}
        {teamAgents.map((a) => <AgentRow key={a.id} agent={a} />)}
      </div>
    </div>
  );
}
