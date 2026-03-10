import { Server as HttpServer } from 'http';
import { v4 as uuid } from 'uuid';
import { WebSocketServer as WsServer, WebSocket } from 'ws';
import type { AgentManager, AgentManagerEvents } from '../agents/AgentManager.js';
import type { FileLockRegistry } from '../coordination/files/FileLockRegistry.js';
import type { ActivityLedger } from '../coordination/activity/ActivityLedger.js';
import type { DecisionLog, Decision } from '../coordination/decisions/DecisionLog.js';
import type { ChatGroupRegistry, ChatGroup, GroupMessage } from '../comms/ChatGroupRegistry.js';
import type { ActivityEntry } from '@flightdeck/shared';
import { getAuthSecret } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { redactWsMessage } from '../utils/redaction.js';
import { runWithWsContext } from '../middleware/requestContext.js';
import type { AgentServerHealth, HealthStateChange } from '../agents/AgentServerHealth.js';

interface ClientConnection {
  id: string;
  ws: WebSocket;
  subscribedAgents: Set<string>;
  subscribedProject: string | null;
}

export class WebSocketServer {
  private wss: WsServer;
  private clients: Map<string, ClientConnection> = new Map();
  private eventCleanups: Array<() => void> = [];
  private agentManager: AgentManager;
  private lockRegistry: FileLockRegistry;
  private decisionLog: DecisionLog;
  private statusThrottleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private statusPending = new Map<string, AgentManagerEvents['agent:status'] & { type: string; _projectId: string | undefined }>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  // agent:text batching — buffer per agent, flush every 100ms
  private textBuffer = new Map<string, { texts: string[]; projectId?: string }>();
  private textFlushTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly TEXT_FLUSH_MS = 100;
  private agentServerHealth: AgentServerHealth | null = null;

