import { EventEmitter } from 'events';
import { Agent } from './Agent.js';
import type { AgentContextInfo, AgentMode } from './Agent.js';
import type { Role, RoleRegistry } from './RoleRegistry.js';
import type { ServerConfig } from '../config.js';
import type { FileLockRegistry } from '../coordination/FileLockRegistry.js';
import type { ActivityLedger } from '../coordination/ActivityLedger.js';
import type { MessageBus } from '../comms/MessageBus.js';
import type { DecisionLog } from '../coordination/DecisionLog.js';
import { logger } from '../utils/logger.js';

// JSON pattern agents can emit to request sub-agent spawning
const SPAWN_REQUEST_REGEX = /<!--\s*SPAWN_AGENT\s*(\{.*?\})\s*-->/s;
const LOCK_REQUEST_REGEX = /<!--\s*LOCK_REQUEST\s*(\{.*?\})\s*-->/s;
const LOCK_RELEASE_REGEX = /<!--\s*LOCK_RELEASE\s*(\{.*?\})\s*-->/s;
const ACTIVITY_REGEX = /<!--\s*ACTIVITY\s*(\{.*?\})\s*-->/s;
const AGENT_MESSAGE_REGEX = /<!--\s*AGENT_MESSAGE\s*(\{.*?\})\s*-->/s;
const DELEGATE_REGEX = /<!--\s*DELEGATE\s*(\{.*?\})\s*-->/s;
const DECISION_REGEX = /<!--\s*DECISION\s*(\{.*?\})\s*-->/s;
const PROGRESS_REGEX = /<!--\s*PROGRESS\s*(\{.*?\})\s*-->/s;

export interface Delegation {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  toRole: string;
  task: string;
  context?: string;
  status: 'active' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  result?: string;
}

export class AgentManager extends EventEmitter {
  private agents: Map<string, Agent> = new Map();
  private config: ServerConfig;
  private roleRegistry: RoleRegistry;
  private maxConcurrent: number;
  private lockRegistry: FileLockRegistry;
  private activityLedger: ActivityLedger;
  private messageBus: MessageBus;
  private decisionLog: DecisionLog;
  /** If set, auto-kill agents after this many ms past the initial hung detection */
  private autoKillTimeoutMs: number | null;
  private hungTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private crashCounts: Map<string, number> = new Map();
  private maxRestarts: number;
  private autoRestart: boolean;
  private delegations: Map<string, Delegation> = new Map();
  /** Buffer ACP text chunks per agent so we can match multi-token command patterns */
  private textBuffers: Map<string, string> = new Map();

  constructor(
    config: ServerConfig,
    roleRegistry: RoleRegistry,
    lockRegistry: FileLockRegistry,
    activityLedger: ActivityLedger,
    messageBus: MessageBus,
    decisionLog: DecisionLog,
    { maxRestarts = 3, autoRestart = true }: { maxRestarts?: number; autoRestart?: boolean } = {},
  ) {
    super();
    this.config = config;
    this.roleRegistry = roleRegistry;
    this.lockRegistry = lockRegistry;
    this.activityLedger = activityLedger;
    this.messageBus = messageBus;
    this.decisionLog = decisionLog;
    this.maxConcurrent = config.maxConcurrentAgents;
    this.maxRestarts = maxRestarts;
    this.autoRestart = autoRestart;
    this.autoKillTimeoutMs = null;

    // Route incoming bus messages to target agents
    this.messageBus.on('message', (msg) => {
      if (msg.to === '*') return; // broadcasts handled elsewhere
      const target = this.agents.get(msg.to);
      if (target && target.status === 'running') {
        const fromAgent = this.agents.get(msg.from);
        const fromLabel = fromAgent ? `${fromAgent.role.name} (${msg.from.slice(0, 8)})` : msg.from.slice(0, 8);
        logger.info('message', `${fromLabel} → ${target.role.name} (${msg.to.slice(0, 8)})`, {
          contentPreview: msg.content.slice(0, 80),
        });
        target.sendMessage(`[Message from ${fromLabel}]: ${msg.content}`);
      } else {
        logger.warn('message', `Target agent not found or not running: ${msg.to.slice(0, 8)}`);
      }
    });
  }

