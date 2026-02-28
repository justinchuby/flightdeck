import { EventEmitter } from 'events';
import { Agent } from './Agent.js';
import type { AgentContextInfo } from './Agent.js';
import type { Role, RoleRegistry } from './RoleRegistry.js';
import type { ServerConfig } from '../config.js';
import type { FileLockRegistry } from '../coordination/FileLockRegistry.js';
import type { ActivityLedger } from '../coordination/ActivityLedger.js';
import type { MessageBus } from '../comms/MessageBus.js';
import type { DecisionLog } from '../coordination/DecisionLog.js';
import type { AgentMemory } from './AgentMemory.js';
import type { ChatGroupRegistry } from '../comms/ChatGroupRegistry.js';
import { TaskDAG } from '../tasks/TaskDAG.js';
import { logger } from '../utils/logger.js';
import { writeAgentFiles } from './agentFiles.js';
import { CommandDispatcher } from './CommandDispatcher.js';
import { HeartbeatMonitor } from './HeartbeatMonitor.js';

// Re-export Delegation so existing consumers (api.ts, etc.) continue to work
export type { Delegation } from './CommandDispatcher.js';

export class AgentManager extends EventEmitter {
  private agents: Map<string, Agent> = new Map();
  private config: ServerConfig;
  private roleRegistry: RoleRegistry;
  private maxConcurrent: number;
  private lockRegistry: FileLockRegistry;
  private activityLedger: ActivityLedger;
  private messageBus: MessageBus;
  private decisionLog: DecisionLog;
  private agentMemory: AgentMemory;
  private chatGroupRegistry: ChatGroupRegistry;
  private taskDAG: TaskDAG;
  /** If set, auto-kill agents after this many ms past the initial hung detection */
  private autoKillTimeoutMs: number | null;
  private hungTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private crashCounts: Map<string, number> = new Map();
  private maxRestarts: number;
  private autoRestart: boolean;
  private dispatcher: CommandDispatcher;
  private heartbeat: HeartbeatMonitor;

  constructor(
    config: ServerConfig,
    roleRegistry: RoleRegistry,
    lockRegistry: FileLockRegistry,
    activityLedger: ActivityLedger,
    messageBus: MessageBus,
    decisionLog: DecisionLog,
    agentMemory: AgentMemory,
    chatGroupRegistry: ChatGroupRegistry,
    taskDAG: TaskDAG,
    { maxRestarts = 3, autoRestart = true }: { maxRestarts?: number; autoRestart?: boolean } = {},
  ) {
    super();
    this.config = config;
    this.roleRegistry = roleRegistry;
    this.lockRegistry = lockRegistry;
    this.activityLedger = activityLedger;
    this.messageBus = messageBus;
    this.decisionLog = decisionLog;
    this.agentMemory = agentMemory;
    this.chatGroupRegistry = chatGroupRegistry;
    this.taskDAG = taskDAG;
    this.maxConcurrent = config.maxConcurrentAgents;
    this.maxRestarts = maxRestarts;
    this.autoRestart = autoRestart;
    this.autoKillTimeoutMs = null;

    this.dispatcher = new CommandDispatcher({
      getAgent: (id) => this.agents.get(id),
      getAllAgents: () => this.getAll(),
      getRunningCount: () => this.getRunningCount(),
      spawnAgent: (role, task, parentId, autopilot, model, cwd) => this.spawn(role, task, parentId, autopilot, model, cwd),
      killAgent: (id) => this.kill(id),
      emit: (event, ...args) => this.emit(event, ...args),
      roleRegistry: this.roleRegistry,
      config: this.config,
      lockRegistry: this.lockRegistry,
      activityLedger: this.activityLedger,
      messageBus: this.messageBus,
      decisionLog: this.decisionLog,
      agentMemory: this.agentMemory,
      chatGroupRegistry: this.chatGroupRegistry,
      taskDAG: this.taskDAG,
      maxConcurrent: this.maxConcurrent,
    });

    // Start heartbeat monitor to detect stalled teams
    this.heartbeat = new HeartbeatMonitor({
      getAllAgents: () => this.getAll(),
      getDelegationsMap: () => this.dispatcher.getDelegationsMap(),
      emit: (event, ...args) => this.emit(event, ...args),
    });
    this.heartbeat.start();

    // Write .agent.md files for all roles so Copilot CLI can load them
    writeAgentFiles(this.roleRegistry.getAll());

    // Route incoming bus messages to target agents
    this.messageBus.on('message', (msg) => {
      if (msg.to === '*') return; // broadcasts handled elsewhere
      const target = this.agents.get(msg.to);
      if (target && (target.status === 'running' || target.status === 'idle')) {
        const fromAgent = this.agents.get(msg.from);
        const fromLabel = fromAgent ? `${fromAgent.role.name} (${msg.from.slice(0, 8)})` : msg.from.slice(0, 8);
        logger.info('message', `Delivering: ${fromLabel} → ${target.role.name} (${msg.to.slice(0, 8)})`, {
          contentPreview: msg.content.slice(0, 80),
        });
        target.sendMessage(`[Message from ${fromLabel}]: ${msg.content}`);
      } else {
        logger.warn('message', `Delivery failed — target not found/running: ${msg.to.slice(0, 8)}`);
      }
    });
  }

