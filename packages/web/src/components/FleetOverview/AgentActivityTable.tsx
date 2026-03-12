import { useState, useMemo } from 'react';
import { useAppStore } from '../../stores/appStore';
import type { AgentInfo } from '../../types';
import type { FileLock } from './FleetOverview';
import { Square, RefreshCw, Terminal, Zap, Check, Play } from 'lucide-react';
import { EmptyState } from '../Shared';
import { formatTokens } from '../../utils/format';
import { AVAILABLE_MODELS } from '../../constants/models';
import { getProviderColors } from '../../utils/providerColors';

function shortModelName(model?: string): string {
  if (!model) return '';
  const m = model.toLowerCase();
  if (m.includes('opus')) return `Opus ${m.match(/[\d.]+$/)?.[0] || ''}`.trim();
  if (m.includes('sonnet')) return `Sonnet ${m.match(/[\d.]+$/)?.[0] || ''}`.trim();
  if (m.includes('haiku')) return `Haiku ${m.match(/[\d.]+$/)?.[0] || ''}`.trim();
  if (m.includes('gemini')) return `Gemini`;
  if (m.includes('gpt')) return m.replace('gpt-', 'GPT-').replace('-codex', ' Codex');
  return model;
}

/** Flatten agents into a depth-first hierarchy. Parents first, children indented below. */
function flattenHierarchy(agents: AgentInfo[]): { agent: AgentInfo; depth: number; isLastChild: boolean }[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const childrenOf = new Map<string | undefined, AgentInfo[]>();
  for (const a of agents) {
    const parentKey = a.parentId && byId.has(a.parentId) ? a.parentId : undefined;
    const siblings = childrenOf.get(parentKey) ?? [];
    siblings.push(a);
    childrenOf.set(parentKey, siblings);
  }

  const result: { agent: AgentInfo; depth: number; isLastChild: boolean }[] = [];

  function walk(parentId: string | undefined, depth: number) {
    const children = childrenOf.get(parentId) ?? [];
    children.forEach((child, idx) => {
      result.push({ agent: child, depth, isLastChild: idx === children.length - 1 });
      walk(child.id, depth + 1);
    });
  }

  walk(undefined, 0);
  return result;
}

interface Props {
  agents: AgentInfo[];
  locks: FileLock[];
  api: any;
  ws: any;
  onSelectAgent?: (id: string) => void;
}

const STATUS_DOT: Record<string, string> = {
  creating: 'bg-yellow-400',
  running: 'bg-green-400 animate-pulse',
  idle: 'bg-blue-400',
  completed: 'bg-gray-400',
  failed: 'bg-red-400',
  terminated: 'bg-orange-400',
};

