/**
 * ServerClientBridge — remote adapter bridge for Agent ↔ AgentServerClient.
 *
 * Provides a ServerClientAdapter (implements AgentAdapter) that proxies all
 * agent operations through an AgentServerClient. This allows Agent to work
 * transparently whether the underlying process is local or remote.
 *
 * startRemoteBridge() is the entry point — analogous to startAcp() in
 * AgentAcpBridge.ts but for the remote/server-client path.
 */
import { EventEmitter } from 'events';
import type { AgentAdapter, AdapterStartOptions, PromptContent, PromptOptions, PromptResult } from '../adapters/types.js';
import type { AgentServerClient } from './AgentServerClient.js';
import type { AgentEventMessage, AgentExitedMessage } from '../transport/types.js';
import { wireAcpEvents } from './AgentAcpBridge.js';
import { logger } from '../utils/logger.js';
import type { Agent } from './Agent.js';

// ── ServerClientAdapter ─────────────────────────────────────────────

/**
 * An AgentAdapter that proxies all operations to a remote agent server
 * via AgentServerClient. Events from the server are re-emitted as
 * standard AgentAdapter events so wireAcpEvents() works transparently.
 */
export class ServerClientAdapter extends EventEmitter implements AgentAdapter {
  readonly type = 'server-client';

  private _isConnected = false;
  private _isPrompting = false;
  private _promptingStartedAt: number | null = null;
  private _currentSessionId: string | null = null;
  private _disposed = false;

  private unsubEvent: (() => void) | null = null;
  private unsubExit: (() => void) | null = null;

  constructor(
    private readonly client: AgentServerClient,
    private readonly agentId: string,
  ) {
    super();
  }

  // ── AgentAdapter readonly properties ──────────────────────────

  get isConnected(): boolean { return this._isConnected; }
  get isPrompting(): boolean { return this._isPrompting; }
  get promptingStartedAt(): number | null { return this._promptingStartedAt; }
  get currentSessionId(): string | null { return this._currentSessionId; }
  get supportsImages(): boolean { return false; }

  // ── AgentAdapter methods ──────────────────────────────────────

  /**
   * Start the remote agent. Subscribes to events and resolves with sessionId.
   * The actual spawn was already done by AgentManager via client.spawn() —
   * start() just wires up event routing.
   */
  async start(_opts: AdapterStartOptions): Promise<string> {
    if (this._disposed) throw new Error('ServerClientAdapter has been disposed');

    this._isConnected = true;

    // Subscribe to agent events from the server client
    const onEvent = (msg: AgentEventMessage) => {
      if (msg.agentId !== this.agentId) return;
      this.handleAgentEvent(msg);
    };
    const onExit = (msg: AgentExitedMessage) => {
      if (msg.agentId !== this.agentId) return;
      this.handleAgentExited(msg);
    };

    this.client.on('agentEvent', onEvent);
    this.client.on('agentExited', onExit);

    this.unsubEvent = () => this.client.off('agentEvent', onEvent);
    this.unsubExit = () => this.client.off('agentExited', onExit);

    // Subscribe to the server's event stream for this agent
    this.client.subscribe(this.agentId);

    // Use the agentId as a synthetic sessionId for the remote agent
    this._currentSessionId = this.agentId;
    return this.agentId;
  }

  /**
   * Send a prompt to the remote agent. Fire-and-forget — prompt_complete
   * comes back asynchronously as an AgentEventMessage.
   */
  async prompt(content: PromptContent, _opts?: PromptOptions): Promise<PromptResult> {
    if (this._disposed) throw new Error('ServerClientAdapter has been disposed');

    const text = typeof content === 'string' ? content : JSON.stringify(content);
    await this.client.prompt(this.agentId, text);

    this._isPrompting = true;
    this._promptingStartedAt = Date.now();
    this.emit('prompting', true);

    // Return a resolved result — actual completion comes via 'prompt_complete' event
    return { stopReason: 'end_turn' };
  }

  /**
   * Cancel the agent's current prompt (interrupt without terminating).
   */
  async cancel(): Promise<void> {
    if (this._disposed) return;
    await this.client.cancel(this.agentId);
  }

  /**
   * Terminate the remote agent.
   */
  terminate(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._isConnected = false;
    this._isPrompting = false;

    this.client.terminate(this.agentId).catch((err) => {
      logger.warn({ module: 'server-client-bridge', msg: 'Terminate failed', agentId: this.agentId, err: String(err) });
    });
    this.client.clearTracking(this.agentId);
    this.removeSubscriptions();
    // Emit exit so AgentManager's onExit handler fires (endSession, cleanup).
    // AcpAdapter and CopilotSdkAdapter both do this; missing here caused
    // sessions to stay 'active' after stop.
    this.emit('exit', 0);
  }

  /**
   * Permission resolution (forwarded as a message to the remote agent).
   */
  resolvePermission(approved: boolean): void {
    if (this._disposed) return;
    const text = approved ? '[System] Permission approved.' : '[System] Permission denied.';
    this.client.prompt(this.agentId, text).catch((err) => {
      logger.warn({ module: 'server-client-bridge', msg: 'resolvePermission send failed', err: String(err) });
    });
  }