  spawn(role: Role, taskId?: string, parentId?: string, mode?: AgentMode, autopilot?: boolean): Agent {
    if (this.getRunningCount() >= this.maxConcurrent) {
      logger.error('agent', `Concurrency limit reached (${this.maxConcurrent})`, { role: role.id });
      throw new Error(
        `Concurrency limit reached (${this.maxConcurrent}). Kill an agent or increase the limit.`,
      );
    }

    const peers: AgentContextInfo[] = this.getAll().map((a) => ({
      id: a.id,
      role: a.role.id,
      roleName: a.role.name,
      status: a.status,
      taskId: a.taskId,
      lockedFiles: [],
    }));

    const agent = new Agent(role, this.config, taskId, parentId, peers, mode, autopilot);

    // Track parent-child relationship
    if (parentId) {
      const parent = this.agents.get(parentId);
      if (parent) {
        parent.childIds.push(agent.id);
      }
    }

    this.agents.set(agent.id, agent);

    // Listen for data to detect sub-agent spawn requests and coordination commands
    agent.onData((data) => {
      if (agent.mode === 'acp') {
        this.emit('agent:text', agent.id, data);
        // Buffer ACP text and scan for complete command patterns
        const buf = (this.textBuffers.get(agent.id) || '') + data;
        this.textBuffers.set(agent.id, buf);
        this.scanBuffer(agent);
      } else {
        this.emit('agent:data', agent.id, data);
        // PTY data arrives in larger chunks — match directly
        this.detectSpawnRequest(agent.id, data);
        this.detectLockRequest(agent, data);
        this.detectLockRelease(agent, data);
        this.detectActivity(agent, data);
        this.detectAgentMessage(agent, data);
        this.detectDelegate(agent, data);
        this.detectDecision(agent, data);
        this.detectProgress(agent, data);
      }
    });

    agent.onToolCall((info) => {
      this.emit('agent:tool_call', { agentId: agent.id, toolCall: info });
    });

    agent.onPlan((entries) => {
      this.emit('agent:plan', { agentId: agent.id, plan: entries });
    });

    agent.onPermissionRequest((request) => {
      this.emit('agent:permission_request', { agentId: agent.id, request });
    });

    agent.onExit((code) => {
      this.clearHungTimer(agent.id);
      this.textBuffers.delete(agent.id);
      logger.info('agent', `Exited ${agent.role.name} (${agent.id.slice(0, 8)}) code=${code}`, {
        role: agent.role.id,
        status: agent.status,
      });
      this.emit('agent:exit', agent.id, code);

      // Notify parent agent of child completion
      this.notifyParentOfCompletion(agent, code);

      if (code !== null && code !== 0) {
        const agentRole = agent.role?.id ?? 'unknown';
        const crashKey = `${agentRole}:${agent.taskId ?? ''}`;

        logger.error('agent', `Crashed ${agent.role.name} (${agent.id.slice(0, 8)}) exit=${code}`, { crashKey });
        this.activityLedger.log(agent.id, agentRole, 'error', `Agent crashed with exit code ${code}`);
        this.emit('agent:crashed', { agentId: agent.id, code });

        const count = (this.crashCounts.get(crashKey) ?? 0) + 1;
        this.crashCounts.set(crashKey, count);

        if (this.autoRestart && count < this.maxRestarts) {
          logger.warn('agent', `Auto-restarting ${agent.role.name} (attempt ${count + 1}/${this.maxRestarts})`);
          setTimeout(() => {
            const newAgent = this.spawn(agent.role, agent.taskId, agent.parentId);
            this.emit('agent:auto_restarted', { agentId: newAgent.id, previousAgentId: agent.id, crashCount: count });
          }, 2000);
        } else if (count >= this.maxRestarts) {
          logger.error('agent', `Restart limit reached for ${agent.role.name} (${this.maxRestarts} restarts)`);
          this.emit('agent:restart_limit', { agentId: agent.id });
        }
      }
    });

    agent.onHung((elapsedMs) => {
      this.emit('agent:hung', { agentId: agent.id, elapsedMs });

      if (this.autoKillTimeoutMs !== null && !this.hungTimers.has(agent.id)) {
        const timer = setTimeout(() => {
          this.hungTimers.delete(agent.id);
          if (agent.status === 'idle') {
            this.kill(agent.id);
            this.emit('agent:hung_killed', { agentId: agent.id });
          }
        }, this.autoKillTimeoutMs);
        this.hungTimers.set(agent.id, timer);
      }
    });

    agent.start();
    logger.info('agent', `Spawned ${role.name} (${agent.id.slice(0, 8)})`, {
      mode: agent.mode,
      autopilot: agent.autopilot,
      parentId: parentId?.slice(0, 8),
      taskId,
    });
    this.emit('agent:spawned', agent.toJSON());
    return agent;
  }

