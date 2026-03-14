// Shared types for CrewRoster components

export type RosterStatus = 'idle' | 'running' | 'terminated' | 'failed';
export type LiveStatus = 'creating' | 'running' | 'idle' | 'completed' | 'failed' | 'terminated' | null;

export interface RosterAgent {
  agentId: string;
  role: string;
  model: string;
  status: RosterStatus;
  liveStatus: LiveStatus;
  teamId: string;
  projectId: string | null;
  parentId: string | null;
  sessionId: string | null;
  lastTaskSummary: string | null;
  createdAt: string;
  updatedAt: string;
  provider: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  contextWindowSize: number | null;
  contextWindowUsed: number | null;
  task: string | null;
  outputPreview: string | null;
}

export interface AgentProfile {
  agentId: string;
  role: string;
  model: string;
  status: RosterStatus;
  liveStatus: LiveStatus;
  teamId: string;
  projectId: string | null;
  lastTaskSummary: string | null;
  createdAt: string;
  updatedAt: string;
  knowledgeCount: number;
  live: {
    task: string | null;
    outputPreview: string | null;
    model: string | null;
    sessionId: string | null;
    provider: string | null;
    backend: string | null;
    exitError: string | null;
  } | null;
}

export interface CrewInfo {
  crewId: string;
  agentCount: number;
  roles: string[];
}

export interface CrewSummary {
  leadId: string;
  projectId: string | null;
  projectName: string | null;
  agentCount: number;
  activeAgentCount: number;
  sessionCount: number;
  lastActivity: string;
}

export interface SessionDetail {
  id: string;
  leadId: string;
  status: string;
  task: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  taskSummary: { total: number; done: number; failed: number };
  hasRetro: boolean;
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export function statusBadge(status: RosterStatus, liveStatus: LiveStatus): { bg: string; label: string } {
  // Live agent states take priority — these come from AgentManager (in-memory)
  if (liveStatus === 'running') return { bg: 'bg-green-500/20 text-green-400', label: 'Running' };
  if (liveStatus === 'creating') return { bg: 'bg-yellow-500/20 text-yellow-400', label: 'Starting' };
  if (liveStatus === 'idle') return { bg: 'bg-cyan-500/20 text-cyan-400', label: 'Idle' };
  if (liveStatus === 'completed') return { bg: 'bg-gray-500/20 text-gray-400', label: 'Completed' };
  if (liveStatus === 'failed') return { bg: 'bg-red-500/20 text-red-400', label: 'Failed' };
  if (liveStatus === 'terminated') return { bg: 'bg-gray-500/20 text-gray-400', label: 'Terminated' };
  // liveStatus is null — agent not in memory. Fall back to DB status.
  if (status === 'terminated') return { bg: 'bg-gray-500/20 text-gray-400', label: 'Terminated' };
  if (status === 'failed') return { bg: 'bg-red-500/20 text-red-400', label: 'Failed' };
  // DB says idle/running but agent not found in live manager → offline
  return { bg: 'bg-gray-500/20 text-gray-400', label: 'Offline' };
}