  spawn(role: Role, task?: string, parentId?: string, autopilot?: boolean, model?: string, cwd?: string, resumeSessionId?: string, id?: string): Agent {
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
      task: a.task,
      lockedFiles: [],
      model: a.model,
      parentId: a.parentId,
    }));

    // For lead agents, inject dynamic role list (including custom roles) before creating
    let effectiveRole = role;
    if (role.id === 'lead') {
      const roleList = this.roleRegistry.generateRoleList();
      effectiveRole = { ...role, systemPrompt: role.systemPrompt.replace('{{ROLE_LIST}}', roleList) };
    }

    const agent = new Agent(effectiveRole, this.config, task, parentId, peers, autopilot, id);
    if (model) agent.model = model;
    if (cwd) agent.cwd = cwd;
    if (resumeSessionId) agent.resumeSessionId = resumeSessionId;
    if (role.id === 'lead') {
      agent.budget = { maxConcurrent: this.maxConcurrent, runningCount: this.getRunningCount() + 1 };
    }

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
      this.emit('agent:text', agent.id, data);
      // Buffer ACP text and scan for complete command patterns
      this.dispatcher.appendToBuffer(agent.id, data);
      this.dispatcher.scanBuffer(agent);
    });

    agent.onToolCall((info) => {
      this.emit('agent:tool_call', { agentId: agent.id, toolCall: info });
    });

    agent.onContent((content) => {
      this.emit('agent:content', { agentId: agent.id, content });
    });

    agent.onPlan((entries) => {
      this.emit('agent:plan', { agentId: agent.id, plan: entries });
    });

    agent.onPermissionRequest((request) => {
      this.emit('agent:permission_request', { agentId: agent.id, request });
    });

    // When an agent's session is established, broadcast session ID
    agent.onSessionReady((sessionId) => {
      this.emit('agent:session_ready', { agentId: agent.id, sessionId });

      // Also report to parent lead so it can resume this agent later
      if (agent.parentId) {
        this.agentMemory.store(agent.parentId, agent.id, 'sessionId', sessionId);
        const parent = this.agents.get(agent.parentId);
        if (parent && (parent.status === 'running' || parent.status === 'idle')) {
          const msg = `[System] ${agent.role.name} (${agent.id.slice(0, 8)}) session ready: ${sessionId}`;
          parent.sendMessage(msg);
          this.emit('agent:message_sent', {
            from: agent.id,
            fromRole: agent.role.name,
            to: parent.id,
            toRole: parent.role.name,
            content: msg,
          });
        }
      }
    });

    agent.onContextCompacted((info) => {
      logger.info('agent', `Context compacted for ${agent.role.name} (${agent.id.slice(0, 8)}): ${info.percentDrop}% reduction`);
      this.emit('agent:context_compacted', { agentId: agent.id, ...info });
    });

    agent.onStatus((status) => {
      this.emit('agent:status', { agentId: agent.id, status });

      // Track lead idle timing for heartbeat
      if (agent.role.id === 'lead') {
        if (status === 'idle') {
          this.heartbeat.trackIdle(agent.id);
        } else if (status === 'running') {
          this.heartbeat.trackActive(agent.id);
        }
      }

      // When a child agent goes idle (prompt complete), notify its parent
      if (status === 'idle' && agent.parentId) {
        this.dispatcher.notifyParentOfIdle(agent);
      }
    });

    agent.onExit((code) => {
      this.clearHungTimer(agent.id);
      this.dispatcher.clearBuffer(agent.id);
      logger.info('agent', `Exited ${agent.role.name} (${agent.id.slice(0, 8)}) code=${code}`, {
        role: agent.role.id,
        status: agent.status,
      });
      this.emit('agent:exit', agent.id, code);

      // Release any file locks held by the exiting agent
      const releasedCount = this.lockRegistry.releaseAll(agent.id);
      if (releasedCount > 0) {
        logger.info('lock', `Auto-released ${releasedCount} lock(s) for exiting agent ${agent.id.slice(0, 8)}`);
      }

      // Notify parent agent of child completion
      this.dispatcher.notifyParentOfCompletion(agent, code);

      // Clean up dedup tracking after a delay
      setTimeout(() => {
        this.dispatcher.clearCompletionTracking(agent.id);
      }, 10000);

      if (code !== null && code !== 0) {
        const agentRole = agent.role?.id ?? 'unknown';
        const crashKey = `${agentRole}:${agent.task ?? ''}`;

        logger.error('agent', `Crashed ${agent.role.name} (${agent.id.slice(0, 8)}) exit=${code}`, { crashKey });
        this.activityLedger.log(agent.id, agentRole, 'error', `Agent crashed with exit code ${code}`);
        this.emit('agent:crashed', { agentId: agent.id, code });

        const count = (this.crashCounts.get(crashKey) ?? 0) + 1;
        this.crashCounts.set(crashKey, count);

        if (this.autoRestart && count < this.maxRestarts) {
          logger.warn('agent', `Auto-restarting ${agent.role.name} (attempt ${count + 1}/${this.maxRestarts})`);
          setTimeout(() => {
            const newAgent = this.spawn(agent.role, agent.task, agent.parentId, undefined, agent.model || undefined, agent.cwd, agent.sessionId || undefined);
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
      autopilot: agent.autopilot,
      parentId: parentId?.slice(0, 8),
      task,
    });
    this.emit('agent:spawned', agent.toJSON());
    this.updateLeadBudgets();
    return agent;
  }

  kill(id: string): boolean {
    const agent = this.agents.get(id);
    if (!agent) return false;
    this.clearHungTimer(id);
    // Release any file locks held by the killed agent
    const releasedCount = this.lockRegistry.releaseAll(id);
    if (releasedCount > 0) {
      logger.info('lock', `Auto-released ${releasedCount} lock(s) for killed agent ${id.slice(0, 8)}`);
    }
    agent.kill();
    this.emit('agent:killed', id);
    this.updateLeadBudgets();
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
    const { role, task, sessionId, parentId, model, cwd } = agent;
    agent.kill();
    this.agents.delete(id);
    // Re-spawn with same ID and resume the session if available
    const newAgent = this.spawn(role, task, parentId, undefined, model || undefined, cwd, sessionId || undefined, id);
    this.emit('agent:restarted', { oldId: id, newAgent: newAgent.toJSON() });
    return newAgent;
  }

  setMaxConcurrent(n: number): void {
    const old = this.maxConcurrent;
    this.maxConcurrent = n;
    if (n !== old) {
      // Notify all running leads about the change
      const running = this.getRunningCount();
      const available = Math.max(0, n - running);
      for (const agent of this.getAll()) {
        if (agent.role.id === 'lead' && (agent.status === 'running' || agent.status === 'idle')) {
          agent.budget = { maxConcurrent: n, runningCount: running };
          agent.sendMessage(`[System] Agent concurrency limit changed: ${old} → ${n}. You now have ${available} available slot(s) (${running} running).`);
        }
      }
    }
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
    this.heartbeat.stop();
    for (const agent of this.agents.values()) {
      if (agent.status === 'running') {
        agent.kill();
      }
    }
  }

  getDelegations(parentId?: string): import('./CommandDispatcher.js').Delegation[] {
    return this.dispatcher.getDelegations(parentId);
  }

  getDecisionLog(): DecisionLog {
    return this.decisionLog;
  }

  getMessageBus(): MessageBus {
    return this.messageBus;
  }

  getChatGroupRegistry(): ChatGroupRegistry {
    return this.chatGroupRegistry;
  }

  getTaskDAG(): TaskDAG {
    return this.taskDAG;
  }

  /** Keep all lead agents' budget info in sync with current state */
  private updateLeadBudgets(): void {
    const running = this.getRunningCount();
    for (const agent of this.getAll()) {
      if (agent.role.id === 'lead') {
        agent.budget = { maxConcurrent: this.maxConcurrent, runningCount: running };
      }
    }
  }
}
