import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from './useApi';
import type { ConflictAlert, ConflictDetectionConfig, ConflictResolution } from '../components/Conflicts/types';

export function useConflicts() {
  const [conflicts, setConflicts] = useState<ConflictAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<ConflictAlert[]>('/conflicts')
      .then(data => setConflicts(Array.isArray(data) ? data : []))
      .catch(() => { /* initial fetch — will retry */ })
      .finally(() => setLoading(false));
  }, []);

  const resolve = useCallback(async (id: string, resolution: ConflictResolution) => {
    const updated = await apiFetch<ConflictAlert>(`/conflicts/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution }),
    });
    setConflicts(prev => prev.map(c => (c.id === id ? updated : c)));
  }, []);

  const dismiss = useCallback(async (id: string) => {
    await apiFetch(`/conflicts/${id}/dismiss`, { method: 'POST' });
    setConflicts(prev => prev.filter(c => c.id !== id));
  }, []);

  const activeConflicts = conflicts.filter(c => c.status === 'active');

  return { conflicts, activeConflicts, loading, resolve, dismiss };
}

export function useConflictConfig() {
  const [config, setConfig] = useState<ConflictDetectionConfig | null>(null);

  useEffect(() => {
    apiFetch<ConflictDetectionConfig>('/conflicts/config')
      .then(setConfig)
      .catch(() => { /* initial fetch — will retry */ });
  }, []);

  const saveConfig = useCallback(async (updates: Partial<ConflictDetectionConfig>) => {
    const updated = await apiFetch<ConflictDetectionConfig>('/conflicts/config', {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    setConfig(updated);
  }, []);

  return { config, saveConfig };
}
