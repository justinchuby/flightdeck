/**
 * AnalysisPage — Project visualization dashboard.
 *
 * Hosts all the chart/visualization components removed from OverviewPage:
 * CumulativeFlow, CostCurve, KeyStats.
 * ProgressTimeline stays in the Overview → integrated into progress feed.
 *
 * Data fetching mirrors the old OverviewPage keyframes-based approach
 * but only runs when this tab is active (performance win).
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '../../stores/appStore';
import { apiFetch } from '../../hooks/useApi';
import { useProjectId } from '../../contexts/ProjectContext';
import { deriveAgentsFromKeyframes } from '../../hooks/useHistoricalAgents';
import { POLL_INTERVAL_MS } from '../../constants/timing';
import { CumulativeFlow } from './TaskBurndown';
import { CostCurve } from './CostCurve';
import { KeyStats } from './KeyStats';
import { CostBreakdown } from '../TokenEconomics/CostBreakdown';
import type { FlowPoint } from './TaskBurndown';
import type { CostPoint } from './CostCurve';
import type { ReplayKeyframe } from '../../hooks/useSessionReplay';
import type { AgentInfo, DagTask } from '../../types';

export function AnalysisPage() {
  const agents = useAppStore((s) => s.agents);
  const effectiveId = useProjectId();

  // ── Data state ─────────────────────────────────────────────────
  const [flowData, setFlowData] = useState<FlowPoint[]>([]);
  const [costData, setCostData] = useState<CostPoint[]>([]);
  const [historicalAgents, setHistoricalAgents] = useState<AgentInfo[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [sessionStart, setSessionStart] = useState<string | undefined>();
  const mountedRef = useRef(true);
  const fetchIdRef = useRef(0);

  const displayAgents = agents.length > 0 ? agents : historicalAgents;

  // Derive session title from the lead agent's task
  const sessionTitle = useMemo(() => {
    if (!effectiveId) return null;
    const lead = agents.find(
      (a) => a.projectId === effectiveId && a.role?.id === 'lead' && (a.status === 'running' || a.status === 'idle'),
    );
    return lead?.task ?? null;
  }, [agents, effectiveId]);

  // ── Fetch visualization data ───────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!effectiveId) return;
    const requestId = ++fetchIdRef.current;

    try {
      const [kfData, taskData] = await Promise.all([
        apiFetch<{ keyframes: ReplayKeyframe[] }>(`/replay/${effectiveId}/keyframes`),
        apiFetch<{ tasks: DagTask[] }>(`/tasks?scope=project&projectId=${effectiveId}&limit=1000`).catch(() => ({ tasks: [] as DagTask[] })),
      ]);
      const kf: ReplayKeyframe[] = kfData.keyframes ?? [];
      const dagTasks: DagTask[] = taskData.tasks ?? [];

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
          const fPoints: FlowPoint[] = [];
          const cPoints: CostPoint[] = [];

          // Prefer live agent token counts; fall back to persisted DB totals for inactive sessions
          let totalInput = currentAgents.reduce((s, a) => s + (a.inputTokens ?? 0), 0);
          let totalOutput = currentAgents.reduce((s, a) => s + (a.outputTokens ?? 0), 0);

          if (totalInput + totalOutput === 0) {
            try {
              const costsByAgent = await apiFetch<Array<{ totalInputTokens: number; totalOutputTokens: number }>>(
                `/costs/by-agent?projectId=${effectiveId}`,
              );
              if (Array.isArray(costsByAgent)) {
                totalInput = costsByAgent.reduce((s, c) => s + (c.totalInputTokens ?? 0), 0);
                totalOutput = costsByAgent.reduce((s, c) => s + (c.totalOutputTokens ?? 0), 0);
              }
            } catch { /* costs API not available — stay at zero */ }
          }

          const realTokens = totalInput + totalOutput;

          // Build task flow from DAG task timestamps instead of keyframe events.
          // Each task has createdAt, startedAt?, completedAt? — these give us the real timeline.
          const TERMINAL_STATES = new Set(['done', 'skipped', 'failed']);
          if (dagTasks.length > 0) {
            type TaskEvent = { time: number; kind: 'created' | 'started' | 'finished' };
            const events: TaskEvent[] = [];
            for (const task of dagTasks) {
              if (task.createdAt) events.push({ time: new Date(task.createdAt).getTime(), kind: 'created' });
              if (task.startedAt) events.push({ time: new Date(task.startedAt).getTime(), kind: 'started' });
              if (task.completedAt && TERMINAL_STATES.has(task.dagStatus)) {
                events.push({ time: new Date(task.completedAt).getTime(), kind: 'finished' });
              }
            }
            events.sort((a, b) => a.time - b.time);

            let created = 0, active = 0, done = 0;
            for (const ev of events) {
              if (ev.kind === 'created') created++;
              else if (ev.kind === 'started') active++;
              else if (ev.kind === 'finished') { done++; active = Math.max(0, active - 1); }
              created = Math.max(created, done);
              fPoints.push({ time: ev.time, created, inProgress: active, completed: done });
            }
          } else {
            // Fallback: no DAG tasks yet — derive from keyframes for backwards compat
            let completed = 0, inProgress = 0, taskTotal = 0;
            for (const frame of kf) {
              const t = new Date(frame.timestamp).getTime();
              if (frame.type === 'delegation' || frame.type === 'task') { taskTotal++; inProgress++; }
              if (frame.type === 'milestone') { completed++; inProgress = Math.max(0, inProgress - 1); }
              taskTotal = Math.max(taskTotal, completed);
              fPoints.push({ time: t, created: taskTotal, inProgress, completed });
            }
          }

          // Cost curve still uses keyframes for timeline distribution
          for (let i = 0; i < kf.length; i++) {
            const t = new Date(kf[i].timestamp).getTime();
            const progress = (i + 1) / kf.length;
            cPoints.push({
              time: t,
              cumulativeCost: realTokens * progress,
              cumulativeInput: totalInput * progress,
              cumulativeOutput: totalOutput * progress,
            });
          }

          setFlowData(fPoints);
          setCostData(cPoints);
          setTotalTokens(realTokens);
        } else {
          setFlowData([]);
          setCostData([]);
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
      <div>
        <h2 className="text-sm font-medium text-th-text">Project Analysis</h2>
        {sessionTitle && (
          <p className="text-xs text-th-text-muted mt-0.5 truncate" title={sessionTitle} data-testid="session-title">
            {sessionTitle}
          </p>
        )}
      </div>

      {/* Key Stats */}
      <KeyStats agents={displayAgents} totalTokens={totalTokens} sessionStart={sessionStart} />

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CumulativeFlow data={flowData} />
        <CostCurve data={costData} />
      </div>

      {/* Token Attribution — scoped to this project */}
      <CostBreakdown projectId={effectiveId} />
    </div>
  );
}
