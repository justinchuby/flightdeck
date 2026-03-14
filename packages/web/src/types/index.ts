// ── Shared domain types (single source of truth) ─────────────────
// Re-exported from @flightdeck/shared so web code imports from one place.
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
  sender?: 'agent' | 'user' | 'system' | 'external' | 'thinking' | 'tool';
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
  /** Tool call ID for sender='tool' messages, links to AcpToolCall */
  toolCallId?: string;
  /** Tool call status for sender='tool' messages */
  toolStatus?: AcpToolCall['status'];
  /** Tool call kind (e.g. 'bash', 'file_edit') for sender='tool' messages */
  toolKind?: string;
}

/**
 * Live tool call state — updated in-place as status changes.
 * Used by AgentCard and AgentActivityTable to show "what is the agent doing right now?"
 *
 * Separate from messages[]: toolCalls[] holds only the latest state per tool call
 * (no history), while messages[] is the append-only chronological timeline.
 * Tool call events are injected into messages[] as AcpTextChunk (sender='tool')
 * with toolCallId/toolStatus/toolKind metadata for proper rendering in the chat panel.
 */
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
  session?: AcpSessionInfo;
  sessionId?: string | null;
  plan?: AcpPlanEntry[];
  /** Live tool call state — latest status per tool, for activity indicators (AgentCard, FleetOverview) */
  toolCalls?: AcpToolCall[];
  /** Chronological message timeline — append-only, rendered by ChatPanel/AcpOutput */
  messages?: AcpTextChunk[];
  projectName?: string;
  projectId?: string;
  model: string;
  cwd?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  contextWindowSize?: number;
  contextWindowUsed?: number;
  contextBurnRate?: number;
  estimatedExhaustionMinutes?: number | null;
  /** CLI provider used to spawn this agent (e.g. 'copilot', 'claude', 'cursor') */
  provider?: string;
  /** Adapter backend type (e.g. 'acp') */
  backend?: string;
  /** Error message if agent failed to start or crashed */
  exitError?: string;
  /** Process exit code (non-zero indicates failure) */
  exitCode?: number;
  /** Model resolution metadata when the requested model differs from the resolved model */
  modelResolution?: {
    /** Model originally requested before cross-provider resolution */
    requested: string;
    /** Model actually used by the CLI after resolution */
    resolved: string;
    /** Whether the model was translated to a different model for the target provider */
    translated: boolean;
    /** Human-readable reason for model translation */
    reason: string;
  };
}

export interface ServerConfig {
  port: number;
  host: string;
  cliCommand: string;
  cliArgs: string[];
  maxConcurrentAgents: number;
  dbPath: string;
  /** CLI provider ID (e.g. 'copilot', 'claude', 'gemini') */
  provider?: string;
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
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- WS messages are dynamically typed
}

// Decision is re-exported from shared above (with proper non-optional fields)

// Delegation is re-exported from shared above (now includes 'cancelled' | 'terminated' statuses)

export interface LeadProgress {
  totalDelegations: number;
  active: number;
  completed: number;
  failed: number;
  completionPct: number;
  crewSize: number;
  leadTokens?: { input: number; output: number };
  crewAgents: Array<{
    id: string;
    role: Role;
    status: AgentStatus;
    task?: string;
    model: string;
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

export interface ProjectCostSummary {
  projectId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  sessionCount: number;
  agentCount: number;
}

export interface AgentCostSummary {
  agentId: string;
  agentRole?: string;
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
  /** ISO 8601 timestamp of last token usage update for this task */
  lastUpdatedAt?: string | null;
  agents: Array<{ agentId: string; agentRole?: string; inputTokens: number; outputTokens: number }>;
}
