import { useQuery } from '@tanstack/react-query';
import { useLeadStore } from '../../stores/leadStore';
import { apiFetch } from '../../hooks/useApi';
import type { DagStatus, Decision } from '../../types';

/**
 * Polls progress, decisions, groups, and DAG for the selected lead agent
 * using TanStack Query for automatic refetching, caching, and cleanup.
 */
export function useLeadPolling(
  selectedLeadId: string | null,
  isActiveAgent: boolean,
  historicalProjectId: string | null,
) {
  // Poll progress
  useQuery({
    queryKey: ['lead', 'progress', selectedLeadId],
    queryFn: async ({ signal }) => {
      const data = await apiFetch(`/lead/${selectedLeadId}/progress`, { signal });
      if (data && !data.error) {
        useLeadStore.getState().setProgress(selectedLeadId!, data);
      }
      return data;
    },
    enabled: isActiveAgent && !!selectedLeadId,
    refetchInterval: 5000,
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes('404')) return false;
      return failureCount < 2;
    },
  });

  // Poll decisions
  useQuery({
    queryKey: ['lead', 'decisions', selectedLeadId],
    queryFn: async ({ signal }) => {
      const data: Decision[] = await apiFetch(`/lead/${selectedLeadId}/decisions`, { signal });
      if (Array.isArray(data)) {
        useLeadStore.getState().setDecisions(selectedLeadId!, data);
      }
      return data;
    },
    enabled: isActiveAgent && !!selectedLeadId,
    refetchInterval: 5000,
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes('404')) return false;
      return failureCount < 2;
    },
  });

  // Fetch groups (one-shot per lead, no polling)
  useQuery({
    queryKey: ['lead', 'groups', selectedLeadId],
    queryFn: async ({ signal }) => {
      const data = await apiFetch(`/lead/${selectedLeadId}/groups`, { signal });
      if (Array.isArray(data)) {
        useLeadStore.getState().setGroups(selectedLeadId!, data);
      }
      return data;
    },
    enabled: isActiveAgent && !!selectedLeadId,
    staleTime: 30_000,
  });

  // Poll DAG status
  useQuery({
    queryKey: ['lead', 'dag', selectedLeadId],
    queryFn: async ({ signal }) => {
      const data = await apiFetch<DagStatus>(`/lead/${selectedLeadId}/dag`, { signal });
      if (data && data.tasks) {
        const store = useLeadStore.getState();
        store.setDagStatus(selectedLeadId!, data);
        if (historicalProjectId && historicalProjectId !== selectedLeadId) {
          store.setDagStatus(historicalProjectId, data);
        }
      }
      return data;
    },
    enabled: isActiveAgent && !!selectedLeadId,
    refetchInterval: 10000,
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes('404')) return false;
      return failureCount < 2;
    },
  });
}
