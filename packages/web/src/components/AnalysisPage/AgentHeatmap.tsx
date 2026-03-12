import { useMemo, useRef, useState, useLayoutEffect } from 'react';
import type { AgentInfo } from '../../types';
import { buildAgentLabel } from '../../utils/agentLabel';

export interface HeatmapBucket {
  agentId: string;
  time: number;
  intensity: number; // 0-1 normalized burn rate
}

interface AgentHeatmapProps {
  agents: AgentInfo[];
  buckets: HeatmapBucket[];
  bucketWidthMs?: number;
}

const ROW_HEIGHT = 28;
const CELL_GAP = 1;
const LABEL_WIDTH = 160;
const HEADER_HEIGHT = 72;

function intensityColor(intensity: number): string {
  if (intensity >= 0.8) return 'rgba(59, 130, 246, 0.9)';  // bright blue
  if (intensity >= 0.5) return 'rgba(59, 130, 246, 0.6)';
  if (intensity >= 0.2) return 'rgba(59, 130, 246, 0.3)';
  if (intensity > 0) return 'rgba(59, 130, 246, 0.1)';
  return 'transparent';
}

function formatTimeLabel(bucketIndex: number, bucketWidthMs: number): string {
  const totalMs = bucketIndex * bucketWidthMs;
  const totalSec = Math.round(totalMs / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return secs > 0 ? `${mins}m${secs}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h${remMins}m` : `${hrs}h`;
}

export function AgentHeatmap({ agents, buckets, bucketWidthMs = 120_000 }: AgentHeatmapProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(600);

  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setGridWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { agentMap, timeRange, bucketCount } = useMemo(() => {
    const map = new Map<string, HeatmapBucket[]>();
    for (const b of buckets) {
      const arr = map.get(b.agentId) ?? [];
      arr.push(b);
      map.set(b.agentId, arr);
    }

    const times = buckets.map((b) => b.time);
    const tMin = times.length > 0 ? Math.min(...times) : Date.now();
    const tMax = times.length > 0 ? Math.max(...times) : Date.now();
    const count = Math.max(Math.ceil((tMax - tMin) / bucketWidthMs) + 1, 1);

    return { agentMap: map, timeRange: { min: tMin, max: tMax }, bucketCount: count };
  }, [buckets, bucketWidthMs]);

  // Only show agents that have heatmap data, plus any running agents
  const visibleAgents = useMemo(() => {
    const withData = agents.filter((a) => agentMap.has(a.id) || a.status === 'running');
    return withData.length > 0 ? withData : agents.slice(0, 5);
  }, [agents, agentMap]);

  if (visibleAgents.length === 0) {
    return (
      <div className="bg-surface-raised border border-th-border rounded-lg p-4" data-testid="agent-heatmap">
        <h3 className="text-[11px] font-medium text-th-text-muted uppercase tracking-wider mb-3">
          Agent Activity
        </h3>
        <p className="text-xs text-th-text-muted text-center py-4 opacity-60">No agent activity data</p>
      </div>
    );
  }

  // Responsive cell width: fill available grid area
  const availableWidth = Math.max(gridWidth - LABEL_WIDTH, 120);
  const cellW = Math.max(6, Math.floor(availableWidth / bucketCount) - CELL_GAP * 2);

  // Show time labels at regular intervals (every ~80px or so)
  const labelInterval = Math.max(1, Math.round(80 / (cellW + CELL_GAP * 2)));

  return (
    <div ref={gridRef} className="bg-surface-raised border border-th-border rounded-lg p-4 overflow-x-auto" data-testid="agent-heatmap">
      <h3 className="text-[11px] font-medium text-th-text-muted uppercase tracking-wider mb-3">
        Agent Activity
      </h3>

      <div className="min-w-max">
        {/* Time axis header */}
        <div className="flex" style={{ paddingLeft: LABEL_WIDTH, height: HEADER_HEIGHT, marginBottom: 4 }}>
          {Array.from({ length: bucketCount }, (_, i) => (
            <div
              key={i}
              className="shrink-0 relative overflow-visible"
              style={{ width: cellW + CELL_GAP * 2 }}
            >
              {i % labelInterval === 0 && (
                <span
                  className="absolute left-0.5 bottom-0.5 text-[10px] text-th-text-muted whitespace-nowrap origin-bottom-left -rotate-45"
                  title={`+${formatTimeLabel(i, bucketWidthMs)}`}
                >
                  +{formatTimeLabel(i, bucketWidthMs)}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Rows: label + cells */}
        {visibleAgents.map((a) => {
          const agentBuckets = agentMap.get(a.id) ?? [];
          const bucketMap = new Map(agentBuckets.map((b) => [
            Math.floor((b.time - timeRange.min) / bucketWidthMs),
            b.intensity,
          ]));
          const label = buildAgentLabel(a);

          return (
            <div key={a.id} className="flex items-center" style={{ height: ROW_HEIGHT, marginBottom: 1 }}>
              {/* Row label */}
              <div
                className="shrink-0 text-th-text-muted text-right pr-2 text-[11px]"
                style={{ width: LABEL_WIDTH }}
                title={`${label} (${a.id})`}
              >
                {label}
              </div>

              {/* Cells */}
              {Array.from({ length: bucketCount }, (_, i) => {
                const intensity = bucketMap.get(i) ?? 0;
                return (
                  <div
                    key={i}
                    style={{
                      width: cellW,
                      height: ROW_HEIGHT - CELL_GAP * 2 - 4,
                      margin: CELL_GAP,
                      backgroundColor: intensityColor(intensity),
                      borderRadius: 2,
                    }}
                    title={intensity > 0 ? `${(intensity * 100).toFixed(0)}% activity at +${formatTimeLabel(i, bucketWidthMs)}` : `Idle at +${formatTimeLabel(i, bucketWidthMs)}`}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-3" style={{ paddingLeft: LABEL_WIDTH }}>
        <span className="text-[10px] text-th-text-muted">Activity:</span>
        {[0.1, 0.3, 0.6, 0.9].map((v) => (
          <div key={v} className="flex items-center gap-1">
            <div
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: intensityColor(v) }}
            />
            <span className="text-[9px] text-th-text-muted">{v < 0.3 ? 'Low' : v < 0.6 ? 'Med' : v < 0.8 ? 'High' : 'Peak'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
