import { EventEmitter } from 'events';
import { Agent } from './Agent.js';
import type { Role, RoleRegistry } from './RoleRegistry.js';
import type { ServerConfig } from '../config.js';

// JSON pattern agents can emit to request sub-agent spawning
const SPAWN_REQUEST_REGEX = /<!--\s*SPAWN_AGENT\s*(\{.*?\})\s*-->/s;

export class AgentManager extends EventEmitter {
  private agents: Map<string, Agent> = new Map();
  private config: ServerConfig;
  private roleRegistry: RoleRegistry;
  private maxConcurrent: number;

  constructor(config: ServerConfig, roleRegistry: RoleRegistry) {
    super();
    this.config = config;
    this.roleRegistry = roleRegistry;
    this.maxConcurrent = config.maxConcurrentAgents;
  }

  spawn(role: Role, taskId?: string, parentId?: string): Agent {
    if (this.getRunningCount() >= this.maxConcurrent) {
      throw new Error(
        `Concurrency limit reached (${this.maxConcurrent}). Kill an agent or increase the limit.`,
      );
    }

    const agent = new Agent(role, this.config, taskId, parentId);

    // Track parent-child relationship
    if (parentId) {
      const parent = this.agents.get(parentId);
      if (parent) {
        parent.childIds.push(agent.id);
      }
    }

    this.agents.set(agent.id, agent);

    // Listen for data to detect sub-agent spawn requests
    agent.onData((data) => {
      this.emit('agent:data', agent.id, data);
      this.detectSpawnRequest(agent.id, data);
    });

    agent.onExit((code) => {
      this.emit('agent:exit', agent.id, code);
    });

    agent.start();
    this.emit('agent:spawned', agent.toJSON());
    return agent;
  }

  kill(id: string): boolean {
    const agent = this.agents.get(id);
    if (!agent) return false;
    agent.kill();
    this.emit('agent:killed', id);
    return true;
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  getAll(): Agent[] {
    return Array.from(this.agents.values());
  }

  getRunningCount(): number {
    return this.getAll().filter((a) => a.status === 'running' || a.status === 'creating').length;
  }

  setMaxConcurrent(n: number): void {
    this.maxConcurrent = n;
  }

  shutdownAll(): void {
    for (const agent of this.agents.values()) {
      if (agent.status === 'running') {
        agent.kill();
      }
    }
  }

  private detectSpawnRequest(agentId: string, data: string): void {
    const match = data.match(SPAWN_REQUEST_REGEX);
    if (!match) return;

    try {
      const request = JSON.parse(match[1]);
      const role = this.roleRegistry.get(request.roleId);
      if (!role) {
        this.emit('agent:spawn_error', agentId, `Unknown role: ${request.roleId}`);
        return;
      }
      const child = this.spawn(role, request.taskId, agentId);
      this.emit('agent:sub_spawned', agentId, child.toJSON());
    } catch (err: any) {
      this.emit('agent:spawn_error', agentId, err.message);
    }
  }
}
