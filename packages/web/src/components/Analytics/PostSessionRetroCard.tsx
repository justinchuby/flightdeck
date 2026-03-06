import type { SessionSummary } from './types';

interface PostSessionRetroCardProps {
  session: SessionSummary;
  avgTasks: number;
  onClose: () => void;
}

function DeltaIndicator({ current, average, lowerIsBetter, label, unit }: {
  current: number; average: number; lowerIsBetter: boolean; label: string; unit: string;
}) {
  if (average === 0) return null;
  const pctChange = ((current - average) / average) * 100;
  const isGood = lowerIsBetter ? pctChange < 0 : pctChange > 0;
  const arrow = pctChange < 0 ? '↘' : pctChange > 0 ? '↗' : '→';
  const color = isGood ? 'text-emerald-400' : 'text-red-400';

  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-th-text-muted">{label}:</span>
      <span className={color}>
        {Math.abs(Math.round(pctChange))}% {pctChange < 0 ? 'below' : 'above'} average {arrow}{' '}
        {isGood ? '✅' : '⚠️'}
      </span>
    </div>
  );
}

export function PostSessionRetroCard({ session, avgTasks, onClose }: PostSessionRetroCardProps) {
  const durationMs = session.endedAt
    ? new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()
    : 0;
  const durationMin = Math.round(durationMs / 60_000);

  return (
    <div className="bg-surface-raised border border-th-border rounded-lg p-5" data-testid="post-session-retro">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-th-text-alt">
          📊 Session Complete — {session.projectId ?? session.leadId.slice(0, 8)}
        </h3>
        <button
          onClick={onClose}
          className="text-xs text-th-text-muted hover:text-th-text"
        >
          Close
        </button>
      </div>

      <div className="flex gap-4 text-xs text-th-text-muted mb-3 flex-wrap">
        <span>Duration: {durationMin}m</span>
        <span>Tokens: {((session.totalInputTokens + session.totalOutputTokens) / 1000).toFixed(0)}k</span>
        <span>Tasks: {session.taskCount}</span>
        <span>Agents: {session.agentCount}</span>
      </div>

      <div className="space-y-1.5 mb-3">
        <p className="text-xs font-medium text-th-text-alt">Compared to your average:</p>
        <DeltaIndicator
          current={session.taskCount}
          average={avgTasks}
          lowerIsBetter={false}
          label="Tasks"
          unit=""
        />
      </div>

      <div className="flex gap-2 mt-3">
        <button className="text-[11px] px-2.5 py-1 rounded-md bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
          View Analytics
        </button>
        <button
          onClick={onClose}
          className="text-[11px] px-2.5 py-1 rounded-md bg-th-bg-alt border border-th-border text-th-text-muted hover:text-th-text transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}
