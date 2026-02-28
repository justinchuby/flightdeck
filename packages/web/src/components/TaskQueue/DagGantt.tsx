/**
 * DagGantt — Gantt-style timeline of DAG tasks.
 *
 * Each task is a horizontal bar positioned proportionally within a shared
 * time-range. Dependency edges are drawn as SVG cubic-bezier curves.
 * The critical path (longest-duration dependency chain) is highlighted.
 */
import { useMemo, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────

export interface GanttTask {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'blocked' | 'skipped';
  assignee?: string;
  dependsOn?: string[];
  createdAt?: number;
  startedAt?: number;
  completedAt?: number;
}

export interface DagGanttProps {
  tasks: GanttTask[];
}

// ── Constants ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  done:    'bg-green-500 dark:bg-green-600',
  running: 'bg-blue-500 dark:bg-blue-600 animate-pulse',
  pending: 'bg-yellow-500 dark:bg-yellow-600',
  blocked: 'bg-th-bg-muted',
  failed:  'bg-red-500 dark:bg-red-600',
  skipped: 'bg-th-text-muted/30',
};

const ROW_H   = 28; // bar height in px
const ROW_GAP = 6;  // vertical gap between rows
const LABEL_W = 176; // fixed label column width
const VB_W    = 1000; // SVG viewBox virtual width

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60)  return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// ── Critical-path computation ─────────────────────────────────────────────

/**
 * Returns the set of task IDs on the critical path — the chain of tasks
 * with the greatest cumulative duration from start to finish.
 *
 * "Duration" here is the wall-clock span of each task, so tasks that
 * haven't completed yet stretch to `now`.
 */
function computeCriticalPath(tasks: GanttTask[], now: number): Set<string> {
  if (tasks.length === 0) return new Set();

  const taskMap = new Map(tasks.map(t => [t.id, t]));

  // Memoised earliest-completion-time for each task (sum of self + max dep ECT).
  const ect = new Map<string, number>();
  const visiting = new Set<string>(); // cycle guard

  function getECT(id: string): number {
    if (ect.has(id)) return ect.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);

    const task = taskMap.get(id);
    if (!task) { ect.set(id, 0); return 0; }

    const start   = task.startedAt ?? task.createdAt ?? now;
    const end     = task.completedAt ?? now;
    const selfDur = Math.max(0, end - start);

    const maxDepECT = (task.dependsOn ?? []).reduce<number>((m, depId) => {
      return Math.max(m, getECT(depId));
    }, 0);

    const result = maxDepECT + selfDur;
    ect.set(id, result);
    visiting.delete(id);
    return result;
  }

  tasks.forEach(t => getECT(t.id));

  const maxECT = Math.max(0, ...ect.values());
  if (maxECT === 0) return new Set();

  const onCritical = new Set<string>();
  const SLACK = 1000; // 1 s tolerance for float/rounding

  function backtrack(id: string) {
    if (onCritical.has(id)) return;
    onCritical.add(id);
    const task = taskMap.get(id);
    if (!task) return;

    const start   = task.startedAt ?? task.createdAt ?? now;
    const end     = task.completedAt ?? now;
    const selfDur = Math.max(0, end - start);
    const targetDepECT = (ect.get(id) ?? 0) - selfDur;

    for (const depId of (task.dependsOn ?? [])) {
      if (Math.abs((ect.get(depId) ?? 0) - targetDepECT) <= SLACK) {
        backtrack(depId);
        break;
      }
    }
  }

  // Backtrack from every leaf task that sits on the maximum ECT.
  tasks.forEach(t => {
    if (Math.abs((ect.get(t.id) ?? 0) - maxECT) <= SLACK) backtrack(t.id);
  });

  return onCritical;
}

// ── Component ─────────────────────────────────────────────────────────────

