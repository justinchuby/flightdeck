/**
 * AgentServer — core agent management process.
 *
 * Receives messages from a transport listener (e.g. ForkListener),
 * dispatches to handlers, and manages agent lifecycles. Reuses
 * EventBuffer for event replay and MassFailureDetector for resilience.
 *
 * Design: docs/design/agent-server-architecture.md
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { EventBuffer } from './transport/EventBuffer.js';
import { MassFailureDetector } from './transport/MassFailureDetector.js';
import { createAdapterForProvider, buildStartOptions } from './adapters/AdapterFactory.js';
import type { AdapterConfig } from './adapters/AdapterFactory.js';
import type { AgentAdapter } from './adapters/types.js';
import { logger } from './utils/logger.js';

// ── Re-export adapter APIs ──────────────────────────────────────────
// AgentServer is the sole owner of adapter code. All adapter imports
// should flow through this module, not directly from adapters/.

// Adapter implementations
export { AcpAdapter } from './adapters/AcpAdapter.js';
export { ClaudeSdkAdapter } from './adapters/ClaudeSdkAdapter.js';
export { MockAdapter } from './adapters/MockAdapter.js';

// Factory
export { createAdapterForProvider, buildStartOptions, resolveBackend } from './adapters/AdapterFactory.js';
export type { AdapterConfig, AdapterResult, BackendType } from './adapters/AdapterFactory.js';

// Types
export type {
  AgentAdapter,
  AdapterStartOptions,
  AdapterFactory,
  AdapterFactoryOptions,
  ContentBlock,
  PromptContent,
  PromptOptions,
  PromptResult,
  StopReason,
  UsageInfo,
  ToolCallInfo,
  ToolUpdateInfo,
  PlanEntry,
  AdapterCapabilities,
  PermissionRequest,
} from './adapters/types.js';

// Model resolution
export {
  resolveModel,
  isTierAlias,
  getTierModels,
  listTiers,
  isValidModel,
} from './adapters/ModelResolver.js';
export type { ModelResolution, ModelTier } from './adapters/ModelResolver.js';

// Provider presets
export {
  PROVIDER_PRESETS,
  getPreset,
  listPresets,
  isValidProviderId,
  detectInstalledProviders,
} from './adapters/presets.js';
export type { ProviderPreset, ProviderId, BinaryChecker } from './adapters/presets.js';

// Role file writers
export {
  CopilotRoleFileWriter,
  ClaudeRoleFileWriter,
  GeminiRoleFileWriter,
  CursorRoleFileWriter,
  CodexRoleFileWriter,
  OpenCodeRoleFileWriter,
  createRoleFileWriter,
  listRoleFileWriterProviders,
  FLIGHTDECK_MARKER,
} from './adapters/RoleFileWriter.js';
export type { RoleDefinition, RoleFileWriter } from './adapters/RoleFileWriter.js';
import type {
  AgentServerListener,
  TransportConnection,
  OrchestratorMessage,
  AgentServerMessage,
  AgentEventType,
  AgentStatus,
  MessageScope,
  SpawnAgentMessage,
  SendMessageMessage,
  TerminateAgentMessage,
  ListAgentsMessage,
  SubscribeMessage,
  ErrorCode,
} from './transport/types.js';
import { hasScope, isValidScope } from './transport/types.js';

// ── Types ───────────────────────────────────────────────────────────

export interface ManagedAgent {
  id: string;
  role: string;
  model: string;
  adapter: AgentAdapter;
  status: AgentStatus;
  pid: number | null;
  task?: string;
  sessionId?: string;
  startedAt: number;
  cleanups: Array<() => void>;
  /** Project this agent belongs to. */
  projectId: string;
  /** Team this agent belongs to. */
  teamId: string;
}

export interface AgentServerOptions {
  listener: AgentServerListener;
  adapterConfig?: Partial<AdapterConfig>;
  orphanTimeoutMs?: number;
  runtimeDir?: string;
  eventBufferOpts?: { maxEventsPerAgent?: number; maxTotalEvents?: number; maxEventAgeMs?: number };
  massFailureOpts?: { threshold?: number; windowMs?: number; cooldownMs?: number };
  /** Optional persistence layer for agent state. */
  persistence?: AgentServerPersistence;
}

/** Optional persistence callbacks for agent lifecycle events. */
export interface AgentServerPersistence {
  onAgentSpawned?(agentId: string, role: string, model: string): void;
  onAgentTerminated?(agentId: string): void;
  onAgentExited?(agentId: string, exitCode: number): void;
  onStatusChanged?(agentId: string, status: AgentStatus): void;
  onServerStop?(agents: ManagedAgent[]): void;
}