  constructor(
    server: HttpServer,
    agentManager: AgentManager,
    lockRegistry: FileLockRegistry,
    activityLedger: ActivityLedger,
    decisionLog: DecisionLog,
    chatGroupRegistry: ChatGroupRegistry,
  ) {
    this.wss = new WsServer({ server, path: '/ws' });
    this.agentManager = agentManager;
    this.lockRegistry = lockRegistry;
    this.decisionLog = decisionLog;

    // Prevent unhandled 'error' events from crashing the process.
    // EADDRINUSE is handled by listenWithRetry in index.ts (auto-port-finding);
    // this handler catches any residual or runtime WSS errors.
    this.wss.on('error', (err: Error & { code?: string }) => {
      logger.error({ module: 'comms', msg: 'WebSocket server error', err: err.message });
    });

    this.wss.on('connection', (ws, req) => {
      // Check auth if secret is configured (allow localhost without token)
      const secret = getAuthSecret();
      if (secret) {
        const ip = req.socket.remoteAddress || '';
        const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
        const url = new URL(req.url || '', `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        const cookieToken = this.parseCookie(req.headers.cookie, 'flightdeck-token');
        if (!isLocalhost && token !== secret && cookieToken !== secret) {
          ws.close(4401, 'Authentication required');
          return;
        }
      }

      const clientId = uuid();
      const client: ClientConnection = { id: clientId, ws, subscribedAgents: new Set(), subscribedProject: null };
      this.clients.set(clientId, client);

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleMessage(client, msg);
        } catch {
          try { ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' })); } catch { /* broken */ }
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
      });

      ws.on('error', () => {
        // Silently handle broken pipe / connection reset — client already gone
        this.clients.delete(clientId);
      });

      // Flush any buffered agent messages so the new client gets complete data
      agentManager.flushAllMessages();

      // Send full state on connect — browser UI needs all data; agent clients
      // that call subscribe-project will get re-filtered data at that point.
      ws.send(
        JSON.stringify({
          type: 'init',
          agents: agentManager.getAll().map((a) => a.toJSON()),
          locks: lockRegistry.getAll(),
          systemPaused: agentManager.isSystemPaused,
          agentServerState: this.agentServerHealth?.state ?? 'connected',
        }),
      );
    });

    // Wire events by domain
    this.wireAgentEvents(agentManager);
    this.wireCoordinationEvents(lockRegistry, activityLedger);
    this.wireDecisionEvents(decisionLog);
    this.wireGroupEvents(chatGroupRegistry);
    this.wireAttentionEvents(agentManager, decisionLog);

    // Ping/pong heartbeat every 30s to detect dead connections
    this.heartbeatTimer = setInterval(() => {
      for (const [id, client] of this.clients) {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.ping();
        } else {
          this.clients.delete(id);
        }
      }
    }, 30_000);
  }

  /** Track an event listener so close() can remove it */
  private track(emitter: { on(event: string, handler: (...args: unknown[]) => void): unknown; off(event: string, handler: (...args: unknown[]) => void): unknown }, event: string, handler: (...args: any[]) => void): void {
    emitter.on(event, handler);
    this.eventCleanups.push(() => emitter.off(event, handler));
  }

  private wireAgentEvents(agentManager: AgentManager): void {
    this.track(agentManager, 'agent:spawned', (agentJson: AgentManagerEvents['agent:spawned']) => {
      this.broadcastToProject({ type: 'agent:spawned', agent: agentJson }, agentJson.projectId);
    });

    this.track(agentManager, 'agent:terminated', (agentId: string) => {
      const projectId = this.resolveAgentProjectId(agentId);
      this.broadcastToProject({ type: 'agent:terminated', agentId }, projectId);
    });

    this.track(agentManager, 'agent:exit', ({ agentId, code, error }: { agentId: string; code: number; error?: string }) => {
      const projectId = this.resolveAgentProjectId(agentId);
      this.broadcastToProject({ type: 'agent:exit', agentId, code, error }, projectId);
    });

    this.track(agentManager, 'agent:status', (data: AgentManagerEvents['agent:status']) => {
      const agentId = data.agentId;
      const projectId = this.resolveAgentProjectId(agentId);
      // Throttle: buffer latest status per agent, flush every 500ms
      this.statusPending.set(agentId, { type: 'agent:status', ...data, _projectId: projectId });
      if (!this.statusThrottleTimers.has(agentId)) {
        this.statusThrottleTimers.set(agentId, setTimeout(() => {
          this.statusThrottleTimers.delete(agentId);
          const pending = this.statusPending.get(agentId);
          if (pending) {
            this.statusPending.delete(agentId);
            const { _projectId, ...msg } = pending;
            this.broadcastToProject(msg, _projectId);
          }
        }, 500));
      }
    });

    this.track(agentManager, 'agent:crashed', (data: AgentManagerEvents['agent:crashed']) => {
      const projectId = this.resolveAgentProjectId(data.agentId);
      this.broadcastToProject({ type: 'agent:crashed', ...data }, projectId);
    });

    this.track(agentManager, 'agent:auto_restarted', (data: AgentManagerEvents['agent:auto_restarted']) => {
      const projectId = this.resolveAgentProjectId(data.agentId);
      this.broadcastToProject({ type: 'agent:auto_restarted', ...data }, projectId);
    });

    this.track(agentManager, 'agent:restart_limit', (data: AgentManagerEvents['agent:restart_limit']) => {
      const projectId = this.resolveAgentProjectId(data.agentId);
      this.broadcastToProject({ type: 'agent:restart_limit', ...data }, projectId);
    });

    this.track(agentManager, 'agent:sub_spawned', (data: AgentManagerEvents['agent:sub_spawned']) => {
      const projectId = this.resolveAgentProjectId(data.parentId);
      this.broadcastToProject({ type: 'agent:sub_spawned', parentId: data.parentId, child: data.child }, projectId);
    });

    this.track(agentManager, 'agent:tool_call', (data: AgentManagerEvents['agent:tool_call']) => {
      const projectId = this.resolveAgentProjectId(data.agentId);
      this.broadcastToProject({ type: 'agent:tool_call', ...data }, projectId);
    });

    // Broadcast immediately (not batched) so it arrives before any text from the new turn
    this.track(agentManager, 'agent:response_start', (data: AgentManagerEvents['agent:response_start']) => {
      const projectId = this.resolveAgentProjectId(data.agentId);
      this.broadcastToProject({ type: 'agent:response_start', ...data }, projectId);
    });

    // WebSocket subscription architecture:
    // - Agent connections subscribe to specific agent IDs (project-scoped participants)
    // - UI connections subscribe to '*' (all agents) because the dashboard is an observer
    //   that must render any agent's chat panel when the user clicks on it.
    // Project-level isolation is enforced server-side via subscribedProject filtering.
    // Do NOT remove the '*' wildcard support — it is intentional for UI monitoring.
    this.track(agentManager, 'agent:text', ({ agentId, text }: { agentId: string; text: string }) => {
      const projectId = this.resolveAgentProjectId(agentId);
      // Buffer text and flush in batches per TEXT_FLUSH_MS
      const buf = this.textBuffer.get(agentId);
      if (buf) {
        buf.texts.push(text);
      } else {
        this.textBuffer.set(agentId, { texts: [text], projectId });
      }
      if (!this.textFlushTimer) {
        this.textFlushTimer = setInterval(() => this.flushTextBuffer(), WebSocketServer.TEXT_FLUSH_MS);
      }
    });

    this.track(agentManager, 'agent:content', (data: AgentManagerEvents['agent:content']) => {
      const projectId = this.resolveAgentProjectId(data.agentId);
      this.broadcastToProject({ type: 'agent:content', ...data }, projectId);
    });

    this.track(agentManager, 'agent:thinking', (data: AgentManagerEvents['agent:thinking']) => {
      const projectId = this.resolveAgentProjectId(data.agentId);
      this.broadcastToProject({ type: 'agent:thinking', ...data }, projectId);
    });

    this.track(agentManager, 'agent:plan', (data: AgentManagerEvents['agent:plan']) => {
      const projectId = this.resolveAgentProjectId(data.agentId);
      this.broadcastToProject({ type: 'agent:plan', ...data }, projectId);
    });

    this.track(agentManager, 'agent:usage', (data: AgentManagerEvents['agent:usage']) => {
      const projectId = this.resolveAgentProjectId(data.agentId);
      this.broadcastToProject({ type: 'agent:usage', ...data }, projectId);
    });

    this.track(agentManager, 'agent:permission_request', (data: AgentManagerEvents['agent:permission_request']) => {
      const projectId = this.resolveAgentProjectId(data.agentId);
      this.broadcastToProject({ type: 'agent:permission_request', ...data }, projectId);
    });

    this.track(agentManager, 'agent:user_input_request', (data: AgentManagerEvents['agent:user_input_request']) => {
      const projectId = this.resolveAgentProjectId(data.agentId);
      this.broadcastToProject({ type: 'agent:user_input_request', ...data }, projectId);
    });

    this.track(agentManager, 'lead:decision', (data: AgentManagerEvents['lead:decision']) => {
      const projectId = this.resolveAgentProjectId(data.agentId);
      this.broadcastToProject({ type: 'lead:decision', ...data }, projectId);
    });

    this.track(agentManager, 'lead:progress', (data: AgentManagerEvents['lead:progress']) => {
      const projectId = this.resolveAgentProjectId(data.agentId ?? data.leadId);
      this.broadcastToProject({ type: 'lead:progress', ...data }, projectId);
    });

    this.track(agentManager, 'agent:delegated', (data: AgentManagerEvents['agent:delegated']) => {
      const projectId = this.resolveAgentProjectId(data.parentId);
      this.broadcastToProject({ type: 'agent:delegated', ...data }, projectId);
    });

    this.track(agentManager, 'agent:completion_reported', (data: AgentManagerEvents['agent:completion_reported']) => {
      const projectId = this.resolveAgentProjectId(data.childId);
      this.broadcastToProject({ type: 'agent:completion_reported', ...data }, projectId);
    });

    this.track(agentManager, 'agent:message_sent', (data: AgentManagerEvents['agent:message_sent']) => {
      const projectId = this.resolveAgentProjectId(data.from);
      this.broadcastToProject({ type: 'agent:message_sent', ...data }, projectId);
    });

    this.track(agentManager, 'agent:session_ready', (data: AgentManagerEvents['agent:session_ready']) => {
      const projectId = this.resolveAgentProjectId(data.agentId);
      this.broadcastToProject({ type: 'agent:session_ready', ...data }, projectId);
    });

    this.track(agentManager, 'agent:session_resume_failed', (data: AgentManagerEvents['agent:session_resume_failed']) => {
      const projectId = this.resolveAgentProjectId(data.agentId);
      this.broadcastToProject({ type: 'agent:session_resume_failed', ...data }, projectId);
    });

    this.track(agentManager, 'agent:context_compacted', (data: AgentManagerEvents['agent:context_compacted']) => {
      const projectId = this.resolveAgentProjectId(data.agentId);
      this.broadcastToProject({ type: 'agent:context_compacted', ...data }, projectId);
    });

    this.track(agentManager, 'dag:updated', (data: AgentManagerEvents['dag:updated']) => {
      const projectId = this.resolveAgentProjectId(data.leadId);
      this.broadcastToProject({ type: 'dag:updated', ...data }, projectId);
    });

    // system:paused is global — always broadcast to all clients
    this.track(agentManager, 'system:paused', (data: AgentManagerEvents['system:paused']) => {
      this.broadcastAll({ type: 'system:paused', ...data });
    });
  }

  private wireCoordinationEvents(lockRegistry: FileLockRegistry, activityLedger: ActivityLedger): void {
    this.track(lockRegistry, 'lock:acquired', (data: { filePath: string; agentId: string; agentRole: string; reason: string; projectId: string }) => {
      const projectId = this.resolveAgentProjectId(data.agentId);
      this.broadcastToProject({ type: 'lock:acquired', ...data }, projectId);
    });

    this.track(lockRegistry, 'lock:released', (data: { filePath: string; agentId: string }) => {
      const projectId = this.resolveAgentProjectId(data.agentId);
      this.broadcastToProject({ type: 'lock:released', ...data }, projectId);
    });

    this.track(lockRegistry, 'lock:expired', (data: { filePath: string; agentId: string; agentRole: string }) => {
      const projectId = this.resolveAgentProjectId(data.agentId);
      this.broadcastToProject({ type: 'lock:expired', ...data }, projectId);
    });

    this.track(activityLedger, 'activity', (entry: ActivityEntry) => {
      const projectId = this.resolveAgentProjectId(entry.agentId);
      this.broadcastToProject({ type: 'activity', entry }, projectId);
    });
  }

  private wireDecisionEvents(decisionLog: DecisionLog): void {
    this.track(decisionLog, 'decision:confirmed', (decision: Decision) => {
      const projectId = decision.projectId ?? this.resolveAgentProjectId(decision.agentId);
      this.broadcastToProject({ type: 'decision:confirmed', decision }, projectId);
    });

    this.track(decisionLog, 'decision:rejected', (decision: Decision) => {
      const projectId = decision.projectId ?? this.resolveAgentProjectId(decision.agentId);
      this.broadcastToProject({ type: 'decision:rejected', decision }, projectId);
    });

    this.track(decisionLog, 'decision:dismissed', (decision: Decision) => {
      const projectId = decision.projectId ?? this.resolveAgentProjectId(decision.agentId);
      this.broadcastToProject({ type: 'decision:dismissed', decision }, projectId);
    });

    this.track(decisionLog, 'decisions:batch_confirmed', (decisions: Decision[]) => {
      if (decisions.length === 0) return;
      const projectId = decisions[0].projectId ?? this.resolveAgentProjectId(decisions[0].agentId);
      this.broadcastToProject({ type: 'decisions:batch', action: 'confirm', decisions }, projectId);
    });

    this.track(decisionLog, 'decisions:batch_rejected', (decisions: Decision[]) => {
      if (decisions.length === 0) return;
      const projectId = decisions[0].projectId ?? this.resolveAgentProjectId(decisions[0].agentId);
      this.broadcastToProject({ type: 'decisions:batch', action: 'reject', decisions }, projectId);
    });

    this.track(decisionLog, 'decisions:batch_dismissed', (decisions: Decision[]) => {
      if (decisions.length === 0) return;
      const projectId = decisions[0].projectId ?? this.resolveAgentProjectId(decisions[0].agentId);
      this.broadcastToProject({ type: 'decisions:batch', action: 'dismiss', decisions }, projectId);
    });
  }

  private wireGroupEvents(chatGroupRegistry: ChatGroupRegistry): void {
    this.track(chatGroupRegistry, 'group:created', (data: ChatGroup) => {
      const projectId = data.projectId ?? this.resolveAgentProjectId(data.leadId);
      this.broadcastToProject({ type: 'group:created', ...data }, projectId);
    });
    this.track(chatGroupRegistry, 'group:message', (data: { message: GroupMessage; recipientIds: string[] }) => {
      const projectId = this.resolveAgentProjectId(data.message.leadId);
      this.broadcastToProject({ type: 'group:message', ...data }, projectId);
    });
    this.track(chatGroupRegistry, 'group:member_added', (data: { group: string; leadId: string; agentId: string }) => {
      const projectId = this.resolveAgentProjectId(data.leadId);
      this.broadcastToProject({ type: 'group:member_added', ...data }, projectId);
    });
    this.track(chatGroupRegistry, 'group:member_removed', (data: { group: string; leadId: string; agentId: string }) => {
      const projectId = this.resolveAgentProjectId(data.leadId);
      this.broadcastToProject({ type: 'group:member_removed', ...data }, projectId);
    });
    this.track(chatGroupRegistry, 'group:reaction', (data: { messageId: string; groupName: string; leadId: string; agentId: string; emoji: string; action: 'add' | 'remove' }) => {
      const projectId = this.resolveAgentProjectId(data.leadId);
      this.broadcastToProject({ type: 'group:reaction', ...data }, projectId);
    });
  }

  /**
   * Broadcast lightweight 'attention:changed' signal when attention-affecting
   * state changes. Client receives this and refetches GET /attention.
   * No debounce server-side — client debounces at 300ms.
   */
  private wireAttentionEvents(agentManager: AgentManager, decisionLog: DecisionLog): void {
    this.track(agentManager, 'dag:updated', (data: AgentManagerEvents['dag:updated']) => {
      this.broadcastAll({ type: 'attention:changed', trigger: 'dag', leadId: data.leadId });
    });
    this.track(agentManager, 'agent:crashed', () => {
      this.broadcastAll({ type: 'attention:changed', trigger: 'agent_crashed' });
    });
    this.track(decisionLog, 'decision', () => {
      this.broadcastAll({ type: 'attention:changed', trigger: 'decision_new' });
    });
    this.track(decisionLog, 'decision:confirmed', () => {
      this.broadcastAll({ type: 'attention:changed', trigger: 'decision_resolved' });
    });
    this.track(decisionLog, 'decision:rejected', () => {
      this.broadcastAll({ type: 'attention:changed', trigger: 'decision_resolved' });
    });
    this.track(decisionLog, 'decision:dismissed', () => {
      this.broadcastAll({ type: 'attention:changed', trigger: 'decision_resolved' });
    });
    this.track(decisionLog, 'decisions:batch_confirmed', () => {
      this.broadcastAll({ type: 'attention:changed', trigger: 'decision_batch' });
    });
    this.track(decisionLog, 'decisions:batch_rejected', () => {
      this.broadcastAll({ type: 'attention:changed', trigger: 'decision_batch' });
    });
    this.track(decisionLog, 'decisions:batch_dismissed', () => {
      this.broadcastAll({ type: 'attention:changed', trigger: 'decision_batch' });
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw JSON from client, validated by switch cases
  private handleMessage(
    client: ClientConnection,
    msg: Record<string, any>,
  ): void {
    runWithWsContext(client.id, client.subscribedProject ?? undefined, () => {
    switch (msg.type) {
      case 'subscribe':
        // Subscribe to agent output (or '*' for all)
        client.subscribedAgents.add(msg.agentId || '*');
        // Send buffered output
        if (msg.agentId && msg.agentId !== '*') {
          const agent = this.agentManager.get(msg.agentId);
          if (agent) {
            client.ws.send(
              JSON.stringify({
                type: 'agent:buffer',
                agentId: msg.agentId,
                data: agent.getBufferedOutput(),
              }),
            );
          }
        }
        break;

      case 'unsubscribe':
        client.subscribedAgents.delete(msg.agentId || '*');
        break;

      case 'subscribe-project':
        client.subscribedProject = msg.projectId || null;
        // Re-send filtered init so client immediately sees only its project's data
        if (client.subscribedProject) {
          const agents = this.agentManager.getByProject(client.subscribedProject);
          try {
            client.ws.send(
              JSON.stringify({
                type: 'init',
                agents: agents.map((a) => a.toJSON()),
                locks: this.lockRegistry.getByProject(client.subscribedProject),
                systemPaused: this.agentManager.isSystemPaused,
              }),
            );
          } catch { /* connection broken */ }
        }
        break;

      case 'input':
        // Send input to an agent
        if (msg.agentId) {
          const agent = this.agentManager.get(msg.agentId);
          if (agent) {
            logger.info({ module: 'comms', msg: 'WS input', agentId: msg.agentId, roleName: agent.role.name, textPreview: (msg.text || '').slice(0, 80) });
            agent.write(msg.text, { priority: true });
          } else {
            logger.warn({ module: 'comms', msg: 'Input for unknown agent', agentId: msg.agentId });
          }
        }
        break;

      case 'resize':
        // resize is no longer supported (PTY mode removed)
        break;

      case 'permission_response':
        if (msg.agentId) {
          this.agentManager.resolvePermission(msg.agentId, msg.approved);
        }
        break;

      case 'queue_open':
        // User opened the approval queue — pause auto-approve timers
        this.decisionLog.pauseTimers();
        break;

      case 'queue_closed':
        // User closed the approval queue — resume auto-approve timers
        this.decisionLog.resumeTimers();
        break;
    }
    }); // end runWithWsContext
  }

  private broadcast(msg: Record<string, unknown>, filter: (c: ClientConnection) => boolean): void {
    const payload = JSON.stringify(redactWsMessage(msg));
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN && filter(client)) {
        try {
          client.ws.send(payload);
        } catch {
          // Connection broken — will be cleaned up on 'close'/'error' event
        }
      }
    }
  }

  private broadcastAll(msg: Record<string, unknown>): void {
    this.broadcast(msg, () => true);
  }

  /** Broadcast only to clients subscribed to the given project (or all if no project filter) */
  private broadcastToProject(msg: Record<string, unknown>, projectId?: string): void {
    this.broadcast(msg, (c) =>
      !c.subscribedProject || !projectId || c.subscribedProject === projectId,
    );
  }

  /** Resolve projectId from an agentId via AgentManager's parent-chain walk */
  private resolveAgentProjectId(agentId: string | undefined): string | undefined {
    if (!agentId) return undefined;
    return this.agentManager.getProjectIdForAgent(agentId);
  }

  /** Public broadcast for external event sources (e.g., AlertEngine, TimerRegistry) */
  broadcastEvent(msg: Record<string, unknown>, projectId?: string): void {
    this.broadcastToProject(msg, projectId);
  }

  /**
   * Wire AgentServerHealth state changes → WS 'agentServerStatus' events.
   * Broadcasts to all clients (global, not project-scoped) so the UI connection
   * status banner (AS19) can show degraded/disconnected state.
   */
  wireAgentServerHealth(health: AgentServerHealth): () => void {
    this.agentServerHealth = health;
    const unsub = health.onStateChange((change: HealthStateChange) => {
      let detail: string | undefined;
      if (change.current === 'degraded') {
        detail = `${change.missedPongs} missed pong(s)`;
      } else if (change.current === 'disconnected') {
        detail = 'Agent server unreachable';
      }

      this.broadcastAll({
        type: 'agentServerStatus',
        state: change.current,
        detail,
      });
    });

    this.eventCleanups.push(unsub);
    return unsub;
  }

  /** Flush buffered agent:text events — coalesces rapid text chunks into single WS messages */
  private flushTextBuffer(): void {
    if (this.textBuffer.size === 0) {
      if (this.textFlushTimer) {
        clearInterval(this.textFlushTimer);
        this.textFlushTimer = null;
      }
      return;
    }
    for (const [agentId, { texts, projectId }] of this.textBuffer) {
      const merged = texts.join('');
      this.broadcast(
        { type: 'agent:text', agentId, text: merged },
        (c) =>
          (!c.subscribedProject || !projectId || c.subscribedProject === projectId) &&
          (c.subscribedAgents.has(agentId) || c.subscribedAgents.has('*')),
      );
    }
    this.textBuffer.clear();
  }

  /** Remove all event listeners and close the WebSocket server */
  close(): void {
    for (const cleanup of this.eventCleanups) {
      cleanup();
    }
    this.eventCleanups.length = 0;

    // Clean up throttle timers
    for (const timer of this.statusThrottleTimers.values()) clearTimeout(timer);
    this.statusThrottleTimers.clear();
    this.statusPending.clear();

    // Clean up text buffer
    if (this.textFlushTimer) {
      clearInterval(this.textFlushTimer);
      this.textFlushTimer = null;
    }
    this.textBuffer.clear();

    // Clean up heartbeat
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const client of this.clients.values()) {
      try { client.ws.close(1001, 'Server shutting down'); } catch { /* already closed */ }
    }
    this.clients.clear();
    this.wss.close();
  }

  private parseCookie(header: string | undefined, name: string): string | null {
    if (!header) return null;
    const match = header.split(';').find(c => c.trim().startsWith(`${name}=`));
    return match ? decodeURIComponent(match.split('=')[1].trim()) : null;
  }
}
