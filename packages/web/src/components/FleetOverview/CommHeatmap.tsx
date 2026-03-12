/**
 * CommHeatmap — N×N grid showing communication frequency between agents.
 *
 * Cell colour intensity is derived from the percentile rank of the message
 * count relative to the maximum pair count, using `bg-accent/X` opacity steps.
 *
 * Supports optional comm-type filtering via toggle chips when messages
 * include a `type` field.
 */
import { useMemo, useState } from 'react';
import { EmptyState } from '../Shared';
import type { CommType } from '../../stores/leadStore';
import { buildAgentLabel } from '../../utils/agentLabel';

export type { CommType };

// ── Types ─────────────────────────────────────────────────────────────────

interface HeatmapAgent {
  id: string;
  role: string;
  name: string;
}

export interface HeatmapMessage {
  from: string;
  to: string;
  count: number;
  type?: CommType;
}

export interface CommHeatmapProps {
  agents: HeatmapAgent[];
  messages: HeatmapMessage[];
  /** Hide the built-in filter chips (useful when parent provides its own). */
  hideFilters?: boolean;
}

// ── Filter chip labels & colours ──────────────────────────────────────────

const COMM_TYPE_META: Record<CommType, { label: string; color: string }> = {
  message:       { label: 'DMs',         color: 'bg-blue-500/20 text-blue-600 dark:text-blue-300 border-blue-500/30' },
  delegation:    { label: 'Delegations', color: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-300 border-yellow-500/30' },
  group_message: { label: 'Groups',      color: 'bg-purple-500/20 text-purple-600 dark:text-purple-300 border-purple-500/30' },
  broadcast:     { label: 'Broadcasts',  color: 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 border-cyan-500/30' },
  report:        { label: 'Reports',     color: 'bg-green-500/20 text-green-600 dark:text-green-300 border-green-500/30' },
};

const ALL_COMM_TYPES: CommType[] = ['message', 'delegation', 'group_message', 'broadcast', 'report'];

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

export function CommHeatmap({ agents, messages, hideFilters }: CommHeatmapProps) {
  const [activeTypes, setActiveTypes] = useState<Set<CommType>>(new Set(ALL_COMM_TYPES));

  const toggleType = (type: CommType) => {
    setActiveTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        if (next.size > 1) next.delete(type); // keep at least one active
      } else {
        next.add(type);
      }
      return next;
    });
  };

  // Determine if messages include type info (for showing/hiding filter chips)
  const hasTypeInfo = useMemo(() => messages.some(m => m.type != null), [messages]);

  // Filter messages by active comm types (pass-through if no type info)
  const filteredMessages = useMemo(
    () => hasTypeInfo ? messages.filter(m => !m.type || activeTypes.has(m.type)) : messages,
    [messages, activeTypes, hasTypeInfo],
  );
  const [tooltip, setTooltip] = useState<{
    from: string;
    to: string;
    count: number;
    x: number;
    y: number;
  } | null>(null);

  /** Aggregate counts from the filtered messages into a map keyed by "from::to". */
  const { commMap, maxCount } = useMemo(() => {
    const commMap = new Map<string, number>();
    let maxCount = 0;

    for (const msg of filteredMessages) {
      const key  = `${msg.from}::${msg.to}`;
      const next = (commMap.get(key) ?? 0) + msg.count;
      commMap.set(key, next);
      if (next > maxCount) maxCount = next;
    }

    return { commMap, maxCount };
  }, [filteredMessages]);

  const labelByAgentId = useMemo(
    () => new Map(agents.map(agent => [agent.id, buildAgentLabel(agent)])),
    [agents],
  );

  if (agents.length === 0) {
    return <EmptyState icon="🔥" title="No agents to display" compact />;
  }

  // Use rectangular cells so long labels remain readable.
  const columnWidth = Math.min(140, Math.max(84, Math.floor(1100 / agents.length)));
  const rowHeight = Math.min(24, Math.max(14, Math.floor(380 / agents.length)));
  const labelWidth = Math.min(220, Math.max(132, Math.floor(columnWidth * 1.65)));

  return (
    <div className="overflow-auto">
      {/* ── Comm type filter chips ── */}
      {hasTypeInfo && !hideFilters && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3" role="group" aria-label="Filter by communication type">
          {ALL_COMM_TYPES.map(type => {
            const meta = COMM_TYPE_META[type];
            const isActive = activeTypes.has(type);
            return (
              <button
                key={type}
                onClick={() => toggleType(type)}
                aria-pressed={isActive}
                className={`px-2.5 py-1 text-[11px] rounded-full transition-colors border ${
                  isActive ? meta.color : 'bg-th-bg-alt/30 border-th-border/30 text-th-text-muted opacity-50 hover:opacity-75'
                }`}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="min-w-max">
        {/* ── Column headers ── */}
        <div className="flex" style={{ paddingLeft: labelWidth, height: 92, marginBottom: 6 }}>
          {agents.map(agent => (
            <div
              key={agent.id}
              className="shrink-0 relative overflow-visible"
              style={{ width: columnWidth }}
            >
              <span
                className="absolute left-1 bottom-1 text-[11px] text-th-text-muted whitespace-nowrap origin-bottom-left -rotate-45"
                title={`${labelByAgentId.get(agent.id)} (${agent.id})`}
              >
                {labelByAgentId.get(agent.id)}
              </span>
            </div>
          ))}
        </div>

        {/* ── Rows ── */}
        {agents.map(fromAgent => (
          <div key={fromAgent.id} className="flex items-center" style={{ marginBottom: 1 }}>
            {/* Row label */}
            <div
              className="shrink-0 text-th-text-muted truncate text-right pr-2 text-[11px]"
              style={{ width: labelWidth }}
              title={`${labelByAgentId.get(fromAgent.id)} (${fromAgent.id})`}
            >
              {labelByAgentId.get(fromAgent.id)}
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
                  style={{ width: columnWidth - 2, height: rowHeight - 2, margin: '0 1px' }}
                  onMouseEnter={e =>
                    !isSelf &&
                    setTooltip({
                      from:  labelByAgentId.get(fromAgent.id) ?? fromAgent.id,
                      to:    labelByAgentId.get(toAgent.id) ?? toAgent.id,
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
