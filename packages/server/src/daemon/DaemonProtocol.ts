/**
 * Daemon ↔ Server JSON-RPC 2.0 protocol over NDJSON (newline-delimited JSON).
 *
 * The daemon and server communicate via Unix Domain Socket using JSON-RPC 2.0
 * messages, one per line. Requests have an `id`, notifications do not.
 *
 * Message flow:
 *   Client → Daemon: auth, spawn, terminate, send, list, subscribe, shutdown, ping
 *   Daemon → Client: responses (with matching id), event notifications (no id)
 */

// ── JSON-RPC 2.0 Base Types ─────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
  id: number;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: JsonRpcError;
  id: number;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// ── Standard JSON-RPC Error Codes ───────────────────────────────────

export const RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Custom daemon errors
  AUTH_REQUIRED: -32000,
  AUTH_FAILED: -32001,
  CLIENT_ALREADY_CONNECTED: -32002,
  AGENT_NOT_FOUND: -32003,
  SPAWNING_PAUSED: -32004,
} as const;

// ── Agent Descriptor (daemon's view of an agent) ────────────────────

export interface AgentDescriptor {
  agentId: string;
  pid: number | null;
  role: string;
  model: string;
  status: DaemonAgentStatus;
  sessionId: string | null;
  taskSummary: string | null;
  spawnedAt: string;
  lastEventId: string | null;
}

export type DaemonAgentStatus = 'starting' | 'running' | 'idle' | 'stopping' | 'exited' | 'crashed';

// ── Request Parameter Types ─────────────────────────────────────────

export interface AuthParams {
  token: string;
  pid: number;
}

export interface SpawnParams {
  agentId: string;
  role: string;
  model: string;
  cliCommand: string;
  cliArgs?: string[];
  cwd?: string;
  env?: Record<string, string>;
  sessionId?: string;
  taskSummary?: string;
}

export interface TerminateParams {
  agentId: string;
  timeoutMs?: number;
}

export interface SendParams {
  agentId: string;
  message: string;
}

export interface SubscribeParams {
  agentId?: string;
  lastSeenEventId?: string;
  fromStart?: boolean;
}

export interface ShutdownParams {
  persist?: boolean;
  timeoutMs?: number;
}

export interface ConfigureParams {
  massFailure?: {
    threshold?: number;
    windowSeconds?: number;
    cooldownSeconds?: number;
  };
}

// ── Response Result Types ───────────────────────────────────────────

export interface AuthResult {
  daemonPid: number;
  uptime: number;
  agentCount: number;
}

export interface SpawnResult {
  agentId: string;
  pid: number;
}

export interface ListResult {
  agents: AgentDescriptor[];
}

export interface SubscribeResult {
  bufferedEvents: DaemonEvent[];
}

// ── Daemon Event Types (notifications from daemon → server) ─────────

export interface DaemonEvent {
  eventId: string;
  timestamp: string;
  type: DaemonEventType;
  agentId?: string;
  data: Record<string, unknown>;
}

export type DaemonEventType =
  | 'agent:spawned'
  | 'agent:exit'
  | 'agent:output'
  | 'agent:status'
  | 'daemon:shutting_down'
  | 'daemon:mass_failure'
  | 'daemon:client_connected'
  | 'daemon:client_disconnected'
  | 'daemon:error';

// ── Mass Failure Event Data ─────────────────────────────────────────

export interface MassFailureData {
  exitCount: number;
  windowSeconds: number;
  recentExits: Array<{
    agentId: string;
    exitCode: number | null;
    signal: string | null;
    error: string | null;
    timestamp: string;
  }>;
  pausedUntil: string;
  likelyCause: 'auth_failure' | 'rate_limit' | 'model_unavailable' | 'resource_exhaustion' | 'unknown';
}

// ── NDJSON Serialization ────────────────────────────────────────────

/** Serialize a message to a single NDJSON line (with trailing newline). */
export function serializeMessage(msg: JsonRpcMessage): string {
  return JSON.stringify(msg) + '\n';
}

/**
 * Parse an NDJSON buffer into complete messages and remaining partial data.
 * Returns [parsedMessages, remainingBuffer].
 */
export function parseNdjsonBuffer(buffer: string): [JsonRpcMessage[], string] {
  const messages: JsonRpcMessage[] = [];
  let remaining = buffer;

  let newlineIdx = remaining.indexOf('\n');
  while (newlineIdx !== -1) {
    const line = remaining.slice(0, newlineIdx).trim();
    remaining = remaining.slice(newlineIdx + 1);

    if (line.length > 0) {
      try {
        messages.push(JSON.parse(line) as JsonRpcMessage);
      } catch {
        // Malformed line — skip it. Daemon logs the error separately.
      }
    }

    newlineIdx = remaining.indexOf('\n');
  }

  return [messages, remaining];
}

// ── Message Constructors ────────────────────────────────────────────

export function createRequest(id: number, method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return { jsonrpc: '2.0', method, params, id };
}

export function createResponse(id: number, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', result, id };
}

export function createErrorResponse(id: number, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', error: { code, message, data }, id };
}

export function createNotification(method: string, params?: Record<string, unknown>): JsonRpcNotification {
  return { jsonrpc: '2.0', method, params };
}

// ── Type Guards ─────────────────────────────────────────────────────

export function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return 'method' in msg && 'id' in msg;
}

export function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return !('method' in msg) && 'id' in msg;
}

export function isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return 'method' in msg && !('id' in msg);
}

// ── Socket Directory Resolution ─────────────────────────────────────

/**
 * Resolve the daemon socket directory using the XDG fallback chain:
 * 1. $XDG_RUNTIME_DIR/flightdeck/
 * 2. $TMPDIR/flightdeck-$UID/
 * 3. ~/.flightdeck/run/
 */
export function getSocketDir(): string {
  const { env } = process;

  if (env.XDG_RUNTIME_DIR) {
    return `${env.XDG_RUNTIME_DIR}/flightdeck`;
  }

  if (env.TMPDIR) {
    return `${env.TMPDIR}/flightdeck-${process.getuid?.() ?? 'unknown'}`;
  }

  const home = env.HOME || env.USERPROFILE || '~';
  return `${home}/.flightdeck/run`;
}
