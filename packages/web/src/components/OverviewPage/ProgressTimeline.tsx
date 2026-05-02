import { useMemo } from 'react';
import { Group } from '@visx/group';
import { AreaStack, LinePath } from '@visx/shape';
import { scaleLinear, scaleTime } from '@visx/scale';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { formatTime } from '../../utils/format';

// ── Types ──────────────────────────────────────────────────────────

export interface TimelineDataPoint {
  time: number; // epoch ms
  completed: number;
  inProgress: number;
  remaining: number;
  agentCount: number;
}

interface ProgressTimelineProps {
  data: TimelineDataPoint[];
  width?: number;
  height?: number;
}

const STACK_KEYS = ['completed', 'inProgress', 'remaining'] as const;
const COLORS: Record<string, string> = {
  completed: 'rgb(var(--chart-progress-completed))',
  inProgress: 'rgb(var(--chart-progress-active))',
  remaining: 'rgb(var(--chart-progress-remaining))',
};

const MARGIN = { top: 16, right: 48, bottom: 32, left: 48 };

// ── Component ──────────────────────────────────────────────────────

export function ProgressTimeline({ data, width = 800, height = 240 }: ProgressTimelineProps) {
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = height - MARGIN.top - MARGIN.bottom;

  const { xScale, yScale, agentScale } = useMemo(() => {
    if (data.length === 0) {
      return {
        xScale: scaleTime({ domain: [new Date(), new Date()], range: [0, innerW] }),
        yScale: scaleLinear({ domain: [0, 1], range: [innerH, 0] }),
        agentScale: scaleLinear({ domain: [0, 1], range: [innerH, 0] }),
      };
    }
    const times = data.map((d) => d.time);
    const maxTotal = Math.max(...data.map((d) => d.completed + d.inProgress + d.remaining), 1);
    const maxAgents = Math.max(...data.map((d) => d.agentCount), 1);

    return {
      xScale: scaleTime({
        domain: [new Date(Math.min(...times)), new Date(Math.max(...times))],
        range: [0, innerW],
      }),
      yScale: scaleLinear({
        domain: [0, maxTotal],
        range: [innerH, 0],
        nice: true,
      }),
      agentScale: scaleLinear({
        domain: [0, maxAgents],
        range: [innerH, 0],
      }),
    };
  }, [data, innerW, innerH]);

  if (data.length === 0) {
    return (
      <div className="bg-surface-raised border border-th-border rounded-lg p-4 h-[240px] flex items-center justify-center" data-testid="progress-timeline">
        <p className="text-xs text-th-text-muted opacity-60">Waiting for session data...</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-raised border border-th-border rounded-lg p-4" data-testid="progress-timeline">
      <h3 className="text-[11px] font-medium text-th-text-muted uppercase tracking-wider mb-2">
        Progress Timeline
      </h3>
      <svg width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          {/* Stacked areas */}
          <AreaStack
            keys={[...STACK_KEYS]}
            data={data}
            x={(d) => xScale(new Date(d.data.time)) ?? 0}
            y0={(d) => yScale(d[0]) ?? 0}
            y1={(d) => yScale(d[1]) ?? 0}
          >
            {({ stacks, path }) =>
              stacks.map((stack) => (
                <path
                  key={stack.key}
                  d={path(stack) ?? ''}
                  fill={COLORS[stack.key] ?? 'currentColor'}
                  opacity={0.6}
                />
              ))
            }
          </AreaStack>

          {/* Agent count line (dashed, secondary axis) */}
          <LinePath
            data={data}
            x={(d) => xScale(new Date(d.time)) ?? 0}
            y={(d) => agentScale(d.agentCount) ?? 0}
            stroke="white"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            strokeOpacity={0.6}
          />

          {/* X axis */}
          <AxisBottom
            top={innerH}
            scale={xScale}
            numTicks={6}
            hideZero
            tickFormat={(d) => formatTime(d instanceof Date ? d : new Date(d as number))}
            stroke="#6b7280"
            tickStroke="#6b7280"
            tickLabelProps={() => ({
              fill: '#9ca3af',
              fontSize: 10,
              textAnchor: 'middle' as const,
            })}
          />

          {/* Y axis (tasks) */}
          <AxisLeft
            scale={yScale}
            numTicks={4}
            hideZero
            stroke="#6b7280"
            tickStroke="#6b7280"
            tickLabelProps={() => ({
              fill: '#9ca3af',
              fontSize: 10,
              textAnchor: 'end' as const,
              dx: -4,
            })}
          />
        </Group>
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-1 px-12">
        {STACK_KEYS.map((key) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLORS[key], opacity: 0.6 }} />
            <span className="text-[10px] text-th-text-muted capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-0 border-t border-dashed border-white/60" />
          <span className="text-[10px] text-th-text-muted">Agents</span>
        </div>
      </div>
    </div>
  );
}
