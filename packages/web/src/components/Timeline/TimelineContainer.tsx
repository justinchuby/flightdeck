import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { ParentSize } from '@visx/responsive';
import { scaleTime } from '@visx/scale';
import { AxisTop } from '@visx/axis';
import { Group } from '@visx/group';
import { useTooltip, TooltipWithBounds, defaultStyles } from '@visx/tooltip';
import { CommunicationLinks } from './CommunicationLinks';
import { BrushTimeSelector } from './BrushTimeSelector';
import { KeyboardShortcutHelp } from './KeyboardShortcutHelp';
import type {
  TimelineAgent,
  TimelineSegment,
  TimelineLock,
  TimelineData,
} from './useTimelineData';

// ── Constants ────────────────────────────────────────────────────────

const LABEL_WIDTH = 180;
const LANE_HEIGHT = 56;
const LANE_HEIGHT_EXPANDED = 160;
const LANE_GAP = 2;
const AXIS_HEIGHT = 32;
const ZOOM_FACTOR_IN = 0.6;
const ZOOM_FACTOR_OUT = 1.5;
const MIN_VISIBLE_MS = 5_000; // 5 seconds minimum visible range

const STATUS_COLORS: Record<string, { fill: string; border: string }> = {
  creating:   { fill: 'rgba(210,153,34,0.3)',  border: '#d29922' },
  running:    { fill: 'rgba(63,185,80,0.3)',   border: '#3fb950' },
  idle:       { fill: 'rgba(72,79,88,0.2)',    border: '#484f58' },
  completed:  { fill: 'rgba(88,166,255,0.3)',  border: '#58a6ff' },
  failed:     { fill: 'rgba(248,81,73,0.3)',   border: '#f85149' },
  terminated: { fill: 'rgba(240,136,62,0.3)',  border: '#f0883e' },
};

const ROLE_ICONS: Record<string, string> = {
  lead: '👑', architect: '🏗', developer: '👨‍💻', 'code-reviewer': '🔍',
  'critical-reviewer': '🛡', designer: '🎨', secretary: '📋', qa: '🧪',
};

const ROLE_ORDER: Record<string, number> = {
  lead: 0, architect: 1, secretary: 2, developer: 3,
  'code-reviewer': 4, 'critical-reviewer': 5, designer: 6, qa: 7,
};

const ROLE_COLORS: Record<string, string> = {
  lead: '#d29922', architect: '#f0883e', developer: '#3fb950',
  'code-reviewer': '#a371f7', 'critical-reviewer': '#a371f7',
  designer: '#f778ba', secretary: '#79c0ff', qa: '#79c0ff',
};