  kill(id: string): boolean {
    const agent = this.agents.get(id);
    if (!agent) return false;
    this.clearHungTimer(id);
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

  restart(id: string): Agent | null {
    const agent = this.agents.get(id);
    if (!agent) return null;
    const { role, taskId } = agent;
    agent.kill();
    this.agents.delete(id);
    const newAgent = this.spawn(role, taskId);
    this.emit('agent:restarted', { oldId: id, newAgent: newAgent.toJSON() });
    return newAgent;
  }

  setMaxConcurrent(n: number): void {
    this.maxConcurrent = n;
  }

  getRoleRegistry(): RoleRegistry {
    return this.roleRegistry;
  }

  setAutoRestart(enabled: boolean): void {
    this.autoRestart = enabled;
  }

  setMaxRestarts(n: number): void {
    this.maxRestarts = n;
  }

  /** Set auto-kill timeout (ms) for hung agents. Pass null to disable. */
  setAutoKillTimeout(ms: number | null): void {
    this.autoKillTimeoutMs = ms;
  }

  resolvePermission(agentId: string, approved: boolean): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.resolvePermission(approved);
    return true;
  }

  private clearHungTimer(agentId: string): void {
    const timer = this.hungTimers.get(agentId);
    if (timer) {
      clearTimeout(timer);
      this.hungTimers.delete(agentId);
    }
  }

  shutdownAll(): void {
    for (const agent of this.agents.values()) {
      if (agent.status === 'running') {
        agent.kill();
      }
    }
  }

