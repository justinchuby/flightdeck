import { useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import type { AgentInfo } from '../../types';
import { RefreshCw, Square, Terminal, Hand, Check, Play } from 'lucide-react';
import { AgentIdBadge } from '../../utils/markdown';

interface Props {
  agent: AgentInfo;
  api: any;
  ws: any;
}

const STATUS_COLORS: Record<string, string> = {
  creating: 'text-yellow-600 dark:text-yellow-400',
  running: 'text-green-400',
  idle: 'text-blue-400',
  completed: 'text-th-text-muted',
  failed: 'text-red-400',
  terminated: 'text-orange-400',
};

const AVAILABLE_MODELS = [
  'claude-opus-4.6',
  'claude-sonnet-4.6',
  'claude-sonnet-4.5',
  'claude-haiku-4.5',
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'gpt-5.2',
  'gpt-5.1-codex',
  'gemini-3-pro-preview',
  'gpt-4.1',
];

export function AgentCard({ agent, api }: Props) {
  const { setSelectedAgent, selectedAgentId } = useAppStore();
  const isSelected = selectedAgentId === agent.id;
  const [confirmKill, setConfirmKill] = useState(false);

  return (
    <div
      className={`rounded-lg border p-3 cursor-pointer transition-colors ${
        isSelected
          ? 'border-accent bg-accent/5'
          : 'border-th-border bg-surface-raised hover:border-th-border-hover'
      }`}
      onClick={() => setSelectedAgent(isSelected ? null : agent.id)}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{agent.role.icon}</span>
          <div>
            <h3 className="text-sm font-medium">{agent.role.name}</h3>
            <span className={`text-xs ${STATUS_COLORS[agent.status] || 'text-th-text-muted'}`}>
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
            className="p-1 text-th-text-muted hover:text-accent"
            title="Open terminal"
          >
            <Terminal size={14} />
          </button>
          {(agent.status === 'completed' || agent.status === 'failed' || agent.status === 'terminated') && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                api.restartAgent(agent.id);
              }}
              className="p-1 text-th-text-muted hover:text-yellow-600 dark:hover:text-yellow-400"
              title="Restart agent"
            >
              <RefreshCw size={14} />
            </button>
          )}
          {(agent.status === 'completed' || agent.status === 'failed' || agent.status === 'terminated') && agent.sessionId && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                api.resumeAgent(agent.id, agent.sessionId!);
              }}
              className="p-1 text-th-text-muted hover:text-green-600 dark:hover:text-green-400"
              title="Resume session — continue from where the agent left off"
            >
              <Play size={14} />
            </button>
          )}
          {(agent.status === 'running' || agent.status === 'idle') && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                api.interruptAgent(agent.id);
              }}
              className="p-1 text-th-text-muted hover:text-orange-400"
              title="Interrupt — cancel current work"
            >
              <Hand size={14} />
            </button>
          )}
          {(agent.status === 'running' || agent.status === 'idle') && (
            confirmKill ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  api.terminateAgent(agent.id);
                  setConfirmKill(false);
                }}
                onBlur={() => setConfirmKill(false)}
                className="p-1 text-red-400 hover:text-red-600 dark:hover:text-red-300 animate-pulse"
                title="Confirm stop"
                autoFocus
              >
                <Check size={14} />
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmKill(true);
                }}
                className="p-1 text-th-text-muted hover:text-red-400"
                title="Stop agent"
              >
                <Square size={14} />
              </button>
            )
          )}
        </div>
      </div>

      {agent.task && (
        <div className="text-xs text-th-text-muted mb-1">
          Task: <span className="text-th-text-alt">{agent.task.length > 60 ? agent.task.slice(0, 60) + '...' : agent.task}</span>
        </div>
      )}

      {(agent.status === 'running' || agent.status === 'idle') && (
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[10px] text-th-text-muted">Model:</span>
          <select
            value={agent.model || agent.role.model || ''}
            onChange={(e) => {
              e.stopPropagation();
              api.updateAgent(agent.id, { model: e.target.value });
            }}
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] bg-th-bg-alt border border-th-border text-th-text-alt rounded px-1 py-0.5 focus:outline-none focus:border-accent cursor-pointer"
          >
            {(() => {
              const currentModel = agent.model || agent.role.model || '';
              const options = AVAILABLE_MODELS.includes(currentModel)
                ? AVAILABLE_MODELS
                : [currentModel, ...AVAILABLE_MODELS];
              return options.map((m) => (
                <option key={m} value={m}>{m}</option>
              ));
            })()}
          </select>
        </div>
      )}

      {!(agent.status === 'running' || agent.status === 'idle') && agent.model && (
        <div className="text-[10px] text-th-text-muted mb-1">
          Model: <span className="text-th-text-muted">{agent.model}</span>
        </div>
      )}

      {agent.childIds.length > 0 && (
        <div className="text-xs text-th-text-muted mb-1">
          Sub-agents: <span className="text-th-text-alt">{agent.childIds.length}</span>
        </div>
      )}

      {agent.plan && agent.plan.length > 0 && (
        <div className="mt-1">
          <div className="flex items-center gap-1 text-[10px] text-th-text-muted mb-0.5">
            <span>Plan: {agent.plan.filter((e) => e.status === 'completed').length}/{agent.plan.length}</span>
          </div>
          <div className="w-full bg-th-bg-muted rounded-full h-1">
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
          <div className="text-[10px] text-th-text-muted mt-1 truncate">
            🔧 {typeof latest.title === 'string' ? latest.title : (latest.title as any)?.text ?? JSON.stringify(latest.title)}
          </div>
        );
      })()}

      {agent.outputPreview && (
        <pre className="text-xs text-th-text-muted mt-2 overflow-hidden h-12 font-mono bg-surface/50 rounded p-1">
          {agent.outputPreview.slice(-200)}
        </pre>
      )}

      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: agent.role.color }}
          />
          {agent.autopilot && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400">
              autopilot
            </span>
          )}
        </div>
        <AgentIdBadge id={agent.id} />
      </div>
    </div>
  );
}
