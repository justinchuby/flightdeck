import { useMemo, useRef, useState, useCallback } from 'react';
import { ParentSize } from '@visx/responsive';
import { scaleTime } from '@visx/scale';
import { AxisTop } from '@visx/axis';
import { Group } from '@visx/group';

// ── Types ────────────────────────────────────────────────────────────

export interface TimelineSegment {
  status: string;
  startAt: string;
  endAt: string;
}

export interface TimelineAgent {
  id: string;
  shortId: string;
  role: string;
  createdAt: string;
  endedAt: string | null;
  segments: TimelineSegment[];
}

export interface TimelineCommunication {
  type: string;
  fromAgentId: string;
  toAgentId: string;
  summary: string;
  timestamp: string;
}

export interface TimelineLock {
  agentId: string;
  filePath: string;
  acquiredAt: string;
  releasedAt: string | null;
}

export interface TimelineData {
  agents: TimelineAgent[];
  communications: TimelineCommunication[];
  locks: TimelineLock[];
  timeRange: { start: string; end: string };
}

// ── Constants ────────────────────────────────────────────────────────

const LABEL_WIDTH = 180;
const LANE_HEIGHT = 56;
const LANE_GAP = 2;
const AXIS_HEIGHT = 32;
const PADDING_RIGHT = 16;

const STATUS_COLORS: Record<string, { fill: string; border: string }> = {
  creating:   { fill: 'rgba(210,153,34,0.3)',  border: '#d29922' },
  running:    { fill: 'rgba(63,185,80,0.3)',   border: '#3fb950' },
  idle:       { fill: 'rgba(72,79,88,0.2)',    border: '#484f58' },
  completed:  { fill: 'rgba(88,166,255,0.3)',  border: '#58a6ff' },
  failed:     { fill: 'rgba(248,81,73,0.3)',   border: '#f85149' },
  terminated: { fill: 'rgba(240,136,62,0.3)',  border: '#f0883e' },
};

const COMM_STYLES: Record<string, { stroke: string; dasharray: string; width: number }> = {
  delegation: { stroke: 'rgba(88,166,255,0.6)',  dasharray: '',    width: 2 },
  message:    { stroke: 'rgba(163,113,247,0.5)', dasharray: '6,4', width: 1.5 },
  group:      { stroke: 'rgba(210,153,34,0.5)',  dasharray: '2,4', width: 1.5 },
  broadcast:  { stroke: 'rgba(247,120,186,0.4)', dasharray: '2,4', width: 1 },
};

const ROLE_ICONS: Record<string, string> = {
  lead: '👑', architect: '🏗', developer: '👨‍💻', 'code-reviewer': '🔍',
  'critical-reviewer': '🛡', designer: '🎨', secretary: '📋', qa: '🧪',
};

// ── Sub-components ───────────────────────────────────────────────────

function AgentLabel({ agent, y, expanded, onClick }: {
  agent: TimelineAgent; y: number; expanded: boolean; onClick: () => void;
}) {
  return (
    <div
      className="absolute left-0 flex flex-col justify-center px-3 border-r border-zinc-800 cursor-pointer hover:bg-zinc-800/50 transition-colors"
      style={{ top: y, width: LABEL_WIDTH, height: expanded ? 160 : LANE_HEIGHT }}
      onClick={onClick}
    >
      <span className="text-sm font-medium text-zinc-200 truncate">
        {ROLE_ICONS[agent.role] ?? '🤖'} {agent.role}
      </span>
      <span className="text-xs font-mono text-zinc-500">{agent.shortId}</span>
    </div>
  );
}

function AgentLane({ agent, y, timeScale, width, locks }: {
  agent: TimelineAgent; y: number;
  timeScale: (d: Date) => number; width: number;
  locks: TimelineLock[];
}) {
  const agentLocks = locks.filter(l => l.agentId === agent.id);

  return (
    <g>
      {/* Lane background */}
      <rect x={0} y={y} width={width} height={LANE_HEIGHT} fill="transparent" stroke="#27272a" strokeWidth={0.5} />

      {/* Status segments */}
      {agent.segments.map((seg, i) => {
        const x1 = timeScale(new Date(seg.startAt));
        const x2 = timeScale(new Date(seg.endAt));
        const segWidth = Math.max(x2 - x1, 2);
        const colors = STATUS_COLORS[seg.status] ?? STATUS_COLORS.idle;
        return (
          <g key={i}>
            <rect
              x={x1} y={y + 4} width={segWidth} height={LANE_HEIGHT - 8}
              fill={colors.fill} stroke={colors.border} strokeWidth={1} rx={3}
            />
            {segWidth > 60 && seg.status === 'running' && (
              <text
                x={x1 + 6} y={y + LANE_HEIGHT / 2 + 4}
                fill="#e4e4e7" fontSize={10} className="select-none"
              >
                {seg.status}
              </text>
            )}
          </g>
        );
      })}

      {/* Lock indicators */}
      {agentLocks.map((lock, i) => {
        const x = timeScale(new Date(lock.acquiredAt));
        return (
          <text key={`lock-${i}`} x={x} y={y + LANE_HEIGHT - 4} fontSize={10} fill="#d29922">
            🔒
          </text>
        );
      })}
    </g>
  );
}

