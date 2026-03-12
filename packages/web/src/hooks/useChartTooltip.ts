/**
 * useChartTooltip — Shared hook for time-series chart tooltips.
 *
 * Encapsulates the bisector-based nearest-point detection, tooltip state,
 * and crosshair positioning used by CumulativeFlow and CostCurve charts.
 *
 * Usage:
 *   const { handleTooltip, hideTooltip, tooltipOpen, tooltipData, tooltipLeft, tooltipTop }
 *     = useChartTooltip({ data, xScale, marginLeft });
 */
import { useCallback } from 'react';
import { useTooltip, defaultStyles } from '@visx/tooltip';
import { localPoint } from '@visx/event';
import { bisector } from 'd3-array';

export { TooltipWithBounds } from '@visx/tooltip';

/** Any data point with a `time` number field (epoch ms). */
export interface TimeSeriesPoint {
  time: number;
}

export interface UseChartTooltipOptions<T extends TimeSeriesPoint> {
  data: T[];
  xScale: { invert: (x: number) => Date; (d: Date): number | undefined };
  marginLeft: number;
  marginTop?: number;
}

export const CHART_TOOLTIP_STYLES: React.CSSProperties = {
  ...defaultStyles,
  background: 'rgba(23, 25, 35, 0.92)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#e5e7eb',
  fontSize: 11,
  lineHeight: '1.4',
  padding: '6px 10px',
  borderRadius: '6px',
};

const bisectTime = bisector<TimeSeriesPoint, number>((d) => d.time).left;

export function useChartTooltip<T extends TimeSeriesPoint>({
  data,
  xScale,
  marginLeft,
  marginTop = 12,
}: UseChartTooltipOptions<T>) {
  const { showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop, tooltipOpen } =
    useTooltip<T>();

  const handleTooltip = useCallback(
    (event: React.TouchEvent<SVGRectElement> | React.MouseEvent<SVGRectElement>) => {
      const coords = localPoint(event);
      if (!coords || data.length === 0) return;
      const x0 = coords.x - marginLeft;
      const time0 = xScale.invert(x0).getTime();
      let idx = bisectTime(data, time0, 1);
      if (idx >= data.length) idx = data.length - 1;
      const d0 = data[idx - 1];
      const d1 = data[idx];
      const nearest = d0 && d1 ? (time0 - d0.time > d1.time - time0 ? d1 : d0) : ((d1 ?? d0) as T);
      if (!nearest) return;
      const tooltipX = (xScale(new Date(nearest.time)) ?? 0) + marginLeft;
      showTooltip({
        tooltipData: nearest,
        tooltipLeft: tooltipX,
        tooltipTop: marginTop,
      });
    },
    [data, xScale, marginLeft, marginTop, showTooltip],
  );

  return { handleTooltip, hideTooltip, tooltipOpen, tooltipData, tooltipLeft, tooltipTop };
}
