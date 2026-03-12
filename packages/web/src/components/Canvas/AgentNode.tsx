import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { CanvasNodeData } from '../../hooks/useCanvasGraph';
import { shortAgentId } from '../../utils/agentLabel';

// ── Status visuals ─────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-[var(--st-running)]',
  idle: 'bg-[var(--st-idle)]',
  creating: 'bg-[var(--st-creating)]',
  completed: 'bg-[var(--st-completed)]',
  failed: 'bg-[var(--st-failed)]',
  terminated: 'bg-[var(--st-terminated)]',
};

const STATUS_PULSE: Record<string, boolean> = {
  running: true,
  creating: true,
};

function pressureColor(pct: number): string {
  if (pct >= 85) return 'bg-red-500';
  if (pct >= 70) return 'bg-orange-500';
  if (pct >= 50) return 'bg-yellow-500';
  return 'bg-green-500';
}

// ── Component ──────────────────────────────────────────────────────

function AgentNodeInner({ data }: NodeProps & { data: CanvasNodeData }) {
  const { agent, commVolume } = data;
  const role = agent.role?.name ?? 'Agent';
  const shortId = shortAgentId(agent.id);
  const status = agent.status ?? 'idle';
  const contextPct = agent.contextBurnRate != null
    ? Math.min(100, Math.round(agent.contextBurnRate * 10))
    : 0;

  // Scale by comm volume
  const scale = commVolume > 20 ? 1.1 : commVolume > 5 ? 1.05 : 1.0;

  return (
    <div
      className="relative bg-[rgba(var(--th-bg-rgb,255,255,255),0.92)] border-2 rounded-xl shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer group"
      style={{
        width: 200,
        minHeight: 88,
        transform: `scale(${scale})`,
        borderColor: agent.role?.color ?? 'var(--th-border)',
      }}
      role="button"
      aria-label={`Agent: ${role} (${status}). Context: ${contextPct}%.`}
    >
      {/* Connection handles — hidden; canvas is read-only visualization */}
      <Handle type="target" position={Position.Left} className="!w-0 !h-0 !min-w-0 !min-h-0 !border-0 !opacity-0 !pointer-events-none" />
      <Handle type="source" position={Position.Right} className="!w-0 !h-0 !min-w-0 !min-h-0 !border-0 !opacity-0 !pointer-events-none" />

      {/* Status dot */}
      <div
        className={`absolute top-2 right-2 w-2.5 h-2.5 rounded-full ${STATUS_COLORS[status] ?? 'bg-gray-400'} ${
          STATUS_PULSE[status] ? 'animate-pulse' : ''
        }`}
        title={status}
      />

      {/* Content */}
      <div className="px-3 py-2">
        {/* Role + ID */}
        <div className="flex items-center gap-1.5 mb-1">
          {agent.role?.icon && <span className="text-sm">{agent.role.icon}</span>}
          <span className="text-xs font-semibold text-th-text-alt truncate">{role}</span>
          <span className="text-[10px] text-th-text-muted font-mono">({shortId})</span>
        </div>

        {/* Provider + Model */}
        <p className="text-[10px] text-th-text-muted mb-1.5 truncate">
          {agent.provider && <span className="text-blue-400 mr-1">{agent.provider}</span>}
          {agent.model ?? 'default model'}
        </p>

        {/* Context pressure bar */}
        <div className="w-full h-1 bg-th-bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${pressureColor(contextPct)}`}
            style={{ width: `${contextPct}%` }}
          />
        </div>
        {contextPct > 0 && (
          <p className="text-[9px] text-th-text-muted text-right mt-0.5">{contextPct}%</p>
        )}
      </div>

      {/* Hover glow */}
      <div
        className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
        style={{
          boxShadow: `0 0 0 3px ${agent.role?.color ?? 'var(--th-border)'}40`,
        }}
      />
    </div>
  );
}

export const AgentNode = memo(AgentNodeInner);
