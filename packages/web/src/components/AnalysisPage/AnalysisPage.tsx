/**
 * AnalysisPage — Project visualization dashboard.
 *
 * Hosts all the chart/visualization components removed from OverviewPage:
 * CumulativeFlow, CostCurve, KeyStats, AgentHeatmap.
 * ProgressTimeline stays in the Overview → integrated into progress feed.
 *
 * Data fetching mirrors the old OverviewPage keyframes-based approach
 * but only runs when this tab is active (performance win).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../../stores/appStore';
import { apiFetch } from '../../hooks/useApi';
import { useEffectiveProjectId } from '../../hooks/useEffectiveProjectId';
import { deriveAgentsFromKeyframes } from '../../hooks/useHistoricalAgents';
import { POLL_INTERVAL_MS } from '../../constants/timing';
import { CumulativeFlow } from './TaskBurndown';
import { CostCurve } from './CostCurve';
import { KeyStats } from './KeyStats';
import { AgentHeatmap } from './AgentHeatmap';
import type { FlowPoint } from './TaskBurndown';
import type { CostPoint } from './CostCurve';
import type { HeatmapBucket } from './AgentHeatmap';
import type { ReplayKeyframe } from '../../hooks/useSessionReplay';
import type { AgentInfo } from '../../types';

export function AnalysisPage() {
  const agents = useAppStore((s) => s.agents);
  const effectiveId = useEffectiveProjectId();

  // ── Data state ─────────────────────────────────────────────────
  const [flowData, setFlowData] = useState<FlowPoint[]>([]);
  const [costData, setCostData] = useState<CostPoint[]>([]);
  const [heatmapBuckets, setHeatmapBuckets] = useState<HeatmapBucket[]>([]);
  const [historicalAgents, setHistoricalAgents] = useState<AgentInfo[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [sessionStart, setSessionStart] = useState<string | undefined>();
  const mountedRef = useRef(true);
  const fetchIdRef = useRef(0);

  const displayAgents = agents.length > 0 ? agents : historicalAgents;

  // ── Fetch visualization data ───────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!effectiveId) return;
    const requestId = ++fetchIdRef.current;

    try {
      const kfData = await apiFetch<{ keyframes: ReplayKeyframe[] }>(`/replay/${effectiveId}/keyframes`);
      const kf: ReplayKeyframe[] = kfData.keyframes ?? [];

      let resolvedAgents: AgentInfo[] = [];
      if (agents.length === 0) {
        try {
          const agentData = await apiFetch<AgentInfo[]>('/agents');
          resolvedAgents = Array.isArray(agentData) ? agentData : [];
        } catch { /* API may not have agent list endpoint */ }
        if (resolvedAgents.length === 0 && kf.length > 0) {
          resolvedAgents = deriveAgentsFromKeyframes(kf) as unknown as AgentInfo[];
        }
        if (mountedRef.current) setHistoricalAgents(resolvedAgents);
      }

      if (fetchIdRef.current !== requestId) return;

      const currentAgents = agents.length > 0 ? agents : resolvedAgents;
      if (mountedRef.current) {
        if (kf.length > 0) {
          setSessionStart(kf[0].timestamp);
          let completed = 0, inProgress = 0, taskTotal = 0, spawnIdx = 0;
          const fPoints: FlowPoint[] = [];
          const cPoints: CostPoint[] = [];
          const hBuckets: HeatmapBucket[] = [];

          const totalInput = currentAgents.reduce((s, a) => s + (a.inputTokens ?? 0), 0);
          const totalOutput = currentAgents.reduce((s, a) => s + (a.outputTokens ?? 0), 0);
          const realTokens = totalInput + totalOutput;

          for (const frame of kf) {
            const t = new Date(frame.timestamp).getTime();
            if (frame.type === 'spawn') {
              const matchAgent = currentAgents[spawnIdx];
              hBuckets.push({ agentId: matchAgent?.id ?? `agent-${spawnIdx}`, time: t, intensity: 0.8 });
              spawnIdx++;
            }
            if (frame.type === 'delegation') { taskTotal++; inProgress++; }
            if (frame.type === 'milestone' || frame.type === 'task') { completed++; inProgress = Math.max(0, inProgress - 1); }

            const progress = (fPoints.length + 1) / kf.length;
            cPoints.push({ time: t, cumulativeCost: realTokens * progress });
            fPoints.push({ time: t, created: taskTotal, inProgress, completed });
          }

          setFlowData(fPoints);
          setCostData(cPoints);
          setHeatmapBuckets(hBuckets);
          setTotalTokens(realTokens);
        } else {
          setFlowData([]);
          setCostData([]);
          setHeatmapBuckets([]);
          setTotalTokens(0);
          setSessionStart(undefined);
        }
      }
    } catch {
      // API not ready — show empty states
    }
  }, [effectiveId, agents.length]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL_MS * 3);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchData]);

  if (!effectiveId) {
    return (
      <div className="flex-1 flex items-center justify-center text-th-text-muted text-sm">
        No project selected. Choose a project to see analysis.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6" data-testid="analysis-page">
      <h2 className="text-sm font-medium text-th-text">Project Analysis</h2>

      {/* Key Stats */}
      <KeyStats agents={displayAgents} totalTokens={totalTokens} sessionStart={sessionStart} />

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CumulativeFlow data={flowData} />
        <CostCurve data={costData} />
      </div>

      {/* Agent Activity Heatmap */}
      <AgentHeatmap agents={displayAgents} buckets={heatmapBuckets} />
    </div>
  );
}