const segmentTooltipStyles: React.CSSProperties = {
  ...defaultStyles,
  background: '#1e1e2e',
  border: '1px solid #3f3f46',
  color: '#e4e4e7',
  padding: '8px 10px',
  fontSize: '11px',
  fontFamily: 'ui-monospace, monospace',
  lineHeight: 1.5,
  borderRadius: '6px',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs > 0 ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

// ── Sub-components ───────────────────────────────────────────────────

function AgentLabel({ agent, height, isExpanded, isFocused, onClick }: {
  agent: TimelineAgent; height: number; isExpanded: boolean; isFocused: boolean; onClick: () => void;
}) {
  return (
    <div
      className={`flex flex-col justify-center px-3 border-b border-th-border-muted/50 cursor-pointer hover:bg-th-bg-alt/50 transition-colors timeline-focusable ${isFocused ? 'ring-1 ring-inset ring-blue-500 bg-th-bg-alt/30' : ''}`}
      style={{ height, minHeight: height, borderLeft: `3px solid ${ROLE_COLORS[agent.role] ?? '#484f58'}` }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={`${ROLE_ICONS[agent.role] ?? ''} ${agent.role} agent ${agent.shortId}${isExpanded ? ', expanded' : ', collapsed'}. Press Enter to ${isExpanded ? 'collapse' : 'expand'}.`}
      aria-expanded={isExpanded}
      aria-roledescription="agent lane toggle"
    >
      <span className="text-sm font-medium text-th-text-alt truncate">
        {ROLE_ICONS[agent.role] ?? '🤖'} {agent.role}
      </span>
      <span className="text-xs font-mono text-th-text-muted">{agent.shortId}</span>
      {isExpanded && (
        <span className="text-xs text-th-text-muted mt-1">
          {new Date(agent.createdAt).toLocaleTimeString()}
          {agent.endedAt ? ` – ${new Date(agent.endedAt).toLocaleTimeString()}` : ' – active'}
        </span>
      )}
    </div>
  );
}

function AgentLane({ agent, y, height, timeScale, width, locks, onSegmentHover, onSegmentLeave }: {
  agent: TimelineAgent; y: number; height: number;
  timeScale: (d: Date) => number; width: number;
  locks: TimelineLock[];
  onSegmentHover?: (seg: TimelineSegment, event: React.MouseEvent) => void;
  onSegmentLeave?: () => void;
}) {
  const agentLocks = locks.filter(l => l.agentId === agent.id);

  return (
    <g role="row" aria-label={`${agent.role} agent ${agent.shortId} timeline`} aria-roledescription="agent timeline lane">
      {/* Lane background */}
      <rect x={0} y={y} width={width} height={height} fill="transparent" stroke="#27272a" strokeWidth={0.5} />

      {/* Status segments */}
      {agent.segments.map((seg, i) => {
        const x1 = timeScale(new Date(seg.startAt));
        const endDate = seg.endAt ? new Date(seg.endAt) : new Date();
        const x2 = timeScale(endDate);
        const segWidth = Math.max(x2 - x1, 4);
        const colors = STATUS_COLORS[seg.status] ?? STATUS_COLORS.idle;
        const isIdle = seg.status === 'idle';
        const isFailed = seg.status === 'failed';
        return (
          <g key={i}
            onMouseEnter={(e) => onSegmentHover?.(seg, e)}
            onMouseLeave={onSegmentLeave}
          >
            <rect
              x={x1} y={y + 4} width={segWidth} height={height - 8}
              fill={isIdle ? 'url(#idle-hatch)' : colors.fill}
              stroke={colors.border} strokeWidth={isFailed ? 2 : 1} rx={3}
              className={`cursor-pointer${isFailed ? ' timeline-error-highlight' : ''}`}
              filter={isFailed ? 'url(#error-glow)' : undefined}
            />
            {/* Task label overlay on running segments */}
            {segWidth > 60 && (seg.taskLabel || seg.status === 'running') && (
              <foreignObject x={x1 + 4} y={y + 6} width={segWidth - 8} height={height - 16} style={{ pointerEvents: 'none' }}>
                <div className="text-[10px] text-th-text-alt truncate leading-tight pt-0.5">
                  {seg.taskLabel ?? seg.status}
                </div>
              </foreignObject>
            )}
          </g>
        );
      })}

      {/* Lock indicators */}
      {agentLocks.map((lock, i) => {
        const x = timeScale(new Date(lock.acquiredAt));
        return (
          <g key={`lock-${i}`}>
            <text x={x} y={y + height - 4} fontSize={10} fill="#d29922">🔒</text>
            <title>{lock.filePath}</title>
          </g>
        );
      })}
    </g>
  );
}

function TimelineLegend() {
  return (
    <div className="flex flex-wrap gap-4 px-3 py-2 text-xs text-th-text-muted border-t border-th-border-muted timeline-legend" role="group" aria-label="Timeline legend: status colors and communication types">
      {Object.entries(STATUS_COLORS).map(([status, colors]) => (
        <span key={status} className="flex items-center gap-1">
          {status === 'idle' ? (
            <svg width="12" height="12" className="rounded-sm">
              <defs>
                <pattern id="legend-idle-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="4" height="4" fill="rgba(72,79,88,0.15)" />
                  <line x1="0" y1="0" x2="0" y2="4" stroke="rgba(113,120,130,0.25)" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="12" height="12" fill="url(#legend-idle-hatch)" stroke={colors.border} strokeWidth="1" rx="2" />
            </svg>
          ) : (
            <span className="inline-block w-3 h-3 rounded-sm border" style={{ background: colors.fill, borderColor: colors.border }} />
          )}
          {status}
        </span>
      ))}
      <span className="border-l border-th-border pl-4 flex items-center gap-1">
        <span className="inline-block w-4 border-t-2" style={{ borderColor: 'rgba(88,166,255,0.6)' }} /> delegation
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-4 border-t border-dashed" style={{ borderColor: 'rgba(163,113,247,0.5)' }} /> message
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-4 border-t border-dotted" style={{ borderColor: 'rgba(247,120,186,0.4)' }} /> broadcast
      </span>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────

type SortDirection = 'newest-first' | 'oldest-first';

interface TimelineContainerProps {
  data: TimelineData;
  liveMode?: boolean;
  onLiveModeChange?: (live: boolean) => void;
  lastSeenTimestamp?: Date;
}

function TimelineContent({ data, width: containerWidth, liveMode, onLiveModeChange, lastSeenTimestamp }: TimelineContainerProps & { width: number }) {
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [focusedLaneIdx, setFocusedLaneIdx] = useState(-1);
  const [sortDirection, setSortDirection] = useState<SortDirection>('oldest-first');
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const labelRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    tooltipOpen, tooltipData, tooltipLeft, tooltipTop,
    showTooltip, hideTooltip,
  } = useTooltip<TimelineSegment>();

  const handleSegmentHover = useCallback((seg: TimelineSegment, event: React.MouseEvent) => {
    const svgEl = event.currentTarget.closest('svg');
    if (!svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    showTooltip({
      tooltipData: seg,
      tooltipLeft: event.clientX - rect.left,
      tooltipTop: event.clientY - rect.top - 10,
    });
  }, [showTooltip]);

  const fullRange = useMemo(() => ({
    start: new Date(data.timeRange.start),
    end: new Date(data.timeRange.end),
  }), [data.timeRange]);

  const [visibleRange, setVisibleRange] = useState<{ start: Date; end: Date }>(fullRange);

  // Live mode: keep visible range pinned to the latest data
  useEffect(() => {
    if (liveMode) {
      // Preserve current zoom span but shift to show latest activity
      setVisibleRange(prev => {
        const span = prev.end.getTime() - prev.start.getTime();
        const newEnd = fullRange.end.getTime();
        const newStart = Math.max(fullRange.start.getTime(), newEnd - span);
        return { start: new Date(newStart), end: new Date(newEnd) };
      });
    }
    // When not live, preserve user's current zoom/pan — don't reset visibleRange
  }, [fullRange, liveMode]);

  // Zoom helpers that adjust visibleRange instead of a zoom scalar
  // anchorFraction: 0..1 position within visible range to zoom toward (0.5 = center)
  const zoomBy = useCallback((factor: number, anchorFraction = 0.5) => {
    onLiveModeChange?.(false);
    setVisibleRange(prev => {
      const start = prev.start.getTime();
      const end = prev.end.getTime();
      const span = end - start;
      const anchor = start + span * anchorFraction;
      const newSpan = span * factor;
      const fullMs = fullRange.end.getTime() - fullRange.start.getTime();
      const clampedSpan = Math.max(MIN_VISIBLE_MS, Math.min(fullMs, newSpan));
      let newStart = anchor - clampedSpan * anchorFraction;
      let newEnd = anchor + clampedSpan * (1 - anchorFraction);
      if (newStart < fullRange.start.getTime()) {
        newStart = fullRange.start.getTime();
        newEnd = newStart + clampedSpan;
      }
      if (newEnd > fullRange.end.getTime()) {
        newEnd = fullRange.end.getTime();
        newStart = newEnd - clampedSpan;
      }
      newStart = Math.max(newStart, fullRange.start.getTime());
      return { start: new Date(newStart), end: new Date(newEnd) };
    });
  }, [fullRange, onLiveModeChange]);

  const fitToView = useCallback(() => { setVisibleRange(fullRange); }, [fullRange]);

  // Sort agents: lead first, then by role hierarchy, then by spawn time
  const sortedAgents = useMemo(() => {
    const sorted = [...data.agents].sort((a, b) => {
      const ra = ROLE_ORDER[a.role] ?? 99;
      const rb = ROLE_ORDER[b.role] ?? 99;
      if (ra !== rb) return ra - rb;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    return sortDirection === 'newest-first' ? sorted.reverse() : sorted;
  }, [data.agents, sortDirection]);

  const chartWidth = Math.max(containerWidth - LABEL_WIDTH, 400);

  // Lane heights and Y positions
  const laneLayout = useMemo(() => {
    const lanes: { agent: TimelineAgent; y: number; height: number }[] = [];
    let y = 0;
    for (const agent of sortedAgents) {
      const h = expandedAgents.has(agent.id) ? LANE_HEIGHT_EXPANDED : LANE_HEIGHT;
      lanes.push({ agent, y, height: h });
      y += h + LANE_GAP;
    }
    return lanes;
  }, [sortedAgents, expandedAgents]);

  const totalHeight = laneLayout.length > 0
    ? laneLayout[laneLayout.length - 1].y + laneLayout[laneLayout.length - 1].height
    : 0;

  const timeScale = useMemo(
    () => scaleTime({ domain: [visibleRange.start, visibleRange.end], range: [0, chartWidth] }),
    [visibleRange, chartWidth],
  );

  const agentPositions = useMemo(() => {
    const map = new Map<string, number>();
    for (const lane of laneLayout) {
      map.set(lane.agent.id, lane.y);
    }
    return map;
  }, [laneLayout]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Auto-expand agents with failed segments so errors are visible
  useEffect(() => {
    const failedIds = data.agents
      .filter(a => a.segments.some(s => s.status === 'failed'))
      .map(a => a.id);
    if (failedIds.length > 0) {
      setExpandedAgents(prev => {
        const next = new Set(prev);
        let changed = false;
        for (const id of failedIds) {
          if (!next.has(id)) { next.add(id); changed = true; }
        }
        return changed ? next : prev;
      });
    }
  }, [data.agents]);

  // Synced vertical scrolling between labels and timeline
  const syncScroll = useCallback((source: 'label' | 'timeline') => {
    const labelEl = labelRef.current;
    const timelineEl = timelineRef.current;
    if (!labelEl || !timelineEl) return;
    if (source === 'timeline') {
      labelEl.scrollTop = timelineEl.scrollTop;
    } else {
      timelineEl.scrollTop = labelEl.scrollTop;
    }
  }, []);

  // Ctrl/Cmd+Wheel = zoom, plain wheel = vertical scroll
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = e.deltaY > 0 ? ZOOM_FACTOR_OUT : ZOOM_FACTOR_IN;
        const svgEl = el.querySelector('svg');
        if (svgEl) {
          const rect = svgEl.getBoundingClientRect();
          const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          zoomBy(factor, fraction);
        } else {
          zoomBy(factor);
        }
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [zoomBy]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        onLiveModeChange?.(false);
        setVisibleRange(prev => {
          const span = prev.end.getTime() - prev.start.getTime();
          const shift = span * 0.1;
          const newStart = Math.max(fullRange.start.getTime(), prev.start.getTime() - shift);
          const newEnd = newStart + span;
          return { start: new Date(newStart), end: new Date(Math.min(newEnd, fullRange.end.getTime())) };
        });
        break;
      case 'ArrowRight':
        e.preventDefault();
        setVisibleRange(prev => {
          const span = prev.end.getTime() - prev.start.getTime();
          const shift = span * 0.1;
          const newEnd = Math.min(fullRange.end.getTime(), prev.end.getTime() + shift);
          const newStart = newEnd - span;
          return { start: new Date(Math.max(newStart, fullRange.start.getTime())), end: new Date(newEnd) };
        });
        break;
      case 'ArrowDown':
        e.preventDefault();
        setFocusedLaneIdx(prev => Math.min(prev + 1, sortedAgents.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedLaneIdx(prev => Math.max(prev - 1, 0));
        break;
      case '+':
      case '=':
        if (e.ctrlKey || e.metaKey || e.key === '+') {
          e.preventDefault();
          zoomBy(ZOOM_FACTOR_IN);
        }
        break;
      case '-':
        if (e.ctrlKey || e.metaKey || e.key === '-') {
          e.preventDefault();
          zoomBy(ZOOM_FACTOR_OUT);
        }
        break;
      case 'Home':
        e.preventDefault();
        setVisibleRange(fullRange);
        break;
      case 'End': {
        e.preventDefault();
        const fullMs = fullRange.end.getTime() - fullRange.start.getTime();
        const last20 = fullMs * 0.2;
        setVisibleRange({
          start: new Date(fullRange.end.getTime() - last20),
          end: new Date(fullRange.end.getTime()),
        });
        break;
      }
      case 'Enter':
      case ' ':
        if (focusedLaneIdx >= 0 && focusedLaneIdx < sortedAgents.length) {
          e.preventDefault();
          toggleExpand(sortedAgents[focusedLaneIdx].id);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setFocusedLaneIdx(-1);
        containerRef.current?.focus();
        break;
      case 'Tab':
        if (!e.shiftKey) {
          if (focusedLaneIdx < sortedAgents.length - 1) {
            e.preventDefault();
            setFocusedLaneIdx(prev => prev + 1);
          }
        } else {
          if (focusedLaneIdx > 0) {
            e.preventDefault();
            setFocusedLaneIdx(prev => prev - 1);
          }
        }
        break;
      case 'f':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          containerRef.current?.dispatchEvent(new CustomEvent('timeline:focus-filter', { bubbles: true }));
        }
        break;
      case '?':
        e.preventDefault();
        setShowShortcutHelp(prev => !prev);
        break;
    }
  }, [focusedLaneIdx, sortedAgents, toggleExpand, zoomBy, fullRange, onLiveModeChange]);

  if (data.agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-th-text-muted text-sm" role="status">
        No agent activity to display.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full timeline-container" ref={containerRef} tabIndex={0} onKeyDown={handleKeyDown} role="application" aria-label="Timeline navigation: use arrow keys to pan, +/- to zoom, Tab to navigate lanes, Enter to expand" aria-roledescription="interactive timeline">
      {/* Zoom controls */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-th-border-muted timeline-toolbar" role="toolbar" aria-label="Timeline controls">
        <span className="text-sm text-th-text-muted">
          {sortedAgents.length} agents · {data.communications.length} communications
        </span>
        <div className="flex items-center gap-2">
          <button
            className={`flex items-center gap-1.5 px-2 py-0.5 text-xs rounded transition-colors ${
              liveMode
                ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-700/50'
                : 'text-th-text-muted bg-th-bg-alt hover:bg-th-bg-muted'
            }`}
            onClick={() => onLiveModeChange?.(!liveMode)}
            aria-label={liveMode ? 'Disable live mode' : 'Enable live mode'}
          >
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${liveMode ? 'bg-emerald-400 animate-pulse motion-reduce:animate-none' : 'bg-zinc-600'}`} />
            Live
          </button>
          <button
            className="px-2 py-0.5 text-xs text-th-text-muted bg-th-bg-alt rounded hover:bg-th-bg-muted"
            onClick={() => zoomBy(ZOOM_FACTOR_IN)}
            aria-label="Zoom in"
          >+</button>
          <button
            className="px-2 py-0.5 text-xs text-th-text-muted bg-th-bg-alt rounded hover:bg-th-bg-muted"
            onClick={() => zoomBy(ZOOM_FACTOR_OUT)}
            aria-label="Zoom out"
          >−</button>
          <button
            className="px-2 py-0.5 text-xs text-th-text-muted bg-th-bg-alt rounded hover:bg-th-bg-muted"
            onClick={fitToView}
            aria-label="Fit timeline to view"
          >Fit</button>
          <button
            className="px-2 py-0.5 text-xs text-th-text-muted bg-th-bg-alt rounded hover:bg-th-bg-muted"
            onClick={() => setSortDirection(d => d === 'oldest-first' ? 'newest-first' : 'oldest-first')}
            aria-label={`Sort: ${sortDirection}. Click to toggle.`}
          >{sortDirection === 'oldest-first' ? '↑' : '↓'}</button>
        </div>
      </div>

      {/* Brush time range selector */}
      <BrushTimeSelector
        fullRange={fullRange}
        visibleRange={visibleRange}
        onRangeChange={(range) => { onLiveModeChange?.(false); setVisibleRange(range); }}
        agents={sortedAgents}
        width={containerWidth}
      />

      {/* Main area: fixed labels + scrollable timeline */}
      <div className="flex flex-1 overflow-hidden">
        {/* Fixed label column */}
        <div
          ref={labelRef}
          className="flex-shrink-0 border-r border-th-border/50 overflow-y-auto overflow-x-hidden"
          style={{ width: LABEL_WIDTH }}
          onScroll={() => syncScroll('label')}
        >
          {/* Spacer for axis alignment */}
          <div style={{ height: AXIS_HEIGHT }} className="border-b border-th-border-muted/50" />
          {laneLayout.map(({ agent, height }, idx) => (
            <AgentLabel
              key={agent.id}
              agent={agent}
              height={height + LANE_GAP}
              isExpanded={expandedAgents.has(agent.id)}
              isFocused={idx === focusedLaneIdx}
              onClick={() => toggleExpand(agent.id)}
            />
          ))}
        </div>

        {/* Scrollable timeline */}
        <div
          ref={timelineRef}
          className="flex-1 overflow-auto"
          onScroll={() => syncScroll('timeline')}
        >
          <svg width={chartWidth} height={AXIS_HEIGHT + totalHeight} role="img" aria-label={`Team collaboration timeline showing ${sortedAgents.length} agents over time`} style={{ position: 'relative' }}>
            {/* Idle hatch pattern */}
            <defs>
              <pattern id="idle-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="rgba(72,79,88,0.15)" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(113,120,130,0.25)" strokeWidth="1.5" />
              </pattern>
              <filter id="error-glow">
                <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#f85149" floodOpacity="0.5" />
              </filter>
            </defs>
            {/* Time axis (sticky behavior via SVG position) */}
            <Group top={AXIS_HEIGHT - 4}>
              <AxisTop
                scale={timeScale}
                stroke="#3f3f46"
                tickStroke="#3f3f46"
                tickLabelProps={() => ({
                  fill: '#a1a1aa',
                  fontSize: 10,
                  fontFamily: 'monospace',
                  textAnchor: 'middle' as const,
                  dy: -4,
                })}
                numTicks={Math.max(Math.floor(chartWidth / 120), 3)}
              />
            </Group>

            {/* Agent swim lanes */}
            <Group top={AXIS_HEIGHT}>
              {laneLayout.map(({ agent, y, height }) => (
                <AgentLane
                  key={agent.id}
                  agent={agent}
                  y={y}
                  height={height}
                  timeScale={timeScale}
                  width={chartWidth}
                  locks={data.locks}
                  onSegmentHover={handleSegmentHover}
                  onSegmentLeave={hideTooltip}
                />
              ))}

              {/* Communication links overlay */}
              <CommunicationLinks
                communications={data.communications}
                agentPositions={agentPositions}
                xScale={timeScale}
                laneHeight={LANE_HEIGHT}
              />

              {/* 'You left off here' marker */}
              {lastSeenTimestamp && (() => {
                const x = timeScale(lastSeenTimestamp);
                if (x >= 0 && x <= chartWidth) {
                  return (
                    <g aria-label="You left off here marker">
                      <line x1={x} y1={0} x2={x} y2={totalHeight} stroke="#58a6ff" strokeWidth={1.5} strokeDasharray="6 3" opacity={0.7} />
                      <text x={x + 4} y={12} fontSize={9} fill="#58a6ff" fontFamily="monospace" opacity={0.8}>You left off here</text>
                    </g>
                  );
                }
                return null;
              })()}
            </Group>
          </svg>

          {/* Segment tooltip */}
          {tooltipOpen && tooltipData && (
            <TooltipWithBounds
              left={tooltipLeft}
              top={tooltipTop}
              style={segmentTooltipStyles}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: (STATUS_COLORS[tooltipData.status] ?? STATUS_COLORS.idle).border }}
                />
                <span className="font-semibold capitalize">{tooltipData.status}</span>
              </div>
              {tooltipData.taskLabel && (
                <div className="text-th-text-muted mb-1">{tooltipData.taskLabel.length > 80 ? tooltipData.taskLabel.slice(0, 80) + '…' : tooltipData.taskLabel}</div>
              )}
              <div className="text-th-text-muted text-[10px]">
                {new Date(tooltipData.startAt).toLocaleTimeString()}
                {' → '}
                {tooltipData.endAt ? new Date(tooltipData.endAt).toLocaleTimeString() : 'now'}
                {' · '}
                {formatDuration(
                  (tooltipData.endAt ? new Date(tooltipData.endAt).getTime() : Date.now()) -
                  new Date(tooltipData.startAt).getTime()
                )}
              </div>
            </TooltipWithBounds>
          )}
        </div>
      </div>

      <TimelineLegend />

      <KeyboardShortcutHelp isOpen={showShortcutHelp} onClose={() => setShowShortcutHelp(false)} />
    </div>
  );
}

export function TimelineContainer({ data, liveMode, onLiveModeChange, lastSeenTimestamp }: TimelineContainerProps) {
  return (
    <div className="bg-th-bg rounded-lg border border-th-border-muted min-h-[300px] flex flex-col" style={{ height: 'calc(100vh - 160px)' }}>
      <ParentSize>
        {({ width }) => width > 0 ? <TimelineContent data={data} width={width} liveMode={liveMode} onLiveModeChange={onLiveModeChange} lastSeenTimestamp={lastSeenTimestamp} /> : null}
      </ParentSize>
    </div>
  );
}
