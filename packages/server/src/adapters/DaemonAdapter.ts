/**
 * Daemon Adapter (D3).
 *
 * Proxies AgentAdapter method calls to a daemon process via DaemonClient.
 * The daemon manages the actual agent lifecycle (spawn, prompt, terminate)
 * while the server communicates over IPC (Unix Domain Socket / named pipe).
 *
 * Event mapping:
 *   daemon 'agent:output'  → adapter 'text'
 *   daemon 'agent:status'  → adapter state updates
 *   daemon 'agent:spawned' → adapter 'connected'
 *   daemon 'agent:exit'    → adapter 'exit'
 *
 * Design: packages/docs/design/hot-reload-agent-preservation.md
 */
import { EventEmitter } from 'events';
import type {
  AgentAdapter,
  AdapterStartOptions,
  PromptContent,
  PromptOptions,
  PromptResult,
  StopReason,
  UsageInfo,
} from './types.js';
import type {
  DaemonClient,
  DaemonClientEvents,
} from '../daemon/DaemonClient.js';
import type {
  DaemonEvent,
  SpawnParams,
  DaemonAgentStatus,
} from '../daemon/DaemonProtocol.js';
import { logger } from '../utils/logger.js';

// ── Types ───────────────────────────────────────────────────────────

export interface DaemonAdapterOptions {
  /** Pre-configured DaemonClient (must already be connected or will connect on start). */
  client: DaemonClient;
  /** Agent ID to use when spawning via the daemon. */
  agentId: string;
  /** Agent role (e.g., 'developer', 'reviewer'). */
  role?: string;
  /** Whether the daemon should auto-approve tool calls. */
  autopilot?: boolean;
  /** Timeout for spawn requests in ms (default: 60000). */
  spawnTimeoutMs?: number;
  /** Timeout for terminate requests in ms (default: 15000). */
  terminateTimeoutMs?: number;
}

/**
 * DaemonAdapter — bridges the AgentAdapter interface with the daemon process.
 *
 * Instead of spawning CLI processes directly, this adapter delegates all agent
 * lifecycle operations to the daemon via JSON-RPC. The daemon manages processes,
 * handles hot-reload survival, and buffers events across server restarts.
 */
export class DaemonAdapter extends EventEmitter implements AgentAdapter {
  readonly type = 'daemon';

  private _isConnected = false;
  private _isPrompting = false;
  private _promptingStartedAt: number | null = null;
  private _sessionId: string | null = null;
  private _agentPid: number | null = null;
  private _terminated = false;
  private _lastStatus: DaemonAgentStatus | null = null;

  private readonly client: DaemonClient;
  private readonly agentId: string;
  private readonly role: string;
  private readonly autopilot: boolean;
  private readonly spawnTimeoutMs: number;
  private readonly terminateTimeoutMs: number;

  /** Bound handler references for cleanup. */
  private readonly onDaemonEvent: (event: DaemonEvent) => void;
  private readonly onDaemonDisconnected: (info: { reason: string }) => void;
  private readonly onDaemonLost: (info: { missedHeartbeats: number }) => void;

  constructor(options: DaemonAdapterOptions) {
    super();

    this.client = options.client;
    this.agentId = options.agentId;
    this.role = options.role ?? 'developer';
    this.autopilot = options.autopilot ?? false;
    this.spawnTimeoutMs = options.spawnTimeoutMs ?? 60_000;
    this.terminateTimeoutMs = options.terminateTimeoutMs ?? 15_000;

    // Bind handlers so we can remove them later
    this.onDaemonEvent = this.handleDaemonEvent.bind(this);
    this.onDaemonDisconnected = this.handleDaemonDisconnected.bind(this);
    this.onDaemonLost = this.handleDaemonLost.bind(this);

    this.client.on('event', this.onDaemonEvent);
    this.client.on('disconnected', this.onDaemonDisconnected);
    this.client.on('daemon-lost', this.onDaemonLost);
  }

  // ── Read-only Properties ──────────────────────────────────────

  get isConnected(): boolean {
    return this._isConnected;
  }

