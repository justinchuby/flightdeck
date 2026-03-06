import { useMemo } from 'react';
import { useAppStore } from '../../stores/appStore';
import type { AgentInfo } from '../../types';

function contextPercent(agent: AgentInfo): number {
  if (!agent.contextWindowSize || !agent.contextWindowUsed) return 0;
  return Math.min(100, (agent.contextWindowUsed / agent.contextWindowSize) * 100);
}

/**
 * Compact horizontal status bar for mobile.
 * Shows running/idle/failed agent counts, pending decisions,
 * token usage, and max context pressure. Hidden on desktop.
 */
export function MobilePulse() {
  const agents = useAppStore(s => s.agents);
  const pendingCount = useAppStore(s => s.pendingDecisions.length);

  const stats = useMemo(() => {
    let totalInput = 0;
    let totalOutput = 0;
    let running = 0;
    let idle = 0;
    let failed = 0;
    let maxPressure = 0;

    for (const a of agents) {
      totalInput += a.inputTokens || 0;
      totalOutput += a.outputTokens || 0;
      if (a.status === 'running') running++;
      else if (a.status === 'idle') idle++;
      else if (a.status === 'failed') failed++;
      const pct = contextPercent(a);
      if (pct > maxPressure) maxPressure = pct;
    }

    return {
      totalTokens: totalInput + totalOutput,
      running,
      idle,
      failed,
      maxPressure: Math.round(maxPressure),
      pendingCount,
    };
  }, [agents, pendingCount]);

  if (agents.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 overflow-x-auto text-[11px] bg-th-bg-alt/40 border-b border-th-border md:hidden">
      <span className="flex items-center gap-1 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
        {stats.running}●
        {stats.idle > 0 && (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
            {stats.idle}○
          </>
        )}
      </span>
      {stats.failed > 0 && (
        <span className="text-red-400 shrink-0">⚠{stats.failed}</span>
      )}
      <span className="w-px h-3 bg-th-border/50" />
      {stats.pendingCount > 0 && (
        <span className="text-accent shrink-0">{stats.pendingCount} pend</span>
      )}
      {stats.totalTokens > 0 ? (
        <span className="text-th-text-muted shrink-0">—</span>
      ) : (
        <span className="text-th-text-muted shrink-0">—</span>
      )}
      <span className="w-px h-3 bg-th-border/50" />
      <span
        className={`shrink-0 ${
          stats.maxPressure >= 90
            ? 'text-red-400'
            : stats.maxPressure >= 70
              ? 'text-yellow-400'
              : 'text-th-text-muted'
        }`}
      >
        {stats.maxPressure}%
      </span>
    </div>
  );
}
