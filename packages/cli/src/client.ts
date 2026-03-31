/**
 * Flightdeck HTTP client — wraps all REST API calls to the Flightdeck server.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ── Session persistence ──────────────────────────────────────────

const SESSION_DIR = join(homedir(), '.flightdeckcli');
const SESSION_FILE = join(SESSION_DIR, 'session.json');

export interface Session {
  serverUrl?: string;
  token?: string;
  projectId?: string;
}

export function loadSession(): Session {
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveSession(patch: Partial<Session>): void {
  mkdirSync(SESSION_DIR, { recursive: true });
  const existing = loadSession();
  const merged = { ...existing, ...patch };
  writeFileSync(SESSION_FILE, JSON.stringify(merged, null, 2));
}

export function clearSession(): void {
  try {
    writeFileSync(SESSION_FILE, '{}');
  } catch { /* ignore */ }
}

// ── HTTP client ──────────────────────────────────────────────────

function getBaseUrl(): string {
  return process.env.FLIGHTDECK_URL || loadSession().serverUrl || 'http://localhost:3001';
}

function getToken(): string | undefined {
  return process.env.FLIGHTDECK_TOKEN || loadSession().token;
}

export class FlightdeckError extends Error {
  constructor(message: string, public status: number = 0, public detail: string = '') {
    super(message);
    this.name = 'FlightdeckError';
  }
}

interface RequestOptions {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  params?: Record<string, string | number | boolean | undefined>;
}

async function request<T = unknown>(opts: RequestOptions): Promise<T> {
  const base = getBaseUrl();
  let url = `${base}${opts.path}`;

  if (opts.params) {
    const entries = Object.entries(opts.params).filter(([, v]) => v !== undefined && v !== null);
    if (entries.length) {
      const qs = new URLSearchParams(entries.map(([k, v]) => [k, String(v)]));
      url += `?${qs.toString()}`;
    }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const init: RequestInit = {
    method: opts.method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  };

  let resp: Response;
  try {
    resp = await fetch(url, init);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new FlightdeckError(
      `Cannot connect to Flightdeck at ${base}: ${msg}`,
      0,
      'Is the server running? Start with: flightdeck --no-browser',
    );
  }

  const text = await resp.text();
  if (!resp.ok) {
    let msg = text;
    try {
      const json = JSON.parse(text);
      msg = json.error || text;
    } catch { /* use raw text */ }
    throw new FlightdeckError(msg, resp.status, text);
  }

  return text ? JSON.parse(text) : ({} as T);
}

// ── API functions ────────────────────────────────────────────────

// Health
export const health = () => request({ method: 'GET', path: '/health' });

// Projects
export const listProjects = (status?: string) =>
  request<unknown[]>({ method: 'GET', path: '/api/projects', params: { status } });

export const getProject = (id: string) =>
  request({ method: 'GET', path: `/api/projects/${id}` });

export const startProject = (task: string, opts?: { name?: string; model?: string; cwd?: string }) =>
  request({ method: 'POST', path: '/api/lead/start', body: { task, ...opts } });

export const deleteProject = (id: string) =>
  request({ method: 'DELETE', path: `/api/projects/${id}` });

// Agents
export const listAgents = (projectId?: string) =>
  request<unknown[]>({ method: 'GET', path: '/api/agents', params: { projectId } });

export const getAgentMessages = (id: string, limit = 50) =>
  request({ method: 'GET', path: `/api/agents/${id}/messages`, params: { limit } });

export const spawnAgent = (roleId: string, opts?: { task?: string; model?: string; provider?: string }) =>
  request({ method: 'POST', path: '/api/agents', body: { roleId, ...opts } });

export const terminateAgent = (id: string) =>
  request({ method: 'POST', path: `/api/agents/${id}/terminate` });

export const sendMessage = (id: string, text: string, mode = 'queue') =>
  request({ method: 'POST', path: `/api/agents/${id}/message`, body: { text, mode } });

export const interruptAgent = (id: string) =>
  request({ method: 'POST', path: `/api/agents/${id}/interrupt` });

export const restartAgent = (id: string) =>
  request({ method: 'POST', path: `/api/agents/${id}/restart` });

// Tasks
export const listTasks = (params?: { projectId?: string; leadId?: string; status?: string; scope?: string }) =>
  request({ method: 'GET', path: '/api/tasks', params: { scope: 'global', ...params } });

export const getAttention = (projectId?: string) =>
  request({ method: 'GET', path: '/api/tasks/attention', params: { projectId } });

// Decisions
export const listDecisions = (params?: { pendingOnly?: boolean; projectId?: string }) =>
  request<unknown[]>({
    method: 'GET',
    path: '/api/decisions',
    params: {
      needs_confirmation: params?.pendingOnly ? 'true' : undefined,
      projectId: params?.projectId,
    },
  });

export const approveDecision = (id: string, reason?: string) =>
  request({ method: 'POST', path: `/api/decisions/${id}/confirm`, body: reason ? { reason } : {} });

export const rejectDecision = (id: string, reason?: string) =>
  request({ method: 'POST', path: `/api/decisions/${id}/reject`, body: reason ? { reason } : {} });

// Coordination
export const getStatus = (projectId?: string) =>
  request({ method: 'GET', path: '/api/coordination/status', params: { projectId } });

export const getLocks = (projectId?: string) =>
  request({ method: 'GET', path: '/api/coordination/locks', params: { projectId } });

export const getActivity = (limit = 20, projectId?: string) =>
  request({ method: 'GET', path: '/api/coordination/activity', params: { limit, projectId } });

export const getSummary = (projectId?: string) =>
  request({ method: 'GET', path: '/api/coordination/summary', params: { projectId } });

// Analytics
export const getAnalytics = (projectId?: string) =>
  request({ method: 'GET', path: '/api/analytics', params: { projectId } });

// Settings / Providers
export const getProviders = () =>
  request<unknown[]>({ method: 'GET', path: '/api/settings/providers' });

export const getProviderStatus = () =>
  request<unknown[]>({ method: 'GET', path: '/api/settings/providers/status' });

export const getRoles = () =>
  request<unknown[]>({ method: 'GET', path: '/api/roles' });
