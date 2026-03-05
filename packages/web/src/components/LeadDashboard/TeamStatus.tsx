import { Bot, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import type { AgentInfo, Delegation } from '../../types';
import { AgentIdBadge } from '../../utils/markdown';
import { agentStatusText } from '../../utils/statusColors';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

interface Props {
  agents: AgentInfo[];
  delegations: Delegation[];
}

const STATUS_ICON: Record<string, typeof CheckCircle> = {
  running: Loader2,
  completed: CheckCircle,
  failed: XCircle,
  terminated: XCircle,
};

/** Shorten model ID for display (e.g. "claude-sonnet-4.6" → "Sonnet 4.6") */
function shortModel(model?: string): string {
  if (!model) return '';
  const m = model.toLowerCase();
  if (m.includes('opus')) return `Opus ${m.match(/[\d.]+$/)?.[0] || ''}`.trim();
  if (m.includes('sonnet')) return `Sonnet ${m.match(/[\d.]+$/)?.[0] || ''}`.trim();
  if (m.includes('haiku')) return `Haiku ${m.match(/[\d.]+$/)?.[0] || ''}`.trim();
  if (m.includes('gemini')) return `Gemini ${m.replace(/.*gemini-?/, '').replace(/-/g, ' ')}`.trim();
  if (m.includes('gpt')) return m.replace('gpt-', 'GPT-').replace('-codex', ' Codex');
  return model;
}

export function TeamStatus({ agents, delegations }: Props) {
  return (
    <div className="flex-1 overflow-hidden flex flex-col min-h-0 border-t border-th-border">
      <div className="px-3 py-2 border-b border-th-border flex items-center gap-2 shrink-0">
        <Bot className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-semibold">Team</span>
        <span className="text-xs text-th-text-muted ml-auto">{agents.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {agents.length === 0 ? (
          <p className="text-xs text-th-text-muted text-center py-4 font-mono">
            No team members yet
          </p>
        ) : (
          agents.map((agent) => {
            const delegation = [...delegations].reverse().find((d) => d.toAgentId === agent.id);
            const Icon = STATUS_ICON[agent.status] || Bot;
            const colorClass = agentStatusText(agent.status);

            return (
              <div key={agent.id} className="bg-th-bg-alt border border-th-border rounded p-2">
                <div className="flex items-center gap-2">
                  <span className="text-base">{agent.role.icon}</span>
                  <span className="text-sm font-mono font-semibold text-th-text-alt truncate">
                    {agent.role.name} <span className="text-th-text-muted text-xs">({agent.id.slice(0, 8)})</span>
                  </span>
                  <Icon className={`w-3.5 h-3.5 ${colorClass} ml-auto shrink-0 ${agent.status === 'running' ? 'animate-spin' : ''}`} />
                </div>
                {delegation && (
                  <p className="text-xs font-mono text-th-text-muted mt-1 truncate" title={delegation.task}>
                    {delegation.task}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-xs font-mono ${colorClass}`}>{agent.status}</span>
                  {((agent.inputTokens ?? 0) > 0 || (agent.outputTokens ?? 0) > 0) && (
                    <span className="text-[10px] font-mono text-purple-400/70">{formatTokens((agent.inputTokens ?? 0) + (agent.outputTokens ?? 0))}</span>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    {(agent.model || agent.role.model) && (
                      <span className="text-[10px] font-mono text-th-text-muted bg-th-bg-muted/50 px-1 rounded" title={agent.model || agent.role.model}>
                        {shortModel(agent.model || agent.role.model)}
                      </span>
                    )}
                    <AgentIdBadge id={agent.id} />
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
