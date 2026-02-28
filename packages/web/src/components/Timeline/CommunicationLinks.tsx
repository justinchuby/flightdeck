import { useState, useCallback } from 'react';
import { useTooltip, TooltipWithBounds, defaultStyles } from '@visx/tooltip';
import type { ScaleTime } from '@visx/vendor/d3-scale';

// ── Types ────────────────────────────────────────────────────────────────

export interface Communication {
  type: string;
  fromAgentId: string;
  toAgentId: string;
  summary: string;
  timestamp: string;
}

export interface CommunicationLinksProps {
  communications: Communication[];
  /** Maps agentId → y position (top of lane) */
  agentPositions: Map<string, number>;
  xScale: ScaleTime<number, number>;
  laneHeight: number;
}

// ── Constants ────────────────────────────────────────────────────────────

const LINK_COLOR = '#6366f1';
const LINK_COLOR_HOVER = '#818cf8';
const HIT_AREA_WIDTH = 12;

const tooltipStyles: React.CSSProperties = {
  ...defaultStyles,
  backgroundColor: '#1e1e2e',
  color: '#e2e8f0',
  border: '1px solid #4b5563',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 12,
  fontFamily: 'ui-monospace, monospace',
  maxWidth: 320,
  lineHeight: 1.4,
  zIndex: 100,
};

// ── Helpers ──────────────────────────────────────────────────────────────

function getStrokeStyle(type: string): { width: number; dasharray: string } {
  switch (type) {
    case 'delegated':
    case 'delegation':
      return { width: 2, dasharray: '' };
    case 'broadcast':
      return { width: 1, dasharray: '2 3' };
    default:
      // message_sent, agent_message, group_message, etc.
      return { width: 1.5, dasharray: '5 3' };
  }
}

function getLinkLabel(type: string): string {
  switch (type) {
    case 'delegated':
    case 'delegation':
      return 'Delegation';
    case 'broadcast':
      return 'Broadcast';
    case 'message_sent':
    case 'agent_message':
      return 'Message';
    case 'group_message':
      return 'Group Message';
    default:
      return type;
  }
}

/** Build a quadratic bezier path from (x, y1) to (x, y2) with a horizontal curve */
function buildBezierPath(x: number, y1: number, y2: number): string {
  const dy = y2 - y1;
  // Control point offset: curve out to the right proportional to vertical distance
  const cpOffset = Math.min(Math.abs(dy) * 0.4, 60);
  return `M ${x} ${y1} Q ${x + cpOffset} ${(y1 + y2) / 2} ${x} ${y2}`;
}

// ── Component ────────────────────────────────────────────────────────────

export function CommunicationLinks({
  communications,
  agentPositions,
  xScale,
  laneHeight,
}: CommunicationLinksProps) {
  const {
    showTooltip,
    hideTooltip,
    tooltipOpen,
    tooltipData,
    tooltipLeft,
    tooltipTop,
  } = useTooltip<Communication>();

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const handleMouseEnter = useCallback(
    (comm: Communication, idx: number, event: React.MouseEvent) => {
      setHoveredIdx(idx);
      const rect = (event.currentTarget as SVGElement).closest('svg')?.getBoundingClientRect();
      if (rect) {
        showTooltip({
          tooltipData: comm,
          tooltipLeft: event.clientX - rect.left,
          tooltipTop: event.clientY - rect.top - 10,
        });
      }
    },
    [showTooltip],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredIdx(null);
    hideTooltip();
  }, [hideTooltip]);

  // Filter to only renderable links (both agents visible)
  const links = communications
    .map((comm, i) => {
      const fromY = agentPositions.get(comm.fromAgentId);
      const toY = agentPositions.get(comm.toAgentId);
      if (fromY === undefined || toY === undefined) return null;
      const x = xScale(new Date(comm.timestamp));
      if (x === undefined || !isFinite(x)) return null;
      const y1 = fromY + laneHeight / 2;
      const y2 = toY + laneHeight / 2;
      return { comm, idx: i, x, y1, y2 };
    })
    .filter(Boolean) as Array<{ comm: Communication; idx: number; x: number; y1: number; y2: number }>;

  return (
    <>
      <g className="communication-links">
        {links.map(({ comm, idx, x, y1, y2 }) => {
          const { width, dasharray } = getStrokeStyle(comm.type);
          const isHovered = hoveredIdx === idx;
          const path = buildBezierPath(x, y1, y2);

          return (
            <g key={idx}>
              {/* Invisible wider hit area for easier hovering */}
              <path
                d={path}
                fill="none"
                stroke="transparent"
                strokeWidth={HIT_AREA_WIDTH}
                onMouseEnter={(e) => handleMouseEnter(comm, idx, e)}
                onMouseLeave={handleMouseLeave}
                style={{ cursor: 'pointer' }}
              />
              {/* Visible link */}
              <path
                d={path}
                fill="none"
                stroke={isHovered ? LINK_COLOR_HOVER : LINK_COLOR}
                strokeWidth={isHovered ? width + 0.5 : width}
                strokeDasharray={dasharray}
                strokeOpacity={isHovered ? 1 : 0.5}
                pointerEvents="none"
              />
              {/* Small dot at the endpoints */}
              <circle cx={x} cy={y1} r={isHovered ? 3 : 2} fill={isHovered ? LINK_COLOR_HOVER : LINK_COLOR} opacity={isHovered ? 1 : 0.6} pointerEvents="none" />
              <circle cx={x} cy={y2} r={isHovered ? 3 : 2} fill={isHovered ? LINK_COLOR_HOVER : LINK_COLOR} opacity={isHovered ? 1 : 0.6} pointerEvents="none" />
            </g>
          );
        })}
      </g>

      {/* Tooltip rendered outside SVG */}
      {tooltipOpen && tooltipData && (
        <TooltipWithBounds
          left={tooltipLeft}
          top={tooltipTop}
          style={tooltipStyles}
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-indigo-300">{getLinkLabel(tooltipData.type)}</span>
              <span className="text-gray-500 text-[10px]">
                {new Date(tooltipData.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="text-[10px] text-gray-400">
              {tooltipData.fromAgentId.slice(0, 8)} → {tooltipData.toAgentId.slice(0, 8)}
            </div>
            {tooltipData.summary && (
              <p className="text-gray-300 text-[11px] line-clamp-3 mt-1">
                {tooltipData.summary.length > 200
                  ? tooltipData.summary.slice(0, 200) + '…'
                  : tooltipData.summary}
              </p>
            )}
          </div>
        </TooltipWithBounds>
      )}
    </>
  );
}
