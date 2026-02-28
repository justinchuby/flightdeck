import { Server as HttpServer } from 'http';
import { WebSocketServer as WsServer, WebSocket } from 'ws';
import type { AgentManager } from '../agents/AgentManager.js';
import type { FileLockRegistry } from '../coordination/FileLockRegistry.js';
import type { ActivityLedger } from '../coordination/ActivityLedger.js';
import type { DecisionLog } from '../coordination/DecisionLog.js';
import type { ChatGroupRegistry } from '../comms/ChatGroupRegistry.js';
import { getAuthSecret } from '../middleware/auth.js';
import { v4 as uuid } from 'uuid';

interface ClientConnection {
  id: string;
  ws: WebSocket;
  subscribedAgents: Set<string>;
}

export class WebSocketServer {
  private wss: WsServer;
  private clients: Map<string, ClientConnection> = new Map();

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
        if (!isLocalhost && token !== secret) {
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
        }),
      );
    });

    // Wire events by domain
    this.wireAgentEvents(agentManager);
    this.wireCoordinationEvents(lockRegistry, activityLedger);
    this.wireDecisionEvents(decisionLog);
    this.wireGroupEvents(chatGroupRegistry);
  }

  private wireAgentEvents(agentManager: AgentManager): void {
    agentManager.on('agent:text', ({ agentId, text }: { agentId: string; text: string }) => {
      this.broadcast(
        { type: 'agent:data', agentId, data: text },
        (c) => c.subscribedAgents.has(agentId) || c.subscribedAgents.has('*'),
      );
    });

    agentManager.on('agent:spawned', (agentJson: any) => {
      this.broadcastAll({ type: 'agent:spawned', agent: agentJson });
    });

    agentManager.on('agent:terminated', (agentId: string) => {
      this.broadcastAll({ type: 'agent:terminated', agentId });
    });

    agentManager.on('agent:exit', ({ agentId, code }: { agentId: string; code: number }) => {
      this.broadcastAll({ type: 'agent:exit', agentId, code });
    });

    agentManager.on('agent:status', (data: any) => {
      this.broadcastAll({ type: 'agent:status', ...data });
    });

    agentManager.on('agent:crashed', (data: any) => {
      this.broadcastAll({ type: 'agent:crashed', ...data });
    });

    agentManager.on('agent:auto_restarted', (data: any) => {
      this.broadcastAll({ type: 'agent:auto_restarted', ...data });
    });

    agentManager.on('agent:restart_limit', (data: any) => {
      this.broadcastAll({ type: 'agent:restart_limit', ...data });
    });

    agentManager.on('agent:sub_spawned', (data: any) => {
      this.broadcastAll({ type: 'agent:sub_spawned', parentId: data.parentId, child: data.child });
    });

    agentManager.on('agent:tool_call', (data: any) => {
      this.broadcastAll({ type: 'agent:tool_call', ...data });
    });

    agentManager.on('agent:text', ({ agentId, text }: { agentId: string; text: string }) => {
      this.broadcastAll({ type: 'agent:text', agentId, text });
    });

    agentManager.on('agent:content', (data: any) => {
      this.broadcastAll({ type: 'agent:content', ...data });
    });

    agentManager.on('agent:thinking', (data: any) => {
      this.broadcastAll({ type: 'agent:thinking', ...data });
    });

    agentManager.on('agent:plan', (data: any) => {
      this.broadcastAll({ type: 'agent:plan', ...data });
    });

    agentManager.on('agent:permission_request', (data: any) => {
      this.broadcastAll({ type: 'agent:permission_request', ...data });
    });

    agentManager.on('lead:decision', (data: any) => {
      this.broadcastAll({ type: 'lead:decision', ...data });
    });

    agentManager.on('lead:progress', (data: any) => {
      this.broadcastAll({ type: 'lead:progress', ...data });
    });

    agentManager.on('agent:delegated', (data: any) => {
      this.broadcastAll({ type: 'agent:delegated', ...data });
    });

    agentManager.on('agent:completion_reported', (data: any) => {
      this.broadcastAll({ type: 'agent:completion_reported', ...data });
    });

    agentManager.on('agent:message_sent', (data: any) => {
      this.broadcastAll({ type: 'agent:message_sent', ...data });
    });

    agentManager.on('agent:session_ready', (data: any) => {
      this.broadcastAll({ type: 'agent:session_ready', ...data });
    });

    agentManager.on('agent:context_compacted', (data: any) => {
      this.broadcastAll({ type: 'agent:context_compacted', ...data });
    });

    agentManager.on('dag:updated', (data: any) => {
      this.broadcastAll({ type: 'dag:updated', ...data });
    });
  }

  private wireCoordinationEvents(lockRegistry: FileLockRegistry, activityLedger: ActivityLedger): void {
    lockRegistry.on('lock:acquired', (data: any) => {
      this.broadcastAll({ type: 'lock:acquired', ...data });
    });

    lockRegistry.on('lock:released', (data: any) => {
      this.broadcastAll({ type: 'lock:released', ...data });
    });

    activityLedger.on('activity', (entry: any) => {
      this.broadcastAll({ type: 'activity', entry });
    });
  }

  private wireDecisionEvents(decisionLog: DecisionLog): void {
    decisionLog.on('decision:confirmed', (decision: any) => {
      this.broadcastAll({ type: 'decision:confirmed', decision });
    });

    decisionLog.on('decision:rejected', (decision: any) => {
      this.broadcastAll({ type: 'decision:rejected', decision });
    });
  }

  private wireGroupEvents(chatGroupRegistry: ChatGroupRegistry): void {
    chatGroupRegistry.on('group:created', (data: any) => {
      this.broadcastAll({ type: 'group:created', ...data });
    });
    chatGroupRegistry.on('group:message', (data: any) => {
      this.broadcastAll({ type: 'group:message', ...data });
    });
    chatGroupRegistry.on('group:member_added', (data: any) => {
      this.broadcastAll({ type: 'group:member_added', ...data });
    });
    chatGroupRegistry.on('group:member_removed', (data: any) => {
      this.broadcastAll({ type: 'group:member_removed', ...data });
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
            agent.write(msg.text);
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
}