  get isPrompting(): boolean {
    return this._isPrompting;
  }

  get promptingStartedAt(): number | null {
    return this._promptingStartedAt;
  }

  get currentSessionId(): string | null {
    return this._sessionId;
  }

  get supportsImages(): boolean {
    // Daemon agents inherit their underlying adapter's capabilities;
    // conservatively report false — can be upgraded via agent:status events.
    return false;
  }

  /** The daemon-managed agent's PID (null before spawn). */
  get agentPid(): number | null {
    return this._agentPid;
  }

  /** Last known daemon status of this agent. */
  get lastDaemonStatus(): DaemonAgentStatus | null {
    return this._lastStatus;
  }

  // ── Core Methods ──────────────────────────────────────────────

  /**
   * Ask the daemon to spawn an agent process.
   * Returns a session ID once the agent is running.
   */
  async start(opts: AdapterStartOptions): Promise<string> {
    if (this._terminated) {
      throw new Error('DaemonAdapter has been terminated');
    }
    if (this._isConnected) {
      throw new Error('Agent already started');
    }

    if (!this.client.isConnected) {
      throw new Error('DaemonClient is not connected');
    }

    const spawnParams: SpawnParams = {
      agentId: this.agentId,
      role: this.role,
      model: opts.model ?? 'default',
      cliCommand: opts.cliCommand,
      cliArgs: [
        ...(opts.baseArgs ?? []),
        ...(opts.cliArgs ?? []),
      ],
      cwd: opts.cwd,
      env: opts.env,
      sessionId: opts.sessionId,
    };

    logger.info({
      module: 'daemon-adapter',
      msg: 'Spawning agent via daemon',
      agentId: this.agentId,
      role: this.role,
      model: spawnParams.model,
    });

    const result = await this.client.spawnAgent(spawnParams);
    this._agentPid = result.pid;
    this._sessionId = opts.sessionId ?? `daemon-${this.agentId}`;
    this._isConnected = true;
    this._lastStatus = 'starting';

    this.emit('connected', this._sessionId);

    logger.info({
      module: 'daemon-adapter',
      msg: 'Agent spawned via daemon',
      agentId: this.agentId,
      pid: result.pid,
      sessionId: this._sessionId,
    });

    return this._sessionId;
  }

  /**
   * Send a prompt to the agent via the daemon.
   * The daemon relays the message to the agent process's stdin.
   */
  async prompt(content: PromptContent, _opts?: PromptOptions): Promise<PromptResult> {
    if (!this._isConnected) {
      throw new Error('Agent not connected');
    }
    if (this._isPrompting) {
      throw new Error('Agent is already prompting');
    }

    const message = typeof content === 'string'
      ? content
      : JSON.stringify(content);

    this._isPrompting = true;
    this._promptingStartedAt = Date.now();
    this.emit('prompting', true);
    this.emit('response_start');

    try {
      await this.client.sendMessage(this.agentId, message);

      // The actual response comes asynchronously via daemon events.
      // We return a placeholder result — the real output arrives via
      // 'text', 'tool_call', and 'prompt_complete' events.
      // This mirrors how AcpAdapter works: prompt() sends the message,
      // completion is signaled via events.
      return new Promise<PromptResult>((resolve, reject) => {
        const onComplete = (reason: string) => {
          cleanup();
          resolve({
            stopReason: (reason as StopReason) || 'end_turn',
          });
        };

        const onExit = (code: number) => {
          cleanup();
          reject(new Error(`Agent exited with code ${code} during prompt`));
        };

        const onError = () => {
          cleanup();
          reject(new Error('Daemon connection lost during prompt'));
        };

        const cleanup = () => {
          this._isPrompting = false;
          this._promptingStartedAt = null;
          this.emit('prompting', false);
          this.removeListener('prompt_complete', onComplete);
          this.removeListener('exit', onExit);
          this.removeListener('daemon_error', onError);
        };

        this.on('prompt_complete', onComplete);
        this.on('exit', onExit);
        this.on('daemon_error', onError);
      });
    } catch (err) {
      this._isPrompting = false;
      this._promptingStartedAt = null;
      this.emit('prompting', false);
      throw err;
    }
  }

