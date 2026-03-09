import { useMemo } from 'react';
import { Group } from '@visx/group';
import { AreaClosed, LinePath } from '@visx/shape';
import { scaleLinear, scaleTime } from '@visx/scale';
import { AxisBottom, AxisLeft } from '@visx/axis';

export interface CostPoint {
  time: number;
  cumulativeCost: number; // actually cumulative tokens (kept for interface compat)
}

interface CostCurveProps {
  data: CostPoint[];
  width?: number;
  height?: number;
}

const MARGIN = { top: 12, right: 12, bottom: 28, left: 40 };

export function CostCurve({ data, width = 260, height = 180 }: CostCurveProps) {
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = height - MARGIN.top - MARGIN.bottom;

  const { xScale, yScale } = useMemo(() => {
    if (data.length === 0) {
      return {
        xScale: scaleTime({ domain: [new Date(), new Date()], range: [0, innerW] }),
        yScale: scaleLinear({ domain: [0, 1], range: [innerH, 0] }),
      };
    }
    const times = data.map((d) => d.time);
    const maxTokens = Math.max(...data.map((d) => d.cumulativeCost), 1);

    return {
      xScale: scaleTime({
        domain: [new Date(Math.min(...times)), new Date(Math.max(...times))],
        range: [0, innerW],
      }),
      yScale: scaleLinear({
        domain: [0, maxTokens * 1.1],
        range: [innerH, 0],
        nice: true,
      }),
    };
  }, [data, innerW, innerH]);

  if (data.length === 0) {
    return (
      <div className="bg-surface-raised border border-th-border rounded-lg p-4 h-[180px] flex items-center justify-center" data-testid="cost-curve">
        <p className="text-xs text-th-text-muted opacity-60">No token data</p>
      </div>
    );
  }

  const areaColor = 'rgb(var(--chart-success))';

  const formatTokenAxis = (v: number | { valueOf(): number }) => {
    const n = typeof v === 'number' ? v : v.valueOf();
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
    return String(n);
  };

  return (
    <div className="bg-surface-raised border border-th-border rounded-lg p-4 h-[180px]" data-testid="cost-curve">
      <h3 className="text-[11px] font-medium text-th-text-muted uppercase tracking-wider mb-1">
        Token Usage
      </h3>
      <svg width={width} height={height - 32}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          <AreaClosed
            data={data}
            x={(d) => xScale(new Date(d.time)) ?? 0}
            y={(d) => yScale(d.cumulativeCost) ?? 0}
            yScale={yScale}
            fill={areaColor}
            fillOpacity={0.15}
          />
          <LinePath
            data={data}
            x={(d) => xScale(new Date(d.time)) ?? 0}
            y={(d) => yScale(d.cumulativeCost) ?? 0}
            stroke={areaColor}
            strokeWidth={1.5}
          />
          <AxisBottom
            top={innerH}
            scale={xScale}
            numTicks={4}
            tickLabelProps={() => ({
              fill: 'var(--th-text-muted)',
              fontSize: 9,
              textAnchor: 'middle' as const,
              dy: '0.25em',
            })}
            stroke="var(--th-border)"
            tickStroke="var(--th-border)"
          />
          <AxisLeft
            scale={yScale}
            numTicks={4}
            tickFormat={formatTokenAxis}
            tickLabelProps={() => ({
              fill: 'var(--th-text-muted)',
              fontSize: 9,
              textAnchor: 'end' as const,
              dx: '-0.25em',
              dy: '0.33em',
            })}
            stroke="var(--th-border)"
            tickStroke="var(--th-border)"
          />
        </Group>
      </svg>
    </div>
  );
}
