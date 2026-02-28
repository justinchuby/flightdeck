import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { ParentSize } from '@visx/responsive';
import { scaleTime } from '@visx/scale';
import { AxisTop } from '@visx/axis';
import { Group } from '@visx/group';
import { CommunicationLinks } from './CommunicationLinks';
import type {
  TimelineAgent,
  TimelineLock,
  TimelineData,
  TimelineComm,
} from './useTimelineData';

// ── Constants ────────────────────────────────────────────────────────

const LABEL_WIDTH = 180;
const LANE_HEIGHT = 56;
const LANE_HEIGHT_EXPANDED = 160;
const LANE_GAP = 2;
const AXIS_HEIGHT = 32;
const MIN_ZOOM = 0.002;   // px per ms (very zoomed out)
const MAX_ZOOM = 2;        // px per ms (very zoomed in)
const DEFAULT_ZOOM = 0.05; // px per ms

const STATUS_COLORS: Record<string, { fill: string; border: string }> = {
  creating:   { fill: 'rgba(210,153,34,0.3)',  border: '#d29922' },
  running:    { fill: 'rgba(63,185,80,0.3)',   border: '#3fb950' },
  idle:       { fill: 'rgba(72,79,88,0.2)',    border: '#484f58' },
  completed:  { fill: 'rgba(88,166,255,0.3)',  border: '#58a6ff' },
  failed:     { fill: 'rgba(248,81,73,0.3)',   border: '#f85149' },
  terminated: { fill: 'rgba(240,136,62,0.3)',  border: '#f0883e' },
};

