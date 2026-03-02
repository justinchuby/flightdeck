import { Server as HttpServer } from 'http';
import { WebSocketServer as WsServer, WebSocket } from 'ws';
import type { AgentManager } from '../agents/AgentManager.js';
import type { FileLockRegistry } from '../coordination/FileLockRegistry.js';
import type { ActivityLedger } from '../coordination/ActivityLedger.js';
import type { DecisionLog } from '../coordination/DecisionLog.js';
import type { ChatGroupRegistry } from '../comms/ChatGroupRegistry.js';
import { getAuthSecret } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { v4 as uuid } from 'uuid';

interface ClientConnection {
  id: string;
  ws: WebSocket;
  subscribedAgents: Set<string>;
}

export class WebSocketServer {
  private wss: WsServer;
  private clients: Map<string, ClientConnection> = new Map();
  private eventCleanups: Array<() => void> = [];

  constructor(
    server: HttpServer,
    agentManager: AgentManager,
    lockRegistry: FileLockRegistry,
    activityLedger: ActivityLedger,
    decisionLog: DecisionLog,
    chatGroupRegistry: ChatGroupRegistry,
  ) {
    this.wss = new WsServer({ server, path: '/ws' });

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
      const client: ClientConnection = { id: clientId, ws, subscribedAgents: new Set() };
      this.clients.set(clientId, client);

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleMessage(client, msg, agentManager);
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

      // Send current state on connect
      ws.send(
        JSON.stringify({
          type: 'init',
          agents: agentManager.getAll().map((a) => a.toJSON()),
          locks: lockRegistry.getAll(),
          systemPaused: agentManager.isSystemPaused,
        }),
      );
    });

    // Wire events by domain
    this.wireAgentEvents(agentManager);
    this.wireCoordinationEvents(lockRegistry, activityLedger);
    this.wireDecisionEvents(decisionLog);
    this.wireGroupEvents(chatGroupRegistry);
  }

  /** Track an event listener so close() can remove it */
  private track(emitter: any, event: string, handler: (...args: any[]) => void): void {
    emitter.on(event, handler);
    this.eventCleanups.push(() => emitter.off(event, handler));
  }

  private wireAgentEvents(agentManager: AgentManager): void {
    this.track(agentManager, 'agent:text', ({ agentId, text }: { agentId: string; text: string }) => {
      this.broadcast(
        { type: 'agent:data', agentId, data: text },
        (c) => c.subscribedAgents.has(agentId) || c.subscribedAgents.has('*'),
      );
    });

    this.track(agentManager, 'agent:spawned', (agentJson: any) => {
      this.broadcastAll({ type: 'agent:spawned', agent: agentJson });
    });

    this.track(agentManager, 'agent:terminated', (agentId: string) => {
      this.broadcastAll({ type: 'agent:terminated', agentId });
    });

    this.track(agentManager, 'agent:exit', ({ agentId, code }: { agentId: string; code: number }) => {
      this.broadcastAll({ type: 'agent:exit', agentId, code });
    });

    this.track(agentManager, 'agent:status', (data: any) => {
      this.broadcastAll({ type: 'agent:status', ...data });
    });

    this.track(agentManager, 'agent:crashed', (data: any) => {
      this.broadcastAll({ type: 'agent:crashed', ...data });
    });

    this.track(agentManager, 'agent:auto_restarted', (data: any) => {
      this.broadcastAll({ type: 'agent:auto_restarted', ...data });
    });

    this.track(agentManager, 'agent:restart_limit', (data: any) => {
      this.broadcastAll({ type: 'agent:restart_limit', ...data });
    });

    this.track(agentManager, 'agent:sub_spawned', (data: any) => {
      this.broadcastAll({ type: 'agent:sub_spawned', parentId: data.parentId, child: data.child });
    });

    this.track(agentManager, 'agent:tool_call', (data: any) => {
      this.broadcastAll({ type: 'agent:tool_call', ...data });
    });

    this.track(agentManager, 'agent:text', ({ agentId, text }: { agentId: string; text: string }) => {
      this.broadcastAll({ type: 'agent:text', agentId, text });
    });

    this.track(agentManager, 'agent:content', (data: any) => {
      this.broadcastAll({ type: 'agent:content', ...data });
    });

    this.track(agentManager, 'agent:thinking', (data: any) => {
      this.broadcastAll({ type: 'agent:thinking', ...data });
    });

    this.track(agentManager, 'agent:plan', (data: any) => {
      this.broadcastAll({ type: 'agent:plan', ...data });
    });

    this.track(agentManager, 'agent:permission_request', (data: any) => {
      this.broadcastAll({ type: 'agent:permission_request', ...data });
    });

    this.track(agentManager, 'lead:decision', (data: any) => {
      this.broadcastAll({ type: 'lead:decision', ...data });
    });

    this.track(agentManager, 'lead:progress', (data: any) => {
      this.broadcastAll({ type: 'lead:progress', ...data });
    });

    this.track(agentManager, 'agent:delegated', (data: any) => {
      this.broadcastAll({ type: 'agent:delegated', ...data });
    });

    this.track(agentManager, 'agent:completion_reported', (data: any) => {
      this.broadcastAll({ type: 'agent:completion_reported', ...data });
    });

    this.track(agentManager, 'agent:message_sent', (data: any) => {
      this.broadcastAll({ type: 'agent:message_sent', ...data });
    });

    this.track(agentManager, 'agent:session_ready', (data: any) => {
      this.broadcastAll({ type: 'agent:session_ready', ...data });
    });

    this.track(agentManager, 'agent:context_compacted', (data: any) => {
      this.broadcastAll({ type: 'agent:context_compacted', ...data });
    });

    this.track(agentManager, 'dag:updated', (data: any) => {
      this.broadcastAll({ type: 'dag:updated', ...data });
    });

    this.track(agentManager, 'system:paused', (data: any) => {
      this.broadcastAll({ type: 'system:paused', ...data });
    });
  }

  private wireCoordinationEvents(lockRegistry: FileLockRegistry, activityLedger: ActivityLedger): void {
    this.track(lockRegistry, 'lock:acquired', (data: any) => {
      this.broadcastAll({ type: 'lock:acquired', ...data });
    });

    this.track(lockRegistry, 'lock:released', (data: any) => {
      this.broadcastAll({ type: 'lock:released', ...data });
    });

    this.track(lockRegistry, 'lock:expired', (data: any) => {
      this.broadcastAll({ type: 'lock:expired', ...data });
    });

    this.track(activityLedger, 'activity', (entry: any) => {
      this.broadcastAll({ type: 'activity', entry });
    });
  }

  private wireDecisionEvents(decisionLog: DecisionLog): void {
    this.track(decisionLog, 'decision:confirmed', (decision: any) => {
      this.broadcastAll({ type: 'decision:confirmed', decision });
    });

    this.track(decisionLog, 'decision:rejected', (decision: any) => {
      this.broadcastAll({ type: 'decision:rejected', decision });
    });
  }

  private wireGroupEvents(chatGroupRegistry: ChatGroupRegistry): void {
    this.track(chatGroupRegistry, 'group:created', (data: any) => {
      this.broadcastAll({ type: 'group:created', ...data });
    });
    this.track(chatGroupRegistry, 'group:message', (data: any) => {
      this.broadcastAll({ type: 'group:message', ...data });
    });
    this.track(chatGroupRegistry, 'group:member_added', (data: any) => {
      this.broadcastAll({ type: 'group:member_added', ...data });
    });
    this.track(chatGroupRegistry, 'group:member_removed', (data: any) => {
      this.broadcastAll({ type: 'group:member_removed', ...data });
    });
    this.track(chatGroupRegistry, 'group:reaction', (data: any) => {
      this.broadcastAll({ type: 'group:reaction', ...data });
    });
  }

  private handleMessage(
    client: ClientConnection,
    msg: any,
    agentManager: AgentManager,
  ): void {
    switch (msg.type) {
      case 'subscribe':
        // Subscribe to agent output (or '*' for all)
        client.subscribedAgents.add(msg.agentId || '*');
        // Send buffered output
        if (msg.agentId && msg.agentId !== '*') {
          const agent = agentManager.get(msg.agentId);
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

      case 'input':
        // Send input to an agent
        if (msg.agentId) {
          const agent = agentManager.get(msg.agentId);
          if (agent) {
            logger.info('ws', `Input → ${agent.role.name} (${msg.agentId.slice(0, 8)}): "${(msg.text || '').slice(0, 80)}"`);
            agent.write(msg.text);
          } else {
            logger.warn('ws', `Input for unknown agent ${msg.agentId.slice(0, 8)}`);
          }
        }
        break;

      case 'resize':
        // resize is no longer supported (PTY mode removed)
        break;

      case 'permission_response':
        if (msg.agentId) {
          agentManager.resolvePermission(msg.agentId, msg.approved);
        }
        break;
    }
  }

  private broadcast(msg: any, filter: (c: ClientConnection) => boolean): void {
    const payload = JSON.stringify(msg);
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

  private broadcastAll(msg: any): void {
    this.broadcast(msg, () => true);
  }

  /** Public broadcast for external event sources (e.g., AlertEngine) */
  broadcastEvent(msg: any): void {
    this.broadcastAll(msg);
  }

  /** Remove all event listeners and close the WebSocket server */
  close(): void {
    for (const cleanup of this.eventCleanups) {
      cleanup();
    }
    this.eventCleanups.length = 0;

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