  /**
   * Cancel the current prompt. Sends a cancel signal through the daemon.
   */
  async cancel(): Promise<void> {
    if (!this._isPrompting) return;

    this._isPrompting = false;
    this._promptingStartedAt = null;
    this.emit('prompting', false);

    // Best-effort cancel via daemon. If the daemon doesn't support
    // explicit cancel, the agent will finish its current turn naturally.
    try {
      await this.client.sendMessage(this.agentId, '\x03'); // Ctrl+C
    } catch {
      // Ignore — agent may have already finished
    }
  }

  /**
   * Terminate the agent process via the daemon.
   */
  terminate(): void {
    if (this._terminated) return;
    this._terminated = true;

    this._isPrompting = false;
    this._promptingStartedAt = null;
    this._isConnected = false;
    this._lastStatus = 'stopping';

    // Fire-and-forget terminate via daemon
    this.client.terminateAgent(this.agentId, this.terminateTimeoutMs).catch((err) => {
      logger.warn({
        module: 'daemon-adapter',
        msg: 'Failed to terminate agent via daemon',
        agentId: this.agentId,
        err: (err as Error).message,
      });
    });

    this.cleanup();
  }

  /**
   * Resolve a permission request. Forwards through the daemon as a message.
   */
  resolvePermission(approved: boolean): void {
    const message = JSON.stringify({ type: 'permission_response', approved });
    this.client.sendMessage(this.agentId, message).catch((err) => {
      logger.warn({
        module: 'daemon-adapter',
        msg: 'Failed to resolve permission via daemon',
        agentId: this.agentId,
        err: (err as Error).message,
      });
    });
  }

  // ── Reconnection ──────────────────────────────────────────────

  /**
   * Reconnect to an existing daemon-managed agent after server restart.
   * Subscribes to the event stream and replays buffered events.
   */
  async reconnect(lastSeenEventId?: string): Promise<void> {
    if (!this.client.isConnected) {
      throw new Error('DaemonClient is not connected');
    }

    // Get the agent's current state from the daemon
    const { agents } = await this.client.listAgents();
    const agent = agents.find(a => a.agentId === this.agentId);

    if (!agent) {
      throw new Error(`Agent ${this.agentId} not found in daemon`);
    }

    this._agentPid = agent.pid;
    this._sessionId = agent.sessionId ?? `daemon-${this.agentId}`;
    this._lastStatus = agent.status;
    this._isConnected = agent.status === 'running' || agent.status === 'idle';

    // Subscribe and replay buffered events
    const { bufferedEvents } = await this.client.subscribe({
      agentId: this.agentId,
      lastSeenEventId,
    });

    for (const event of bufferedEvents) {
      this.handleDaemonEvent(event);
    }

    if (this._isConnected) {
      this.emit('connected', this._sessionId);
    }

    logger.info({
      module: 'daemon-adapter',
      msg: 'Reconnected to daemon-managed agent',
      agentId: this.agentId,
      status: agent.status,
      replayedEvents: bufferedEvents.length,
    });
  }

  // ── Event Handling ────────────────────────────────────────────

  private handleDaemonEvent(event: DaemonEvent): void {
    // Only process events for our agent
    if (event.agentId && event.agentId !== this.agentId) return;

    switch (event.type) {
      case 'agent:output':
        this.handleAgentOutput(event);
        break;
      case 'agent:status':
        this.handleAgentStatus(event);
        break;
      case 'agent:spawned':
        this.handleAgentSpawned(event);
        break;
      case 'agent:exit':
        this.handleAgentExit(event);
        break;
      case 'daemon:shutting_down':
        this.handleDaemonShutdown();
        break;
      case 'daemon:mass_failure':
        logger.warn({
          module: 'daemon-adapter',
          msg: 'Mass failure detected by daemon',
          agentId: this.agentId,
          data: event.data,
        });
        break;
    }
  }

