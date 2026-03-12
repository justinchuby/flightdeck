import type { SessionComparison } from './types';
import { shortAgentId } from '../../utils/agentLabel';

interface SessionComparisonViewProps {
  comparison: SessionComparison;
  onClose: () => void;
}

function deltaColor(delta: number, lowerIsBetter: boolean): string {
  if (delta === 0) return 'text-th-text-muted';
  const isGood = lowerIsBetter ? delta < 0 : delta > 0;
  return isGood ? 'text-emerald-400' : 'text-red-400';
}

function formatDelta(v: number, suffix = ''): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}${suffix}`;
}

export function SessionComparisonView({ comparison, onClose }: SessionComparisonViewProps) {
  const [a, b] = comparison.sessions;
  if (!a || !b) return null;

  const tokenA = a.totalInputTokens + a.totalOutputTokens;
  const tokenB = b.totalInputTokens + b.totalOutputTokens;
  const tokenDelta = tokenB > 0 ? ((tokenA - tokenB) / tokenB) * 100 : 0;

  const agentDelta = a.agentCount - b.agentCount;
  const taskDelta = a.taskCount - b.taskCount;

  const rows: Array<{ label: string; valA: string; valB: string; delta: string; lowerIsBetter: boolean; numDelta: number }> = [
    {
      label: 'Tokens',
      valA: tokenA.toLocaleString(),
      valB: tokenB.toLocaleString(),
      delta: formatDelta(tokenDelta, '%'),
      lowerIsBetter: true,
      numDelta: tokenDelta,
    },
    {
      label: 'Agents',
      valA: String(a.agentCount),
      valB: String(b.agentCount),
      delta: formatDelta(agentDelta),
      lowerIsBetter: false,
      numDelta: agentDelta,
    },
    {
      label: 'Tasks',
      valA: String(a.taskCount),
      valB: String(b.taskCount),
      delta: formatDelta(taskDelta),
      lowerIsBetter: false,
      numDelta: taskDelta,
    },
  ];

  return (
    <div className="bg-surface-raised border border-th-border rounded-lg p-4" data-testid="session-comparison">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-th-text-muted uppercase tracking-wide">
          📊 Compare Sessions
        </h3>
        <button
          onClick={onClose}
          className="text-[10px] text-th-text-muted hover:text-th-text"
        >
          ✕ Close
        </button>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="text-th-text-muted border-b border-th-border">
            <th className="pb-2 text-left">Metric</th>
            <th className="pb-2 text-right">{a.projectId ?? shortAgentId(a.leadId)}</th>
            <th className="pb-2 text-right">{b.projectId ?? shortAgentId(b.leadId)}</th>
            <th className="pb-2 text-right">Delta</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-th-border/40">
              <td className="py-1.5 text-th-text-alt">{r.label}</td>
              <td className="py-1.5 text-right text-th-text-alt">{r.valA}</td>
              <td className="py-1.5 text-right text-th-text-alt">{r.valB}</td>
              <td className={`py-1.5 text-right font-medium ${deltaColor(r.numDelta, r.lowerIsBetter)}`}>
                {r.delta}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
