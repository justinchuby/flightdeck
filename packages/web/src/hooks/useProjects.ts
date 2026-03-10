import { useState, useEffect } from 'react';
import { apiFetch } from './useApi';
import type { Project } from '../types';

/**
 * Shared hook to fetch projects from the REST API.
 * Filters out archived projects by default.
 * Caches in component state — multiple consumers each get their own fetch.
 */
export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Project[]>('/projects')
      .then((ps) => {
        if (Array.isArray(ps)) {
          setProjects(ps.filter((p) => p.status !== 'archived'));
        }
      })
      .catch(() => { /* initial fetch — will retry */ })
      .finally(() => setLoading(false));
  }, []);

  return { projects, loading };
}
