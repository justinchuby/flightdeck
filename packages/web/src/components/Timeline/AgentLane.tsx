import React from 'react';
import type { ScaleTime } from '@visx/vendor/d3-scale';
import type { TimelineAgent } from './useTimelineData';
import { getRoleIcon } from '../../utils/getRoleIcon';

/** Status → Tailwind color map matching the existing app palette */
const STATUS_STYLES: Record<string, { bg: string; border: string; fill: string }> = {
  running:    { bg: 'bg-blue-500/30',    border: 'border-blue-500',    fill: 'rgb(59 130 246 / 0.35)' },
  idle:       { bg: 'bg-gray-300/30',    border: 'border-gray-400',    fill: 'rgb(156 163 175 / 0.25)' },
  creating:   { bg: 'bg-amber-400/30',   border: 'border-amber-500',   fill: 'rgb(251 191 36 / 0.35)' },
  completed:  { bg: 'bg-purple-500/30',   border: 'border-purple-500',   fill: 'rgb(168 85 247 / 0.35)' },
  failed:     { bg: 'bg-red-500/30',     border: 'border-red-500',     fill: 'rgb(239 68 68 / 0.35)' },
  terminated: { bg: 'bg-orange-500/30',  border: 'border-orange-500',  fill: 'rgb(249 115 22 / 0.35)' },
};

const STATUS_STROKE: Record<string, string> = {
  running:    'rgb(59 130 246)',
  idle:       'rgb(156 163 175)',
  creating:   'rgb(251 191 36)',
  completed:  'rgb(5 150 105)',
  failed:     'rgb(239 68 68)',
  terminated: 'rgb(249 115 22)',
};

export interface AgentLaneProps {
  agent: TimelineAgent;
  xScale: ScaleTime<number, number, never>;
  y: number;
  width: number;
  height?: number;
  onExpand?: (agentId: string) => void;
}

const LABEL_WIDTH = 180;
const DEFAULT_HEIGHT = 48;
const SEGMENT_PADDING = 2;

export function AgentLane({ agent, xScale, y, width, height = DEFAULT_HEIGHT, onExpand }: AgentLaneProps) {
  const laneWidth = width - LABEL_WIDTH;

  return (
    <g transform={`translate(0, ${y})`} data-agent-id={agent.id}>
      {/* Lane background — subtle alternating row hint */}
      <rect x={LABEL_WIDTH} y={0} width={laneWidth} height={height} fill="rgb(255 255 255 / 0.02)" rx={2} />

      {/* Idle hatch pattern definition (rendered once, referenced by idle segments) */}
      <defs>
        <pattern
          id={`hatch-${agent.shortId}`}
          width={6}
          height={6}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1={0} y1={0} x2={0} y2={6} stroke="rgb(156 163 175 / 0.3)" strokeWidth={1} />
        </pattern>
      </defs>

      {/* Status segments */}
      {agent.segments.map((seg, i) => {
        const x0 = Math.max(xScale(new Date(seg.startAt)), LABEL_WIDTH);
        const x1 = Math.min(xScale(new Date(seg.endAt ?? new Date().toISOString())), width);
        const segWidth = Math.max(x1 - x0, 2); // min 2px so short segments are visible
        const style = STATUS_STYLES[seg.status] ?? STATUS_STYLES.idle;
        const stroke = STATUS_STROKE[seg.status] ?? STATUS_STROKE.idle;

        return (
          <g key={`${seg.status}-${i}`}>
            {/* Filled rectangle */}
            <rect
              x={x0}
              y={SEGMENT_PADDING}
              width={segWidth}
              height={height - SEGMENT_PADDING * 2}
              fill={style.fill}
              stroke={stroke}
              strokeWidth={1}
              rx={3}
            />
            {/* Hatch overlay for idle segments */}
            {seg.status === 'idle' && (
              <rect
                x={x0}
                y={SEGMENT_PADDING}
                width={segWidth}
                height={height - SEGMENT_PADDING * 2}
                fill={`url(#hatch-${agent.shortId})`}
                rx={3}
              />
            )}
          </g>
        );
      })}

      {/* Agent label (fixed left column) */}
      <foreignObject x={0} y={0} width={LABEL_WIDTH} height={height}>
        <div
          className="flex items-center gap-1.5 h-full px-2 cursor-pointer select-none hover:bg-white/5 rounded-l"
          onClick={() => onExpand?.(agent.id)}
          title={`${agent.role} (${agent.id.slice(0, 4)})`}
        >
          <span className="text-sm">{getRoleIcon(agent.role)}</span>
          <div className="flex flex-col min-w-0 leading-tight">
            <span className="text-xs font-medium text-th-text-alt truncate">{agent.role}</span>
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-mono text-th-text-muted">{agent.shortId}</span>
              {agent.provider && (
                <span className="text-[10px] bg-blue-500/15 text-blue-400 px-1 py-px rounded">{agent.provider}</span>
              )}
              {agent.model && (
                <span className="text-[11px] text-th-text-muted truncate">{agent.model}</span>
              )}
            </div>
          </div>
        </div>
      </foreignObject>
    </g>
  );
}

export { LABEL_WIDTH, DEFAULT_HEIGHT };
