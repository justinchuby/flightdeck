/**
 * useEffectiveProjectId — derives the active project ID from stores.
 *
 * Priority: selected lead > any running lead > first project in registry.
 * Uses lead.projectId (project registry UUID) when available so fetches
 * match the projectId stored in activity events.
 *
 * Caches the last resolved ID so it survives agent cleanup (when agents
 * exit, they are removed from the store but the user still expects to
 * see the same project).
 */
import { useMemo, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { useLeadStore } from '../stores/leadStore';
import { useProjects } from './useProjects';

export function useEffectiveProjectId(): string | null {
  const agents = useAppStore((s) => s.agents);
  const selectedLeadId = useLeadStore((s) => s.selectedLeadId);
  const { projects } = useProjects();
  const cachedRef = useRef<string | null>(null);

  const resolved = useMemo(() => {
    if (selectedLeadId) {
      const lead = agents.find((a) => a.id === selectedLeadId);
      if (lead) return lead.projectId || selectedLeadId;
      // Agent removed from store — check if selectedLeadId is itself a project ID
      if (projects.some(p => p.id === selectedLeadId)) return selectedLeadId;
      // selectedLeadId is an agent ID with no live agent — fall through
    }
    const lead = agents.find((a) => a.role?.id === 'lead' && !a.parentId);
    if (lead) return lead.projectId || lead.id;
    return projects.length > 0 ? projects[0].id : null;
  }, [selectedLeadId, agents, projects]);

  // Cache last valid project ID so it persists through agent cleanup
  if (resolved) cachedRef.current = resolved;
  return resolved ?? cachedRef.current;
}
