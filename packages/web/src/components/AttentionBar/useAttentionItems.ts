import { useMemo, useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore } from '../../stores/leadStore';
import { apiFetch } from '../../hooks/useApi';

// ── Types ───────────────────────────────────────────────────────────

export type EscalationLevel = 'green' | 'yellow' | 'red';

export interface AttentionItem {
  id: string;
  kind: 'failed' | 'blocked' | 'stale' | 'decision';
  label: string;
  /** Route to navigate to on click, or callback action */
  action: { type: 'navigate'; to: string } | { type: 'callback'; key: string };
}

export interface AttentionState {
  items: AttentionItem[];
  escalation: EscalationLevel;
  /** "12/20 done" style summary */
  progressText: string;
  agentCount: number;
  runningCount: number;
  failedTaskCount: number;
  pendingDecisionCount: number;
}

/** Shape returned by GET /attention */
interface AttentionApiResponse {
  scope: string;
  projectId?: string;
  escalation: EscalationLevel;
  summary: {
    failedCount: number;
    blockedCount: number;
    staleCount: number;
    decisionCount: number;
    totalCount: number;
  };
  items: Array<{
    type: 'failed' | 'blocked' | 'stale' | 'decision';
    severity: 'critical' | 'warning' | 'info';
    task?: { id: string; title?: string; projectId?: string };
    decision?: { id: string; title: string; projectId?: string };
    reason?: string;
    durationMs?: number;
  }>;
}

// ── Constants ───────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 10_000;
const POLL_INTERVAL_WS_MS = 30_000;  // Slower polling when WS is active
const REFETCH_DEBOUNCE_MS = 300;     // Debounce rapid WS signals
const BLOCKED_THRESHOLD_MS = 30 * 60 * 1000;
const STALE_THRESHOLD_MS = 15 * 60 * 1000;

// ── API Hook ────────────────────────────────────────────────────────

/**
 * Fetches attention data from the backend API with hybrid WS+polling.
 * When WebSocket is connected, listens for 'attention:changed' signals
 * and refetches immediately (debounced 300ms). Polling slows to 30s.
 * When WS is disconnected, falls back to 10s polling.
 */
