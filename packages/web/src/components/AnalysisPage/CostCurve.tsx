import { useMemo } from 'react';
import { Group } from '@visx/group';
import { AreaClosed, LinePath, Line } from '@visx/shape';
import { scaleLinear, scaleTime } from '@visx/scale';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { ParentSize } from '@visx/responsive';
import { useChartTooltip, TooltipWithBounds, CHART_TOOLTIP_STYLES } from '../../hooks/useChartTooltip';

export interface CostPoint {
  time: number;
  cumulativeCost: number;      // total tokens (kept for backward compat)
  cumulativeInput?: number;    // cumulative input tokens
  cumulativeOutput?: number;   // cumulative output tokens
}

interface CostCurveProps {
  data: CostPoint[];
  width?: number;
  height?: number;
}

const MARGIN = { top: 12, right: 12, bottom: 28, left: 36 };
/** Vertical space reserved for card padding (32px) + title/legend row (~24px) */
const SVG_HEADER_OFFSET = 56;
const INPUT_COLOR = '#60a5fa';   // blue-400
const OUTPUT_COLOR = 'rgb(var(--chart-success))';
const TOTAL_FALLBACK_COLOR = '#34d399'; // emerald-400 for non-breakdown mode

const formatTokens = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
};

const CARD_HEIGHT = 250;

export function CostCurve({ data }: { data: CostPoint[] }) {
  return (
    <div className="bg-surface-raised border border-th-border rounded-lg p-4 relative" style={{ height: CARD_HEIGHT }} data-testid="cost-curve">
      <ParentSize debounceTime={100}>
        {({ width: parentWidth }) => (
          <CostCurveInner data={data} width={Math.max(parentWidth, 100)} height={CARD_HEIGHT} />
        )}
      </ParentSize>
    </div>
  );
}

