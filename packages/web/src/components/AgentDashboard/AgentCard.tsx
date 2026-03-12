import { useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import type { AgentInfo } from '../../types';
import { RefreshCw, Square, Terminal, Zap, Check, Play } from 'lucide-react';
import { AgentIdBadge } from '../../utils/markdown';
import { agentStatusText } from '../../utils/statusColors';
import { shortAgentId } from '../../utils/agentLabel';
import { formatTokens } from '../../utils/format';
import { DiffBadge } from '../DiffPreview';
import { useModels } from '../../hooks/useModels';
import { getProviderColors } from '../../utils/providerColors';

interface Props {
  agent: AgentInfo;
  api: any;
  ws: any;
}

export function AgentCard({ agent, api }: Props) {
  const setSelectedAgent = useAppStore((s) => s.setSelectedAgent);
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const isSelected = selectedAgentId === agent.id;
  const [confirmKill, setConfirmKill] = useState(false);
  const providerColors = getProviderColors(agent.provider);
  const { models: availableModels } = useModels();

  return (
    <div
      className={`rounded-lg border p-3 cursor-pointer transition-colors border-l-[3px] ${providerColors.border} ${
        isSelected
          ? 'border-t-accent border-r-accent border-b-accent bg-accent/5'
          : 'border-t-th-border border-r-th-border border-b-th-border bg-surface-raised hover:border-t-th-border-hover hover:border-r-th-border-hover hover:border-b-th-border-hover'
      }`}
      onClick={() => setSelectedAgent(isSelected ? null : agent.id)}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{agent.role.icon}</span>
          <div>
            <h3 className="text-sm font-medium">{agent.role.name} <span className="text-th-text-muted font-mono text-xs">({shortAgentId(agent.id)})</span></h3>
            <div className="flex items-center gap-2">
              <span className={`text-xs ${agentStatusText(agent.status)}`}>
                {agent.status}
              </span>
            </div>
            {agent.sessionId && (
              <button
                className="text-[10px] font-mono text-th-text-muted bg-th-bg-alt/60 px-1 rounded hover:bg-th-bg-alt transition-colors block mt-0.5 truncate max-w-[220px]"
                title={`Session: ${agent.sessionId} — click to copy`}
                onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(agent.sessionId!); }}
              >
                sess:{agent.sessionId}
              </button>
            )}
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
              title="Interrupt agent"
            >
              <Zap size={14} />
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

      {agent.exitError && (
        <div className="text-[10px] font-mono text-red-400 bg-red-900/20 border border-red-800/30 rounded px-2 py-1 mb-1 whitespace-pre-wrap max-h-12 overflow-hidden">
          {agent.exitError.length > 120 ? agent.exitError.slice(0, 120) + '…' : agent.exitError}
        </div>
      )}

      {(agent.status === 'running' || agent.status === 'idle') && (
        <div className="flex items-center gap-1.5 mb-1">
          {agent.provider && (
            <span className={`text-[9px] shrink-0 px-1 py-px rounded-sm font-medium ${providerColors.bg} ${providerColors.text}`}>{agent.provider}</span>
          )}
          <select
            value={agent.model || ''}
            onChange={(e) => {
              e.stopPropagation();
              api.updateAgent(agent.id, { model: e.target.value });
            }}
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] bg-th-bg-alt border border-th-border text-th-text-alt rounded px-1 py-0.5 focus:outline-none focus:border-accent cursor-pointer min-w-0 truncate"
          >
            {(() => {
              const currentModel = agent.model || '';
              const options = availableModels.includes(currentModel)
                ? availableModels
                : [currentModel, ...availableModels];
              return options.map((m) => (
                <option key={m} value={m}>{m}</option>
              ));
            })()}
          </select>
        </div>
      )}

      {!(agent.status === 'running' || agent.status === 'idle') && (agent.model || agent.provider) && (
        <div className="flex items-center gap-1.5 text-[10px] text-th-text-muted mb-1">
          {agent.provider && (
            <span className={`text-[9px] shrink-0 px-1 py-px rounded-sm font-medium ${providerColors.bg} ${providerColors.text}`}>{agent.provider}</span>
          )}
          {agent.model && <span className="truncate">{agent.model}</span>}
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

      {/* Token metrics & context window bar */}
      {(agent.inputTokens || agent.outputTokens || agent.contextWindowUsed) ? (
        <div className="mt-1.5 space-y-1">
          {(agent.inputTokens || agent.outputTokens) ? (
            <div className="flex items-center gap-2 text-[10px] text-th-text-muted">
              <span title="Input tokens">↓{formatTokens(agent.inputTokens)}</span>
              <span title="Output tokens">↑{formatTokens(agent.outputTokens)}</span>
              {(agent.cacheReadTokens != null && agent.cacheReadTokens > 0) && (
                <span title="Cache read tokens" className="text-green-500/70">⚡{formatTokens(agent.cacheReadTokens)}</span>
              )}
            </div>
          ) : null}
          {agent.contextWindowSize && agent.contextWindowUsed ? (() => {
            const pct = Math.min(100, Math.round((agent.contextWindowUsed / agent.contextWindowSize) * 100));
            const color = pct > 85 ? 'bg-red-500' : pct > 60 ? 'bg-yellow-500' : 'bg-blue-500';
            return (
              <div className="flex items-center gap-1.5">
                <div className="flex-1 bg-th-bg-muted rounded-full h-1">
                  <div className={`${color} h-1 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[10px] text-th-text-muted">{pct}%</span>
              </div>
            );
          })() : null}
        </div>
      ) : null}

      {agent.outputPreview && (
        <div className="relative mt-2">
          <pre className="text-xs text-th-text-muted overflow-hidden max-h-16 font-mono bg-surface/50 rounded p-1 whitespace-pre-wrap break-words">
            {agent.outputPreview.slice(-200)}
          </pre>
          <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-surface/50 to-transparent rounded-b pointer-events-none" />
        </div>
      )}

      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: agent.role.color }}
          />
          {(agent.status === 'running' || agent.status === 'idle') && (
            <DiffBadge agentId={agent.id} />
          )}
        </div>
        <AgentIdBadge id={agent.id} />
      </div>
    </div>
  );
}
