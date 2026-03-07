/**
 * AgentServerClient — orchestrator-side typed client for the agent server.
 *
 * Sends commands to the agent server via a pluggable transport and handles
 * request/response matching, event subscriptions, and reconnection state.
 *
 * Usage:
 *   const client = new AgentServerClient(transport, scope);
 *   await client.connect();
 *   const { agentId } = await client.spawn('developer', 'fast', 'implement feature');
 *   client.on('agentEvent', (event) => console.log(event));
 *   await client.prompt(agentId, 'Hello');
 *   await client.terminate(agentId);
 *
 * Design: docs/design/agent-server-architecture.md
 */
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type {
  AgentServerTransport,
  TransportState,
  MessageScope,
  OrchestratorMessage,
  AgentServerMessage,
  AgentSpawnedMessage,
  AgentEventMessage,
  AgentExitedMessage,
  AgentListMessage,
  AgentInfo,
  PongMessage,
  AuthResultMessage,
  ErrorMessage,
} from '../transport/types.js';
import { logger } from '../utils/logger.js';

// ── Types ───────────────────────────────────────────────────────────

export interface AgentServerClientOptions {
  /** Request timeout in ms (default: 30000). */
  requestTimeoutMs?: number;
  /** Auth token for the agent server (optional). */
  authToken?: string;
}

export interface AgentServerClientEvents {
  agentSpawned: AgentSpawnedMessage;
  agentEvent: AgentEventMessage;
  agentExited: AgentExitedMessage;
  connected: void;
  disconnected: string; // reason
  error: ErrorMessage;
}

interface PendingRequest<T = AgentServerMessage> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface SpawnResult {
  agentId: string;
  role: string;
  model: string;
  pid: number | null;
}

// ── Client ──────────────────────────────────────────────────────────

export class AgentServerClient extends EventEmitter {
  private readonly transport: AgentServerTransport;
  private readonly scope: MessageScope;
  private readonly requestTimeoutMs: number;
  private readonly authToken?: string;

  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly lastSeenEventIds = new Map<string, string>();

  private unsubMessage: (() => void) | null = null;
  private unsubState: (() => void) | null = null;
  private _disposed = false;

  constructor(
    transport: AgentServerTransport,
    scope: MessageScope,
    options: AgentServerClientOptions = {},
  ) {
    super();
    this.transport = transport;
    this.scope = scope;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.authToken = options.authToken;
  }

  /** Whether the transport is connected. */
  get isConnected(): boolean {
    return this.transport.state === 'connected';
  }

  /** Current transport state. */
  get state(): TransportState {
    return this.transport.state;
  }

  /** Number of pending (in-flight) requests. */
  get pendingCount(): number {
    return this.pendingRequests.size;
  }

  /** Number of agents being tracked for event replay. */
  get trackedAgentCount(): number {
    return this.lastSeenEventIds.size;
  }

  // ── Connection ────────────────────────────────────────────────

  /**
   * Connect to the agent server and set up message handling.
   * Authenticates if an auth token was provided.
   */
  async connect(): Promise<void> {
    if (this._disposed) throw new Error('AgentServerClient has been disposed');

    // Set up message and state handlers before connecting
    this.unsubMessage = this.transport.onMessage(this.handleMessage.bind(this));
    this.unsubState = this.transport.onStateChange(this.handleStateChange.bind(this));

    await this.transport.connect();

    // Authenticate if token provided
    if (this.authToken) {
      const result = await this.authenticate(this.authToken);
      if (!result.success) {
        await this.transport.disconnect();
        throw new Error(`Authentication failed: ${result.error ?? 'unknown'}`);
      }
    }

    this.emit('connected');
  }

  /**
   * Disconnect from the agent server.
   */
  async disconnect(): Promise<void> {
    this.rejectAllPending('Client disconnecting');
    this.removeHandlers();
    await this.transport.disconnect();
    this.emit('disconnected', 'client disconnect');
  }

  /**
   * Full disposal — disconnect and prevent further use.
   */
  async dispose(): Promise<void> {
    this._disposed = true;
    await this.disconnect();
    this.removeAllListeners();
  }

  // ── Commands ──────────────────────────────────────────────────

  /**
   * Spawn an agent on the agent server.
   */
  async spawn(
    role: string,
    model: string,
    task?: string,
    context?: Record<string, unknown>,
  ): Promise<SpawnResult> {
    const response = await this.request<AgentSpawnedMessage>('agent_spawned', {
      type: 'spawn_agent',
      requestId: '', // filled by request()
      scope: this.scope,
      role,
      model,
      task,
      context,
    });

    return {
      agentId: response.agentId,
      role: response.role,
      model: response.model,
      pid: response.pid,
    };
  }

  /**
   * Send a prompt/message to a running agent.
   */
  async prompt(agentId: string, content: string): Promise<void> {
    this.send({
      type: 'send_message',
      requestId: randomUUID(),
      scope: this.scope,
      agentId,
      content,
    });
  }

  /**
   * Terminate an agent.
   */
  async terminate(agentId: string, reason?: string): Promise<void> {
    this.send({
      type: 'terminate_agent',
      requestId: randomUUID(),
      scope: this.scope,
      agentId,
      reason,
    });
  }

