import { useEffect } from 'react';
import { useLeadStore } from '../../stores/leadStore';
import { apiFetch } from '../../hooks/useApi';
import type { DagStatus } from '../../types';

/**
 * Polls progress, decisions, groups, and DAG for the selected lead agent.
 * Writes results to leadStore — no return value needed.
 */
export function useLeadPolling(
  selectedLeadId: string | null,
  isActiveAgent: boolean,
  historicalProjectId: string | null,
) {
  // Poll progress
  useEffect(() => {
    if (!isActiveAgent || !selectedLeadId) return;
    const controller = new AbortController();
    let stopped = false;
    const fetchProgress = () => {
      if (stopped) return;
      apiFetch(`/lead/${selectedLeadId}/progress`, { signal: controller.signal }).then((data) => {
        if (!controller.signal.aborted && data && !data.error) useLeadStore.getState().setProgress(selectedLeadId, data);
      }).catch((err: unknown) => {
        if (err instanceof Error && err.message.includes('404')) { stopped = true; return; }
        if (!(err instanceof DOMException)) console.warn('[LeadDashboard] Progress poll failed:', err);
      });
    };
    fetchProgress();
    const interval = setInterval(fetchProgress, 5000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [selectedLeadId, isActiveAgent]);

  // Poll decisions
  useEffect(() => {
    if (!isActiveAgent || !selectedLeadId) return;
    const controller = new AbortController();
    let stopped = false;
    const fetchDecisions = () => {
      if (stopped) return;
      apiFetch(`/lead/${selectedLeadId}/decisions`, { signal: controller.signal }).then((data) => {
        if (!controller.signal.aborted && Array.isArray(data)) useLeadStore.getState().setDecisions(selectedLeadId, data);
      }).catch((err: unknown) => {
        if (err instanceof Error && err.message.includes('404')) { stopped = true; return; }
        if (!(err instanceof DOMException)) console.warn('[LeadDashboard] Decisions poll failed:', err);
      });
    };
    fetchDecisions();
    const interval = setInterval(fetchDecisions, 5000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [selectedLeadId, isActiveAgent]);

  // Fetch groups
  useEffect(() => {
    if (!isActiveAgent || !selectedLeadId) return;
    const controller = new AbortController();
    apiFetch(`/lead/${selectedLeadId}/groups`, { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted && Array.isArray(data)) useLeadStore.getState().setGroups(selectedLeadId, data);
    }).catch((err: unknown) => { if (!(err instanceof DOMException)) console.warn('[LeadDashboard] Groups fetch failed:', err); });
    return () => controller.abort();
  }, [selectedLeadId, isActiveAgent]);

  // Poll DAG status
  useEffect(() => {
    if (!isActiveAgent || !selectedLeadId) return;
    const controller = new AbortController();
    let stopped = false;
    const fetchDag = () => {
      if (stopped) return;
      apiFetch<DagStatus>(`/lead/${selectedLeadId}/dag`, { signal: controller.signal }).then((data) => {
        if (!controller.signal.aborted && data && data.tasks) {
          const store = useLeadStore.getState();
          store.setDagStatus(selectedLeadId, data);
          if (historicalProjectId && historicalProjectId !== selectedLeadId) {
            store.setDagStatus(historicalProjectId, data);
          }
        }
      }).catch((err: unknown) => {
        if (err instanceof Error && err.message.includes('404')) { stopped = true; return; }
        if (!(err instanceof DOMException)) console.warn('[LeadDashboard] DAG poll failed:', err);
      });
    };
    fetchDag();
    const interval = setInterval(fetchDag, 10000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [selectedLeadId, historicalProjectId, isActiveAgent]);
}
