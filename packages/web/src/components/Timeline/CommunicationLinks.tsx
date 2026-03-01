import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTooltip, TooltipWithBounds, defaultStyles } from '@visx/tooltip';
import type { ScaleTime } from '@visx/vendor/d3-scale';

// ── Types ────────────────────────────────────────────────────────────────

export interface Communication {
  type: string;
  fromAgentId: string;
  toAgentId?: string;
  groupName?: string;
  summary: string;
  timestamp: string;
}

export interface CommunicationLinksProps {
  communications: Communication[];
  /** Maps agentId → y position (top of lane) */
  agentPositions: Map<string, number>;
  xScale: ScaleTime<number, number>;
  laneHeight: number;
  /** Optional visible time range for performance culling */
  visibleTimeRange?: [Date, Date];
  /** Container element for portaling the tooltip outside SVG */
  tooltipContainer?: HTMLElement | null;
}

// ── Style config per comm type ───────────────────────────────────────────

interface LinkStyle {
  color: string;
  width: number;
  dasharray: string;
  markerId: string;
  label: string;
}

const LINK_STYLES: Record<string, LinkStyle> = {
  delegated:      { color: 'rgba(88,166,255,0.60)',  width: 2,   dasharray: '',    markerId: 'marker-arrow',   label: 'Delegation' },
  delegation:     { color: 'rgba(88,166,255,0.60)',  width: 2,   dasharray: '',    markerId: 'marker-arrow',   label: 'Delegation' },
  agent_message:  { color: 'rgba(163,113,247,0.50)', width: 1.5, dasharray: '6,4', markerId: 'marker-circle',  label: 'Message' },
  message_sent:   { color: 'rgba(163,113,247,0.50)', width: 1.5, dasharray: '6,4', markerId: 'marker-circle',  label: 'Message' },
  group_message:  { color: 'rgba(210,153,34,0.50)',  width: 1.5, dasharray: '2,4', markerId: 'marker-diamond', label: 'Group Message' },
  broadcast:      { color: 'rgba(247,120,186,0.40)', width: 1,   dasharray: '2,4', markerId: 'marker-star',    label: 'Broadcast' },
};

const DEFAULT_STYLE: LinkStyle = {
  color: 'rgba(163,113,247,0.50)', width: 1.5, dasharray: '6,4', markerId: 'marker-circle', label: 'Message',
};

function getStyle(type: string): LinkStyle {
  return LINK_STYLES[type] ?? DEFAULT_STYLE;
}

// ── Constants ────────────────────────────────────────────────────────────

const HIT_AREA_WIDTH = 12;
const CURVE_OFFSET = 20;
const MAX_VISIBLE_LINKS = 500;

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

/** Cubic bezier S-curve between (x, y1) and (x, y2) */
function buildCurve(x: number, y1: number, y2: number): string {
  const midX = x + CURVE_OFFSET;
  return `M ${x} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x} ${y2}`;
}

/** Short horizontal stub for comms with missing toAgentId */
function buildStub(x: number, y: number): string {
  return `M ${x} ${y} L ${x + 24} ${y}`;
}

// ── SVG Marker definitions ───────────────────────────────────────────────

function MarkerDefs() {
  return (
    <defs>
      <marker id="marker-arrow" viewBox="0 0 10 10" refX="10" refY="5"
        markerWidth="6" markerHeight="6" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(88,166,255,0.6)" />
      </marker>
      <marker id="marker-circle" viewBox="0 0 10 10" refX="5" refY="5"
        markerWidth="5" markerHeight="5" orient="auto">
        <circle cx="5" cy="5" r="4" fill="rgba(163,113,247,0.5)" />
      </marker>
      <marker id="marker-diamond" viewBox="0 0 10 10" refX="5" refY="5"
        markerWidth="6" markerHeight="6" orient="auto">
        <path d="M 5 0 L 10 5 L 5 10 L 0 5 z" fill="rgba(210,153,34,0.5)" />
      </marker>
      <marker id="marker-star" viewBox="0 0 12 12" refX="6" refY="6"
        markerWidth="6" markerHeight="6" orient="auto">
        <path d="M 6 0 L 7.5 4.5 L 12 4.5 L 8.25 7.5 L 9.75 12 L 6 9 L 2.25 12 L 3.75 7.5 L 0 4.5 L 4.5 4.5 z"
          fill="rgba(247,120,186,0.4)" />
      </marker>
    </defs>
  );
}

// ── Resolved link data ───────────────────────────────────────────────────

interface ResolvedLink {
  comm: Communication;
  idx: number;
  x: number;
  y1: number;
  y2: number | null; // null = missing toAgentId
  style: LinkStyle;
}

// ── Component ────────────────────────────────────────────────────────────

