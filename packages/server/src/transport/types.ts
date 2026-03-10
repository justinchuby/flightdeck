/**
 * Transport interface types for two-process agent server communication.
 *
 * The orchestrator (Flightdeck server) communicates with a separate agent
 * server process via a pluggable transport layer. Messages use discriminated
 * unions with a `type` field for type-safe dispatch.
 *
 * Design: docs/design/agent-server-architecture.md
 */

// ── Transport State ─────────────────────────────────────────────────

export type TransportState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

// ── Transport Interfaces ────────────────────────────────────────────

/**
 * Orchestrator-side transport — connects to an agent server and
 * sends/receives typed messages.
 */
export interface AgentServerTransport {
  /** Connect to the agent server. */
  connect(): Promise<void>;
  /** Disconnect from the agent server. */
  disconnect(): Promise<void>;
  /** Send a message to the agent server. */
  send(message: OrchestratorMessage): void;
  /** Register a handler for incoming messages. Returns unsubscribe function. */
  onMessage(handler: (message: AgentServerMessage) => void): () => void;
  /** Register a handler for transport state changes. Returns unsubscribe function. */
  onStateChange(handler: (state: TransportState) => void): () => void;
  /** Current transport state. */
  readonly state: TransportState;
  /** Whether this transport supports automatic reconnection. */
  readonly supportsReconnect: boolean;
}

/**
 * Agent-server-side listener — accepts connections from the orchestrator
 * and relays messages.
 */
export interface AgentServerListener {
  /** Start listening for connections. */
  listen(): void;
  /** Stop listening and close all connections. */
  close(): void;
  /** Register a handler for incoming connections. Returns unsubscribe function. */
  onConnection(handler: (connection: TransportConnection) => void): () => void;
}

/**
 * A single connection from the orchestrator to the agent server.
 * Created by AgentServerListener when a client connects.
 */
export interface TransportConnection {
  /** Unique connection identifier. */
  readonly id: string;
  /** Whether this connection is active. */
  readonly isConnected: boolean;
  /** Send a message to the orchestrator. */
  send(message: AgentServerMessage): void;
  /** Register a handler for incoming messages. Returns unsubscribe function. */
  onMessage(handler: (message: OrchestratorMessage) => void): () => void;
  /** Register a handler for disconnection. Returns unsubscribe function. */
  onDisconnect(handler: (reason: string) => void): () => void;
  /** Close this connection. */
  close(): void;
}

// ── Scope ───────────────────────────────────────────────────────────

/** All messages are scoped to a project and team. */
export interface MessageScope {
  projectId: string;
  teamId: string;
}

// ── Orchestrator → Agent Server Messages ────────────────────────────

export interface SpawnAgentMessage {
  type: 'spawn_agent';
  requestId: string;
  scope: MessageScope;
  role: string;
  model: string;
  task?: string;
  context?: Record<string, unknown>;
}

export interface SendMessageMessage {
  type: 'send_message';
  requestId: string;
  scope: MessageScope;
  agentId: string;
  content: string;
}

export interface TerminateAgentMessage {
  type: 'terminate_agent';
  requestId: string;
  scope: MessageScope;
  agentId: string;
  reason?: string;
}

export interface ListAgentsMessage {
  type: 'list_agents';
  requestId: string;
  scope: MessageScope;
}

export interface CancelAgentMessage {
  type: 'cancel_agent';
  requestId: string;
  scope: MessageScope;
  agentId: string;
}

export interface SubscribeMessage {
  type: 'subscribe';
  requestId: string;
  scope: MessageScope;
  agentId?: string;
  lastSeenEventId?: string;
}

export interface PingMessage {
  type: 'ping';
  requestId: string;
}

export interface AuthenticateMessage {
  type: 'authenticate';
  requestId: string;
  token: string;
}

/** All messages sent from orchestrator to agent server. */
export type OrchestratorMessage =
  | SpawnAgentMessage
  | SendMessageMessage
  | TerminateAgentMessage
  | CancelAgentMessage
  | ListAgentsMessage
  | SubscribeMessage
  | PingMessage
  | AuthenticateMessage;

// ── Agent Server → Orchestrator Messages ────────────────────────────

export interface AgentSpawnedMessage {
  type: 'agent_spawned';
  requestId: string;
  agentId: string;
  role: string;
  model: string;
  pid: number | null;
  sessionId?: string;
}