export function DagGantt({ tasks }: DagGanttProps) {
  const now = Date.now();

  const [tooltip, setTooltip] = useState<{
    task: GanttTask;
    x: number;
    y: number;
  } | null>(null);

  const { minTime, timeRange, criticalPath } = useMemo(() => {
    if (tasks.length === 0) {
      return { minTime: now, timeRange: 1, criticalPath: new Set<string>() };
    }

    const times = tasks.flatMap(t => [
      t.createdAt  ?? now,
      t.startedAt  ?? t.createdAt ?? now,
      t.completedAt ?? now,
    ]);
    const minTime  = Math.min(...times);
    const maxTime  = Math.max(...times, now);
    const timeRange = Math.max(maxTime - minTime, 1_000); // at least 1 s

    return { minTime, timeRange, criticalPath: computeCriticalPath(tasks, now) };
  }, [tasks, now]);

  const taskMap   = useMemo(() => new Map(tasks.map(t => [t.id, t])),     [tasks]);
  const taskIndex = useMemo(() => new Map(tasks.map((t, i) => [t.id, i])), [tasks]);

  const totalH = Math.max(1, tasks.length * (ROW_H + ROW_GAP) - ROW_GAP);

  /** Convert an epoch-ms timestamp to an SVG x-coordinate (0–VB_W). */
  const toX = (ms: number) => ((ms - minTime) / timeRange) * VB_W;
  /** Centre-Y of a row in px (same for bars and SVG). */
  const rowCY = (i: number) => i * (ROW_H + ROW_GAP) + ROW_H / 2;

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-th-text-muted text-sm">
        No tasks to display in Gantt view
      </div>
    );
  }

  return (
    <div className="relative select-none text-th-text">
      {/* ── Time axis header ── */}
      <div className="flex mb-1.5" style={{ paddingLeft: LABEL_W }}>
        <div className="flex-1 flex justify-between text-[10px] text-th-text-muted px-1">
          <span>{fmtTime(minTime)}</span>
          <span>{fmtTime(minTime + timeRange * 0.5)}</span>
          <span>{fmtTime(minTime + timeRange)}</span>
        </div>
      </div>

      {/* ── Main body ── */}
      <div className="flex" style={{ height: totalH }}>
        {/* Label column */}
        <div className="shrink-0 relative overflow-hidden" style={{ width: LABEL_W }}>
          {tasks.map((task, i) => (
            <div
              key={task.id}
              className={`absolute flex items-center gap-1 pr-2 ${
                criticalPath.has(task.id) ? 'text-orange-300' : 'text-th-text-alt'
              }`}
              style={{ top: i * (ROW_H + ROW_GAP), height: ROW_H, width: '100%' }}
            >
              {criticalPath.has(task.id) && (
                <span className="text-orange-400 text-[9px] shrink-0 leading-none">★</span>
              )}
              <span className="text-[11px] truncate leading-tight">{task.title}</span>
            </div>
          ))}
        </div>

        {/* Timeline column */}
        <div className="flex-1 relative overflow-hidden border-l border-th-border/50">
          {/* Subtle vertical grid lines */}
          {[0.25, 0.5, 0.75].map(p => (
            <div
              key={p}
              className="absolute top-0 bottom-0 w-px bg-th-border/20 pointer-events-none"
              style={{ left: `${p * 100}%` }}
            />
          ))}

          {/* Alternating row backgrounds */}
          {tasks.map((_, i) => (
            <div
              key={i}
              className={`absolute w-full pointer-events-none ${i % 2 === 0 ? 'bg-th-bg-alt/10' : ''}`}
              style={{ top: i * (ROW_H + ROW_GAP), height: ROW_H }}
            />
          ))}

          {/* Task bars */}
          {tasks.map((task, i) => {
            const start     = task.startedAt  ?? task.createdAt ?? now;
            const end       = task.completedAt ?? now;
            const leftPct   = Math.max(0, ((start - minTime) / timeRange) * 100);
            const widthPct  = Math.max(0.3, ((end - start) / timeRange) * 100);
            const onCrit    = criticalPath.has(task.id);

            return (
              <div
                key={task.id}
                className={`absolute rounded flex items-center px-1.5 overflow-hidden cursor-default
                  ${STATUS_COLORS[task.status] ?? 'bg-gray-500'}
                  ${onCrit ? 'ring-1 ring-orange-400/80' : ''}
                `}
                style={{
                  top:    i * (ROW_H + ROW_GAP) + 2,
                  left:   `${leftPct}%`,
                  width:  `${widthPct}%`,
                  height: ROW_H - 4,
                }}
                onMouseEnter={e => setTooltip({ task, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setTooltip(null)}
                onMouseMove={e =>
                  setTooltip(prev => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null))
                }
              >
                {task.assignee && (
                  <span className="text-[9px] text-white/80 truncate">{task.assignee}</span>
                )}
              </div>
            );
          })}

          {/* SVG dependency arrows — drawn in the same coordinate space as the bars */}
          <svg
            className="absolute inset-0 pointer-events-none overflow-visible"
            style={{ width: '100%', height: '100%' }}
            viewBox={`0 0 ${VB_W} ${totalH}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <marker id="gantt-arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
                <path d="M0,0 L5,2.5 L0,5 Z" fill="rgba(148,163,184,0.45)" />
              </marker>
              <marker id="gantt-arrow-crit" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
                <path d="M0,0 L5,2.5 L0,5 Z" fill="rgba(251,146,60,0.8)" />
              </marker>
            </defs>

            {tasks.flatMap((task, targetIdx) =>
              (task.dependsOn ?? []).map(depId => {
                const srcTask  = taskMap.get(depId);
                const srcIdx   = taskIndex.get(depId);
                if (!srcTask || srcIdx === undefined) return null;

                const srcEnd  = srcTask.completedAt ?? now;
                const tgtStart = task.startedAt ?? task.createdAt ?? now;

                const x1 = toX(srcEnd);
                const y1 = rowCY(srcIdx);
                const x2 = toX(tgtStart);
                const y2 = rowCY(targetIdx);
                const mx = (x1 + x2) / 2;
                const isCrit = criticalPath.has(task.id) && criticalPath.has(depId);

                return (
                  <path
                    key={`${depId}→${task.id}`}
                    d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                    fill="none"
                    stroke={isCrit ? 'rgba(251,146,60,0.65)' : 'rgba(148,163,184,0.28)'}
                    strokeWidth={isCrit ? 1.8 : 1.2}
                    markerEnd={isCrit ? 'url(#gantt-arrow-crit)' : 'url(#gantt-arrow)'}
                  />
                );
              }),
            )}
          </svg>
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap items-center gap-3 mt-3 text-[10px] text-th-text-muted">
        {(['done','running','pending','blocked','failed','skipped'] as const).map(s => (
          <span key={s} className="flex items-center gap-1">
            <span className={`inline-block w-3 h-2 rounded-sm ${STATUS_COLORS[s]}`} />
            <span className="capitalize">{s}</span>
          </span>
        ))}
        <span className="flex items-center gap-1 ml-2">
          <span className="text-orange-400">★</span>
          <span>Critical path</span>
        </span>
      </div>

      {/* ── Tooltip ── */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-th-bg border border-th-border rounded-lg p-3 shadow-xl max-w-xs text-left"
          style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}
        >
          <div className="text-sm font-semibold text-th-text mb-1.5 truncate">{tooltip.task.title}</div>
          <div className="text-xs text-th-text-muted space-y-0.5">
            <div>
              Status:{' '}
              <span className="text-th-text-alt capitalize">{tooltip.task.status}</span>
            </div>
            {tooltip.task.assignee && (
              <div>Role: <span className="text-th-text-alt">{tooltip.task.assignee}</span></div>
            )}
            {tooltip.task.createdAt && (
              <div>Created: {fmtTime(tooltip.task.createdAt)}</div>
            )}
            {tooltip.task.startedAt && (
              <div>Started: {fmtTime(tooltip.task.startedAt)}</div>
            )}
            {tooltip.task.completedAt && (
              <div>
                Duration:{' '}
                {fmtDuration(
                  tooltip.task.completedAt -
                    (tooltip.task.startedAt ?? tooltip.task.createdAt ?? tooltip.task.completedAt),
                )}
              </div>
            )}
            {(tooltip.task.dependsOn ?? []).length > 0 && (
              <div className="text-[10px] truncate">
                Deps: {tooltip.task.dependsOn!.join(', ')}
              </div>
            )}
            {criticalPath.has(tooltip.task.id) && (
              <div className="text-orange-400 mt-0.5">★ On critical path</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
