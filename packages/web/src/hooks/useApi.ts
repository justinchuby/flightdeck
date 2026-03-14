import { useEffect, useCallback } from 'react';
import type { Role, ServerConfig } from '../types';
import { useAppStore } from '../stores/appStore';

const API_BASE = '/api';

/** Default request timeout in milliseconds */
const DEFAULT_TIMEOUT_MS = 30_000;

export interface ApiFetchOptions extends RequestInit {
  /** Per-request timeout in ms (default: 30 000). Set to 0 to disable. */
  timeoutMs?: number;
}

export function getAuthToken(): string | null {
  // URL param or localStorage — for cross-machine access or manual token entry.
  // In production, the server sets an HttpOnly cookie that handles auth automatically
  // (cookie is sent by the browser with every request, no JS access needed).
  const params = new URLSearchParams(window.location.search);
  try { return params.get('token') || localStorage.getItem('flightdeck-token'); } catch { return params.get('token'); }
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  if (token) return { Authorization: `Bearer ${token}` };
  return {};
}

/** Standalone authenticated fetch — usable outside React hooks */
export async function apiFetch<T = any>(path: string, opts?: ApiFetchOptions): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOpts } = opts ?? {};

  // Wire up abort controller for timeout (and caller-provided signals)
  const controller = new AbortController();
  const callerSignal = fetchOpts.signal;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }
  // If the caller already passed a signal, forward its abort
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...fetchOpts,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...authHeaders(), ...fetchOpts.headers },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      if (callerSignal?.aborted) throw err; // caller-initiated abort — rethrow as-is
      throw new Error(`Request to ${path} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export function useApi() {
  const setRoles = useAppStore((s) => s.setRoles);
  const setConfig = useAppStore((s) => s.setConfig);

  const loadRoles = useCallback(async () => {
    const roles = await apiFetch<Role[]>('/roles');
    setRoles(roles);
  }, [setRoles]);

  const loadConfig = useCallback(async () => {
    const config = await apiFetch<ServerConfig>('/config');
    setConfig(config);
  }, [setConfig]);

  const spawnAgent = useCallback(async (roleId: string, task?: string, options?: { model?: string; provider?: string }) => {
    return apiFetch('/agents', {
      method: 'POST',
      body: JSON.stringify({ roleId, task, ...options }),
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
    loadRoles().catch(() => { /* initial fetch — will retry */ });
    loadConfig().catch(() => { /* initial fetch — will retry */ });
  }, [loadRoles, loadConfig]);

  const updateAgent = useCallback(async (id: string, patch: { model?: string }) => {
    // Optimistically update local store so the dropdown reflects the change immediately
    useAppStore.getState().updateAgent(id, patch);
    return apiFetch(`/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
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
    updateAgent,
    updateConfig,
    createRole,
    deleteRole,
    fetchGroups,
    fetchGroupMessages,
    fetchDagStatus,
  };
}