  /**
   * List all agents on the server.
   */
  async list(): Promise<AgentInfo[]> {
    const response = await this.request<AgentListMessage>('agent_list', {
      type: 'list_agents',
      requestId: '',
      scope: this.scope,
    });

    return response.agents;
  }

  /**
   * Subscribe to events for an agent. Replays from lastSeenEventId if available.
   */
  subscribe(agentId?: string, lastSeenEventId?: string): void {
    const eventId = lastSeenEventId ?? (agentId ? this.lastSeenEventIds.get(agentId) : undefined);

    this.send({
      type: 'subscribe',
      requestId: randomUUID(),
      scope: this.scope,
      agentId,
      lastSeenEventId: eventId,
    });
  }

  /**
   * Ping the agent server.
   */
  async ping(): Promise<number> {
    const response = await this.request<PongMessage>('pong', {
      type: 'ping',
      requestId: '',
    });

    return response.timestamp;
  }

  /**
   * Get the last seen event ID for an agent (for reconnection).
   */
  getLastSeenEventId(agentId: string): string | undefined {
    return this.lastSeenEventIds.get(agentId);
  }

  /**
   * Re-subscribe all tracked agents with their last seen event IDs.
   * Call this manually after a reconnect if the automatic re-subscribe
   * in handleStateChange doesn't cover your use case.
   */
  resubscribeAll(): void {
    for (const [agentId, lastEventId] of this.lastSeenEventIds) {
      this.subscribe(agentId, lastEventId);
    }

    logger.info({
      module: 'agent-server-client',
      msg: 'Re-subscribed all tracked agents',
      count: this.lastSeenEventIds.size,
    });
  }

  /**
   * Stop tracking an agent's event cursor. Call when an agent exits
   * and you no longer need replay for it.
   */
  clearTracking(agentId: string): void {
    this.lastSeenEventIds.delete(agentId);
  }

  // ── Request/Response ──────────────────────────────────────────

  /**
   * Send a request and wait for a matching response by requestId.
   * The `expectedType` narrows the response type for the caller.
   */
  private request<T extends AgentServerMessage>(
    expectedType: T['type'],
    message: OrchestratorMessage,
  ): Promise<T> {
    const requestId = randomUUID();
    const withId = { ...message, requestId };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timeout: ${message.type} (${requestId})`));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: AgentServerMessage) => void,
        reject,
        timer,
      });

      this.transport.send(withId);
    });
  }

  /** Fire-and-forget send (no response expected). */
  private send(message: OrchestratorMessage): void {
    if (this.transport.state !== 'connected') {
      throw new Error('Transport not connected');
    }
    this.transport.send(message);
  }

  /** Authenticate with the agent server. */
  private async authenticate(token: string): Promise<AuthResultMessage> {
    return this.request<AuthResultMessage>('auth_result', {
      type: 'authenticate',
      requestId: '',
      token,
    });
  }

  // ── Message Handling ──────────────────────────────────────────

  private handleMessage(message: AgentServerMessage): void {
    // Check if this is a response to a pending request
    if ('requestId' in message && typeof message.requestId === 'string') {
      const pending = this.pendingRequests.get(message.requestId);
      if (pending) {
        this.pendingRequests.delete(message.requestId);
        clearTimeout(pending.timer);

        if (message.type === 'error') {
          pending.reject(new Error((message as ErrorMessage).message));
        } else {
          pending.resolve(message);
        }
        return;
      }
    }

    // Handle unsolicited events/notifications
    switch (message.type) {
      case 'agent_spawned':
        this.emit('agentSpawned', message);
        break;

      case 'agent_event':
        this.trackEventId(message);
        this.emit('agentEvent', message);
        break;

      case 'agent_exited':
        this.emit('agentExited', message);
        // Keep tracking for a brief period — the orchestrator may want to
        // query final events. Caller can clearTracking() when ready.
        break;

      case 'error':
        logger.warn({
          module: 'agent-server-client',
          msg: 'Server error',
          code: message.code,
          error: message.message,
        });
        this.emit('error', message);
        break;

      case 'pong':
      case 'auth_result':
      case 'agent_list':
        // These should have been handled by pending request matching above.
        // If we get here, it's an orphaned response — log and ignore.
        logger.debug({
          module: 'agent-server-client',
          msg: 'Orphaned response (no pending request)',
          type: message.type,
        });
        break;
    }
  }

  private handleStateChange(state: TransportState): void {
    if (state === 'disconnected') {
      this.rejectAllPending('Transport disconnected');
      this.emit('disconnected', 'transport disconnected');
    } else if (state === 'connected') {
      // Re-subscribe for all tracked agents on reconnect
      for (const [agentId, lastEventId] of this.lastSeenEventIds) {
        this.subscribe(agentId, lastEventId);
      }
      this.emit('connected');
    }
  }

  // ── Event Tracking ────────────────────────────────────────────

  private trackEventId(event: AgentEventMessage): void {
    if (event.agentId && event.eventId) {
      this.lastSeenEventIds.set(event.agentId, event.eventId);
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  private removeHandlers(): void {
    if (this.unsubMessage) {
      this.unsubMessage();
      this.unsubMessage = null;
    }
    if (this.unsubState) {
      this.unsubState();
      this.unsubState = null;
    }
  }
}