function elapsed(createdAt: string): string {
  const diff = Date.now() - new Date(createdAt).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function getCurrentActivity(agent: AgentInfo): { text: string; detail?: string } {
  // Active tool call
  if (agent.toolCalls?.length) {
    const active = agent.toolCalls.filter(
      (tc) => tc.status === 'in_progress' || tc.status === 'pending',
    );
    if (active.length > 0) {
      const latest = active[active.length - 1];
      const title = typeof latest.title === 'string' ? latest.title : (latest.title as any)?.text ?? JSON.stringify(latest.title);
      return { text: `🔧 ${title}`, detail: typeof latest.kind === 'string' ? latest.kind : JSON.stringify(latest.kind) };
    }
    const last = agent.toolCalls[agent.toolCalls.length - 1];
    const lastTitle = typeof last.title === 'string' ? last.title : (last.title as any)?.text ?? JSON.stringify(last.title);
    return { text: `✅ ${lastTitle}`, detail: 'completed' };
  }

  // Plan progress
  if (agent.plan?.length) {
    const inProgress = agent.plan.find((p) => p.status === 'in_progress');
    if (inProgress) {
      return { text: `📋 ${inProgress.content}` };
    }
    const pending = agent.plan.find((p) => p.status === 'pending');
    if (pending) {
      return { text: `⏳ ${pending.content}` };
    }
    return { text: '📋 Plan complete' };
  }

  // Output preview fallback
  if (agent.outputPreview) {
    const lastLine = agent.outputPreview.trim().split('\n').pop() ?? '';
    return { text: lastLine.slice(0, 80) || 'Working...' };
  }

  if (agent.status === 'creating') return { text: 'Starting up...' };
  if (agent.status === 'completed') return { text: 'Finished' };
  if (agent.status === 'failed') return { text: 'Crashed' };
  if (agent.status === 'terminated') return { text: 'Terminated' };
  return { text: 'Idle' };
}

export function AgentActivityTable({ agents, locks, api, onSelectAgent }: Props) {
  const setSelectedAgent = useAppStore((s) => s.setSelectedAgent);
  const [confirmTerminateIds, setConfirmTerminateIds] = useState<Set<string>>(new Set());

  const handleSelect = (id: string) => {
    if (onSelectAgent) onSelectAgent(id);
    else setSelectedAgent(id);
  };

  const hierarchicalAgents = useMemo(() => flattenHierarchy(agents), [agents]);

  if (agents.length === 0) {
    return (
      <div className="border border-th-border rounded-lg bg-surface-raised p-8">
        <EmptyState icon="👥" title="No agents to display" compact />
      </div>
    );
  }

  return (
    <div className="border border-th-border rounded-lg bg-surface-raised overflow-hidden">
      <table className="w-full text-sm table-fixed">
        <thead>
          <tr className="border-b border-th-border text-th-text-muted text-xs uppercase tracking-wider">
            <th className="text-left px-3 py-2 w-[14%]">Agent</th>
            <th className="text-left px-3 py-2 w-[7%]">Status</th>
            <th className="text-left px-3 py-2 hidden md:table-cell w-[12%]">Provider / Model</th>
            <th className="text-left px-3 py-2 hidden md:table-cell w-[14%]">Task</th>
            <th className="text-left px-3 py-2 w-[16%]">Current Activity</th>
            <th className="text-left px-3 py-2 hidden lg:table-cell w-[8%]">Progress</th>
            <th className="text-left px-3 py-2 hidden xl:table-cell w-[10%]">Tokens</th>
            <th className="text-left px-3 py-2 hidden lg:table-cell w-[9%]">Locks</th>
            <th className="text-left px-3 py-2 hidden sm:table-cell w-[5%]">Uptime</th>
            <th className="text-right px-3 py-2 w-[5%]">Actions</th>
          </tr>
        </thead>
        <tbody>
          {hierarchicalAgents.map(({ agent, depth, isLastChild }) => {
            const activity = getCurrentActivity(agent);
            const agentLocks = locks.filter((l) => l.agentId === agent.id);
            const planTotal = agent.plan?.length ?? 0;
            const planDone = agent.plan?.filter((p) => p.status === 'completed').length ?? 0;
            const isActive = agent.status === 'running' || agent.status === 'idle';
            const currentModel = agent.model || '';

            return (
              <tr
                key={agent.id}
                className="border-b border-th-border/50 hover:bg-surface/50 transition-colors"
              >
                {/* Agent identity — clickable name to open chat panel */}
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 24}px` }}>
                    {depth > 0 && (
                      <span className="text-th-text-muted text-xs font-mono select-none shrink-0">
                        {isLastChild ? '└─' : '├─'}
                      </span>
                    )}
                    <span className="text-base shrink-0">{agent.role.icon}</span>
                    <div className="min-w-0">
                      <button
                        onClick={() => handleSelect(agent.id)}
                        className="font-medium text-th-text-alt text-xs hover:text-accent transition-colors text-left truncate block"
                        title={`${agent.role.name} (${agent.id.slice(0, 8)}) — click to open chat`}
                      >
                        {agent.role.name} <span className="text-th-text-muted font-mono">({agent.id.slice(0, 8)})</span>
                      </button>
                      <div className="text-[10px] text-th-text-muted font-mono flex items-center gap-1 flex-wrap">
                        {agent.childIds.length > 0 && (
                          <span className="text-[10px] px-1 py-px rounded bg-blue-500/15 text-blue-400 font-sans">
                            {agent.childIds.length} sub-agent{agent.childIds.length > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </td>

                {/* Status */}
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${STATUS_DOT[agent.status] ?? 'bg-gray-400'}`} />
                    <span className="text-xs text-th-text-alt capitalize">{agent.status}</span>
                  </div>
                  {agent.status === 'failed' && agent.exitError && (
                    <div className="text-[10px] text-red-400 mt-0.5 truncate max-w-[140px]" title={agent.exitError}>
                      {agent.exitError}
                    </div>
                  )}
                </td>

                {/* Provider + Model */}
                <td className="px-3 py-2.5 hidden md:table-cell">
                  <div className="flex items-center gap-1 flex-wrap">
                    {agent.provider && (() => {
                      const pc = getProviderColors(agent.provider);
                      return (
                        <span className={`text-[9px] shrink-0 px-1 py-px rounded-sm font-medium ${pc.bg} ${pc.text}`}>
                          {agent.provider}
                        </span>
                      );
                    })()}
                    {isActive ? (
                      <select
                        value={currentModel}
                        onChange={(e) => {
                          e.stopPropagation();
                          api.updateAgent(agent.id, { model: e.target.value });
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[10px] bg-th-bg-alt border border-th-border text-th-text-alt rounded px-1 py-0.5 focus:outline-none focus:border-accent cursor-pointer max-w-[120px]"
                      >
                        {(() => {
                          const options = AVAILABLE_MODELS.includes(currentModel)
                            ? AVAILABLE_MODELS
                            : [currentModel, ...AVAILABLE_MODELS];
                          return options.map((m) => (
                            <option key={m} value={m}>{shortModelName(m) || m}</option>
                          ));
                        })()}
                      </select>
                    ) : (
                      <span className="text-[10px] text-th-text-muted">
                        {currentModel ? shortModelName(currentModel) : '—'}
                      </span>
                    )}
                  </div>
                </td>

                {/* Task */}
                <td className="px-3 py-2.5 hidden md:table-cell overflow-hidden">
                  {agent.task ? (
                    <div>
                      <div className="text-xs text-th-text-alt truncate" title={agent.task}>
                        {agent.task}
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-th-text-muted">—</span>
                  )}
                </td>

                {/* Current Activity */}
                <td className="px-3 py-2.5 overflow-hidden">
                  <div>
                    <div className="text-xs text-th-text-alt truncate" title={activity.text}>
                      {activity.text}
                    </div>
                    {activity.detail && (
                      <div className="text-[10px] text-th-text-muted">{activity.detail}</div>
                    )}
                  </div>
                </td>

                {/* Progress */}
                <td className="px-3 py-2.5 hidden lg:table-cell">
                  {planTotal > 0 ? (
                    <div className="flex items-center gap-2 min-w-[100px]">
                      <div className="flex-1 bg-th-bg-muted rounded-full h-1.5">
                        <div
                          className="bg-green-500 h-1.5 rounded-full transition-all"
                          style={{ width: `${(planDone / planTotal) * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-th-text-muted whitespace-nowrap">
                        {planDone}/{planTotal}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-th-text-muted">—</span>
                  )}
                </td>

                {/* Tokens */}
                <td className="px-3 py-2.5 hidden xl:table-cell">
                  {(agent.inputTokens || agent.outputTokens) ? (
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 text-[10px] text-th-text-muted">
                        <span title="Input tokens">↓{formatTokens(agent.inputTokens)}</span>
                        <span title="Output tokens">↑{formatTokens(agent.outputTokens)}</span>
                      </div>
                      {(agent.cacheReadTokens != null && agent.cacheReadTokens > 0) && (
                        <div className="text-[10px] text-green-500/70" title="Cache read tokens">⚡{formatTokens(agent.cacheReadTokens)}</div>
                      )}
                      {agent.contextWindowSize && agent.contextWindowUsed ? (() => {
                        const pct = Math.min(100, Math.round((agent.contextWindowUsed / agent.contextWindowSize) * 100));
                        const color = pct > 85 ? 'bg-red-500' : pct > 60 ? 'bg-yellow-500' : 'bg-blue-500';
                        return (
                          <div className="flex items-center gap-1">
                            <div className="flex-1 bg-th-bg-muted rounded-full h-1 max-w-[60px]">
                              <div className={`${color} h-1 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-[9px] text-th-text-muted">{pct}%</span>
                          </div>
                        );
                      })() : null}
                    </div>
                  ) : (
                    <span className="text-xs text-th-text-muted">—</span>
                  )}
                </td>

                {/* Locks */}
                <td className="px-3 py-2.5 hidden lg:table-cell">
                  {agentLocks.length > 0 ? (
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-purple-400">🔒 {agentLocks.length}</span>
                      {agentLocks.map((l) => (
                        <div
                          key={l.filePath}
                          className="text-[10px] text-th-text-muted font-mono truncate"
                          title={l.filePath}
                        >
                          {l.filePath.split('/').pop()}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-th-text-muted">—</span>
                  )}
                </td>

                {/* Uptime */}
                <td className="px-3 py-2.5 hidden sm:table-cell">
                  <span className="text-xs text-th-text-muted font-mono">{elapsed(agent.createdAt)}</span>
                </td>

                {/* Actions */}
                <td className="px-3 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelect(agent.id);
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
                    {isActive && (
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
                    {isActive && (
                      confirmTerminateIds.has(agent.id) ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            api.terminateAgent(agent.id);
                            setConfirmTerminateIds((s) => { const n = new Set(s); n.delete(agent.id); return n; });
                          }}
                          onBlur={() => setConfirmTerminateIds((s) => { const n = new Set(s); n.delete(agent.id); return n; })}
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
                            setConfirmTerminateIds((s) => new Set(s).add(agent.id));
                          }}
                          className="p-1 text-th-text-muted hover:text-red-400"
                          title="Stop agent"
                        >
                          <Square size={14} />
                        </button>
                      )
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