function useAttentionApi(projectId: string | null): AttentionApiResponse | null {
  const [data, setData] = useState<AttentionApiResponse | null>(null);
  const connected = useAppStore((s) => s.connected);

  const fetchAttention = useCallback(async () => {
    try {
      const query = projectId
        ? `?scope=project&projectId=${encodeURIComponent(projectId)}`
        : '';
      const result = await apiFetch<AttentionApiResponse>(`/attention${query}`);
      setData(result);
    } catch {
      // API unavailable — fall back to client-side derivation
      setData(null);
    }
  }, [projectId]);

  useEffect(() => {
    if (!connected) return;
    fetchAttention();

    // Polling fallback: slower when WS connected, faster when disconnected
    const pollMs = connected ? POLL_INTERVAL_WS_MS : POLL_INTERVAL_MS;
    const interval = setInterval(fetchAttention, pollMs);

    // WebSocket push: refetch on attention:changed signal (debounced)
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const handleAttentionChanged = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(fetchAttention, REFETCH_DEBOUNCE_MS);
    };
    window.addEventListener('attention:changed', handleAttentionChanged);

    return () => {
      clearInterval(interval);
      window.removeEventListener('attention:changed', handleAttentionChanged);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [connected, fetchAttention]);

  return data;
}

// ── Main Hook ───────────────────────────────────────────────────────

/**
 * Primary data source: GET /attention API (server-computed, authoritative).
 * Fallback: client-side derivation from app + lead stores.
 */
export function useAttentionItems(): AttentionState {
  const agents = useAppStore((s) => s.agents);
  const pendingDecisions = useAppStore((s) => s.pendingDecisions);
  const projects = useLeadStore((s) => s.projects);
  const selectedLeadId = useLeadStore((s) => s.selectedLeadId);

  const apiData = useAttentionApi(selectedLeadId);

  // API-driven state (preferred — server is the trust anchor)
  const apiState = useMemo((): AttentionState | null => {
    if (!apiData) return null;

    const items: AttentionItem[] = apiData.items.map((item, i) => {
      const projectRoute = item.task?.projectId || item.decision?.projectId || selectedLeadId;
      if (item.type === 'decision') {
        return {
          id: `decision-${item.decision?.id ?? i}`,
          kind: 'decision',
          label: item.decision?.title || 'Decision pending',
          action: { type: 'callback' as const, key: 'openApprovalQueue' },
        };
      }
      const taskLabel = item.task?.title || item.task?.id || `Task ${i}`;
      const suffix = item.durationMs ? ` (${Math.round(item.durationMs / 60_000)}m)` : '';
      return {
        id: `${item.type}-${item.task?.id ?? i}`,
        kind: item.type,
        label: item.type === 'failed' ? taskLabel : `${taskLabel}${suffix}`,
        action: { type: 'navigate' as const, to: projectRoute ? `/projects/${projectRoute}/tasks` : '/tasks' },
      };
    });

    // Agent counts (still from store — API doesn't provide this)
    let runningCount = 0;
    for (const agent of agents) {
      if (agent.status === 'running' || agent.status === 'creating') runningCount++;
    }

    // Compute progress from DAG data in store (API summary doesn't include total done/total)
    let totalDone = 0;
    let totalTasks = 0;
    const projectEntries = selectedLeadId
      ? [[selectedLeadId, projects[selectedLeadId]] as const]
      : Object.entries(projects);
    for (const [, project] of projectEntries) {
      if (!project?.dagStatus) continue;
      const s = project.dagStatus.summary;
      totalDone += s.done;
      totalTasks += s.pending + s.ready + s.running + s.done + s.failed + s.blocked + s.paused + s.skipped;
    }

    return {
      items,
      escalation: apiData.escalation,
      progressText: totalTasks > 0 ? `${totalDone}/${totalTasks} done` : '',
      agentCount: agents.length,
      runningCount,
      failedTaskCount: apiData.summary.failedCount,
      pendingDecisionCount: apiData.summary.decisionCount,
    };
  }, [apiData, agents, projects, selectedLeadId]);

  // Client-side fallback (used when API is unavailable)
  const fallbackState = useMemo((): AttentionState => {
    const items: AttentionItem[] = [];
    const now = Date.now();
    let totalDone = 0;
    let totalTasks = 0;
    let failedTaskCount = 0;

    const projectEntries = selectedLeadId
      ? [[selectedLeadId, projects[selectedLeadId]] as const]
      : Object.entries(projects);

    for (const [projectId, project] of projectEntries) {
      if (!project?.dagStatus) continue;
      const { summary, tasks } = project.dagStatus;

      totalDone += summary.done;
      totalTasks += summary.pending + summary.ready + summary.running +
        summary.done + summary.failed + summary.blocked + summary.paused + summary.skipped;
      failedTaskCount += summary.failed;

      for (const task of tasks) {
        if (task.dagStatus === 'failed') {
          items.push({
            id: `failed-${task.id}`,
            kind: 'failed',
            label: task.title || task.id,
            action: { type: 'navigate', to: `/projects/${projectId}/tasks` },
          });
        }
        if (task.dagStatus === 'blocked') {
          const blockedSince = task.startedAt ? new Date(task.startedAt).getTime()
            : new Date(task.createdAt).getTime();
          if (now - blockedSince > BLOCKED_THRESHOLD_MS) {
            items.push({
              id: `blocked-${task.id}`,
              kind: 'blocked',
              label: `${task.title || task.id} (blocked ${Math.round((now - blockedSince) / 60_000)}m)`,
              action: { type: 'navigate', to: `/projects/${projectId}/tasks` },
            });
          }
        }
        if (task.dagStatus === 'running') {
          const startedAt = task.startedAt ? new Date(task.startedAt).getTime() : 0;
          const duration = startedAt ? now - startedAt : 0;
          if (duration > STALE_THRESHOLD_MS) {
            items.push({
              id: `stale-${task.id}`,
              kind: 'stale',
              label: `${task.title || task.id} (running ${Math.round(duration / 60_000)}m)`,
              action: { type: 'navigate', to: `/projects/${projectId}/tasks` },
            });
          }
        }
      }
    }

    for (const decision of pendingDecisions) {
      items.push({
        id: `decision-${decision.id}`,
        kind: 'decision',
        label: decision.title || 'Decision pending',
        action: { type: 'callback', key: 'openApprovalQueue' },
      });
    }

    let runningCount = 0;
    for (const agent of agents) {
      if (agent.status === 'running' || agent.status === 'creating') runningCount++;
    }

    const exceptionCount = items.length;
    let escalation: EscalationLevel = 'green';
    if (failedTaskCount > 0 || exceptionCount >= 3) escalation = 'red';
    else if (exceptionCount >= 1) escalation = 'yellow';

    return {
      items,
      escalation,
      progressText: totalTasks > 0 ? `${totalDone}/${totalTasks} done` : '',
      agentCount: agents.length,
      runningCount,
      failedTaskCount,
      pendingDecisionCount: pendingDecisions.length,
    };
  }, [agents, pendingDecisions, projects, selectedLeadId]);

  return apiState ?? fallbackState;
}
