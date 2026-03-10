import { useMemo } from 'react';
import type { AgentInfo } from '../../types';

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

const ROW_HEIGHT = 32;
const CELL_GAP = 1;
const LABEL_WIDTH = 100;

function intensityColor(intensity: number): string {
  if (intensity >= 0.8) return 'rgba(59, 130, 246, 0.9)';  // bright blue
  if (intensity >= 0.5) return 'rgba(59, 130, 246, 0.6)';
  if (intensity >= 0.2) return 'rgba(59, 130, 246, 0.3)';
  if (intensity > 0) return 'rgba(59, 130, 246, 0.1)';
  return 'transparent';
}

export function AgentHeatmap({ agents, buckets, bucketWidthMs = 120_000 }: AgentHeatmapProps) {
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

  const cellW = Math.max(4, Math.min(16, 600 / bucketCount));

  return (
    <div className="bg-surface-raised border border-th-border rounded-lg p-4 overflow-x-auto" data-testid="agent-heatmap">
      <h3 className="text-[11px] font-medium text-th-text-muted uppercase tracking-wider mb-3">
        Agent Activity
      </h3>
      <div className="flex">
        {/* Agent labels */}
        <div className="shrink-0" style={{ width: LABEL_WIDTH }}>
          {visibleAgents.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-1.5 truncate"
              style={{ height: ROW_HEIGHT }}
            >
              <span className="text-[10px] text-th-text-muted truncate">
                {a.role?.name ?? 'Agent'} ({a.id.slice(0, 6)})
              </span>
            </div>
          ))}
        </div>

        {/* Heatmap grid */}
        <div className="flex-1 overflow-x-auto">
          {visibleAgents.map((a) => {
            const agentBuckets = agentMap.get(a.id) ?? [];
            const bucketMap = new Map(agentBuckets.map((b) => [
              Math.floor((b.time - timeRange.min) / bucketWidthMs),
              b.intensity,
            ]));

            return (
              <div key={a.id} className="flex items-center" style={{ height: ROW_HEIGHT }}>
                {Array.from({ length: bucketCount }, (_, i) => {
                  const intensity = bucketMap.get(i) ?? 0;
                  return (
                    <div
                      key={i}
                      style={{
                        width: cellW,
                        height: ROW_HEIGHT - CELL_GAP * 2,
                        margin: CELL_GAP,
                        backgroundColor: intensityColor(intensity),
                        borderRadius: 2,
                      }}
                      title={intensity > 0 ? `${(intensity * 100).toFixed(0)}% activity` : 'Idle'}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-2 pl-[100px]">
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
