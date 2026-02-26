import { useAppStore } from '../../stores/appStore';
import type { AgentInfo } from '../../types';
import { RefreshCw, Square, Terminal, Hand } from 'lucide-react';

interface Props {
  agent: AgentInfo;
  api: any;
  ws: any;
}

const STATUS_COLORS: Record<string, string> = {
  creating: 'text-yellow-400',
  running: 'text-green-400',
  idle: 'text-blue-400',
  completed: 'text-gray-400',
  failed: 'text-red-400',
};

export function AgentCard({ agent, api }: Props) {
  const { setSelectedAgent, selectedAgentId } = useAppStore();
  const isSelected = selectedAgentId === agent.id;

  return (
    <div
      className={`rounded-lg border p-3 cursor-pointer transition-colors ${
        isSelected
          ? 'border-accent bg-accent/5'
          : 'border-gray-700 bg-surface-raised hover:border-gray-600'
      }`}
      onClick={() => setSelectedAgent(isSelected ? null : agent.id)}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{agent.role.icon}</span>
          <div>
            <h3 className="text-sm font-medium">{agent.role.name}</h3>
            <span className={`text-xs ${STATUS_COLORS[agent.status] || 'text-gray-400'}`}>
              {agent.status}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setSelectedAgent(agent.id);
            }}
            className="p-1 text-gray-400 hover:text-accent"
            title="Open terminal"
          >
            <Terminal size={14} />
          </button>
          {(agent.status === 'completed' || agent.status === 'failed') && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                api.restartAgent(agent.id);
              }}
              className="p-1 text-gray-400 hover:text-yellow-400"
              title="Restart agent"
            >
              <RefreshCw size={14} />
            </button>
          )}
          {(agent.status === 'running' || agent.status === 'idle') && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                api.interruptAgent(agent.id);
              }}
              className="p-1 text-gray-400 hover:text-orange-400"
              title="Interrupt — cancel current work"
            >
              <Hand size={14} />
            </button>
          )}
          {(agent.status === 'running' || agent.status === 'idle') && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                api.killAgent(agent.id);
              }}
              className="p-1 text-gray-400 hover:text-red-400"
              title="Stop agent"
            >
              <Square size={14} />
            </button>
          )}
        </div>
      </div>

      {agent.taskId && (
        <div className="text-xs text-gray-400 mb-1">
          Task: <span className="text-gray-300">{agent.taskId.slice(0, 8)}...</span>
        </div>
      )}

      {agent.childIds.length > 0 && (
        <div className="text-xs text-gray-400 mb-1">
          Sub-agents: <span className="text-gray-300">{agent.childIds.length}</span>
        </div>
      )}

      {agent.plan && agent.plan.length > 0 && (
        <div className="mt-1">
          <div className="flex items-center gap-1 text-[10px] text-gray-400 mb-0.5">
            <span>Plan: {agent.plan.filter((e) => e.status === 'completed').length}/{agent.plan.length}</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-1">
            <div
              className="bg-green-500 h-1 rounded-full transition-all"
              style={{ width: `${(agent.plan.filter((e) => e.status === 'completed').length / agent.plan.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      {agent.toolCalls && agent.toolCalls.length > 0 && (() => {
        const active = agent.toolCalls.filter((tc) => tc.status === 'in_progress' || tc.status === 'pending');
        const latest = active[active.length - 1] ?? agent.toolCalls[agent.toolCalls.length - 1];
        return (
          <div className="text-[10px] text-gray-400 mt-1 truncate">
            🔧 {typeof latest.title === 'string' ? latest.title : (latest.title as any)?.text ?? JSON.stringify(latest.title)}
          </div>
        );
      })()}

      {agent.outputPreview && (
        <pre className="text-xs text-gray-500 mt-2 overflow-hidden h-12 font-mono bg-surface/50 rounded p-1">
          {agent.outputPreview.slice(-200)}
        </pre>
      )}

      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: agent.role.color }}
          />
          <span className={`text-[10px] px-1 py-0.5 rounded ${agent.mode === 'acp' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-500/20 text-gray-400'}`}>
            {agent.mode === 'acp' ? 'ACP' : 'PTY'}
          </span>
          {agent.autopilot && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400">
              autopilot
            </span>
          )}
        </div>
        <span className="text-[10px] text-gray-500 font-mono">{agent.id.slice(0, 8)}</span>
      </div>
    </div>
  );
}
