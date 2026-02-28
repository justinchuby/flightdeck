import { useMemo } from 'react';
import { useAppStore } from '../../stores/appStore';
import type { AgentInfo } from '../../types';

// ── Helpers ──────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function contextPercent(agent: AgentInfo): number {
  if (!agent.contextWindowSize || !agent.contextWindowUsed) return 0;
  return Math.min(100, (agent.contextWindowUsed / agent.contextWindowSize) * 100);
}

function pressureColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 80) return 'bg-yellow-500';
  return 'bg-blue-500';
}

function pressureTextColor(pct: number): string {
  if (pct >= 90) return 'text-red-400';
  if (pct >= 80) return 'text-yellow-400';
  return 'text-gray-400';
}

// ── Component ────────────────────────────────────────────────────────

export function TokenEconomics() {
  const agents = useAppStore((s) => s.agents);

  const { sorted, totalIn, totalOut } = useMemo(() => {
    const withTokens = agents.filter(
      (a) => (a.inputTokens ?? 0) > 0 || (a.outputTokens ?? 0) > 0,
    );
    const s = [...withTokens].sort(
      (a, b) =>
        ((b.inputTokens ?? 0) + (b.outputTokens ?? 0)) -
        ((a.inputTokens ?? 0) + (a.outputTokens ?? 0)),
    );
    const tIn = agents.reduce((sum, a) => sum + (a.inputTokens ?? 0), 0);
    const tOut = agents.reduce((sum, a) => sum + (a.outputTokens ?? 0), 0);
    return { sorted: s, totalIn: tIn, totalOut: tOut };
  }, [agents]);

  const total = totalIn + totalOut;

  if (sorted.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-500">
        No token usage data yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      {/* Summary bar */}
      <div className="flex items-center justify-between rounded-lg bg-gray-800/60 px-4 py-2.5 border border-gray-700/50">
        <div className="flex items-center gap-2">
          <span className="text-base">📊</span>
          <span className="font-medium text-gray-200">Token Usage</span>
        </div>
        <div className="flex items-center gap-4 font-mono text-xs">
          <span className="text-blue-300">↑ {formatTokens(totalIn)} in</span>
          <span className="text-emerald-300">↓ {formatTokens(totalOut)} out</span>
          <span className="text-gray-300 font-semibold">{formatTokens(total)} total</span>
        </div>
      </div>

      {/* Per-agent table */}
      <div className="overflow-x-auto rounded-lg border border-gray-700/50">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-800/40 text-gray-400">
              <th className="px-3 py-2 text-left font-medium">Agent</th>
              <th className="px-3 py-2 text-left font-medium">Model</th>
              <th className="px-3 py-2 text-right font-medium">Input</th>
              <th className="px-3 py-2 text-right font-medium">Output</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 text-left font-medium w-36">Context</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((agent) => {
              const inT = agent.inputTokens ?? 0;
              const outT = agent.outputTokens ?? 0;
              const pct = contextPercent(agent);
              const totalAgent = inT + outT;
              const shareOfTotal = total > 0 ? ((totalAgent / total) * 100).toFixed(0) : '0';

              return (
                <tr
                  key={agent.id}
                  className="border-t border-gray-700/30 hover:bg-gray-800/30"
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span>{agent.role.icon}</span>
                      <span className="text-gray-200 font-medium">{agent.role.name}</span>
                      <span className="text-gray-500 font-mono">({agent.id.slice(0, 8)})</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-gray-400 font-mono">
                    {agent.model || agent.role.model || '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-blue-300">
                    {formatTokens(inT)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-300">
                    {formatTokens(outT)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-200">
                    {formatTokens(totalAgent)}
                    <span className="ml-1 text-gray-500">({shareOfTotal}%)</span>
                  </td>
                  <td className="px-3 py-2">
                    {agent.contextWindowSize ? (
                      <div className="flex items-center gap-2">
                        {/* Pressure bar */}
                        <div className="flex-1 h-1.5 rounded-full bg-gray-700 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${pressureColor(pct)}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className={`font-mono w-10 text-right ${pressureTextColor(pct)}`}>
                          {pct.toFixed(0)}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pressure warnings */}
      {sorted.some((a) => contextPercent(a) >= 80) && (
        <div className="flex flex-col gap-1 text-xs">
          {sorted
            .filter((a) => contextPercent(a) >= 80)
            .map((a) => {
              const pct = contextPercent(a);
              const isRed = pct >= 90;
              return (
                <div
                  key={a.id}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded ${
                    isRed ? 'bg-red-500/10 text-red-400' : 'bg-yellow-500/10 text-yellow-400'
                  }`}
                >
                  <span>{isRed ? '🔴' : '🟡'}</span>
                  <span>
                    {a.role.name} ({a.id.slice(0, 8)}) — {pct.toFixed(0)}% context used
                    {isRed ? ' — nearing limit, may lose context' : ' — consider wrapping up'}
                  </span>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
