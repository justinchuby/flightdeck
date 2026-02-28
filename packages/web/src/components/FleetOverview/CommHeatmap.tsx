/**
 * CommHeatmap — N×N grid showing communication frequency between agents.
 *
 * Cell colour intensity is derived from the percentile rank of the message
 * count relative to the maximum pair count, using `bg-accent/X` opacity steps.
 */
import { useMemo, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────

interface HeatmapAgent {
  id: string;
  role: string;
  name: string;
}

export interface CommHeatmapProps {
  agents: HeatmapAgent[];
  messages: Array<{ from: string; to: string; count: number }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Maps a count → a Tailwind bg-accent opacity class based on percentile. */
function intensityClass(count: number, max: number): string {
  if (max === 0 || count === 0) return '';
  const ratio = count / max;
  if (ratio < 0.1) return 'bg-accent/10';
  if (ratio < 0.3) return 'bg-accent/20';
  if (ratio < 0.5) return 'bg-accent/40';
  if (ratio < 0.7) return 'bg-accent/60';
  if (ratio < 0.9) return 'bg-accent/80';
  return 'bg-accent';
}

// ── Component ─────────────────────────────────────────────────────────────

export function CommHeatmap({ agents, messages }: CommHeatmapProps) {
  const [tooltip, setTooltip] = useState<{
    from: string;
    to: string;
    count: number;
    x: number;
    y: number;
  } | null>(null);

  /** Aggregate counts from the messages array into a map keyed by "from::to". */
  const { commMap, maxCount } = useMemo(() => {
    const commMap = new Map<string, number>();
    let maxCount = 0;

    for (const msg of messages) {
      const key  = `${msg.from}::${msg.to}`;
      const next = (commMap.get(key) ?? 0) + msg.count;
      commMap.set(key, next);
      if (next > maxCount) maxCount = next;
    }

    return { commMap, maxCount };
  }, [messages]);

  if (agents.length === 0) {
    return (
      <div className="flex items-center justify-center py-6 text-th-text-muted text-sm">
        No agents to display
      </div>
    );
  }

  // Keep cells readable even for large fleets.
  const cellSize   = Math.min(36, Math.max(16, Math.floor(360 / agents.length)));
  const labelWidth = Math.min(88, Math.max(48, cellSize * 2.2));
  const fontSize   = cellSize <= 20 ? 8 : cellSize <= 28 ? 9 : 10;

  return (
    <div className="overflow-auto">
      <div style={{ display: 'inline-block' }}>
        {/* ── Column headers ── */}
        <div className="flex" style={{ paddingLeft: labelWidth, marginBottom: 4 }}>
          {agents.map(agent => (
            <div
              key={agent.id}
              className="shrink-0 text-center overflow-hidden"
              style={{ width: cellSize }}
            >
              <span
                className="block text-th-text-muted truncate px-px"
                style={{ fontSize }}
                title={`${agent.name} — ${agent.role}`}
              >
                {agent.name}
              </span>
            </div>
          ))}
        </div>

        {/* ── Rows ── */}
        {agents.map(fromAgent => (
          <div key={fromAgent.id} className="flex items-center" style={{ marginBottom: 1 }}>
            {/* Row label */}
            <div
              className="shrink-0 text-th-text-muted truncate text-right pr-1.5"
              style={{ width: labelWidth, fontSize }}
              title={`${fromAgent.name} — ${fromAgent.role}`}
            >
              {fromAgent.name}
            </div>

            {/* Cells */}
            {agents.map(toAgent => {
              const isSelf = fromAgent.id === toAgent.id;
              const count  = isSelf
                ? 0
                : (commMap.get(`${fromAgent.id}::${toAgent.id}`) ?? 0);

              return (
                <div
                  key={toAgent.id}
                  className={`shrink-0 rounded-sm border transition-colors cursor-default
                    ${isSelf
                      ? 'bg-th-bg-muted/20 border-th-border/10'
                      : count > 0
                        ? `${intensityClass(count, maxCount)} border-accent/20 hover:opacity-80`
                        : 'bg-th-bg-alt/15 border-th-border/10'
                    }
                  `}
                  style={{ width: cellSize - 2, height: cellSize - 2, margin: '0 1px' }}
                  onMouseEnter={e =>
                    !isSelf &&
                    setTooltip({
                      from:  fromAgent.name,
                      to:    toAgent.name,
                      count,
                      x: e.clientX,
                      y: e.clientY,
                    })
                  }
                  onMouseLeave={() => setTooltip(null)}
                  onMouseMove={e =>
                    setTooltip(prev => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null))
                  }
                />
              );
            })}
          </div>
        ))}

        {/* ── Colour scale legend ── */}
        <div className="flex items-center gap-1.5 mt-3 text-[10px] text-th-text-muted">
          <span>Low</span>
          {['bg-accent/10','bg-accent/20','bg-accent/40','bg-accent/60','bg-accent/80','bg-accent'].map(cls => (
            <span key={cls} className={`inline-block w-4 h-3 rounded-sm border border-accent/20 ${cls}`} />
          ))}
          <span>High</span>
          {maxCount > 0 && (
            <span className="ml-2 text-th-text-muted/60">(max {maxCount})</span>
          )}
        </div>
      </div>

      {/* ── Tooltip ── */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-th-bg border border-th-border rounded-lg p-2.5 shadow-xl text-xs"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          <div className="flex items-center gap-1 text-th-text-alt">
            <span className="text-accent font-medium">{tooltip.from}</span>
            <span className="text-th-text-muted">→</span>
            <span className="text-accent font-medium">{tooltip.to}</span>
          </div>
          <div className="text-th-text-muted mt-0.5">
            {tooltip.count === 0
              ? 'No messages'
              : `${tooltip.count} message${tooltip.count !== 1 ? 's' : ''}`}
          </div>
        </div>
      )}
    </div>
  );
}
