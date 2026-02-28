import { useState, useEffect, useCallback } from 'react';
import type { Role, ServerConfig } from '../types';
import { useAppStore } from '../stores/appStore';

const API_BASE = '/api';

async function fetchJSON<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  return res.json();
}

export function useApi() {
  const { setRoles, setConfig } = useAppStore();

  const loadRoles = useCallback(async () => {
    const roles = await fetchJSON<Role[]>('/roles');
    setRoles(roles);
  }, [setRoles]);

  const loadConfig = useCallback(async () => {
    const config = await fetchJSON<ServerConfig>('/config');
    setConfig(config);
  }, [setConfig]);

  const spawnAgent = useCallback(async (roleId: string, task?: string, autopilot?: boolean) => {
    return fetchJSON('/agents', {
      method: 'POST',
      body: JSON.stringify({ roleId, task, autopilot }),
    });
  }, []);

  const killAgent = useCallback(async (id: string) => {
    return fetchJSON(`/agents/${id}`, { method: 'DELETE' });
  }, []);

  const interruptAgent = useCallback(async (id: string) => {
    return fetchJSON(`/agents/${id}/interrupt`, { method: 'POST' });
  }, []);

  const restartAgent = useCallback(async (id: string) => {
    return fetchJSON(`/agents/${id}/restart`, { method: 'POST' });
  }, []);

  const createTask = useCallback(
    async (title: string, description?: string, priority?: number, assignedRole?: string) => {
      return fetchJSON('/tasks', {
        method: 'POST',
        body: JSON.stringify({ title, description, priority, assignedRole }),
      });
    },
    [],
  );

  const updateTask = useCallback(async (id: string, patch: Record<string, any>) => {
    return fetchJSON(`/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    // Optimistic removal from store
    useAppStore.getState().removeTask(id);
    return fetchJSON(`/tasks/${id}`, { method: 'DELETE' });
  }, []);

  const updateConfig = useCallback(
    async (patch: Partial<ServerConfig>) => {
      const config = await fetchJSON<ServerConfig>('/config', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setConfig(config);
      return config;
    },
    [setConfig],
  );

  const createRole = useCallback(
    async (role: Omit<Role, 'builtIn'>) => {
      await fetchJSON('/roles', {
        method: 'POST',
        body: JSON.stringify(role),
      });
      await loadRoles();
    },
    [loadRoles],
  );

  const deleteRole = useCallback(
    async (id: string) => {
      await fetchJSON(`/roles/${id}`, { method: 'DELETE' });
      await loadRoles();
    },
    [loadRoles],
  );

  // Load initial data
  useEffect(() => {
    loadRoles();
    loadConfig();
  }, [loadRoles, loadConfig]);

  const updateAgent = useCallback(async (id: string, patch: { model?: string }) => {
    return fetchJSON(`/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }, []);

  const resolvePermission = useCallback(async (agentId: string, approved: boolean) => {
    return fetchJSON(`/agents/${agentId}/permission`, {
      method: 'POST',
      body: JSON.stringify({ approved }),
    });
  }, []);

  const fetchGroups = useCallback(async (leadId: string) => {
    return fetchJSON(`/lead/${leadId}/groups`);
  }, []);

  const fetchGroupMessages = useCallback(async (leadId: string, groupName: string) => {
    return fetchJSON(`/lead/${leadId}/groups/${encodeURIComponent(groupName)}/messages`);
  }, []);

  const fetchDagStatus = useCallback(async (leadId: string) => {
    return fetchJSON(`/lead/${leadId}/dag`);
  }, []);

  return {
    spawnAgent,
    killAgent,
    interruptAgent,
    restartAgent,
    createTask,
    updateTask,
    deleteTask,
    updateAgent,
    updateConfig,
    createRole,
    deleteRole,
    resolvePermission,
    fetchGroups,
    fetchGroupMessages,
    fetchDagStatus,
  };
}
