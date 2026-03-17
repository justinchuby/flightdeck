import type { LeadProgress } from '../../types';

interface Props {
  progress: LeadProgress | null;
  progressSummary: string | null;
  onShowDetail: () => void;
}

export function LeadProgressBanner({ progress, progressSummary, onShowDetail }: Props) {
  return (
    <>
      {progress && progress.totalDelegations > 0 && (
        <div
          className="border-b border-th-border px-4 py-1 flex items-center gap-3 text-xs font-mono bg-th-bg-alt/50 cursor-pointer hover:bg-th-bg-alt/80 transition-colors"
          onClick={onShowDetail}
          title="Click for detailed progress view"
        >
          <span className="text-blue-400">{progress.crewSize} agents</span>
          <span className="text-yellow-600 dark:text-yellow-400">{progress.active} active</span>
          <span className="text-green-400">{progress.completed} done</span>
          {progress.failed > 0 && (
            <span className="text-red-400">{progress.failed} failed</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <div className="w-24 bg-th-bg-muted rounded-full h-1.5">
              <div
                className="bg-green-500 h-1.5 rounded-full transition-all"
                style={{ width: `${progress.completionPct}%` }}
              />
            </div>
            <span className="text-th-text-muted">{progress.completionPct}%</span>
          </div>
        </div>
      )}
      {progressSummary && (
        <div
          className="border-b border-th-border px-4 py-0.5 text-[11px] text-th-text-muted bg-th-bg-alt/30 font-mono truncate cursor-pointer hover:bg-th-bg-alt/50 transition-colors"
          onClick={onShowDetail}
          title="Click for detailed progress view"
        >
          📋 {progressSummary}
        </div>
      )}
    </>
  );
}
