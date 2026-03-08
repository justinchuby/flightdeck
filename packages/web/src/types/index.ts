// ── Shared domain types (single source of truth) ─────────────────
// These types are defined in @flightdeck/shared and re-exported here
// for backward compatibility. Fixes 3 drift bugs:
//   1. Delegation.status now includes 'cancelled' | 'terminated'
//   2. DagTask now includes projectId
//   3. ChatGroup now includes archived
export type {
  AgentStatus,
  DagTask,
  DagTaskStatus,
  ChatGroup,
  GroupMessage,
  Decision,
  DecisionStatus,
  DecisionCategory,
  Delegation,
  DelegationStatus,
  Role,
  ActionType,
  FileLock,
} from '@flightdeck/shared';

// Import shared types for use in local type extensions
import type {
  AgentStatus,
  DagTask,
  Delegation,
  Role,
  Project as SharedProject,
  ProjectSession as SharedProjectSession,
  Timer,
} from '@flightdeck/shared';

// ── Web extensions of shared types ────────────────────────────────

// Project with web-specific fields (sessions list, active lead)
export interface Project extends SharedProject {
  sessions?: ProjectSession[];
  activeLeadId?: string;
}

export interface ProjectSession extends SharedProjectSession {}

export interface DagStatus {
  tasks: DagTask[];
  fileLockMap: Record<string, { taskId: string; agentId?: string }>;
  summary: { pending: number; ready: number; running: number; done: number; failed: number; blocked: number; paused: number; skipped: number };
}

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
  /** Image attachments sent with a user message */
  attachments?: Array<{ name: string; mimeType: string; thumbnailDataUrl?: string }>;
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

// Role is re-exported from shared above (includes receivesStatusUpdates)

export interface AgentInfo {
  id: string;
  role: Role;
  status: AgentStatus;
  task?: string;
  dagTaskId?: string;
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
  contextBurnRate?: number;
  estimatedExhaustionMinutes?: number | null;
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

// Decision is re-exported from shared above (with proper non-optional fields)

// Delegation is re-exported from shared above (now includes 'cancelled' | 'terminated' statuses)

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

// ── Cost Tracking ─────────────────────────────────────────────────

export interface TimerInfo extends Timer {
  remainingMs: number;
}

export interface AgentCostSummary {
  agentId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  taskCount: number;
}

export interface TaskCostSummary {
  dagTaskId: string;
  leadId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  agentCount: number;
  agents: Array<{ agentId: string; inputTokens: number; outputTokens: number }>;
}