// ── Constants ───────────────────────────────────────────────────────

const DEFAULT_ORPHAN_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 hours
const PID_FILENAME = 'agent-server.pid';
const DEFAULT_PROJECT_ID = 'default';
const DEFAULT_TEAM_ID = 'default';

/** A connection bound to a (projectId, teamId) scope. */
interface ScopedConnection {
  conn: TransportConnection;
  scope: MessageScope;
}

/** Build the scope key used for agent indexing. */
function scopeKey(projectId: string, teamId: string): string {
  return `${projectId}:${teamId}`;
}

/**
 * Verify that a message's scope matches the connection's scope.
 * Throws a user-facing error message on mismatch.
 */
function enforceScope(msg: OrchestratorMessage, connScope: MessageScope): void {
  if (!hasScope(msg)) return; // Unscoped messages (ping, authenticate) are always allowed
  const msgScope = (msg as OrchestratorMessage & { scope: MessageScope }).scope;
  if (msgScope.projectId !== connScope.projectId || msgScope.teamId !== connScope.teamId) {
    throw new ScopeMismatchError(connScope, msgScope);
  }
}

class ScopeMismatchError extends Error {
  readonly code = 'SCOPE_MISMATCH' as const;
  constructor(expected: MessageScope, received: MessageScope) {
    super(
      `Scope mismatch: connection bound to (${expected.projectId}, ${expected.teamId}) ` +
      `but message targets (${received.projectId}, ${received.teamId})`
    );
    this.name = 'ScopeMismatchError';
  }
}

// ── AgentServer ─────────────────────────────────────────────────────

export class AgentServer {
  private readonly listener: AgentServerListener;
  private readonly adapterConfig: Partial<AdapterConfig>;
  private readonly orphanTimeoutMs: number;
  private readonly runtimeDir: string;
  private readonly agents = new Map<string, ManagedAgent>();
  /** Secondary index: "projectId:teamId" → Set of agentIds. */
  private readonly projectTeamIndex = new Map<string, Set<string>>();
  private readonly eventBuffer: EventBuffer;
  private readonly massFailure: MassFailureDetector;
  private readonly persistence: AgentServerPersistence | undefined;

  private connection: TransportConnection | null = null;
  /** Scope declared by the current connection (set at first scoped message). */
  private connectionScope: MessageScope | null = null;
  private orphanTimer: ReturnType<typeof setTimeout> | null = null;
  private listenerCleanup: (() => void) | null = null;
  private massFailureCleanup: (() => void) | null = null;
  private _started = false;
  private _stopped = false;

  constructor(opts: AgentServerOptions) {
    this.listener = opts.listener;
    this.adapterConfig = opts.adapterConfig ?? {};
    this.orphanTimeoutMs = opts.orphanTimeoutMs ?? DEFAULT_ORPHAN_TIMEOUT_MS;
    this.runtimeDir = opts.runtimeDir ?? process.cwd();
    this.eventBuffer = new EventBuffer(opts.eventBufferOpts);
    this.massFailure = new MassFailureDetector(opts.massFailureOpts);
    this.persistence = opts.persistence;
  }

  // ── Getters ─────────────────────────────────────────────────────

  get started(): boolean { return this._started; }
  get stopped(): boolean { return this._stopped; }
  get agentCount(): number { return this.agents.size; }
  get hasConnection(): boolean { return this.connection?.isConnected === true; }
  get isSpawningPaused(): boolean { return this.massFailure.isPaused; }
  /** The scope of the current connection, or null if none. */
  get currentScope(): MessageScope | null { return this.connectionScope; }