  private handleAgentOutput(event: DaemonEvent): void {
    const data = event.data;

    // Map daemon output types to adapter events
    if (data.type === 'text' && typeof data.text === 'string') {
      this.emit('text', data.text);
    } else if (data.type === 'thinking' && typeof data.text === 'string') {
      this.emit('thinking', data.text);
    } else if (data.type === 'tool_call' && data.info) {
      this.emit('tool_call', data.info);
    } else if (data.type === 'tool_call_update' && data.info) {
      this.emit('tool_call_update', data.info);
    } else if (data.type === 'plan' && data.entries) {
      this.emit('plan', data.entries);
    } else if (data.type === 'content' && data.block) {
      this.emit('content', data.block);
    } else if (data.type === 'usage_update' && data.usage) {
      this.emit('usage_update', data.usage);
    } else if (data.type === 'usage' && data.usage) {
      this.emit('usage', data.usage as UsageInfo);
    } else if (data.type === 'prompt_complete') {
      this.emit('prompt_complete', (data.reason as string) ?? 'end_turn');
    } else if (data.type === 'permission_request' && data.request) {
      this.emit('permission_request', data.request);
    }
  }

  private handleAgentStatus(event: DaemonEvent): void {
    const status = event.data.status as DaemonAgentStatus | undefined;
    if (!status) return;

    this._lastStatus = status;

    if (status === 'running') {
      this._isConnected = true;
    } else if (status === 'idle') {
      if (this._isPrompting) {
        this._isPrompting = false;
        this._promptingStartedAt = null;
        this.emit('prompting', false);
      }
    } else if (status === 'exited' || status === 'crashed') {
      this._isConnected = false;
      this._isPrompting = false;
      this._promptingStartedAt = null;
    }
  }

  private handleAgentSpawned(event: DaemonEvent): void {
    if (typeof event.data.pid === 'number') {
      this._agentPid = event.data.pid;
    }
    if (typeof event.data.sessionId === 'string') {
      this._sessionId = event.data.sessionId;
    }
    this._isConnected = true;
    this._lastStatus = 'running';
  }

  private handleAgentExit(event: DaemonEvent): void {
    const exitCode = typeof event.data.exitCode === 'number' ? event.data.exitCode : 1;
    this._isConnected = false;
    this._isPrompting = false;
    this._promptingStartedAt = null;
    this._lastStatus = 'exited';

    this.emit('exit', exitCode);
  }

  private handleDaemonDisconnected(info: { reason: string }): void {
    logger.warn({
      module: 'daemon-adapter',
      msg: 'Daemon connection lost',
      agentId: this.agentId,
      reason: info.reason,
    });

    // Don't set _isConnected = false — the agent may still be running
    // in the daemon. On reconnect, we can recover state.
    this.emit('daemon_error', info);
  }

  private handleDaemonLost(info: { missedHeartbeats: number }): void {
    logger.warn({
      module: 'daemon-adapter',
      msg: 'Daemon lost (heartbeat failure)',
      agentId: this.agentId,
      missedHeartbeats: info.missedHeartbeats,
    });

    this.emit('daemon_error', { reason: `Daemon heartbeat lost (${info.missedHeartbeats} missed)` });
  }

  private handleDaemonShutdown(): void {
    logger.info({
      module: 'daemon-adapter',
      msg: 'Daemon shutting down',
      agentId: this.agentId,
    });

    this._isConnected = false;
    this._isPrompting = false;
    this._promptingStartedAt = null;
    this._lastStatus = 'exited';

    this.emit('exit', 0);
  }

  // ── Cleanup ───────────────────────────────────────────────────

  private cleanup(): void {
    this.client.off('event', this.onDaemonEvent);
    this.client.off('disconnected', this.onDaemonDisconnected);
    this.client.off('daemon-lost', this.onDaemonLost);
  }

  /** Full disposal — terminate agent and remove all listeners. */
  dispose(): void {
    if (!this._terminated) {
      this.terminate();
    } else {
      this.cleanup();
    }
    this.removeAllListeners();
  }
}
