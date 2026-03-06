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
import type { Project } from '../../types';

// ── Props (kept for backward compat with App.tsx route) ────────────

interface Props {
  api?: any;
  ws?: any;
}

// ── Overview Page ──────────────────────────────────────────────────

export function OverviewPage(_props: Props) {
  const agents = useAppStore((s) => s.agents);
  const selectedLeadId = useLeadStore((s) => s.selectedLeadId);

  // ── Project list for selector ───────────────────────────────────
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Project[]>('/projects')
      .then((ps) => {
        if (!Array.isArray(ps)) return;
        const active = ps.filter((p) => p.status !== 'archived');
        setProjects(active);
        // Auto-select the most recent project if nothing else is selected
        if (!selectedProjectId && !selectedLeadId && active.length > 0) {
          setSelectedProjectId(active[0].id);
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive the effective ID used for data fetching.
  // Priority: live lead agent > sidebar-selected lead > user-picked project > first project
  const effectiveId = useMemo(() => {
    if (selectedLeadId) return selectedLeadId;
    const lead = agents.find((a) => a.role?.id === 'lead' && !a.parentId);
    if (lead?.id) return lead.id;
    if (selectedProjectId) return selectedProjectId;
    return projects.length > 0 ? projects[0].id : null;
  }, [selectedLeadId, agents, selectedProjectId, projects]);

  // ── Data state ─────────────────────────────────────────────────
  const [timelineData, setTimelineData] = useState<TimelineDataPoint[]>([]);
  const [burndownData, setBurndownData] = useState<BurndownPoint[]>([]);
  const [costData, setCostData] = useState<CostPoint[]>([]);
  const [heatmapBuckets, setHeatmapBuckets] = useState<HeatmapBucket[]>([]);
  const [keyframes, setKeyframes] = useState<ReplayKeyframe[]>([]);
  const [historicalAgents, setHistoricalAgents] = useState<any[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [totalTasks, setTotalTasks] = useState(0);
  const mountedRef = useRef(true);

  // Use live agents if available, otherwise fall back to API-fetched historical agents
  const displayAgents = agents.length > 0 ? agents : historicalAgents;

  // ── Fetch overview data ────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!effectiveId) return;

    try {
      // Fetch agents from REST API when live WebSocket agents are empty
      let fetchedAgents: any[] = [];
      if (agents.length === 0) {
        try {
          const agentData = await apiFetch<any[]>('/agents');
          fetchedAgents = Array.isArray(agentData) ? agentData : [];
          if (mountedRef.current) setHistoricalAgents(fetchedAgents);
        } catch { /* API may not have agent list endpoint */ }
      }

      // Use live agents if available, otherwise the just-fetched historical data
      const currentAgents = agents.length > 0 ? agents : fetchedAgents;

      // Fetch keyframes for milestones
      const kfData = await apiFetch<{ keyframes: ReplayKeyframe[] }>(`/replay/${effectiveId}/keyframes`);
      const kf: ReplayKeyframe[] = kfData.keyframes ?? [];
      if (mountedRef.current) {
        setKeyframes(kf);

        // Derive timeline data from keyframes
        if (kf.length > 0) {
          let completed = 0, inProgress = 0, agentCount = 0;
          const tPoints: TimelineDataPoint[] = [];
          const bPoints: BurndownPoint[] = [];
          const cPoints: CostPoint[] = [];
          const hBuckets: HeatmapBucket[] = [];
          let taskTotal = 0;

          // Use real token counts from available agents
          const totalInput = currentAgents.reduce((s: number, a: any) => s + (a.inputTokens ?? 0), 0);
          const totalOutput = currentAgents.reduce((s: number, a: any) => s + (a.outputTokens ?? 0), 0);
          const realTokens = totalInput + totalOutput;

          for (const frame of kf) {
            const t = new Date(frame.timestamp).getTime();

            if (frame.type === 'spawn') {
              agentCount++;
              hBuckets.push({ agentId: frame.label.split(' ')[0] ?? 'unknown', time: t, intensity: 0.8 });
            }
            if (frame.type === 'agent_exit') agentCount = Math.max(0, agentCount - 1);
            if (frame.type === 'delegation') { taskTotal++; inProgress++; }
            if (frame.type === 'milestone' || frame.type === 'task') { completed++; inProgress = Math.max(0, inProgress - 1); }

            // Distribute real token usage proportionally across keyframes for the curve
            const progress = (tPoints.length + 1) / kf.length;
            cPoints.push({ time: t, cumulativeCost: realTokens * progress });

            tPoints.push({
              time: t,
              completed,
              inProgress,
              remaining: Math.max(0, taskTotal - completed - inProgress),
              agentCount,
            });
            bPoints.push({ time: t, remaining: Math.max(0, taskTotal - completed) });
          }

          setTimelineData(tPoints);
          setBurndownData(bPoints);
          setCostData(cPoints);
          setHeatmapBuckets(hBuckets);
          setTotalTokens(realTokens);
          setTotalTasks(taskTotal);
        } else {
          // No keyframes — clear stale data
          setTimelineData([]);
          setBurndownData([]);
          setCostData([]);
          setHeatmapBuckets([]);
          setTotalTokens(0);
          setTotalTasks(0);
        }
      }
    } catch {
      // API not ready — show empty states
    }
  }, [effectiveId, agents.length]);

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
    const lead = displayAgents.find((a: any) => a.id === effectiveId);
    return lead?.createdAt ?? undefined;
  }, [keyframes, displayAgents, effectiveId]);

  // ── Active project name for display ────────────────────────────
  const activeProject = projects.find((p) => effectiveId === p.id || effectiveId === `project:${p.id}`);

  if (!effectiveId && projects.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-th-text-muted text-sm">
        No session data yet. Start a project to see the overview.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4" data-testid="overview-page">
      {/* Project selector (shown when multiple projects exist or no live session) */}
      {projects.length > 0 && (
        <div className="flex items-center gap-3">
          <label htmlFor="overview-project-select" className="text-xs text-th-text-muted font-medium">
            Project:
          </label>
          <select
            id="overview-project-select"
            data-testid="overview-project-selector"
            value={selectedProjectId ?? effectiveId ?? ''}
            onChange={(e) => setSelectedProjectId(e.target.value || null)}
            className="text-sm bg-th-bg-alt border border-th-border rounded px-2 py-1 text-th-text-alt focus:outline-none focus:ring-1 focus:ring-accent max-w-xs truncate"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id.slice(0, 8)} {p.status === 'active' ? '' : `(${p.status})`}
              </option>
            ))}
          </select>
          {activeProject && (
            <span className="text-xs text-th-text-muted">
              {keyframes.length} events · {totalTasks} tasks
            </span>
          )}
        </div>
      )}

      {/* Hero: Progress Timeline */}
      <ProgressTimeline data={timelineData} width={800} height={240} />

      {/* Stats row: Burndown + Cost + Key Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <TaskBurndown data={burndownData} totalTasks={totalTasks} />
        <CostCurve data={costData} />
        <KeyStats agents={displayAgents} totalTokens={totalTokens} sessionStart={sessionStart} />
      </div>

      {/* Agent Activity Heatmap */}
      <AgentHeatmap agents={displayAgents} buckets={heatmapBuckets} />

      {/* Milestones */}
      <MilestoneTimeline keyframes={keyframes} />
    </div>
  );
}
