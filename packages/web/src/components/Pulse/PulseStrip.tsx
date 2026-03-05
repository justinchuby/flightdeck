import { useMemo } from 'react';
import { DollarSign, Users, AlertCircle, Brain } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type { AgentInfo } from '../../types';

// ── Pricing (approximate per-token costs in USD) ─────────────────────

const INPUT_COST_PER_TOKEN = 0.000003; // $3 per 1M input tokens (blended avg)
const OUTPUT_COST_PER_TOKEN = 0.000015; // $15 per 1M output tokens (blended avg)

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return inputTokens * INPUT_COST_PER_TOKEN + outputTokens * OUTPUT_COST_PER_TOKEN;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return '<$0.01';
  if (usd < 1) return `$${usd.toFixed(2)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(0)}`;
}

function formatTokensCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

// ── Token pressure helpers ───────────────────────────────────────────

function contextPercent(agent: AgentInfo): number {
  if (!agent.contextWindowSize || !agent.contextWindowUsed) return 0;
  return Math.min(100, (agent.contextWindowUsed / agent.contextWindowSize) * 100);
}

function pressureBarColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 70) return 'bg-yellow-500';
  return 'bg-emerald-500';
}

function pressureDotColor(pct: number): string {
  if (pct >= 90) return 'bg-red-400';
  if (pct >= 70) return 'bg-yellow-400';
  return 'bg-emerald-400';
}

// ── Component ────────────────────────────────────────────────────────

export function PulseStrip() {
  const agents = useAppStore((s) => s.agents);
  const pendingDecisionCount = useAppStore((s) => s.pendingDecisions.length);
  const openApprovalQueue = useAppStore((s) => s.setApprovalQueueOpen);

  const stats = useMemo(() => {
    let totalInput = 0;
    let totalOutput = 0;
    let running = 0;
    let idle = 0;
    let failed = 0;
    let stuck = 0;

    for (const agent of agents) {
      totalInput += agent.inputTokens ?? 0;
      totalOutput += agent.outputTokens ?? 0;
      switch (agent.status) {
        case 'running':
        case 'creating':
          running++;
          break;
        case 'idle':
          idle++;
          break;
        case 'failed':
          failed++;
          break;
        case 'completed':
          break;
        default:
          break;
      }
    }

    const cost = estimateCostUsd(totalInput, totalOutput);
    const totalTokens = totalInput + totalOutput;

    // Pending decisions: from appStore (tracked via WebSocket events)
    // Also count agents with pendingPermission as a fallback
    const permissionCount = agents.filter((a) => a.pendingPermission).length;

    // Token pressure: agents with context data, sorted by pressure descending
    const agentsWithContext = agents
      .filter((a) => a.contextWindowSize && a.contextWindowSize > 0 && a.status !== 'completed')
      .map((a) => ({
        id: a.id,
        roleIcon: a.role.icon,
        roleName: a.role.name,
        pct: contextPercent(a),
      }))
      .sort((a, b) => b.pct - a.pct);

    const maxPressure = agentsWithContext.length > 0 ? agentsWithContext[0].pct : 0;

    return {
      totalInput,
      totalOutput,
      totalTokens,
      cost,
      running,
      idle,
      failed,
      stuck,
      permissionCount,
      agentsWithContext,
      maxPressure,
      agentCount: agents.length,
    };
  }, [agents]);

  // Combine appStore pending decisions + permission requests for total count
  const totalPending = pendingDecisionCount + (stats.permissionCount ?? 0);

  // Don't render if no agents are active
  if (stats.agentCount === 0) return null;

  return (
    <div className="h-10 border-b border-th-border bg-th-bg-alt/40 flex items-center px-4 gap-6 text-xs shrink-0 overflow-x-auto">
      {/* Session Cost */}
      <div className="flex items-center gap-1.5 text-th-text-muted" title={`${formatTokensCompact(stats.totalTokens)} tokens total (${formatTokensCompact(stats.totalInput)} in / ${formatTokensCompact(stats.totalOutput)} out)`}>
        <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
        <span className="font-mono font-medium text-th-text-alt">{formatCost(stats.cost)}</span>
        <span className="text-th-text-muted hidden sm:inline">({formatTokensCompact(stats.totalTokens)})</span>
      </div>

      {/* Separator */}
      <div className="w-px h-4 bg-th-border/50" />

      {/* Agent Status Breakdown */}
      <div className="flex items-center gap-1.5" title={`${stats.agentCount} agents: ${stats.running} running, ${stats.idle} idle, ${stats.failed} failed`}>
        <Users className="w-3.5 h-3.5 text-blue-400" />
        <div className="flex items-center gap-2 font-mono">
          {stats.running > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-green-400">{stats.running}</span>
            </span>
          )}
          {stats.idle > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
              <span className="text-yellow-400">{stats.idle}</span>
            </span>
          )}
          {stats.failed > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              <span className="text-red-400">{stats.failed}</span>
            </span>
          )}
        </div>
      </div>

      {/* Separator */}
      <div className="w-px h-4 bg-th-border/50" />

      {/* Pending Decisions — click opens Approval Queue */}
      <button
        onClick={() => openApprovalQueue(true)}
        className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md transition-colors ${
          totalPending > 0
            ? 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 cursor-pointer'
            : 'text-th-text-muted hover:text-th-text-alt cursor-pointer'
        }`}
        title={totalPending > 0 ? `${totalPending} decisions awaiting approval — click to review` : 'No pending decisions — click to open approval queue'}
      >
        <AlertCircle className="w-3.5 h-3.5" />
        <span className="font-mono font-medium">{totalPending}</span>
        <span className="hidden sm:inline">pending</span>
        {totalPending > 0 && (
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        )}
      </button>

      {/* Separator */}
      <div className="w-px h-4 bg-th-border/50" />

      {/* Token Pressure Mini-Indicators */}
      <div className="flex items-center gap-1.5">
        <Brain className={`w-3.5 h-3.5 ${stats.maxPressure >= 80 ? 'text-red-400' : stats.maxPressure >= 60 ? 'text-yellow-400' : 'text-th-text-muted'}`} />
        {stats.agentsWithContext.length > 0 ? (
          <div className="flex items-center gap-1" title="Token pressure per agent (sorted by pressure)">
            {stats.agentsWithContext.slice(0, 8).map((a) => (
              <div
                key={a.id}
                className="flex flex-col items-center gap-0.5"
                title={`${a.roleName}: ${a.pct.toFixed(0)}% context used`}
              >
                <div className="w-4 h-1.5 rounded-full bg-th-bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full ${pressureBarColor(a.pct)}`}
                    style={{ width: `${Math.max(a.pct, 2)}%` }}
                  />
                </div>
              </div>
            ))}
            {stats.agentsWithContext.length > 8 && (
              <span className="text-th-text-muted text-[10px]">+{stats.agentsWithContext.length - 8}</span>
            )}
          </div>
        ) : (
          <span className="text-th-text-muted">—</span>
        )}
      </div>
    </div>
  );
}