  // ── Event Translation ─────────────────────────────────────────

  /**
   * Translate AgentEventMessage from the server into standard AgentAdapter events
   * that wireAcpEvents() expects.
   */
  private handleAgentEvent(msg: AgentEventMessage): void {
    const { eventType, data } = msg;

    switch (eventType) {
      case 'text':
        this.emit('text', data.text ?? '');
        break;

      case 'thinking':
        this.emit('thinking', data.text ?? '');
        break;

      case 'tool_call':
        this.emit('tool_call', data);
        break;

      case 'tool_call_update':
        this.emit('tool_call_update', data);
        break;

      case 'plan':
        this.emit('plan', data.entries ?? []);
        break;

      case 'content':
        this.emit('content', data);
        break;

      case 'usage':
        this.emit('usage', data);
        break;

      case 'usage_update':
        this.emit('usage_update', data);
        break;

      case 'prompt_complete':
        this._isPrompting = false;
        this._promptingStartedAt = null;
        this.emit('prompt_complete', data.stopReason ?? 'end_turn');
        break;

      case 'prompting': {
        const active = data.active as boolean ?? true;
        this._isPrompting = active;
        this._promptingStartedAt = active ? Date.now() : null;
        this.emit('prompting', active);
        break;
      }

      case 'response_start':
        this.emit('response_start');
        break;

      case 'permission_request':
        this.emit('permission_request', data);
        break;

      case 'status_change':
        // Status changes are handled by AgentManager, not the adapter
        break;
    }
  }

  private handleAgentExited(msg: AgentExitedMessage): void {
    this._isConnected = false;
    this._isPrompting = false;
    this._promptingStartedAt = null;
    this.client.clearTracking(this.agentId);
    this.emit('exit', msg.exitCode);
    this.removeSubscriptions();
  }

  private removeSubscriptions(): void {
    if (this.unsubEvent) { this.unsubEvent(); this.unsubEvent = null; }
    if (this.unsubExit) { this.unsubExit(); this.unsubExit = null; }
  }
}

// ── Bridge Entry Point ──────────────────────────────────────────────

/**
 * Start a remote agent via AgentServerClient — analogous to startAcp()
 * in AgentAcpBridge.ts.
 *
 * 1. Spawns the agent on the remote server via client.spawn()
 * 2. Creates a ServerClientAdapter for local event routing
 * 3. Wires standard AgentAdapter events to the Agent via wireAcpEvents()
 * 4. Sends the initial prompt if provided
 */
export async function startRemoteBridge(
  agent: Agent,
  client: AgentServerClient,
  initialPrompt?: string,
): Promise<void> {
  const rawModel = agent.model || agent.role.model || 'default';

  try {
    // Spawn on the remote agent server
    const result = await client.spawn(
      agent.role.id,
      rawModel,
      agent.task,
      {
        agentId: agent.id,
        parentId: agent.parentId,
        dagTaskId: agent.dagTaskId,
        projectId: agent.projectId,
        projectName: agent.projectName,
        cwd: agent.cwd || process.cwd(),
        autopilot: agent.autopilot,
        resumeSessionId: agent.resumeSessionId,
      },
    );

    logger.info({
      module: 'server-client-bridge',
      msg: 'Remote agent spawned',
      agentId: agent.id,
      remoteAgentId: result.agentId,
      role: agent.role.id,
      pid: result.pid,
    });

    // Create adapter and wire events to the Agent
    const adapter = new ServerClientAdapter(client, result.agentId);
    agent._setAcpConnection(adapter);
    agent.status = 'running';
    wireAcpEvents(agent, adapter);

    // Start the adapter (subscribes to events)
    const sessionId = await adapter.start({
      cliCommand: '', // Not used for remote
    });

    // For session resume, prefer: spawn result sessionId > agent.resumeSessionId > adapter's agentId
    // The spawn result carries the actual session ID from the remote CopilotSdkAdapter.
    // ServerClientAdapter.start() returns agentId (synthetic), so we override it.
    agent.sessionId = result.sessionId || agent.resumeSessionId || sessionId;
    agent._notifySessionReady(agent.sessionId!);

    // Send initial prompt (always provided — includes context manifest on resume, full system prompt on fresh start)
    if (initialPrompt) {
      await adapter.prompt(initialPrompt);
    } else {
      // Resumed agents with no initial prompt are waiting for input — set idle.
      agent.status = 'idle';
      agent._notifyStatusChange(agent.status);
    }
  } catch (err) {
    const errorMsg = (err as Error)?.message || String(err);
    logger.error({
      module: 'server-client-bridge',
      msg: 'Remote spawn failed',
      err: errorMsg,
      role: agent.role?.id,
    });

    agent.exitError = errorMsg;
    agent.status = 'failed';
    agent._notifyExit(1);
  }
}
