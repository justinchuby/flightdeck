/**
 * TokenUsageSection — Shows token usage at project, session, and agent levels.
 *
 * Uses /api/costs/by-project for totals (server-side aggregation).
 * Agent/task breakdown fetched separately, filtered at render time.
 * Works even when sessions are not active — reads from persisted DB data.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../../stores/appStore';
import { formatTokens } from '../../utils/format';
import { shortAgentId } from '../../utils/agentLabel';
import type { ProjectCostSummary, AgentCostSummary, TaskCostSummary, AgentInfo } from '../../types';
import { Coins, ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  projectId: string;
}

export function TokenUsageSection({ projectId }: Props) {
  const [projectCost, setProjectCost] = useState<ProjectCostSummary | null>(null);
  const [agentCosts, setAgentCosts] = useState<AgentCostSummary[]>([]);
  const [taskCosts, setTaskCosts] = useState<TaskCostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const agents = useAppStore((s) => s.agents);

  const agentMap = useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents],
  );

  // Stable set for render-time filtering — no effect dependency
  const projectAgentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const a of agents) {
      if (a.projectId === projectId) ids.add(a.id);
    }
    return ids;
  }, [agents, projectId]);

  // Effect depends only on projectId (stable string prop)
  useEffect(() => {
    const controller = new AbortController();
    const fetchCosts = async () => {
      try {
        const [projRes, agentRes, taskRes] = await Promise.all([
          fetch('/api/costs/by-project', { signal: controller.signal }),
          fetch('/api/costs/by-agent', { signal: controller.signal }),
          fetch('/api/costs/by-task', { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        const allProjects: ProjectCostSummary[] = await projRes.json();
        setProjectCost(allProjects.find(c => c.projectId === projectId) ?? null);
        setAgentCosts(await agentRes.json());
        setTaskCosts(await taskRes.json());
      } catch (err) {
        if (!controller.signal.aborted) {
          console.warn('[TokenUsage] Failed to fetch costs:', err);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    fetchCosts();
    const interval = setInterval(fetchCosts, 15_000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [projectId]);

  // Filter to this project's agents at render time (not in effect)
  const filteredAgentCosts = useMemo(
    () => agentCosts.filter(c => projectAgentIds.has(c.agentId)),
    [agentCosts, projectAgentIds],
  );
  const filteredTaskCosts = useMemo(
    () => taskCosts.filter(c => c.agents.some(a => projectAgentIds.has(a.agentId))),
    [taskCosts, projectAgentIds],
  );

  // Use server-side totals from by-project endpoint
  const totalInput = projectCost?.totalInputTokens ?? 0;
  const totalOutput = projectCost?.totalOutputTokens ?? 0;
  const totalTokens = totalInput + totalOutput;

  if (loading) {
    return (
      <section className="rounded-xl bg-th-bg-panel border border-th-border/50 p-4">
        <div className="text-xs text-th-text-muted">Loading token usage…</div>
      </section>
    );
  }

  if (totalTokens === 0) {
    return (
      <section className="rounded-xl bg-th-bg-panel border border-th-border/50 p-4">
        <div className="flex items-center gap-2 text-th-text-muted text-xs">
          <Coins className="w-3.5 h-3.5" />
          <span>No token usage recorded yet</span>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl bg-th-bg-panel border border-th-border/50">
      {/* Summary header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-th-bg-alt/30 rounded-xl transition-colors"
      >
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-blue-500">↓{formatTokens(totalInput)}</span>
          <span className="text-emerald-500">↑{formatTokens(totalOutput)}</span>
          <span className="font-semibold text-th-text-alt">{formatTokens(totalTokens)}</span>
          <span className="text-th-text-muted">
            · {projectCost?.agentCount ?? 0} agent{(projectCost?.agentCount ?? 0) !== 1 ? 's' : ''}
          </span>
        </div>
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 text-th-text-muted" />
          : <ChevronRight className="w-3.5 h-3.5 text-th-text-muted" />}
      </button>

      {/* Expanded breakdown */}
      {expanded && (
        <div className="border-t border-th-border/30 px-4 py-3 space-y-3">
          {/* Per-agent breakdown */}
          <AgentBreakdown costs={filteredAgentCosts} agentMap={agentMap} total={totalTokens} />

          {/* Per-task breakdown (collapsed by default) */}
          {filteredTaskCosts.length > 0 && (
            <TaskBreakdown costs={filteredTaskCosts} agentMap={agentMap} total={totalTokens} />
          )}
        </div>
      )}
    </section>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function AgentBreakdown({
  costs,
  agentMap,
  total,
}: {
  costs: AgentCostSummary[];
  agentMap: Map<string, AgentInfo>;
  total: number;
}) {
  const sorted = useMemo(
    () => [...costs].sort((a, b) =>
      (b.totalInputTokens + b.totalOutputTokens) - (a.totalInputTokens + a.totalOutputTokens)
    ),
    [costs],
  );

  return (
    <div>
      <h4 className="text-[10px] uppercase tracking-wider text-th-text-muted mb-1.5">By Agent</h4>
      <div className="space-y-1">
        {sorted.map((cost) => {
          const agent = agentMap.get(cost.agentId);
          const roleName = agent?.role.name
            ?? (cost.agentRole ? cost.agentRole.charAt(0).toUpperCase() + cost.agentRole.slice(1) : undefined)
            ?? shortAgentId(cost.agentId);
          const roleIcon = agent?.role.icon ?? '🤖';
          const agentTotal = cost.totalInputTokens + cost.totalOutputTokens;
          const pct = total > 0 ? (agentTotal / total) * 100 : 0;
          return (
            <div key={cost.agentId} className="flex items-center gap-1.5 text-xs">
              <span className="w-4 text-center shrink-0">{roleIcon}</span>
              <span className="text-th-text-alt w-16 truncate shrink-0" title={`${roleName} (${shortAgentId(cost.agentId)})`}>
                {roleName}
              </span>
              <div className="flex-1 min-w-0 h-1.5 bg-th-bg-alt rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500/60 rounded-full transition-all"
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
              <span className="font-mono text-th-text-muted w-12 text-right shrink-0 text-[11px]">
                {formatTokens(agentTotal)}
              </span>
              <span className="font-mono text-th-text-muted w-7 text-right shrink-0 text-[10px]">
                {pct.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskBreakdown({
  costs,
  agentMap,
  total,
}: {
  costs: TaskCostSummary[];
  agentMap: Map<string, AgentInfo>;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const sorted = useMemo(
    () => [...costs].sort((a, b) =>
      (b.totalInputTokens + b.totalOutputTokens) - (a.totalInputTokens + a.totalOutputTokens)
    ),
    [costs],
  );

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-th-text-muted hover:text-th-text-alt transition-colors"
      >
        {open ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
        By Task ({costs.length})
      </button>
      {open && (
        <div className="mt-1.5 space-y-1">
          {sorted.map((cost) => {
            const taskTotal = cost.totalInputTokens + cost.totalOutputTokens;
            const pct = total > 0 ? (taskTotal / total) * 100 : 0;
            return (
              <div key={`${cost.leadId}:${cost.dagTaskId}`} className="flex items-center gap-1.5 text-xs">
                <span className="text-th-text-muted font-mono w-20 truncate shrink-0 text-[10px]" title={cost.dagTaskId}>
                  {cost.dagTaskId}
                </span>
                <div className="flex-1 min-w-0 h-1.5 bg-th-bg-alt rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500/60 rounded-full transition-all"
                    style={{ width: `${Math.max(pct, 1)}%` }}
                  />
                </div>
                <span className="font-mono text-th-text-muted w-12 text-right shrink-0 text-[11px]">
                  {formatTokens(taskTotal)}
                </span>
                <div className="flex gap-0.5 shrink-0">
                  {cost.agents.slice(0, 3).map((a) => {
                    const agent = agentMap.get(a.agentId);
                    return (
                      <span key={a.agentId} title={agent?.role.name ?? shortAgentId(a.agentId)}>
                        {agent?.role.icon ?? '🤖'}
                      </span>
                    );
                  })}
                  {cost.agents.length > 3 && (
                    <span className="text-th-text-muted text-[10px]">+{cost.agents.length - 3}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
