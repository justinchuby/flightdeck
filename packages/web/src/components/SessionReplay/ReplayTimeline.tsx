/**
 * ReplayTimeline — Lightweight agent swim-lane visualization for session replay.
 *
 * Renders one row per agent with a colored bar indicating their active period.
 * Uses keyframes (spawn/agent_exit) to determine agent lifespans.
 * Pure CSS — no visx/d3 dependency.
 */
import { useMemo } from 'react';
import type { ReplayKeyframe } from '../../hooks/useSessionReplay';
import { getRoleIcon } from '../../utils/getRoleIcon';

// ── Role colors (matches Timeline AgentLane palette) ─────────────────

const ROLE_COLORS: Record<string, string> = {
  lead:       'bg-blue-500/60',
  architect:  'bg-violet-500/60',
  developer:  'bg-emerald-500/60',
  reviewer:   'bg-amber-500/60',
  secretary:  'bg-cyan-500/60',
  qa:         'bg-rose-500/60',
  designer:   'bg-pink-500/60',
};

const DEFAULT_COLOR = 'bg-gray-400/60';

// ── Types ────────────────────────────────────────────────────────────

interface AgentSpan {
  agentId: string;
  role: string;
  startPct: number; // 0-100
  endPct: number;   // 0-100
}

export interface ReplayTimelineProps {
  keyframes: ReplayKeyframe[];
  duration: number;      // total ms
  currentTime: number;   // ms since start
  onSeek: (timeMs: number) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────

function buildAgentSpans(keyframes: ReplayKeyframe[], duration: number): AgentSpan[] {
  if (keyframes.length === 0 || duration <= 0) return [];

  const startMs = new Date(keyframes[0].timestamp).getTime();
  const agents = new Map<string, { role: string; start: number; end: number }>();

  for (const kf of keyframes) {
    const tMs = new Date(kf.timestamp).getTime() - startMs;
    const id = kf.agentId;
    if (!id) continue;

    if (kf.type === 'spawn') {
      agents.set(id, { role: kf.label.replace(/^Spawned\s+/i, '').split(' ')[0].toLowerCase(), start: tMs, end: duration });
    } else if (kf.type === 'agent_exit') {
      const existing = agents.get(id);
      if (existing) existing.end = tMs;
    }
  }

  return Array.from(agents.entries()).map(([agentId, { role, start, end }]) => ({
    agentId,
    role,
    startPct: (start / duration) * 100,
    endPct: (end / duration) * 100,
  }));
}

// ── Component ────────────────────────────────────────────────────────

export function ReplayTimeline({ keyframes, duration, currentTime, onSeek }: ReplayTimelineProps) {
  const spans = useMemo(() => buildAgentSpans(keyframes, duration), [keyframes, duration]);

  if (spans.length === 0) return null;

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    onSeek(pct * duration);
  };

  return (
    <div className="border-b border-th-border px-4 py-2" data-testid="replay-timeline">
      <div className="text-[10px] text-th-text-muted uppercase tracking-wide mb-1">Agent Timeline</div>
      <div className="space-y-0.5">
        {spans.map((span) => (
          <div key={span.agentId} className="flex items-center gap-2 h-5">
            <span className="text-[10px] text-th-text-muted w-20 truncate text-right shrink-0" title={span.role}>
              {getRoleIcon(span.role)} {span.role}
            </span>
            <div
              className="flex-1 relative h-3 bg-th-bg-alt/50 rounded-sm overflow-hidden cursor-pointer"
              onClick={handleClick}
            >
              <div
                className={`absolute top-0 bottom-0 rounded-sm ${ROLE_COLORS[span.role] ?? DEFAULT_COLOR}`}
                style={{ left: `${span.startPct}%`, width: `${Math.max(span.endPct - span.startPct, 0.5)}%` }}
                data-testid={`agent-bar-${span.agentId.slice(0, 8)}`}
              />
              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 w-px bg-accent pointer-events-none"
                style={{ left: `${progressPct}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