export function CommunicationLinks({
  communications,
  agentPositions,
  xScale,
  laneHeight,
  visibleTimeRange,
  tooltipContainer,
}: CommunicationLinksProps) {
  // Fallback portal target for tooltip (must be outside SVG)
  const fallbackRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!tooltipContainer) {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.top = '0';
      el.style.left = '0';
      document.body.appendChild(el);
      fallbackRef.current = el;
      return () => { document.body.removeChild(el); };
    }
  }, [tooltipContainer]);

  const portalTarget = tooltipContainer ?? fallbackRef.current;

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

  const links = useMemo<ResolvedLink[]>(() => {
    const result: ResolvedLink[] = [];

    for (let i = 0; i < communications.length; i++) {
      const comm = communications[i];
      const ts = new Date(comm.timestamp);

      // Performance: skip links outside visible time range
      if (visibleTimeRange) {
        if (ts < visibleTimeRange[0] || ts > visibleTimeRange[1]) continue;
      }

      const fromY = agentPositions.get(comm.fromAgentId);
      if (fromY === undefined) continue;

      const x = xScale(ts);
      if (x === undefined || !isFinite(x)) continue;

      const y1 = fromY + laneHeight / 2;
      let y2: number | null = null;

      if (comm.toAgentId) {
        const toY = agentPositions.get(comm.toAgentId);
        if (toY !== undefined) {
          y2 = toY + laneHeight / 2;
        }
      }

      // Broadcasts: fan-out to all visible agents except sender
      if (!comm.toAgentId && comm.type === 'broadcast') {
        for (const [agentId, agentY] of agentPositions.entries()) {
          if (agentId === comm.fromAgentId) continue;
          result.push({ comm, idx: i, x, y1, y2: agentY + laneHeight / 2, style: getStyle(comm.type) });
          if (result.length >= MAX_VISIBLE_LINKS) break;
        }
        continue;
      }

      result.push({ comm, idx: i, x, y1, y2, style: getStyle(comm.type) });

      // Hard cap for performance
      if (result.length >= MAX_VISIBLE_LINKS) break;
    }
    return result;
  }, [communications, agentPositions, xScale, laneHeight, visibleTimeRange]);

  return (
    <>
      <g className="communication-links" style={{ pointerEvents: 'none' }} role="list" aria-label="Communication links between agents">
        <MarkerDefs />

        {links.map(({ comm, idx, x, y1, y2, style }, linkIndex) => {
          const isHovered = hoveredIdx === idx;
          const isMissing = y2 === null;
          const path = isMissing ? buildStub(x, y1) : buildCurve(x, y1, y2);
          const glowFilter = isHovered
            ? `drop-shadow(0 0 4px ${style.color})`
            : undefined;

          return (
            <g key={linkIndex} role="listitem" aria-label={`${style.label} from ${comm.fromAgentId.slice(0, 8)}${comm.toAgentId ? ` to ${comm.toAgentId.slice(0, 8)}` : comm.groupName ? ` to group ${comm.groupName}` : ''}`}>
              {/* Invisible wider hit area for hover */}
              <path
                d={path}
                fill="none"
                stroke="transparent"
                strokeWidth={HIT_AREA_WIDTH}
                style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                onMouseEnter={(e) => handleMouseEnter(comm, idx, e)}
                onMouseLeave={handleMouseLeave}
              />
              {/* Visible link */}
              <path
                d={path}
                fill="none"
                stroke={style.color}
                strokeWidth={isHovered ? style.width + 0.5 : style.width}
                strokeDasharray={style.dasharray || undefined}
                opacity={isHovered ? 1 : 0.7}
                markerEnd={isMissing ? undefined : `url(#${style.markerId})`}
                style={{ filter: glowFilter, pointerEvents: 'none' }}
              />
              {/* Label for group messages or missing toAgentId */}
              {isMissing && (
                <text
                  x={x + 28} y={y1 + 4}
                  fontSize={10} fill="#9ca3af"
                  style={{ pointerEvents: 'none' }}
                >{comm.groupName ? `👥 ${comm.groupName}` : '?'}</text>
              )}
            </g>
          );
        })}
      </g>

      {/* Tooltip rendered outside SVG via portal */}
      {tooltipOpen && tooltipData && portalTarget && createPortal(
        <TooltipWithBounds
          left={tooltipLeft}
          top={tooltipTop}
          style={tooltipStyles}
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span
                className="font-semibold"
                style={{ color: getStyle(tooltipData.type).color }}
              >
                {getStyle(tooltipData.type).label}
              </span>
              <span className="text-th-text-muted text-[10px]">
                {new Date(tooltipData.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="text-[10px] text-th-text-muted">
              {tooltipData.fromAgentId.slice(0, 8)}
              {tooltipData.toAgentId
                ? ` → ${tooltipData.toAgentId.slice(0, 8)}`
                : tooltipData.groupName
                  ? ` → 👥 ${tooltipData.groupName}`
                  : ' → ?'}
            </div>
            {tooltipData.summary && (
              <p className="text-th-text-alt text-[11px] line-clamp-3 mt-1">
                {tooltipData.summary.length > 80
                  ? tooltipData.summary.slice(0, 80) + '…'
                  : tooltipData.summary}
              </p>
            )}
          </div>
        </TooltipWithBounds>,
        portalTarget,
      )}
    </>
  );
}
