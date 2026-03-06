import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore } from '../../stores/leadStore';
import { apiFetch } from '../../hooks/useApi';
import { POLL_INTERVAL_MS } from '../../constants/timing';
import { ProgressTimeline } from './ProgressTimeline';
import { TaskBurndown } from './TaskBurndown';
import { CostCurve } from './CostCurve';
import { KeyStats } from './KeyStats';
import { AgentHeatmap } from './AgentHeatmap';
import { MilestoneTimeline } from './MilestoneTimeline';
import type { TimelineDataPoint } from './ProgressTimeline';
import type { BurndownPoint } from './TaskBurndown';
import type { CostPoint } from './CostCurve';
import type { HeatmapBucket } from './AgentHeatmap';
import type { ReplayKeyframe } from '../../hooks/useSessionReplay';

// ── Props (kept for backward compat with App.tsx route) ────────────

interface Props {
  api?: any;
  ws?: any;
}

// ── Overview Page ──────────────────────────────────────────────────

export function OverviewPage(_props: Props) {
  const agents = useAppStore((s) => s.agents);
  const selectedLeadId = useLeadStore((s) => s.selectedLeadId);
  const projectIds = useLeadStore((s) => Object.keys(s.projects));

  // Derive leadId — prefer selected, then active lead agent, then most recent project
  const leadId = useMemo(() => {
    if (selectedLeadId) return selectedLeadId;
    const lead = agents.find((a) => a.role?.id === 'lead' && !a.parentId);
    if (lead?.id) return lead.id;
    // Fallback to most recent known project for historical data
    return projectIds.length > 0 ? projectIds[projectIds.length - 1] : null;
  }, [selectedLeadId, agents, projectIds]);

  // ── Data state ─────────────────────────────────────────────────
  const [timelineData, setTimelineData] = useState<TimelineDataPoint[]>([]);
  const [burndownData, setBurndownData] = useState<BurndownPoint[]>([]);
  const [costData, setCostData] = useState<CostPoint[]>([]);
  const [heatmapBuckets, setHeatmapBuckets] = useState<HeatmapBucket[]>([]);
  const [keyframes, setKeyframes] = useState<ReplayKeyframe[]>([]);
  const [totalCost, setTotalCost] = useState(0);
  const [totalTasks, setTotalTasks] = useState(0);
  const mountedRef = useRef(true);

  // ── Fetch overview data ────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!leadId) return;

    try {
      // Fetch keyframes for milestones
      const kfResp = await apiFetch(`/api/replay/${leadId}/keyframes`);
      if (kfResp.ok && mountedRef.current) {
        const kf: ReplayKeyframe[] = await kfResp.json();
        setKeyframes(kf);

        // Derive timeline data from keyframes
        if (kf.length > 0) {
          let completed = 0, inProgress = 0, agentCount = 0, cost = 0;
          const tPoints: TimelineDataPoint[] = [];
          const bPoints: BurndownPoint[] = [];
          const cPoints: CostPoint[] = [];
          const hBuckets: HeatmapBucket[] = [];
          let taskTotal = 0;

          for (const frame of kf) {
            const t = new Date(frame.timestamp).getTime();

            if (frame.type === 'spawn') {
              agentCount++;
              hBuckets.push({ agentId: frame.label.split(' ')[0] ?? 'unknown', time: t, intensity: 0.8 });
            }
            if (frame.type === 'agent_exit') agentCount = Math.max(0, agentCount - 1);
            if (frame.type === 'delegation') { taskTotal++; inProgress++; }
            if (frame.type === 'milestone' || frame.type === 'task') { completed++; inProgress = Math.max(0, inProgress - 1); }

            cost += 0.15; // Estimate per-event cost (real data from cost API when available)

            tPoints.push({
              time: t,
              completed,
              inProgress,
              remaining: Math.max(0, taskTotal - completed - inProgress),
              agentCount,
            });
            bPoints.push({ time: t, remaining: Math.max(0, taskTotal - completed) });
            cPoints.push({ time: t, cumulativeCost: cost });
          }

          setTimelineData(tPoints);
          setBurndownData(bPoints);
          setCostData(cPoints);
          setHeatmapBuckets(hBuckets);
          setTotalCost(cost);
          setTotalTasks(taskTotal);
        }
      }
    } catch {
      // API not ready — show empty states
    }
  }, [leadId]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL_MS * 3); // 30s
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchData]);

  // ── Session start time ─────────────────────────────────────────
  const sessionStart = useMemo(() => {
    if (keyframes.length > 0) return keyframes[0].timestamp;
    const lead = agents.find((a) => a.id === leadId);
    return lead?.createdAt ?? undefined;
  }, [keyframes, agents, leadId]);

  if (!leadId) {
    return (
      <div className="flex-1 flex items-center justify-center text-th-text-muted text-sm">
        No session data yet. Start a project to see the overview.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4" data-testid="overview-page">
      {/* Hero: Progress Timeline */}
      <ProgressTimeline data={timelineData} width={800} height={240} />

      {/* Stats row: Burndown + Cost + Key Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <TaskBurndown data={burndownData} totalTasks={totalTasks} />
        <CostCurve data={costData} />
        <KeyStats agents={agents} totalCost={totalCost} sessionStart={sessionStart} />
      </div>

      {/* Agent Activity Heatmap */}
      <AgentHeatmap agents={agents} buckets={heatmapBuckets} />

      {/* Milestones */}
      <MilestoneTimeline keyframes={keyframes} />
    </div>
  );
}
