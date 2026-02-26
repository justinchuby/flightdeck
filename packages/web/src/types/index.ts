export type AgentStatus = 'creating' | 'running' | 'idle' | 'completed' | 'failed';

// ACP Protocol Types

export type AgentMode = 'pty' | 'acp';

export interface AcpTextChunk {
  type: 'text';
  text: string;
  sender?: 'agent' | 'user';
}

export interface AcpToolCall {
  toolCallId: string;
  title: string;
  kind: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  content?: string;
}

export interface AcpPlanEntry {
  content: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed';
}

export interface AcpPermissionRequest {
  id: string;
  agentId: string;
  toolName: string;
  arguments: Record<string, any>;
  timestamp: string;
}

export interface AcpSessionInfo {
  sessionId: string;
  mode: AgentMode;
  isPrompting: boolean;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  color: string;
  icon: string;
  builtIn: boolean;
}

export interface AgentInfo {
  id: string;
  role: Role;
  status: AgentStatus;
  taskId?: string;
  parentId?: string;
  childIds: string[];
  createdAt: string;
  outputPreview: string;
  mode: AgentMode;
  autopilot: boolean;
  session?: AcpSessionInfo;
  plan?: AcpPlanEntry[];
  toolCalls?: AcpToolCall[];
  messages?: AcpTextChunk[];
  pendingPermission?: AcpPermissionRequest;
  projectName?: string;
}

export type TaskStatus = 'queued' | 'assigned' | 'in_progress' | 'review' | 'done' | 'failed';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  assignedRole?: string;
  assignedAgentId?: string;
  parentTaskId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerConfig {
  port: number;
  host: string;
  cliCommand: string;
  cliArgs: string[];
  maxConcurrentAgents: number;
  dbPath: string;
}

export interface WsMessage {
  type:
    | 'agent:output'
    | 'agent:status'
    | 'agent:text'
    | 'agent:tool_call'
    | 'agent:plan'
    | 'agent:permission_request'
    | 'agent:permission_response'
    | 'agent:delegated'
    | 'agent:completion_reported'
    | 'lead:decision'
    | 'lead:progress'
    | string;
  [key: string]: any;
}

export interface Decision {
  id: string;
  agentId: string;
  agentRole: string;
  title: string;
  rationale: string;
  timestamp: string;
}

export interface Delegation {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  toRole: string;
  task: string;
  context?: string;
  status: 'active' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  result?: string;
}

export interface LeadProgress {
  totalDelegations: number;
  active: number;
  completed: number;
  failed: number;
  completionPct: number;
  teamSize: number;
  teamAgents: Array<{
    id: string;
    role: Role;
    status: AgentStatus;
    taskId?: string;
  }>;
  delegations: Delegation[];
}