export interface AgentEventMessage {
  type: 'agent_event';
  agentId: string;
  eventId: string;
  eventType: AgentEventType;
  data: Record<string, unknown>;
}

export type AgentEventType =
  | 'text'
  | 'thinking'
  | 'tool_call'
  | 'tool_call_update'
  | 'plan'
  | 'content'
  | 'usage'
  | 'usage_update'
  | 'prompt_complete'
  | 'prompting'
  | 'response_start'
  | 'permission_request'
  | 'status_change';

export interface AgentExitedMessage {
  type: 'agent_exited';
  agentId: string;
  exitCode: number;
  reason?: string;
}

export interface AgentListMessage {
  type: 'agent_list';
  requestId: string;
  agents: AgentInfo[];
}

export interface AgentInfo {
  agentId: string;
  role: string;
  model: string;
  status: AgentStatus;
  pid: number | null;
  task?: string;
  sessionId?: string;
  spawnedAt: string;
}

export type AgentStatus = 'starting' | 'running' | 'idle' | 'stopping' | 'exited' | 'crashed';

export interface PongMessage {
  type: 'pong';
  requestId: string;
  timestamp: number;
}

export interface AuthResultMessage {
  type: 'auth_result';
  requestId: string;
  success: boolean;
  error?: string;
}

export interface ErrorMessage {
  type: 'error';
  requestId?: string;
  code: ErrorCode;
  message: string;
}

export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_FAILED'
  | 'AGENT_NOT_FOUND'
  | 'SPAWN_FAILED'
  | 'SEND_FAILED'
  | 'INVALID_MESSAGE'
  | 'INTERNAL_ERROR';

/** All messages sent from agent server to orchestrator. */
export type AgentServerMessage =
  | AgentSpawnedMessage
  | AgentEventMessage
  | AgentExitedMessage
  | AgentListMessage
  | PongMessage
  | AuthResultMessage
  | ErrorMessage;

/** Any transport message (either direction). */
export type TransportMessage = OrchestratorMessage | AgentServerMessage;

// ── Type Guards ─────────────────────────────────────────────────────

/** Check if a message is from the orchestrator. */
export function isOrchestratorMessage(msg: TransportMessage): msg is OrchestratorMessage {
  return ORCHESTRATOR_TYPES.has(msg.type);
}

/** Check if a message is from the agent server. */
export function isAgentServerMessage(msg: TransportMessage): msg is AgentServerMessage {
  return SERVER_TYPES.has(msg.type);
}

/** Check if a message has a requestId for request/response matching. */
export function hasRequestId(msg: TransportMessage): msg is TransportMessage & { requestId: string } {
  return 'requestId' in msg && typeof (msg as Record<string, unknown>).requestId === 'string';
}

/** Check if a message has a scope. */
export function hasScope(msg: TransportMessage): msg is TransportMessage & { scope: MessageScope } {
  return 'scope' in msg && isValidScope((msg as Record<string, unknown>).scope);
}

/** Validate a MessageScope object. */
export function isValidScope(scope: unknown): scope is MessageScope {
  if (!scope || typeof scope !== 'object') return false;
  const s = scope as Record<string, unknown>;
  return typeof s.projectId === 'string' && s.projectId.length > 0
    && typeof s.teamId === 'string' && s.teamId.length > 0;
}

/**
 * Validate a raw object as a transport message.
 * Returns the message if valid, null if not.
 */
export function validateMessage(raw: unknown): TransportMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as Record<string, unknown>;
  if (typeof msg.type !== 'string') return null;
  if (!ALL_TYPES.has(msg.type)) return null;
  return raw as TransportMessage;
}

// ── Internal Constants ──────────────────────────────────────────────

const ORCHESTRATOR_TYPES = new Set<string>([
  'spawn_agent',
  'send_message',
  'terminate_agent',
  'cancel_agent',
  'list_agents',
  'subscribe',
  'ping',
  'authenticate',
]);

const SERVER_TYPES = new Set<string>([
  'agent_spawned',
  'agent_event',
  'agent_exited',
  'agent_list',
  'pong',
  'auth_result',
  'error',
]);

const ALL_TYPES = new Set<string>([...ORCHESTRATOR_TYPES, ...SERVER_TYPES]);
