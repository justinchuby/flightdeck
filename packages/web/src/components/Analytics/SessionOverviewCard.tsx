import type { AnalyticsOverview } from './types';
import { formatTokens } from '../../utils/format';

interface SessionOverviewCardProps {
  overview: AnalyticsOverview;
}

export function SessionOverviewCard({ overview }: SessionOverviewCardProps) {
  const { totalSessions, sessions } = overview;

  // Total duration from sessions
  const totalDurationMs = sessions.reduce((sum, s) => {
    if (!s.endedAt) return sum;
    return sum + (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime());
  }, 0);
  const totalHours = totalDurationMs / 3_600_000;

  const totalTasks = sessions.reduce((s, x) => s + x.taskCount, 0);
  const totalTokens = sessions.reduce((s, x) => s + x.totalInputTokens + x.totalOutputTokens, 0);

  return (
    <div className="bg-surface-raised border border-th-border rounded-lg p-4" data-testid="session-overview-card">
      <h3 className="text-xs font-semibold text-th-text-muted uppercase tracking-wide mb-3">Sessions</h3>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Total sessions" value={String(totalSessions)} />
        <Stat label="Total time" value={`${totalHours.toFixed(1)}h`} />
        <Stat label="Tasks completed" value={String(totalTasks)} />
        <Stat label="Total tokens" value={formatTokens(totalTokens)} />
      </div>
      <p className="text-[10px] text-th-text-muted mt-2">
        Avg: {formatTokens(totalSessions > 0 ? Math.round(totalTokens / totalSessions) : 0)} tokens/session
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-th-text-muted">{label}</p>
      <p className="text-lg font-bold text-th-text-alt">{value}</p>
    </div>
  );
}
