import { useState, useEffect, useCallback } from 'react';
import type { Role, ServerConfig } from '../types';
import { useAppStore } from '../stores/appStore';

const API_BASE = '/api';

export function getAuthToken(): string | null {
  // Check injected token from server (production), then URL params, then localStorage
  const injected = (window as any).__AI_CREW_TOKEN__;
  if (injected) return injected;
  const params = new URLSearchParams(window.location.search);
  return params.get('token') || localStorage.getItem('ai-crew-token');
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  if (token) return { Authorization: `Bearer ${token}` };
  return {};
}

/** Standalone authenticated fetch — usable outside React hooks */
export async function apiFetch<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...opts?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export function useApi() {
  const { setRoles, setConfig } = useAppStore();

  const loadRoles = useCallback(async () => {
    const roles = await apiFetch<Role[]>('/roles');
    setRoles(roles);
  }, [setRoles]);

  const loadConfig = useCallback(async () => {
    const config = await apiFetch<ServerConfig>('/config');
    setConfig(config);
  }, [setConfig]);

  const spawnAgent = useCallback(async (roleId: string, task?: string, autopilot?: boolean) => {
    return apiFetch('/agents', {
      method: 'POST',
      body: JSON.stringify({ roleId, task, autopilot }),
    });
  }, []);

  const terminateAgent = useCallback(async (id: string) => {
    return apiFetch(`/agents/${id}`, { method: 'DELETE' });
  }, []);

  const interruptAgent = useCallback(async (id: string) => {
    return apiFetch(`/agents/${id}/interrupt`, { method: 'POST' });
  }, []);

  const restartAgent = useCallback(async (id: string) => {
    return apiFetch(`/agents/${id}/restart`, { method: 'POST' });
  }, []);

  const resumeAgent = useCallback(async (id: string, sessionId: string) => {
    const agent = useAppStore.getState().agents.find((a) => a.id === id);
    return apiFetch('/agents', {
      method: 'POST',
      body: JSON.stringify({
        roleId: agent?.role.id ?? 'lead',
        task: agent?.task,
        model: agent?.model,
        sessionId,
      }),
    });
  }, []);

  const updateConfig = useCallback(
    async (patch: Partial<ServerConfig>) => {
      const config = await apiFetch<ServerConfig>('/config', {
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
      await apiFetch('/roles', {
        method: 'POST',
        body: JSON.stringify(role),
      });
      await loadRoles();
    },
    [loadRoles],
  );

  const deleteRole = useCallback(
    async (id: string) => {
      await apiFetch(`/roles/${id}`, { method: 'DELETE' });
      await loadRoles();
    },
    [loadRoles],
  );

  // Load initial data
  useEffect(() => {
    loadRoles().catch(() => {});
    loadConfig().catch(() => {});
  }, [loadRoles, loadConfig]);

  const updateAgent = useCallback(async (id: string, patch: { model?: string }) => {
    // Optimistically update local store so the dropdown reflects the change immediately
    useAppStore.getState().updateAgent(id, patch);
    return apiFetch(`/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }, []);

  const resolvePermission = useCallback(async (agentId: string, approved: boolean) => {
    return apiFetch(`/agents/${agentId}/permission`, {
      method: 'POST',
      body: JSON.stringify({ approved }),
    });
  }, []);

  const fetchGroups = useCallback(async (leadId: string) => {
    return apiFetch(`/lead/${leadId}/groups`);
  }, []);

  const fetchGroupMessages = useCallback(async (leadId: string, groupName: string) => {
    return apiFetch(`/lead/${leadId}/groups/${encodeURIComponent(groupName)}/messages`);
  }, []);

  const fetchDagStatus = useCallback(async (leadId: string) => {
    return apiFetch(`/lead/${leadId}/dag`);
  }, []);

  return {
    spawnAgent,
    terminateAgent,
    interruptAgent,
    restartAgent,
    resumeAgent,
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
