import { Server as HttpServer } from 'http';
import { WebSocketServer as WsServer, WebSocket } from 'ws';
import type { AgentManager } from '../agents/AgentManager.js';
import type { TaskQueue } from '../tasks/TaskQueue.js';
import { v4 as uuid } from 'uuid';

interface ClientConnection {
  id: string;
  ws: WebSocket;
  subscribedAgents: Set<string>;
}

export class WebSocketServer {
  private wss: WsServer;
  private clients: Map<string, ClientConnection> = new Map();

  constructor(server: HttpServer, agentManager: AgentManager, taskQueue: TaskQueue) {
    this.wss = new WsServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      const clientId = uuid();
      const client: ClientConnection = { id: clientId, ws, subscribedAgents: new Set() };
      this.clients.set(clientId, client);

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleMessage(client, msg, agentManager, taskQueue);
        } catch {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
      });

      // Send current state on connect
      ws.send(
        JSON.stringify({
          type: 'init',
          agents: agentManager.getAll().map((a) => a.toJSON()),
          tasks: taskQueue.getAll(),
        }),
      );
    });

    // Forward agent events to subscribed clients
    agentManager.on('agent:data', (agentId: string, data: string) => {
      this.broadcast(
        { type: 'agent:data', agentId, data },
        (c) => c.subscribedAgents.has(agentId) || c.subscribedAgents.has('*'),
      );
    });

    agentManager.on('agent:spawned', (agentJson: any) => {
      this.broadcastAll({ type: 'agent:spawned', agent: agentJson });
    });

    agentManager.on('agent:killed', (agentId: string) => {
      this.broadcastAll({ type: 'agent:killed', agentId });
    });

    agentManager.on('agent:exit', (agentId: string, code: number) => {
      this.broadcastAll({ type: 'agent:exit', agentId, code });
    });

    agentManager.on('agent:sub_spawned', (parentId: string, childJson: any) => {
      this.broadcastAll({ type: 'agent:sub_spawned', parentId, child: childJson });
    });

    taskQueue.on('task:updated', (task: any) => {
      this.broadcastAll({ type: 'task:updated', task });
    });
  }

  private handleMessage(
    client: ClientConnection,
    msg: any,
    agentManager: AgentManager,
    _taskQueue: TaskQueue,
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
        if (msg.agentId) {
          const agent = agentManager.get(msg.agentId);
          if (agent) {
            agent.resize(msg.cols, msg.rows);
          }
        }
        break;
    }
  }

  private broadcast(msg: any, filter: (c: ClientConnection) => boolean): void {
    const payload = JSON.stringify(msg);
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN && filter(client)) {
        client.ws.send(payload);
      }
    }
  }

  private broadcastAll(msg: any): void {
    this.broadcast(msg, () => true);
  }
}
