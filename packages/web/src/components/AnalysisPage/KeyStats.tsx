import { useMemo } from 'react';
import { CheckCircle2, Users, Clock, Zap } from 'lucide-react';
import type { AgentInfo } from '../../types';

interface KeyStatsProps {
  agents: AgentInfo[];
  totalTokens?: number;
  sessionStart?: string;
}

interface StatItem {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

export function KeyStats({ agents, totalTokens, sessionStart }: KeyStatsProps) {
  const stats = useMemo((): StatItem[] => {
    const running = agents.filter((a) => a.status === 'running').length;
    const _idle = agents.filter((a) => a.status === 'idle').length;
    const completed = agents.filter((a) => a.status === 'completed').length;
    const total = agents.length;

    const elapsed = sessionStart
      ? Math.floor((Date.now() - new Date(sessionStart).getTime()) / 60_000)
      : 0;
    const elapsedStr = elapsed >= 60 ? `${Math.floor(elapsed / 60)}h ${elapsed % 60}m` : `${elapsed}m`;

    const hasTokenData = agents.some((a) => (a.inputTokens ?? 0) > 0 || (a.outputTokens ?? 0) > 0);

    const items: StatItem[] = [
      {
        label: 'Agents',
        value: `${running} active / ${total} total`,
        icon: <Users size={14} />,
        color: running > 0 ? 'text-blue-400' : 'text-th-text-muted',
      },
      {
        label: 'Duration',
        value: elapsedStr,
        icon: <Clock size={14} />,
        color: 'text-th-text-alt',
      },
      {
        label: 'Completed',
        value: `${completed} agent${completed !== 1 ? 's' : ''}`,
        icon: <CheckCircle2 size={14} />,
        color: completed > 0 ? 'text-green-400' : 'text-th-text-muted',
      },
    ];

    if (hasTokenData) {
      const inputTotal = agents.reduce((s, a) => s + (a.inputTokens ?? 0), 0);
      const outputTotal = agents.reduce((s, a) => s + (a.outputTokens ?? 0), 0);
      items.push({
        label: 'Tokens',
        value: `${formatTokens(inputTotal)} in / ${formatTokens(outputTotal)} out`,
        icon: <Zap size={14} />,
        color: 'text-amber-400',
      });
    } else {
      items.push({
        label: 'Tokens',
        value: 'No data available',
        icon: <Zap size={14} />,
        color: 'text-th-text-muted',
      });
    }

    return items;
  }, [agents, totalTokens, sessionStart]);

  return (
    <div className="bg-surface-raised border border-th-border rounded-lg p-4 h-[180px]" data-testid="key-stats">
      <h3 className="text-[11px] font-medium text-th-text-muted uppercase tracking-wider mb-3">
        Key Stats
      </h3>
      <div className="space-y-2.5">
        {stats.map((stat) => (
          <div key={stat.label} className="flex items-center gap-2">
            <span className={stat.color}>{stat.icon}</span>
            <span className="text-xs text-th-text-muted w-16">{stat.label}</span>
            <span className={`text-xs font-medium ${stat.color}`}>{stat.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
