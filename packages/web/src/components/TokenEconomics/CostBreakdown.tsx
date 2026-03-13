import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../../stores/appStore';
import { formatTokens } from '../../utils/format';
import { shortAgentId } from '../../utils/agentLabel';
import { formatRelativeTime } from '../../utils/formatRelativeTime';
import type { AgentCostSummary, TaskCostSummary, AgentInfo } from '../../types';

// ── Helpers ──────────────────────────────────────────────────────────

function useAgentMap(): Map<string, AgentInfo> {
  const agents = useAppStore((s) => s.agents);
  return useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
}

// ── Component ────────────────────────────────────────────────────────

type CostView = 'by-agent' | 'by-task';

interface CostBreakdownProps {
  projectId?: string | null;
}

export function CostBreakdown({ projectId }: CostBreakdownProps = {}) {
  const [view, setView] = useState<CostView>('by-agent');
  const [agentCosts, setAgentCosts] = useState<AgentCostSummary[]>([]);
  const [taskCosts, setTaskCosts] = useState<TaskCostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const agentMap = useAgentMap();

  useEffect(() => {
    let cancelled = false;
    const params = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    const fetchCosts = async () => {
      try {
        const [agentRes, taskRes] = await Promise.all([
          fetch(`/api/costs/by-agent${params}`),
          fetch(`/api/costs/by-task${params}`),
        ]);
        if (cancelled) return;
        const agentData = await agentRes.json();
        const taskData = await taskRes.json();
        setAgentCosts(agentData);
        setTaskCosts(taskData);
      } catch {
        // silently ignore fetch errors
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchCosts();
    const interval = setInterval(fetchCosts, 10_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [projectId]);

  const totalInput = useMemo(
    () => agentCosts.reduce((s, c) => s + c.totalInputTokens, 0),
    [agentCosts],
  );
  const totalOutput = useMemo(
    () => agentCosts.reduce((s, c) => s + c.totalOutputTokens, 0),
    [agentCosts],
  );
  const total = totalInput + totalOutput;

  if (loading) {
    return <div className="p-4 text-sm text-th-text-muted">Loading token data…</div>;
  }

  if (agentCosts.length === 0 && taskCosts.length === 0) {
    return (
      <div className="p-4 text-sm text-th-text-muted">
        No token attribution data yet. Token usage is tracked when agents work on DAG tasks.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      {/* Summary bar */}
      <div className="flex items-center justify-between rounded-lg bg-th-bg-alt/60 px-4 py-2.5 border border-th-border/50">
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-blue-600 dark:text-blue-300">↑ {formatTokens(totalInput)} in</span>
          <span className="text-emerald-600 dark:text-emerald-300">↓ {formatTokens(totalOutput)} out</span>
          <span className="text-th-text-alt font-semibold">{formatTokens(total)} total</span>
        </div>
      </div>

      {/* View toggle */}
      <div className="flex gap-1">
        <button
          onClick={() => setView('by-agent')}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            view === 'by-agent'
              ? 'bg-blue-600 text-white'
              : 'bg-th-bg-alt text-th-text-muted hover:text-th-text-alt'
          }`}
        >
          By Agent
        </button>
        <button
          onClick={() => setView('by-task')}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            view === 'by-task'
              ? 'bg-blue-600 text-white'
              : 'bg-th-bg-alt text-th-text-muted hover:text-th-text-alt'
          }`}
        >
          By Task
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-th-border/50">
        {view === 'by-agent' ? (
          <AgentCostTable costs={agentCosts} agentMap={agentMap} total={total} />
        ) : (
          <TaskCostTable costs={taskCosts} agentMap={agentMap} total={total} />
        )}
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function AgentCostTable({
  costs,
  agentMap,
  total,
}: {
  costs: AgentCostSummary[];
  agentMap: Map<string, AgentInfo>;
  total: number;
}) {
  const sorted = useMemo(
    () =>
      [...costs].sort(
        (a, b) =>
          b.totalInputTokens + b.totalOutputTokens - (a.totalInputTokens + a.totalOutputTokens),
      ),
    [costs],
  );

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="bg-th-bg-alt/40 text-th-text-muted">
          <th className="px-3 py-2 text-left font-medium">Agent</th>
          <th className="px-3 py-2 text-right font-medium">Input</th>
          <th className="px-3 py-2 text-right font-medium">Output</th>
          <th className="px-3 py-2 text-right font-medium">Total</th>
          <th className="px-3 py-2 text-right font-medium">Tasks</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((cost) => {
          const agent = agentMap.get(cost.agentId);
          const agentTotal = cost.totalInputTokens + cost.totalOutputTokens;
          const share = total > 0 ? ((agentTotal / total) * 100).toFixed(0) : '0';
          return (
            <tr
              key={cost.agentId}
              className="border-t border-th-border/30 hover:bg-th-bg-alt/30"
            >
              <td className="px-3 py-2">
                <div className="flex items-center gap-1.5">
                  {agent && <span>{agent.role.icon}</span>}
                  <span className="text-th-text-alt font-medium">
                    {agent?.role.name ?? cost.agentRole ?? 'Unknown'}
                  </span>
                  <span className="text-th-text-muted font-mono">
                    ({shortAgentId(cost.agentId)})
                  </span>
                </div>
              </td>
              <td className="px-3 py-2 text-right font-mono text-blue-600 dark:text-blue-300">
                {formatTokens(cost.totalInputTokens)}
              </td>
              <td className="px-3 py-2 text-right font-mono text-emerald-600 dark:text-emerald-300">
                {formatTokens(cost.totalOutputTokens)}
              </td>
              <td className="px-3 py-2 text-right font-mono text-th-text-alt">
                {formatTokens(agentTotal)}
                <span className="ml-1 text-th-text-muted">({share}%)</span>
              </td>
              <td className="px-3 py-2 text-right font-mono text-th-text-muted">
                {cost.taskCount}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

type TaskSortField = 'task' | 'input' | 'output' | 'total' | 'completed';
type SortDir = 'asc' | 'desc';

function SortIndicator({ field, activeField, dir }: { field: TaskSortField; activeField: TaskSortField; dir: SortDir }) {
  if (field !== activeField) return <span className="text-th-text-muted/30 ml-0.5">↕</span>;
  return <span className="ml-0.5">{dir === 'asc' ? '↑' : '↓'}</span>;
}

function TaskCostTable({
  costs,
  agentMap,
  total,
}: {
  costs: TaskCostSummary[];
  agentMap: Map<string, AgentInfo>;
  total: number;
}) {
  const [sortField, setSortField] = useState<TaskSortField>('total');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (field: TaskSortField) => {
    if (field === sortField) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'task' ? 'asc' : 'desc');
    }
  };

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...costs].sort((a, b) => {
      switch (sortField) {
        case 'task':
          return dir * a.dagTaskId.localeCompare(b.dagTaskId);
        case 'input':
          return dir * (a.totalInputTokens - b.totalInputTokens);
        case 'output':
          return dir * (a.totalOutputTokens - b.totalOutputTokens);
        case 'total':
          return dir * ((a.totalInputTokens + a.totalOutputTokens) - (b.totalInputTokens + b.totalOutputTokens));
        case 'completed': {
          const ta = a.lastUpdatedAt ?? '';
          const tb = b.lastUpdatedAt ?? '';
          return dir * ta.localeCompare(tb);
        }
        default:
          return 0;
      }
    });
  }, [costs, sortField, sortDir]);

  const thClass = 'px-3 py-2 font-medium cursor-pointer select-none hover:text-th-text transition-colors';

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="bg-th-bg-alt/40 text-th-text-muted">
          <th className={`${thClass} text-left`} onClick={() => handleSort('task')}>
            Task<SortIndicator field="task" activeField={sortField} dir={sortDir} />
          </th>
          <th className={`${thClass} text-right`} onClick={() => handleSort('input')}>
            Input<SortIndicator field="input" activeField={sortField} dir={sortDir} />
          </th>
          <th className={`${thClass} text-right`} onClick={() => handleSort('output')}>
            Output<SortIndicator field="output" activeField={sortField} dir={sortDir} />
          </th>
          <th className={`${thClass} text-right`} onClick={() => handleSort('total')}>
            Total<SortIndicator field="total" activeField={sortField} dir={sortDir} />
          </th>
          <th className={`${thClass} text-right`} onClick={() => handleSort('completed')}>
            Updated<SortIndicator field="completed" activeField={sortField} dir={sortDir} />
          </th>
          <th className="px-3 py-2 text-left font-medium">Agents</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((cost) => {
          const taskTotal = cost.totalInputTokens + cost.totalOutputTokens;
          const share = total > 0 ? ((taskTotal / total) * 100).toFixed(0) : '0';
          return (
            <tr
              key={`${cost.leadId}:${cost.dagTaskId}`}
              className="border-t border-th-border/30 hover:bg-th-bg-alt/30"
            >
              <td className="px-3 py-2">
                <span className="text-th-text-alt font-medium font-mono">
                  {cost.dagTaskId}
                </span>
              </td>
              <td className="px-3 py-2 text-right font-mono text-blue-600 dark:text-blue-300">
                {formatTokens(cost.totalInputTokens)}
              </td>
              <td className="px-3 py-2 text-right font-mono text-emerald-600 dark:text-emerald-300">
                {formatTokens(cost.totalOutputTokens)}
              </td>
              <td className="px-3 py-2 text-right font-mono text-th-text-alt">
                {formatTokens(taskTotal)}
                <span className="ml-1 text-th-text-muted">({share}%)</span>
              </td>
              <td className="px-3 py-2 text-right text-th-text-muted">
                {cost.lastUpdatedAt
                  ? (() => {
                      const d = new Date(cost.lastUpdatedAt.endsWith('Z') ? cost.lastUpdatedAt : cost.lastUpdatedAt.replace(' ', 'T') + 'Z');
                      return (
                        <span title={formatRelativeTime(cost.lastUpdatedAt)}>
                          {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      );
                    })()
                  : '—'}
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {cost.agents.map((a) => {
                    const agent = agentMap.get(a.agentId);
                    return (
                      <span
                        key={a.agentId}
                        className="inline-flex items-center gap-0.5 rounded bg-th-bg-alt px-1.5 py-0.5 text-th-text-muted"
                        title={`${agent?.role.name ?? a.agentRole ?? shortAgentId(a.agentId)}: ${formatTokens(a.inputTokens)} in / ${formatTokens(a.outputTokens)} out`}
                      >
                        {agent?.role.icon ?? '🤖'}
                        <span className="font-mono">{shortAgentId(a.agentId)}</span>
                      </span>
                    );
                  })}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
