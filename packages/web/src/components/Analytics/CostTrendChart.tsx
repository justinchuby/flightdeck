import { useMemo } from 'react';
import { Group } from '@visx/group';
import { scaleLinear, scalePoint } from '@visx/scale';
import { LinePath, AreaClosed } from '@visx/shape';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { useParentSize } from '@visx/responsive';
import type { AnalyticsOverview } from './types';

interface CostTrendChartProps {
  overview: AnalyticsOverview;
}

export function CostTrendChart({ overview }: CostTrendChartProps) {
  const { parentRef, width } = useParentSize({ debounceTime: 100 });
  const height = 160;
  const margin = { top: 10, right: 16, bottom: 28, left: 48 };

  const { sessions } = overview;

  // Build token trend — aggregate sessions by date to avoid duplicate keys
  const tokenTrend = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const s of sessions) {
      const date = s.startedAt.slice(0, 10);
      byDate.set(date, (byDate.get(date) ?? 0) + s.totalInputTokens + s.totalOutputTokens);
    }
    return Array.from(byDate, ([date, tokens]) => ({ date, tokens }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [sessions]);
  const avgTokensPerSession = sessions.length > 0
    ? Math.round(sessions.reduce((s, x) => s + x.totalInputTokens + x.totalOutputTokens, 0) / sessions.length)
    : 0;

  const innerW = Math.max(width - margin.left - margin.right, 0);
  const innerH = Math.max(height - margin.top - margin.bottom, 0);

  const xScale = useMemo(
    () => scalePoint({ domain: tokenTrend.map((d) => d.date), range: [0, innerW] }),
    [tokenTrend, innerW],
  );

  const yMax = Math.max(...tokenTrend.map((d) => d.tokens), avgTokensPerSession, 1);
  const yScale = useMemo(
    () => scaleLinear({ domain: [0, yMax * 1.15], range: [innerH, 0] }),
    [yMax, innerH],
  );

  const formatTokenAxis = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
    return String(n);
  };

  if (tokenTrend.length === 0) {
    return (
      <div className="bg-surface-raised border border-th-border rounded-lg p-4 h-[200px] flex items-center justify-center" data-testid="cost-trend-chart">
        <p className="text-xs text-th-text-muted">No token data yet</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-raised border border-th-border rounded-lg p-4" data-testid="cost-trend-chart">
      <h3 className="text-xs font-semibold text-th-text-muted uppercase tracking-wide mb-2">Token Trend</h3>
      <div ref={parentRef} style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height}>
            <Group left={margin.left} top={margin.top}>
              {/* Grid lines (manual) */}
              {yScale.ticks(4).map((tick, i) => (
                <line
                  key={`grid-${i}`}
                  x1={0}
                  x2={innerW}
                  y1={yScale(tick)}
                  y2={yScale(tick)}
                  stroke="var(--th-border)"
                  strokeOpacity={0.3}
                />
              ))}

              {/* Area fill */}
              <AreaClosed
                data={tokenTrend}
                x={(d) => xScale(d.date) ?? 0}
                y={(d) => yScale(d.tokens)}
                yScale={yScale}
                fill="rgb(var(--chart-1))"
                fillOpacity={0.1}
              />

              {/* Line */}
              <LinePath
                data={tokenTrend}
                x={(d) => xScale(d.date) ?? 0}
                y={(d) => yScale(d.tokens)}
                stroke="rgb(var(--chart-1))"
                strokeWidth={2}
              />

              {/* Average dashed line */}
              <line
                x1={0}
                x2={innerW}
                y1={yScale(avgTokensPerSession)}
                y2={yScale(avgTokensPerSession)}
                stroke="var(--th-border)"
                strokeDasharray="4 3"
                strokeWidth={1}
              />

              {/* Data points */}
              {tokenTrend.map((d) => (
                <circle
                  key={d.date}
                  cx={xScale(d.date) ?? 0}
                  cy={yScale(d.tokens)}
                  r={3}
                  fill="rgb(var(--chart-1))"
                >
                  <title>{`${d.date}: ${formatTokenAxis(d.tokens)} tokens`}</title>
                </circle>
              ))}

              <AxisBottom
                scale={xScale}
                top={innerH}
                stroke="#6b7280"
                tickStroke="#6b7280"
                tickLabelProps={() => ({ fill: '#9ca3af', fontSize: 9, textAnchor: 'middle' as const })}
                numTicks={Math.min(tokenTrend.length, 6)}
              />
              <AxisLeft
                scale={yScale}
                stroke="#6b7280"
                tickStroke="#6b7280"
                tickLabelProps={() => ({ fill: '#9ca3af', fontSize: 9, textAnchor: 'end' as const })}
                tickFormat={(v) => formatTokenAxis(Number(v))}
                numTicks={4}
              />
            </Group>
          </svg>
        )}
      </div>
      <p className="text-[10px] text-th-text-muted mt-1">
        Avg: {formatTokenAxis(avgTokensPerSession)} tokens per session
      </p>
    </div>
  );
}
