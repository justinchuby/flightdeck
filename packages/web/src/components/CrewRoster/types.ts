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


