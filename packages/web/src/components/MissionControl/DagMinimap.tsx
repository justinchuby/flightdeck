import { GitBranch } from 'lucide-react';
import { useLeadStore } from '../../stores/leadStore';
import { dagMinimapColor } from '../../utils/statusColors';
import type { DagStatus } from '../../types';

// ── Stacked status bar ───────────────────────────────────────────────

function DagStatusBar({ summary }: { summary: DagStatus['summary'] }) {
  const total = Object.values(summary).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  const segments = [
    { status: 'done',    count: summary.done },
    { status: 'running', count: summary.running },
    { status: 'ready',   count: summary.ready },
    { status: 'blocked', count: summary.blocked },
    { status: 'paused',  count: summary.paused },
    { status: 'pending', count: summary.pending },
    { status: 'skipped', count: summary.skipped },
    { status: 'failed',  count: summary.failed },
  ].filter((s) => s.count > 0);

  return (
    <div className="space-y-1">
      <div className="flex h-4 rounded-full overflow-hidden">
        {segments.map((seg) => (
          <div
            key={seg.status}
            className={`${dagMinimapColor(seg.status)} relative`}
            style={{ width: `${(seg.count / total) * 100}%` }}
          >
            {seg.count / total > 0.08 && (
              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-th-text/80">
                {seg.count}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-[10px] text-th-text-muted">
        {segments.map((seg) => (
          <span key={seg.status} className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-sm ${dagMinimapColor(seg.status)}`} />
            {seg.status} ({seg.count})
          </span>
        ))}
      </div>
    </div>
  );
}

// ── DagMinimap ───────────────────────────────────────────────────────

interface DagMinimapProps {
  leadId: string;
}

export function DagMinimap({ leadId }: DagMinimapProps) {
  const dagStatus = useLeadStore((s) => s.projects[leadId]?.dagStatus);

  if (!dagStatus || dagStatus.tasks.length === 0) {
    return (
      <div className="bg-th-bg rounded-lg border border-th-border-muted p-4 flex items-center justify-center h-full text-th-text-muted text-sm">
        No task DAG defined
      </div>
    );
  }

  const recentDone = dagStatus.tasks
    .filter((t) => t.dagStatus === 'done' && t.completedAt)
    .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())
    .slice(0, 5);

  const running = dagStatus.tasks.filter((t) => t.dagStatus === 'running');

  return (
    <div className="bg-th-bg rounded-lg border border-th-border-muted p-4 flex flex-col h-full">
      <h3 className="text-sm font-semibold text-th-text-alt flex items-center gap-2 mb-3">
        <GitBranch size={14} className="text-th-text-muted" />
        Task Progress
        <a href="/tasks" className="text-xs text-th-text-muted hover:text-th-text-muted ml-auto">
          Full DAG →
        </a>
      </h3>

      <DagStatusBar summary={dagStatus.summary} />

      <div className="grid grid-cols-2 gap-4 mt-3 flex-1 min-h-0 overflow-y-auto">
        {/* Recent completions */}
        <div>
          <div className="text-xs text-th-text-muted uppercase tracking-wide mb-1">Recent</div>
          {recentDone.length === 0 && (
            <div className="text-xs text-th-text-muted">None yet</div>
          )}
          {recentDone.map((t) => (
            <div key={t.id} className="text-xs text-th-text-muted py-0.5 truncate">
              ✅ {t.description?.slice(0, 40) ?? t.id}
            </div>
          ))}
        </div>

        {/* Currently running */}
        <div>
          <div className="text-xs text-th-text-muted uppercase tracking-wide mb-1">Running</div>
          {running.length === 0 && (
            <div className="text-xs text-th-text-muted">None</div>
          )}
          {running.map((t) => (
            <div key={t.id} className="text-xs text-blue-400 py-0.5 truncate">
              🔵 {t.description?.slice(0, 40) ?? t.id}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
