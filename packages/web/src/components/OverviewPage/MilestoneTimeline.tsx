import { useMemo } from 'react';
import type { ReplayKeyframe } from '../../hooks/useSessionReplay';

/** Only show meaningful progress events — filter out routine system noise */
const MILESTONE_TYPES = new Set(['milestone', 'task', 'decision', 'progress', 'commit', 'error']);

const TYPE_ICONS: Record<string, string> = {
  decision: '⚡',
  milestone: '✅',
  task: '📋',
  progress: '📊',
  error: '🔴',
  commit: '📦',
};

interface MilestoneTimelineProps {
  keyframes: ReplayKeyframe[];
  onSeek?: (timestamp: string) => void;
}

export function MilestoneTimeline({ keyframes, onSeek }: MilestoneTimelineProps) {
  const milestones = useMemo(
    () => keyframes.filter((kf) => MILESTONE_TYPES.has(kf.type)),
    [keyframes],
  );

  if (milestones.length === 0) {
    return (
      <div className="bg-surface-raised border border-th-border rounded-lg p-4" data-testid="milestone-timeline">
        <h3 className="text-[11px] font-medium text-th-text-muted uppercase tracking-wider mb-3">
          Milestones
        </h3>
        <p className="text-xs text-th-text-muted text-center py-4 opacity-60">
          No milestones yet
        </p>
      </div>
    );
  }

  return (
    <div className="bg-surface-raised border border-th-border rounded-lg p-4" data-testid="milestone-timeline">
      <h3 className="text-[11px] font-medium text-th-text-muted uppercase tracking-wider mb-3">
        Milestones
      </h3>
      <div className="relative space-y-0">
        {/* Vertical line */}
        <div className="absolute left-[11px] top-2 bottom-2 w-px bg-th-border" />

        {[...milestones].reverse().map((kf, idx) => {
          const icon = TYPE_ICONS[kf.type] ?? '⏱';
          const time = new Date(kf.timestamp);
          const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          return (
            <button
              key={`${kf.timestamp}-${idx}`}
              onClick={() => onSeek?.(kf.timestamp)}
              className="relative flex items-start gap-3 pl-0 py-1.5 w-full text-left hover:bg-th-bg-hover/50 rounded transition-colors group"
            >
              {/* Dot */}
              <span className="relative z-10 flex items-center justify-center w-[22px] h-[22px] text-sm shrink-0">
                {icon}
              </span>
              {/* Content */}
              <div className="flex-1 min-w-0">
                <span
                  className="text-xs text-th-text-alt group-hover:text-th-text transition-colors line-clamp-2"
                  title={kf.label}
                >
                  {kf.label}
                </span>
                <span className="text-[10px] text-th-text-muted">{timeStr}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