function CostCurveInner({ data, width, height }: CostCurveProps) {
  const svgH = height - SVG_HEADER_OFFSET;
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = svgH - MARGIN.top - MARGIN.bottom;

  const hasBreakdown = data.some(
    (d) => d.cumulativeInput != null && d.cumulativeOutput != null,
  );

  const { xScale, yScale } = useMemo(() => {
    if (data.length === 0) {
      return {
        xScale: scaleTime({ domain: [new Date(), new Date()], range: [0, innerW] }),
        yScale: scaleLinear({ domain: [0, 1], range: [innerH, 0] }),
      };
    }
    const times = data.map((d) => d.time);
    const maxTokens = hasBreakdown
      ? Math.max(
          ...data.map((d) => d.cumulativeInput ?? 0),
          ...data.map((d) => d.cumulativeOutput ?? 0),
          1,
        )
      : Math.max(...data.map((d) => d.cumulativeCost), 1);

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

  const { handleTooltip, hideTooltip, tooltipOpen, tooltipData, tooltipLeft, tooltipTop } =
    useChartTooltip<CostPoint>({ data, xScale, marginLeft: MARGIN.left, marginTop: MARGIN.top });

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-th-text-muted opacity-60">No token data</p>
      </div>
    );
  }

  const maxVal = Math.max(...data.map((d) => d.cumulativeCost));
  if (maxVal === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-th-text-muted opacity-60">Waiting for token data…</p>
      </div>
    );
  }

  const formatTokenAxis = (v: number | { valueOf(): number }) => {
    const n = typeof v === 'number' ? v : v.valueOf();
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
    return String(n);
  };

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[11px] font-medium text-th-text-muted uppercase tracking-wider">
          Token Usage
        </h3>
        {hasBreakdown && (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-[9px] text-th-text-muted">
              <span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: INPUT_COLOR }} />
              Input
            </span>
            <span className="flex items-center gap-1 text-[9px] text-th-text-muted">
              <span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: OUTPUT_COLOR }} />
              Output
            </span>
          </div>
        )}
      </div>
      <svg width={width} height={svgH}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          {hasBreakdown ? (
            <>
              {/* Input area + line */}
              <AreaClosed
                data={data}
                x={(d) => xScale(new Date(d.time)) ?? 0}
                y={(d) => yScale(d.cumulativeInput ?? 0) ?? 0}
                yScale={yScale}
                fill={INPUT_COLOR}
                fillOpacity={0.15}
              />
              <LinePath
                data={data}
                x={(d) => xScale(new Date(d.time)) ?? 0}
                y={(d) => yScale(d.cumulativeInput ?? 0) ?? 0}
                stroke={INPUT_COLOR}
                strokeWidth={1.5}
              />
              {/* Output area + line */}
              <AreaClosed
                data={data}
                x={(d) => xScale(new Date(d.time)) ?? 0}
                y={(d) => yScale(d.cumulativeOutput ?? 0) ?? 0}
                yScale={yScale}
                fill={OUTPUT_COLOR}
                fillOpacity={0.15}
              />
              <LinePath
                data={data}
                x={(d) => xScale(new Date(d.time)) ?? 0}
                y={(d) => yScale(d.cumulativeOutput ?? 0) ?? 0}
                stroke={OUTPUT_COLOR}
                strokeWidth={1.5}
              />
            </>
          ) : (
            <>
              <AreaClosed
                data={data}
                x={(d) => xScale(new Date(d.time)) ?? 0}
                y={(d) => yScale(d.cumulativeCost) ?? 0}
                yScale={yScale}
                fill={OUTPUT_COLOR}
                fillOpacity={0.15}
              />
              <LinePath
                data={data}
                x={(d) => xScale(new Date(d.time)) ?? 0}
                y={(d) => yScale(d.cumulativeCost) ?? 0}
                stroke={OUTPUT_COLOR}
                strokeWidth={1.5}
              />
            </>
          )}

          {/* Crosshair on hover */}
          {tooltipOpen && tooltipData && (
            <>
              <Line
                from={{ x: xScale(new Date(tooltipData.time)) ?? 0, y: 0 }}
                to={{ x: xScale(new Date(tooltipData.time)) ?? 0, y: innerH }}
                stroke="#9ca3af"
                strokeWidth={1}
                strokeDasharray="3,3"
                pointerEvents="none"
              />
              {hasBreakdown ? (
                <>
                  <circle
                    cx={xScale(new Date(tooltipData.time)) ?? 0}
                    cy={yScale(tooltipData.cumulativeInput ?? 0) ?? 0}
                    r={3}
                    fill={INPUT_COLOR}
                    stroke="#1a1a2e"
                    strokeWidth={1.5}
                    pointerEvents="none"
                  />
                  <circle
                    cx={xScale(new Date(tooltipData.time)) ?? 0}
                    cy={yScale(tooltipData.cumulativeOutput ?? 0) ?? 0}
                    r={3}
                    fill={OUTPUT_COLOR}
                    stroke="#1a1a2e"
                    strokeWidth={1.5}
                    pointerEvents="none"
                  />
                </>
              ) : (
                <circle
                  cx={xScale(new Date(tooltipData.time)) ?? 0}
                  cy={yScale(tooltipData.cumulativeCost) ?? 0}
                  r={3}
                  fill={TOTAL_FALLBACK_COLOR}
                  stroke="#1a1a2e"
                  strokeWidth={1.5}
                  pointerEvents="none"
                />
              )}
            </>
          )}

          {/* Invisible overlay for mouse events */}
          <rect
            width={innerW}
            height={innerH}
            fill="transparent"
            onMouseMove={handleTooltip}
            onTouchMove={handleTooltip}
            onMouseLeave={hideTooltip}
            onTouchEnd={hideTooltip}
          />

          <AxisBottom
            top={innerH}
            scale={xScale}
            numTicks={4}
            hideZero
            tickFormat={(d) => {
              const date = d instanceof Date ? d : new Date(d as number);
              return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }}
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
            hideZero
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
      {tooltipOpen && tooltipData && (
        <TooltipWithBounds
          left={tooltipLeft}
          top={tooltipTop}
          style={CHART_TOOLTIP_STYLES}
        >
          <div style={{ fontWeight: 600, marginBottom: 3 }}>
            {new Date(tooltipData.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
          {hasBreakdown ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: INPUT_COLOR, flexShrink: 0 }} />
                <span>Input: <strong>{formatTokens(tooltipData.cumulativeInput ?? 0)}</strong></span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: OUTPUT_COLOR, flexShrink: 0 }} />
                <span>Output: <strong>{formatTokens((tooltipData.cumulativeOutput ?? 0))}</strong></span>
              </div>
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: 3, paddingTop: 3, fontSize: 10, opacity: 0.7 }}>
                Total: {formatTokens(tooltipData.cumulativeCost)}
              </div>
            </>
          ) : (
            <div>Total: <strong>{formatTokens(tooltipData.cumulativeCost)}</strong></div>
          )}
        </TooltipWithBounds>
      )}
    </div>
  );
}