  /**
   * Scan accumulated text buffer for complete command patterns.
   * When a pattern is found, execute it and remove it from the buffer.
   * Keep only trailing text that might be the start of a new command.
   */
  private scanBuffer(agent: Agent): void {
    let buf = this.textBuffers.get(agent.id) || '';
    if (!buf) return;

    const patterns: Array<{ regex: RegExp; handler: (agent: Agent, data: string) => void }> = [
      { regex: SPAWN_REQUEST_REGEX, handler: (a, d) => this.detectSpawnRequest(a.id, d) },
      { regex: LOCK_REQUEST_REGEX, handler: (a, d) => this.detectLockRequest(a, d) },
      { regex: LOCK_RELEASE_REGEX, handler: (a, d) => this.detectLockRelease(a, d) },
      { regex: ACTIVITY_REGEX, handler: (a, d) => this.detectActivity(a, d) },
      { regex: AGENT_MESSAGE_REGEX, handler: (a, d) => this.detectAgentMessage(a, d) },
      { regex: DELEGATE_REGEX, handler: (a, d) => this.detectDelegate(a, d) },
      { regex: DECISION_REGEX, handler: (a, d) => this.detectDecision(a, d) },
      { regex: PROGRESS_REGEX, handler: (a, d) => this.detectProgress(a, d) },
    ];

    let found = true;
    while (found) {
      found = false;
      for (const { regex, handler } of patterns) {
        const match = buf.match(regex);
        if (match) {
          handler(agent, match[0]);
          buf = buf.slice(0, match.index!) + buf.slice(match.index! + match[0].length);
          found = true;
        }
      }
    }

    // Keep only last 500 chars that might contain an incomplete command
    const lastOpen = buf.lastIndexOf('<!--');
    if (lastOpen >= 0) {
      // Keep from the last incomplete opening tag
      buf = buf.slice(lastOpen);
    } else if (buf.length > 500) {
      buf = buf.slice(-200);
    }
    this.textBuffers.set(agent.id, buf);
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

  private detectLockRequest(agent: Agent, data: string): void {
    const match = data.match(LOCK_REQUEST_REGEX);
    if (!match) return;

    try {
      const request = JSON.parse(match[1]);
      const agentRole = agent.role?.id ?? 'unknown';
      const result = this.lockRegistry.acquire(agent.id, agentRole, request.filePath, request.reason);
      if (result.ok) {
        this.activityLedger.log(agent.id, agentRole, 'lock_acquired', `Locked ${request.filePath}`, {
          filePath: request.filePath,
          reason: request.reason,
        });
      }
    } catch {
      // ignore malformed lock requests
    }
  }

  private detectLockRelease(agent: Agent, data: string): void {
    const match = data.match(LOCK_RELEASE_REGEX);
    if (!match) return;

    try {
      const request = JSON.parse(match[1]);
      const released = this.lockRegistry.release(agent.id, request.filePath);
      if (released) {
        const agentRole = agent.role?.id ?? 'unknown';
        this.activityLedger.log(agent.id, agentRole, 'lock_released', `Released ${request.filePath}`, {
          filePath: request.filePath,
        });
      }
    } catch {
      // ignore malformed lock releases
    }
  }

  private detectActivity(agent: Agent, data: string): void {
    const match = data.match(ACTIVITY_REGEX);
    if (!match) return;

    try {
      const entry = JSON.parse(match[1]);
      const agentRole = agent.role?.id ?? 'unknown';
      this.activityLedger.log(
        agent.id,
        agentRole,
        entry.actionType ?? 'message_sent',
        entry.summary ?? '',
        entry.details ?? {},
      );
    } catch {
      // ignore malformed activity entries
    }
  }

  private detectAgentMessage(agent: Agent, data: string): void {
    const match = data.match(AGENT_MESSAGE_REGEX);
    if (!match) return;

    try {
      const msg = JSON.parse(match[1]);
      if (!msg.to || !msg.content) return;

      // Resolve "to" — could be agent ID or role name
      let targetId = msg.to;
      if (!this.agents.has(targetId)) {
        // Try to find by role
        const byRole = this.getAll().find((a) => a.role.id === msg.to && a.status === 'running');
        if (byRole) targetId = byRole.id;
      }

      this.messageBus.send({
        from: agent.id,
        to: targetId,
        type: 'request',
        content: msg.content,
      });

      logger.info('message', `Agent message: ${agent.role.name} (${agent.id.slice(0, 8)}) → ${targetId.slice(0, 8)}`, {
        contentPreview: msg.content.slice(0, 80),
      });
      this.emit('agent:message_sent', { from: agent.id, to: targetId, content: msg.content });
    } catch {
      // ignore malformed messages
    }
  }

  private detectDelegate(agent: Agent, data: string): void {
    const match = data.match(DELEGATE_REGEX);
    if (!match) return;

    try {
      const req = JSON.parse(match[1]);
      if (!req.to || !req.task) return;

      const role = this.roleRegistry.get(req.to);
      if (!role) {
        this.emit('agent:delegate_error', agent.id, `Unknown role: ${req.to}`);
        return;
      }

      // Spawn child in autopilot mode
      const child = this.spawn(role, req.task, agent.id, 'acp', true);

      logger.info('delegation', `${agent.role.name} (${agent.id.slice(0, 8)}) delegated to ${role.name}: ${req.task.slice(0, 80)}`);

      // Track delegation
      const delegation: Delegation = {
        id: `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fromAgentId: agent.id,
        toAgentId: child.id,
        toRole: role.id,
        task: req.task,
        context: req.context,
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      this.delegations.set(delegation.id, delegation);

      // Send task + context to child
      const taskPrompt = req.context
        ? `${req.task}\n\nContext: ${req.context}`
        : req.task;
      child.sendMessage(taskPrompt);

      const agentRole = agent.role?.id ?? 'unknown';
      this.activityLedger.log(agent.id, agentRole, 'delegated', `Delegated to ${role.name}: ${req.task.slice(0, 100)}`, {
        childId: child.id,
        childRole: role.id,
        delegationId: delegation.id,
      });

      this.emit('agent:delegated', { parentId: agent.id, childId: child.id, delegation });
      this.emit('agent:sub_spawned', agent.id, child.toJSON());
    } catch (err: any) {
      this.emit('agent:delegate_error', agent.id, err.message);
    }
  }

  private detectDecision(agent: Agent, data: string): void {
    const match = data.match(DECISION_REGEX);
    if (!match) return;

    try {
      const decision = JSON.parse(match[1]);
      if (!decision.title) return;

      this.decisionLog.add(agent.id, agent.role?.id ?? 'unknown', decision.title, decision.rationale ?? '');
      logger.info('lead', `Decision: "${decision.title}"`, { rationale: decision.rationale?.slice(0, 100) });
      this.emit('lead:decision', { agentId: agent.id, title: decision.title, rationale: decision.rationale });
    } catch {
      // ignore malformed decisions
    }
  }

  private detectProgress(agent: Agent, data: string): void {
    const match = data.match(PROGRESS_REGEX);
    if (!match) return;

    try {
      const progress = JSON.parse(match[1]);
      logger.info('lead', `Progress update from ${agent.role.name} (${agent.id.slice(0, 8)})`, progress);
      this.emit('lead:progress', { agentId: agent.id, ...progress });
    } catch {
      // ignore malformed progress
    }
  }

  private notifyParentOfCompletion(agent: Agent, exitCode: number | null): void {
    if (!agent.parentId) return;
    const parent = this.agents.get(agent.parentId);
    if (!parent || parent.status !== 'running') return;

    // Update delegation records
    for (const [, del] of this.delegations) {
      if (del.toAgentId === agent.id && del.status === 'active') {
        del.status = exitCode === 0 ? 'completed' : 'failed';
        del.completedAt = new Date().toISOString();
        del.result = agent.messages.slice(-3).join('\n').slice(0, 500);
      }
    }

    const status = exitCode === 0 ? 'completed successfully' : `failed (exit code ${exitCode})`;
    const preview = agent.messages.slice(-3).join('\n').slice(0, 300);
    const summary = `[Agent Report] ${agent.role.name} (${agent.id.slice(0, 8)}) ${status}.\nTask: ${agent.taskId || 'none'}\nOutput summary: ${preview || '(no output)'}`;

    logger.info('delegation', `Child ${agent.role.name} (${agent.id.slice(0, 8)}) → parent ${parent.role.name} (${parent.id.slice(0, 8)}): ${status}`);
    parent.sendMessage(summary);
    this.emit('agent:message_sent', { from: agent.id, to: parent.id, content: summary });
    this.emit('agent:completion_reported', { childId: agent.id, parentId: agent.parentId, status });
  }

  getDelegations(parentId?: string): Delegation[] {
    const all = Array.from(this.delegations.values());
    return parentId ? all.filter((d) => d.fromAgentId === parentId) : all;
  }

  getDecisionLog(): DecisionLog {
    return this.decisionLog;
  }

  getMessageBus(): MessageBus {
    return this.messageBus;
  }
}