  getAgent(id: string): ManagedAgent | undefined { return this.agents.get(id); }
  listAgents(scope?: MessageScope): ManagedAgent[] {
    if (!scope) return [...this.agents.values()];
    const key = scopeKey(scope.projectId, scope.teamId);
    const ids = this.projectTeamIndex.get(key);
    if (!ids) return [];
    return [...ids].map(id => this.agents.get(id)!).filter(Boolean);
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  start(): void {
    if (this._started) throw new Error('AgentServer already started');
    this._started = true;

    this.writePidFile();
    this.listenerCleanup = this.listener.onConnection((conn) => this.handleConnection(conn));
    this.listener.listen();
    this.startOrphanTimer();

    this.massFailureCleanup = this.massFailure.onMassFailure((data) => {
      const eventId = EventBuffer.generateEventId();
      this.bufferOrSend({
        type: 'agent_event',
        agentId: '',
        eventId,
        eventType: 'status_change',
        data: { massFailure: true, cause: data.likelyCause, exitCount: data.exitCount },
      });
    });
  }

  async stop(opts?: { reason?: string; timeoutMs?: number }): Promise<void> {
    if (this._stopped) return;
    this._stopped = true;

    this.clearOrphanTimer();
    this.massFailureCleanup?.();
    this.massFailure.dispose();

    // Terminate all agents
    const terminatePromises = [...this.agents.values()].map((agent) => {
      return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), opts?.timeoutMs ?? 5000);
        try {
          agent.adapter.terminate();
        } catch {
          // Agent may already be dead
        }
        agent.cleanups.forEach((fn) => fn());
        agent.status = 'exited';
        clearTimeout(timeout);
        resolve();
      });
    });
    // Persist shutdown state for all agents before clearing
    this.persistence?.onServerStop?.([...this.agents.values()]);

    await Promise.all(terminatePromises);
    this.agents.clear();
    this.projectTeamIndex.clear();

    this.connection?.close();
    this.connection = null;
    this.listenerCleanup?.();
    this.listener.close();
    this.removePidFile();
  }

  // ── Connection Management ─────────────────────────────────────

  private handleConnection(conn: TransportConnection): void {
    // Replace existing connection (single-client model)
    if (this.connection?.isConnected) {
      this.connection.close();
    }

    this.connection = conn;
    this.connectionScope = null; // Scope is set on first scoped message
    this.clearOrphanTimer();
    this.eventBuffer.stopBuffering();

    conn.onMessage((msg) => this.dispatchMessage(msg, conn));
    conn.onDisconnect(() => {
      if (this.connection === conn) {
        this.connection = null;
        this.connectionScope = null;
        this.eventBuffer.startBuffering();
        this.startOrphanTimer();
      }
    });
  }

  // ── Message Dispatch ──────────────────────────────────────────

  private dispatchMessage(msg: OrchestratorMessage, conn: TransportConnection): void {
    // Bind connection scope from first scoped message
    if (!this.connectionScope && 'scope' in msg) {
      const rawScope = (msg as any).scope;
      if (rawScope && typeof rawScope === 'object') {
        this.connectionScope = {
          projectId: (typeof rawScope.projectId === 'string' && rawScope.projectId) || DEFAULT_PROJECT_ID,
          teamId: (typeof rawScope.teamId === 'string' && rawScope.teamId) || DEFAULT_TEAM_ID,
        };
      }
    }

    // Enforce scope on all scoped messages
    if (this.connectionScope) {
      try {
        enforceScope(msg, this.connectionScope);
      } catch (err) {
        if (err instanceof ScopeMismatchError) {
          this.sendError(conn, 'INVALID_MESSAGE', err.message, (msg as any).requestId);
          return;
        }
        throw err;
      }
    }

    switch (msg.type) {
      case 'spawn_agent':     this.handleSpawn(msg, conn).catch(err => logger.error({ module: 'agent-server', msg: 'handleSpawn failed', err: (err as Error).message })); return;
      case 'send_message':    return this.handleSendMessage(msg, conn);
      case 'terminate_agent': return this.handleTerminate(msg, conn);
      case 'list_agents':     return this.handleListAgents(msg, conn);
      case 'subscribe':       return this.handleSubscribe(msg, conn);
      case 'ping':            return void conn.send({ type: 'pong', requestId: msg.requestId, timestamp: Date.now() });
      case 'authenticate':    return void conn.send({ type: 'auth_result', requestId: msg.requestId, success: true });
      default:
        this.sendError(conn, 'INVALID_MESSAGE', `Unknown message type: ${(msg as any).type}`, (msg as any).requestId);
    }
  }

  // ── Handlers ──────────────────────────────────────────────────

  private async handleSpawn(msg: SpawnAgentMessage, conn: TransportConnection): Promise<void> {
    if (this.massFailure.isPaused) {
      this.sendError(conn, 'SPAWN_FAILED', 'Spawning paused due to mass failure', msg.requestId);
      return;
    }

    const agentId = randomUUID();
    const config: AdapterConfig = {
      ...this.adapterConfig,
      provider: this.adapterConfig.provider ?? 'copilot',
      model: msg.model,
    };

    let adapter: AgentAdapter;
    try {
      const result = await createAdapterForProvider(config);
      adapter = result.adapter;
    } catch (err) {
      this.sendError(conn, 'SPAWN_FAILED', `Adapter creation failed: ${(err as Error).message}`, msg.requestId);
      return;
    }

    const agent: ManagedAgent = {
      id: agentId,
      role: msg.role,
      model: msg.model,
      adapter,
      status: 'starting',
      pid: null,
      task: msg.task,
      projectId: msg.scope?.projectId || DEFAULT_PROJECT_ID,
      teamId: msg.scope?.teamId || DEFAULT_TEAM_ID,
      startedAt: Date.now(),
      cleanups: [],
    };
    this.agents.set(agentId, agent);
    this.addToIndex(agent);
    this.persistence?.onAgentSpawned?.(agentId, msg.role, msg.model);

    // Wire adapter events
    this.wireAdapterEvents(agent);

    // Start the adapter
    const startOpts = buildStartOptions(config, { cwd: process.cwd() });
    adapter.start(startOpts).then((sessionId) => {
      agent.sessionId = sessionId;
      agent.status = 'running';
      conn.send({
        type: 'agent_spawned',
        requestId: msg.requestId,
        agentId,
        role: msg.role,
        model: msg.model,
        pid: agent.pid,
      });
    }).catch((err) => {
      agent.status = 'crashed';
      this.sendError(conn, 'SPAWN_FAILED', `Agent start failed: ${(err as Error).message}`, msg.requestId);
    });
  }

  private handleSendMessage(msg: SendMessageMessage, conn: TransportConnection): void {
    const agent = this.agents.get(msg.agentId);
    if (!agent) {
      this.sendError(conn, 'AGENT_NOT_FOUND', `Agent ${msg.agentId} not found`, msg.requestId);
      return;
    }
    if (!this.agentMatchesScope(agent)) {
      this.sendError(conn, 'AGENT_NOT_FOUND', `Agent ${msg.agentId} not found in current scope`, msg.requestId);
      return;
    }

    agent.adapter.prompt(msg.content).catch((err) => {
      this.sendError(conn, 'SEND_FAILED', `Prompt failed: ${(err as Error).message}`, msg.requestId);
    });
  }

  private handleTerminate(msg: TerminateAgentMessage, conn: TransportConnection): void {
    const agent = this.agents.get(msg.agentId);
    if (!agent) {
      this.sendError(conn, 'AGENT_NOT_FOUND', `Agent ${msg.agentId} not found`, msg.requestId);
      return;
    }
    if (!this.agentMatchesScope(agent)) {
      this.sendError(conn, 'AGENT_NOT_FOUND', `Agent ${msg.agentId} not found in current scope`, msg.requestId);
      return;
    }

    agent.status = 'stopping';

    // Try graceful cancel first, then force terminate
    if (agent.adapter.isPrompting) {
      agent.adapter.cancel().catch(() => {}).finally(() => {
        agent.adapter.terminate();
      });
    } else {
      agent.adapter.terminate();
    }

    this.persistence?.onAgentTerminated?.(msg.agentId);
  }

  private handleListAgents(msg: ListAgentsMessage, conn: TransportConnection): void {
    // Filter agents by connection scope
    const scopedAgents = this.connectionScope
      ? this.getScopedAgents(this.connectionScope)
      : [...this.agents.values()];

    const agents = scopedAgents.map((a) => ({
      agentId: a.id,
      role: a.role,
      model: a.model,
      status: a.status,
      pid: a.pid,
      task: a.task,
      sessionId: a.sessionId,
      spawnedAt: new Date(a.startedAt).toISOString(),
    }));

    conn.send({ type: 'agent_list', requestId: msg.requestId, agents });
  }

  private handleSubscribe(msg: SubscribeMessage, conn: TransportConnection): void {
    // Replay buffered events
    const events = this.eventBuffer.drain(msg.agentId, msg.lastSeenEventId);
    for (const event of events) {
      conn.send({
        type: 'agent_event',
        agentId: event.agentId ?? '',
        eventId: event.eventId,
        eventType: (event.type.replace('agent:', '') || 'status_change') as AgentEventType,
        data: event.data,
      });
    }
  }

  // ── Adapter Event Wiring ──────────────────────────────────────

  private wireAdapterEvents(agent: ManagedAgent): void {
    const send = (eventType: AgentEventType, data: Record<string, unknown>) => {
      const eventId = EventBuffer.generateEventId();
      const msg: AgentServerMessage = {
        type: 'agent_event',
        agentId: agent.id,
        eventId,
        eventType,
        data,
      };
      this.bufferOrSend(msg);
    };

    const on = <T>(event: string, handler: (arg: T) => void) => {
      agent.adapter.on(event, handler);
      agent.cleanups.push(() => agent.adapter.removeListener(event, handler));
    };

    on<string>('text', (text) => send('text', { text }));
    on<string>('thinking', (text) => send('thinking', { text }));
    on<string>('connected', (sessionId) => {
      agent.sessionId = sessionId;
    });
    on<any>('tool_call', (info) => send('tool_call', { ...info }));
    on<any>('tool_call_update', (info) => send('tool_call_update', { ...info }));
    on<any>('plan', (entries) => send('plan', { entries }));
    on<any>('content', (block) => send('content', { ...block }));
    on<any>('usage', (usage) => send('usage', { ...usage }));
    on<any>('usage_update', (usage) => send('usage_update', { ...usage }));
    on<string>('prompt_complete', (reason) => send('prompt_complete', { reason }));
    on<any>('permission_request', (req) => send('permission_request', { ...req }));

    on<number>('exit', (code) => {
      agent.status = code === 0 ? 'exited' : 'crashed';

      this.massFailure.recordExit({
        agentId: agent.id,
        exitCode: code,
        signal: null,
        error: code !== 0 ? `Exit code ${code}` : null,
        timestamp: Date.now(),
      });

      // Persist exit status
      this.persistence?.onAgentExited?.(agent.id, code);

      const exitMsg: AgentServerMessage = {
        type: 'agent_exited',
        agentId: agent.id,
        exitCode: code,
        reason: code === 0 ? 'completed' : `exit code ${code}`,
      };
      this.bufferOrSend(exitMsg);

      // Clean up: remove event listeners and agent from map and index
      agent.cleanups.forEach((fn) => fn());
      agent.cleanups.length = 0;
      this.removeFromIndex(agent);
      this.agents.delete(agent.id);
    });

    // Status change (idle/running transitions)
    on<boolean>('prompting', (active) => {
      agent.status = active ? 'running' : 'idle';
      this.persistence?.onStatusChanged?.(agent.id, agent.status);
      send('status_change', { status: agent.status, prompting: active });
    });
  }

  // ── Helpers ───────────────────────────────────────────────────

  private bufferOrSend(msg: AgentServerMessage): void {
    if (this.connection?.isConnected) {
      this.connection.send(msg);
    } else if (msg.type === 'agent_event') {
      this.eventBuffer.push({
        eventId: msg.eventId,
        timestamp: new Date().toISOString(),
        type: `agent:${msg.eventType}` as any,
        agentId: msg.agentId,
        data: msg.data,
      });
    }
  }

  private sendError(conn: TransportConnection, code: ErrorCode, message: string, requestId?: string): void {
    conn.send({ type: 'error', code, message, requestId });
  }

  // ── Scope Index ──────────────────────────────────────────────

  private addToIndex(agent: ManagedAgent): void {
    const key = scopeKey(agent.projectId, agent.teamId);
    let set = this.projectTeamIndex.get(key);
    if (!set) {
      set = new Set();
      this.projectTeamIndex.set(key, set);
    }
    set.add(agent.id);
  }

  private removeFromIndex(agent: ManagedAgent): void {
    const key = scopeKey(agent.projectId, agent.teamId);
    const set = this.projectTeamIndex.get(key);
    if (set) {
      set.delete(agent.id);
      if (set.size === 0) this.projectTeamIndex.delete(key);
    }
  }

  /** Get all agents matching a scope. */
  private getScopedAgents(scope: MessageScope): ManagedAgent[] {
    const key = scopeKey(scope.projectId, scope.teamId);
    const ids = this.projectTeamIndex.get(key);
    if (!ids) return [];
    return [...ids].map(id => this.agents.get(id)!).filter(Boolean);
  }

  /** Check if an agent belongs to the current connection's scope. */
  private agentMatchesScope(agent: ManagedAgent): boolean {
    if (!this.connectionScope) return true; // No scope bound yet — allow all
    return agent.projectId === this.connectionScope.projectId
      && agent.teamId === this.connectionScope.teamId;
  }

  // ── Orphan Timer ──────────────────────────────────────────────

  private startOrphanTimer(): void {
    this.clearOrphanTimer();
    this.orphanTimer = setTimeout(() => {
      this.stop({ reason: 'orphan timeout' });
    }, this.orphanTimeoutMs);
  }

  private clearOrphanTimer(): void {
    if (this.orphanTimer) {
      clearTimeout(this.orphanTimer);
      this.orphanTimer = null;
    }
  }

  // ── PID File ──────────────────────────────────────────────────

  private writePidFile(): void {
    try {
      mkdirSync(this.runtimeDir, { recursive: true });
      writeFileSync(join(this.runtimeDir, PID_FILENAME), String(process.pid), 'utf8');
    } catch {
      // Best-effort — runtime dir may not be writable
    }
  }

  private removePidFile(): void {
    try {
      unlinkSync(join(this.runtimeDir, PID_FILENAME));
    } catch {
      // Already removed or never written
    }
  }
}
