import { useMemo, useRef, useCallback, useEffect } from 'react';
import { Brush } from '@visx/brush';
import type BaseBrush from '@visx/brush/lib/BaseBrush';
import { scaleTime, scaleLinear } from '@visx/scale';
import { Group } from '@visx/group';
import type { Bounds } from '@visx/brush/lib/types';
import type { TimelineAgent } from './useTimelineData';

// ── Types ────────────────────────────────────────────────────────────

export interface BrushTimeSelectorProps {
  /** Full time range of the project */
  fullRange: { start: Date; end: Date };
  /** Currently visible time range (controlled) */
  visibleRange: { start: Date; end: Date };
  /** Called when brush selection changes */
  onRangeChange: (range: { start: Date; end: Date }) => void;
  /** All agents for mini-timeline overview */
  agents: TimelineAgent[];
  /** Component width from parent */
  width: number;
}

// ── Constants ────────────────────────────────────────────────────────

const BRUSH_HEIGHT = 48;
const MINI_LANE_HEIGHT = 4;
const MINI_LANE_GAP = 1;
const PADDING = { top: 8, bottom: 4, left: 0, right: 0 };

const MINI_STATUS_COLORS: Record<string, string> = {
  creating:   '#d29922',
  running:    '#3fb950',
  idle:       '#484f58',
  completed:  '#58a6ff',
  failed:     '#f85149',
  terminated: '#f0883e',
};

// ── Component ────────────────────────────────────────────────────────

export function BrushTimeSelector({
  fullRange,
  visibleRange,
  onRangeChange,
  agents,
  width,
}: BrushTimeSelectorProps) {
  const brushRef = useRef<BaseBrush | null>(null);

  const innerWidth = width - PADDING.left - PADDING.right;
  const innerHeight = BRUSH_HEIGHT - PADDING.top - PADDING.bottom;

  const xScale = useMemo(
    () => scaleTime<number>({
      domain: [fullRange.start, fullRange.end],
      range: [0, innerWidth],
    }),
    [fullRange, innerWidth],
  );

  const yScale = useMemo(
    () => scaleLinear<number>({
      domain: [0, innerHeight],
      range: [0, innerHeight],
    }),
    [innerHeight],
  );

  // Compute initial brush position from visibleRange
  const initialBrushPosition = useMemo(() => ({
    start: { x: xScale(visibleRange.start) },
    end: { x: xScale(visibleRange.end) },
  }), []); // Only set once on mount

  const handleBrushEnd = useCallback((bounds: Bounds | null) => {
    if (!bounds) return;
    // bounds.x0/x1 are already domain values (timestamps) — @visx/brush
    // calls convertRangeToDomain internally before invoking onBrushEnd
    const newStart = new Date(bounds.x0);
    const newEnd = new Date(bounds.x1);
    // Prevent degenerate ranges
    if (newEnd.getTime() - newStart.getTime() < 1000) return;
    onRangeChange({ start: newStart, end: newEnd });
  }, [onRangeChange]);

  // Update brush position when visibleRange changes externally (e.g., from zoom buttons)
  const prevRangeRef = useRef(visibleRange);
  useEffect(() => {
    if (
      prevRangeRef.current.start.getTime() === visibleRange.start.getTime() &&
      prevRangeRef.current.end.getTime() === visibleRange.end.getTime()
    ) return;
    prevRangeRef.current = visibleRange;
    if (!brushRef.current) return;
    const x0 = xScale(visibleRange.start);
    const x1 = xScale(visibleRange.end);
    brushRef.current.updateBrush((prev) => ({
      ...prev,
      start: { ...prev.start, x: x0 },
      end: { ...prev.end, x: x1 },
      extent: { ...prev.extent, x0, x1, y0: 0, y1: innerHeight },
    }));
  }, [visibleRange, xScale, innerHeight]);

  if (innerWidth <= 0) return null;

  return (
    <div className="border-b border-th-border-muted bg-th-bg/50" style={{ height: BRUSH_HEIGHT }} role="region" aria-label="Timeline range selector: drag handles to adjust visible time range" aria-roledescription="minimap">
      <svg width={width} height={BRUSH_HEIGHT} aria-hidden="true">
        <Group top={PADDING.top} left={PADDING.left}>
          {/* Mini agent lanes background */}
          {agents.map((agent, i) => {
            const y = i * (MINI_LANE_HEIGHT + MINI_LANE_GAP);
            if (y + MINI_LANE_HEIGHT > innerHeight) return null;
            return (
              <g key={agent.id}>
                {agent.segments.map((seg, j) => {
                  const x1 = xScale(new Date(seg.startAt));
                  const endDate = seg.endAt ? new Date(seg.endAt) : fullRange.end;
                  const x2 = xScale(endDate);
                  const color = MINI_STATUS_COLORS[seg.status] ?? MINI_STATUS_COLORS.idle;
                  return (
                    <rect
                      key={j}
                      x={x1}
                      y={y}
                      width={Math.max(x2 - x1, 1)}
                      height={MINI_LANE_HEIGHT}
                      fill={color}
                      opacity={0.7}
                      rx={1}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* Brush overlay */}
          <Brush
            xScale={xScale}
            yScale={yScale}
            width={innerWidth}
            height={innerHeight}
            handleSize={8}
            innerRef={brushRef}
            resizeTriggerAreas={['left', 'right']}
            brushDirection="horizontal"
            initialBrushPosition={initialBrushPosition}
            onBrushEnd={handleBrushEnd}
            selectedBoxStyle={{
              fill: 'rgba(88, 166, 255, 0.15)',
              stroke: '#58a6ff',
              strokeWidth: 1,
              strokeOpacity: 0.8,
            }}
            useWindowMoveEvents
            disableDraggingSelection={false}
          />
        </Group>
      </svg>
    </div>
  );
}