const COMM_STYLES: Record<string, { stroke: string }> = {
  delegation: { stroke: 'rgba(88,166,255,0.60)' },
  message:    { stroke: 'rgba(163,113,247,0.50)' },
  broadcast:  { stroke: 'rgba(247,120,186,0.40)' },
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

const LEGEND_COMM_COLORS = {
  delegation: 'rgba(88,166,255,0.6)',
  message: 'rgba(163,113,247,0.5)',
  broadcast: 'rgba(247,120,186,0.4)',
};

// ── Sub-components ───────────────────────────────────────────────────

function AgentLabel({ agent, height, isExpanded, onClick }: {
  agent: TimelineAgent; height: number; isExpanded: boolean; onClick: () => void;
}) {
  return (
    <div
      className="flex flex-col justify-center px-3 border-b border-zinc-800/50 cursor-pointer hover:bg-zinc-800/50 transition-colors"
      style={{ height, minHeight: height, borderLeft: `3px solid ${ROLE_COLORS[agent.role] ?? '#484f58'}` }}
      onClick={onClick}
    >
      <span className="text-sm font-medium text-zinc-200 truncate">
        {ROLE_ICONS[agent.role] ?? '🤖'} {agent.role}
      </span>
      <span className="text-xs font-mono text-zinc-500">{agent.shortId}</span>
      {isExpanded && (
        <span className="text-xs text-zinc-600 mt-1">
          {new Date(agent.createdAt).toLocaleTimeString()}
          {agent.endedAt ? ` – ${new Date(agent.endedAt).toLocaleTimeString()}` : ' – active'}
        </span>
      )}
    </div>
  );
}

function AgentLane({ agent, y, height, timeScale, width, locks }: {
  agent: TimelineAgent; y: number; height: number;
  timeScale: (d: Date) => number; width: number;
  locks: TimelineLock[];
}) {
  const agentLocks = locks.filter(l => l.agentId === agent.id);

  return (
    <g>
      {/* Lane background */}
      <rect x={0} y={y} width={width} height={height} fill="transparent" stroke="#27272a" strokeWidth={0.5} />

      {/* Status segments */}
      {agent.segments.map((seg, i) => {
        const x1 = timeScale(new Date(seg.startAt));
        const endDate = seg.endAt ? new Date(seg.endAt) : new Date();
        const x2 = timeScale(endDate);
        const segWidth = Math.max(x2 - x1, 4);
        const colors = STATUS_COLORS[seg.status] ?? STATUS_COLORS.idle;
        return (
          <g key={i}>
            <rect
              x={x1} y={y + 4} width={segWidth} height={height - 8}
              fill={colors.fill} stroke={colors.border} strokeWidth={1} rx={3}
            />
            {/* Task label overlay on running segments */}
            {segWidth > 60 && (seg.taskLabel || seg.status === 'running') && (
              <foreignObject x={x1 + 4} y={y + 6} width={segWidth - 8} height={height - 16}>
                <div className="text-[10px] text-zinc-300 truncate leading-tight pt-0.5">
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
    <div className="flex flex-wrap gap-4 px-3 py-2 text-xs text-zinc-500 border-t border-zinc-800">
      {Object.entries(STATUS_COLORS).map(([status, colors]) => (
        <span key={status} className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm border" style={{ background: colors.fill, borderColor: colors.border }} />
          {status}
        </span>
      ))}
      <span className="border-l border-zinc-700 pl-4 flex items-center gap-1">
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

interface TimelineContainerProps {
  data: TimelineData;
}

function TimelineContent({ data, width: containerWidth }: TimelineContainerProps & { width: number }) {
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const labelRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Sort agents: lead first, then by role hierarchy, then by spawn time
  const sortedAgents = useMemo(() => {
    return [...data.agents].sort((a, b) => {
      const ra = ROLE_ORDER[a.role] ?? 99;
      const rb = ROLE_ORDER[b.role] ?? 99;
      if (ra !== rb) return ra - rb;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }, [data.agents]);

  const timeRange = useMemo(() => ({
    start: new Date(data.timeRange.start),
    end: new Date(data.timeRange.end),
  }), [data.timeRange]);

  const durationMs = timeRange.end.getTime() - timeRange.start.getTime();
  const chartWidth = Math.max(durationMs * zoom, containerWidth - LABEL_WIDTH);

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
    () => scaleTime({ domain: [timeRange.start, timeRange.end], range: [0, chartWidth] }),
    [timeRange, chartWidth],
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
        const factor = e.deltaY > 0 ? 0.85 : 1.18;
        setZoom(prev => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev * factor)));
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  if (data.agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-500 text-sm">
        No agent activity to display.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Zoom controls */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <span className="text-sm text-zinc-400">
          {sortedAgents.length} agents · {data.communications.length} communications
        </span>
        <div className="flex items-center gap-2">
          <button
            className="px-2 py-0.5 text-xs text-zinc-400 bg-zinc-800 rounded hover:bg-zinc-700"
            onClick={() => setZoom(prev => Math.min(MAX_ZOOM, prev * 1.5))}
          >+</button>
          <button
            className="px-2 py-0.5 text-xs text-zinc-400 bg-zinc-800 rounded hover:bg-zinc-700"
            onClick={() => setZoom(prev => Math.max(MIN_ZOOM, prev * 0.67))}
          >−</button>
          <button
            className="px-2 py-0.5 text-xs text-zinc-400 bg-zinc-800 rounded hover:bg-zinc-700"
            onClick={() => {
              const fitZoom = (containerWidth - LABEL_WIDTH - 32) / Math.max(durationMs, 1);
              setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fitZoom)));
            }}
          >Fit</button>
        </div>
      </div>

      {/* Main area: fixed labels + scrollable timeline */}
      <div className="flex flex-1 overflow-hidden">
        {/* Fixed label column */}
        <div
          ref={labelRef}
          className="flex-shrink-0 border-r border-zinc-700/50 overflow-y-auto overflow-x-hidden"
          style={{ width: LABEL_WIDTH }}
          onScroll={() => syncScroll('label')}
        >
          {/* Spacer for axis alignment */}
          <div style={{ height: AXIS_HEIGHT }} className="border-b border-zinc-800/50" />
          {laneLayout.map(({ agent, height }) => (
            <AgentLabel
              key={agent.id}
              agent={agent}
              height={height + LANE_GAP}
              isExpanded={expandedAgents.has(agent.id)}
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
          <svg width={chartWidth} height={AXIS_HEIGHT + totalHeight}>
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
                />
              ))}

              {/* Communication links overlay */}
              <CommunicationLinks
                communications={data.communications}
                agentPositions={agentPositions}
                xScale={timeScale}
                laneHeight={LANE_HEIGHT}
              />
            </Group>
          </svg>
        </div>
      </div>

      <TimelineLegend />
    </div>
  );
}

export function TimelineContainer({ data }: TimelineContainerProps) {
  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 min-h-[300px] flex flex-col" style={{ height: 'calc(100vh - 160px)' }}>
      <ParentSize>
        {({ width }) => width > 0 ? <TimelineContent data={data} width={width} /> : null}
      </ParentSize>
    </div>
  );
}