function CommunicationLinks({ communications, agentIndex, timeScale, laneTop }: {
  communications: TimelineCommunication[];
  agentIndex: Map<string, number>;
  timeScale: (d: Date) => number;
  laneTop: (idx: number) => number;
}) {
  return (
    <g className="communication-links">
      {communications.map((comm, i) => {
        const fromIdx = agentIndex.get(comm.fromAgentId);
        const toIdx = agentIndex.get(comm.toAgentId);
        if (fromIdx === undefined || toIdx === undefined) return null;

        const x = timeScale(new Date(comm.timestamp));
        const y1 = laneTop(fromIdx) + LANE_HEIGHT / 2;
        const y2 = laneTop(toIdx) + LANE_HEIGHT / 2;
        const style = COMM_STYLES[comm.type] ?? COMM_STYLES.message;
        const midY = (y1 + y2) / 2;
        const cpOffset = Math.min(Math.abs(y2 - y1) * 0.3, 40);

        return (
          <g key={i} className="opacity-60 hover:opacity-100 transition-opacity">
            <path
              d={`M ${x} ${y1} C ${x + cpOffset} ${y1}, ${x + cpOffset} ${y2}, ${x} ${y2}`}
              fill="none" stroke={style.stroke}
              strokeWidth={style.width}
              strokeDasharray={style.dasharray || undefined}
            />
            {/* Arrow at destination */}
            <circle cx={x} cy={y2} r={3} fill={style.stroke} />
            {/* Hover target */}
            <title>{`${comm.type}: ${comm.summary}`}</title>
          </g>
        );
      })}
    </g>
  );
}

// ── Main component ───────────────────────────────────────────────────

interface TimelineContainerProps {
  data: TimelineData;
}

function TimelineContent({ data, width: containerWidth }: TimelineContainerProps & { width: number }) {
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const timeRange = useMemo(() => ({
    start: new Date(data.timeRange.start),
    end: new Date(data.timeRange.end),
  }), [data.timeRange]);

  const chartWidth = Math.max(containerWidth - LABEL_WIDTH - PADDING_RIGHT, 400);
  const totalHeight = AXIS_HEIGHT + data.agents.length * (LANE_HEIGHT + LANE_GAP);

  const timeScale = useMemo(
    () => scaleTime({ domain: [timeRange.start, timeRange.end], range: [0, chartWidth] }),
    [timeRange, chartWidth],
  );

  const agentIndex = useMemo(() => {
    const map = new Map<string, number>();
    data.agents.forEach((a, i) => map.set(a.id, i));
    return map;
  }, [data.agents]);

  const laneTop = useCallback(
    (idx: number) => AXIS_HEIGHT + idx * (LANE_HEIGHT + LANE_GAP),
    [],
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedAgent(prev => prev === id ? null : id);
  }, []);

  if (data.agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-500 text-sm">
        No agent activity to display.
      </div>
    );
  }

  return (
    <div className="relative" style={{ height: totalHeight + 16 }}>
      {/* Agent labels (fixed left column) */}
      {data.agents.map((agent, i) => (
        <AgentLabel
          key={agent.id}
          agent={agent}
          y={laneTop(i)}
          expanded={expandedAgent === agent.id}
          onClick={() => toggleExpand(agent.id)}
        />
      ))}

      {/* Scrollable timeline area */}
      <div
        ref={scrollRef}
        className="overflow-x-auto"
        style={{ marginLeft: LABEL_WIDTH }}
      >
        <svg width={chartWidth} height={totalHeight}>
          {/* Time axis */}
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
          {data.agents.map((agent, i) => (
            <AgentLane
              key={agent.id}
              agent={agent}
              y={laneTop(i)}
              timeScale={timeScale}
              width={chartWidth}
              locks={data.locks}
            />
          ))}

          {/* Communication links overlay */}
          <CommunicationLinks
            communications={data.communications}
            agentIndex={agentIndex}
            timeScale={timeScale}
            laneTop={laneTop}
          />
        </svg>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mt-4 px-2 text-xs text-zinc-500">
        {Object.entries(STATUS_COLORS).map(([status, colors]) => (
          <span key={status} className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm border" style={{ background: colors.fill, borderColor: colors.border }} />
            {status}
          </span>
        ))}
        <span className="border-l border-zinc-700 pl-4 flex items-center gap-1">
          <span className="inline-block w-4 border-t-2" style={{ borderColor: COMM_STYLES.delegation.stroke }} /> delegation
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-4 border-t border-dashed" style={{ borderColor: COMM_STYLES.message.stroke }} /> message
        </span>
      </div>
    </div>
  );
}

export function TimelineContainer({ data }: TimelineContainerProps) {
  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4 min-h-[300px]">
      <ParentSize>
        {({ width }) => width > 0 ? <TimelineContent data={data} width={width} /> : null}
      </ParentSize>
    </div>
  );
}
