import { createContext, useContext } from 'react';

export interface ProjectContextValue {
  /** The project ID from the URL (:id param) */
  projectId: string;
}

export const ProjectContext = createContext<ProjectContextValue | null>(null);

/**
 * Hook to get the current project ID from the nearest ProjectLayout.
 * Throws if used outside a project-scoped route.
 */
export function useProjectId(): string {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error('useProjectId must be used within a project route (/projects/:id/*)');
  }
  return ctx.projectId;
}

/**
 * Hook to optionally get the project ID — returns null if outside a project route.
 */
export function useOptionalProjectId(): string | null {
  const ctx = useContext(ProjectContext);
  return ctx?.projectId ?? null;
}
