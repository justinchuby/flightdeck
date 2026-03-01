export interface DagTask {
  id: string;
  leadId: string;
  role: string;
  title?: string;
  description: string;
  files: string[];
  dependsOn: string[];
  dagStatus: 'pending' | 'ready' | 'running' | 'done' | 'failed' | 'blocked' | 'paused' | 'skipped';
  priority: number;
  model?: string;
  assignedAgentId?: string;
  createdAt: string;
  completedAt?: string;
}

// Persistent project (survives lead sessions)
export interface Project {
  id: string;
  name: string;
  description: string;
  cwd: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  sessions?: ProjectSession[];
  activeLeadId?: string;
}

export interface ProjectSession {
  id: number;
  projectId: string;
  leadId: string;
  sessionId: string | null;
  task: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
}

export interface DagStatus {
  tasks: DagTask[];
  fileLockMap: Record<string, { taskId: string; agentId?: string }>;
  summary: { pending: number; ready: number; running: number; done: number; failed: number; blocked: number; paused: number; skipped: number };
}

export interface ChatGroup {
  name: string;
  leadId: string;
  projectId?: string;
  memberIds: string[];
  createdAt: string;
}

export interface GroupMessage {
  id: string;
  groupName: string;
  leadId: string;
  projectId?: string;
  fromAgentId: string;
  fromRole: string;
  content: string;
  timestamp: string;
}

export type AgentStatus = 'creating' | 'running' | 'idle' | 'completed' | 'failed' | 'terminated';

// ACP Protocol Types

export interface AcpTextChunk {
  type: 'text';
  text: string;
  sender?: 'agent' | 'user' | 'system' | 'external' | 'thinking';
  /** Role name of external sender (e.g. "Developer", "Architect") */
  fromRole?: string;
  timestamp?: number;
  /** Whether a user message is still queued (not yet processed by agent) */
  queued?: boolean;
  /** Content type for rich media (default: 'text') */
  contentType?: 'text' | 'image' | 'audio' | 'resource';
  /** MIME type for image/audio content */
  mimeType?: string;
  /** Base64-encoded data for image/audio */
  data?: string;
  /** URI for resource content */
  uri?: string;
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
  model?: string;
}

export interface AgentInfo {
  id: string;
  role: Role;
  status: AgentStatus;
  task?: string;
  parentId?: string;
  childIds: string[];
  createdAt: string;
  outputPreview: string;
  autopilot: boolean;
  session?: AcpSessionInfo;
  sessionId?: string | null;
  plan?: AcpPlanEntry[];
  toolCalls?: AcpToolCall[];
  messages?: AcpTextChunk[];
  pendingPermission?: AcpPermissionRequest;
  projectName?: string;
  projectId?: string;
  model?: string;
  cwd?: string;
  inputTokens?: number;
  outputTokens?: number;
  contextWindowSize?: number;
  contextWindowUsed?: number;
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
    | 'agent:thinking'
    | 'lead:decision'
    | 'lead:progress'
    | string;
  [key: string]: any;
}

export interface Decision {
  id: string;
  agentId: string;
  agentRole: string;
  projectId?: string;
  title: string;
  rationale: string;
  needsConfirmation?: boolean;
  status?: 'recorded' | 'confirmed' | 'rejected';
  autoApproved?: boolean;
  confirmedAt?: string | null;
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
  leadTokens?: { input: number; output: number };
  teamAgents: Array<{
    id: string;
    role: Role;
    status: AgentStatus;
    task?: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    contextWindowSize?: number;
    contextWindowUsed?: number;
  }>;
  delegations: Delegation[];
}
