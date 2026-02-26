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
const QUERY_CREW_REGEX = /<!--\s*QUERY_CREW\s*-->/s;
const BROADCAST_REGEX = /<!--\s*BROADCAST\s*(\{.*?\})\s*-->/s;

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
  /** Heartbeat: track when each lead went idle and consecutive nudge count */
  private leadIdleSince: Map<string, number> = new Map();
  private leadNudgeCount: Map<string, number> = new Map();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

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

    // Start heartbeat timer to detect stalled teams
    this.heartbeatTimer = setInterval(() => this.heartbeatCheck(), 120_000);

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

  spawn(role: Role, taskId?: string, parentId?: string, mode?: AgentMode, autopilot?: boolean, model?: string, cwd?: string): Agent {
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
    if (model) agent.model = model;
    if (cwd) agent.cwd = cwd;

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

    agent.onContent((content) => {
      this.emit('agent:content', { agentId: agent.id, content });
    });

    agent.onPlan((entries) => {
      this.emit('agent:plan', { agentId: agent.id, plan: entries });
    });

    agent.onPermissionRequest((request) => {
      this.emit('agent:permission_request', { agentId: agent.id, request });
    });

    agent.onStatus((status) => {
      this.emit('agent:status', { agentId: agent.id, status });

      // Track lead idle timing for heartbeat
      if (agent.role.id === 'lead') {
        if (status === 'idle') {
          this.leadIdleSince.set(agent.id, Date.now());
        } else if (status === 'running') {
          this.leadIdleSince.delete(agent.id);
          this.leadNudgeCount.set(agent.id, 0);
        }
      }

      // When a child agent goes idle (prompt complete), notify its parent
      if (status === 'idle' && agent.parentId) {
        this.notifyParentOfIdle(agent);
      }
    });

    agent.onExit((code) => {
      this.clearHungTimer(agent.id);
      this.textBuffers.delete(agent.id);
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
            const newAgent = this.spawn(agent.role, agent.taskId, agent.parentId, undefined, undefined, undefined, agent.cwd);
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
    // Release any file locks held by the killed agent
    const releasedCount = this.lockRegistry.releaseAll(id);
    if (releasedCount > 0) {
      logger.info('lock', `Auto-released ${releasedCount} lock(s) for killed agent ${id.slice(0, 8)}`);
    }
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
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const agent of this.agents.values()) {
      if (agent.status === 'running') {
        agent.kill();
      }
    }
  }

  /** Periodic heartbeat check: detect stalled teams and nudge the lead */
  private heartbeatCheck(): void {
    const leads = this.getAll().filter((a) => a.role.id === 'lead' && a.status === 'idle');

    for (const lead of leads) {
      const idleSince = this.leadIdleSince.get(lead.id);
      if (!idleSince) continue;

      // Don't nudge if lead went idle less than 60s ago
      const idleDuration = Date.now() - idleSince;
      if (idleDuration < 60_000) continue;

      // Find children of this lead
      const children = this.getAll().filter((a) => a.parentId === lead.id);
      if (children.length === 0) continue; // no team → legitimately idle

      // If any child is still running, work is in progress — wait
      const anyRunning = children.some((a) => a.status === 'running');
      if (anyRunning) continue;

      // Check if there are active (incomplete) delegations — if none, work is done
      const activeDelegations = Array.from(this.delegations.values()).filter(
        (d) => d.fromAgentId === lead.id && d.status === 'active'
      );
      if (activeDelegations.length === 0) continue; // all delegations completed → legitimately idle

      // All children are idle/completed but there are uncompleted delegations — team is stalled
      const idleChildren = children.filter((a) => a.status === 'idle');
      const completedChildren = children.filter((a) => a.status === 'completed' || a.status === 'failed');

      const nudgeCount = (this.leadNudgeCount.get(lead.id) ?? 0) + 1;
      this.leadNudgeCount.set(lead.id, nudgeCount);

      const roster = children.map((c) => `  - ${c.role.name} (${c.id.slice(0, 8)}): ${c.status}`).join('\n');
      const nudge = `[System Heartbeat] Your team appears stalled — you've been idle for ${Math.floor(idleDuration / 1000)}s. ` +
        `${idleChildren.length} agents idle, ${completedChildren.length} completed/failed, ${activeDelegations.length} active delegations.\n` +
        `Team status:\n${roster}\n` +
        `Please review agent reports and continue: delegate reviews, assign next tasks, or report final results to the user.`;

      logger.warn('lead', `Heartbeat nudge #${nudgeCount} → ${lead.role.name} (${lead.id.slice(0, 8)}): idle ${Math.floor(idleDuration / 1000)}s, ${children.length} children`);
      lead.sendMessage(nudge);

      this.emit('agent:message_sent', {
        from: 'system',
        fromRole: 'System',
        to: lead.id,
        toRole: lead.role.name,
        content: nudge,
      });

      // Escalate after 2 consecutive nudges
      if (nudgeCount >= 2) {
        logger.error('lead', `Lead ${lead.id.slice(0, 8)} stalled after ${nudgeCount} nudges`);
        this.emit('lead:stalled', { leadId: lead.id, nudgeCount, idleDuration });
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

    const patterns: Array<{ regex: RegExp; name: string; handler: (agent: Agent, data: string) => void }> = [
      { regex: SPAWN_REQUEST_REGEX, name: 'SPAWN', handler: (a, d) => this.detectSpawnRequest(a.id, d) },
      { regex: LOCK_REQUEST_REGEX, name: 'LOCK', handler: (a, d) => this.detectLockRequest(a, d) },
      { regex: LOCK_RELEASE_REGEX, name: 'UNLOCK', handler: (a, d) => this.detectLockRelease(a, d) },
      { regex: ACTIVITY_REGEX, name: 'ACTIVITY', handler: (a, d) => this.detectActivity(a, d) },
      { regex: AGENT_MESSAGE_REGEX, name: 'AGENT_MSG', handler: (a, d) => this.detectAgentMessage(a, d) },
      { regex: DELEGATE_REGEX, name: 'DELEGATE', handler: (a, d) => this.detectDelegate(a, d) },
      { regex: DECISION_REGEX, name: 'DECISION', handler: (a, d) => this.detectDecision(a, d) },
      { regex: PROGRESS_REGEX, name: 'PROGRESS', handler: (a, d) => this.detectProgress(a, d) },
      { regex: QUERY_CREW_REGEX, name: 'QUERY_CREW', handler: (a, _d) => this.handleQueryCrew(a) },
      { regex: BROADCAST_REGEX, name: 'BROADCAST', handler: (a, d) => this.detectBroadcast(a, d) },
    ];

    let found = true;
    while (found) {
      found = false;
      for (const { regex, name, handler } of patterns) {
        const match = buf.match(regex);
        if (match) {
          logger.info('agent', `Command detected: ${name} from ${agent.role.name} (${agent.id.slice(0, 8)})`, {
            matchPreview: match[0].slice(0, 120),
          });
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

    // Debug: periodically log buffer state for lead agents
    if (agent.role.id === 'lead' && buf.length > 10) {
      logger.debug('agent', `Buffer for ${agent.id.slice(0, 8)} (${buf.length} chars)`, {
        tail: buf.slice(-150),
      });
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
      const parentAgent = this.agents.get(agentId);
      const child = this.spawn(role, request.taskId, agentId, undefined, undefined, undefined, parentAgent?.cwd);
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
        agent.sendMessage(`[System] Lock acquired on \`${request.filePath}\`. You may proceed with edits. Remember to release it when done with <!-- LOCK_RELEASE {"filePath": "${request.filePath}"} -->`);
      } else {
        const holderShort = result.holder?.slice(0, 8) ?? 'unknown';
        agent.sendMessage(`[System] Lock DENIED on \`${request.filePath}\` — currently held by agent ${holderShort}. Wait for them to release it, or coordinate via AGENT_MESSAGE.`);
        this.activityLedger.log(agent.id, agentRole, 'lock_denied', `Lock denied on ${request.filePath} (held by ${holderShort})`, {
          filePath: request.filePath,
          holder: result.holder,
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
        agent.sendMessage(`[System] Lock released on \`${request.filePath}\`.`);
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

      // Resolve "to" — could be full UUID, short ID prefix, role ID, or role name
      let targetId = msg.to;
      if (!this.agents.has(targetId)) {
        // Try short ID prefix match (agents see 8-char prefixes in context)
        const byPrefix = this.getAll().find((a) => a.id.startsWith(msg.to) && (a.status === 'running' || a.status === 'idle'));
        if (byPrefix) {
          targetId = byPrefix.id;
        } else {
          // Try to find by role ID
          const byRoleId = this.getAll().find((a) => a.role.id === msg.to && (a.status === 'running' || a.status === 'idle'));
          if (byRoleId) {
            targetId = byRoleId.id;
          } else {
            // Try by role name (case-insensitive)
            const lower = msg.to.toLowerCase();
            const byRoleName = this.getAll().find((a) =>
              a.role.name.toLowerCase() === lower && (a.status === 'running' || a.status === 'idle')
            );
            if (byRoleName) {
              targetId = byRoleName.id;
            } else {
              // Try partial match on role
              const partial = this.getAll().find((a) =>
                (a.role.id.includes(lower) || a.role.name.toLowerCase().includes(lower)) && (a.status === 'running' || a.status === 'idle')
              );
              if (partial) targetId = partial.id;
            }
          }
        }
      }

      const targetAgent = this.agents.get(targetId);
      if (!targetAgent) {
        logger.warn('message', `Cannot resolve target "${msg.to}" for message from ${agent.role.name} (${agent.id.slice(0, 8)})`);
        return;
      }

      this.messageBus.send({
        from: agent.id,
        to: targetId,
        type: 'request',
        content: msg.content,
      });

      logger.info('message', `Agent message: ${agent.role.name} (${agent.id.slice(0, 8)}) → ${targetAgent.role.name} (${targetId.slice(0, 8)})`, {
        contentPreview: msg.content.slice(0, 80),
      });
      this.emit('agent:message_sent', {
        from: agent.id,
        fromRole: agent.role.name,
        to: targetId,
        toRole: targetAgent.role.name,
        content: msg.content,
      });
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

      // Only lead agents can delegate to role agents
      if (agent.role.id !== 'lead') {
        logger.warn('delegation', `Non-lead agent ${agent.role.name} (${agent.id.slice(0, 8)}) attempted DELEGATE — ignoring. Use SPAWN_AGENT for sub-agents.`);
        agent.sendMessage(`[System] Only the Project Lead can delegate to role agents. Use <!-- SPAWN_AGENT {"roleId":"worker","taskId":"your task"} --> to create sub-agents for parallel work.`);
        return;
      }

      const role = this.roleRegistry.get(req.to);
      if (!role) {
        this.emit('agent:delegate_error', agent.id, `Unknown role: ${req.to}`);
        return;
      }

      // Try to reuse an idle agent with the same role under the same lead
      const existingAgent = this.getAll().find((a) =>
        a.role.id === role.id &&
        a.parentId === agent.id &&
        a.status === 'idle' &&
        a.id !== agent.id
      );

      let child: Agent;
      if (existingAgent) {
        child = existingAgent;
        logger.info('delegation', `Reusing idle ${role.name} (${child.id.slice(0, 8)}) for new task from ${agent.role.name}`);
      } else {
        // No idle agent available — spawn a new one, with optional model override from lead
        child = this.spawn(role, req.task, agent.id, 'acp', true, req.model, agent.cwd);
        logger.info('delegation', `${agent.role.name} (${agent.id.slice(0, 8)}) spawned new ${role.name}${req.model ? ` (model: ${req.model})` : ''}: ${req.task.slice(0, 80)}`);
      }

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

      // Acknowledge delegation back to lead so it knows the task was received
      const ackMsg = `[Agent ACK] ${role.name} (${child.id.slice(0, 8)}) acknowledged task: ${req.task.slice(0, 120)}`;
      agent.sendMessage(ackMsg);
      this.emit('agent:message_sent', {
        from: child.id,
        fromRole: role.name,
        to: agent.id,
        toRole: agent.role.name,
        content: ackMsg,
      });

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

  /** Respond to QUERY_CREW with a full roster of active agents and their IDs */
  private handleQueryCrew(agent: Agent): void {
    const roster = this.getAll()
      .filter((a) => a.status !== 'completed' && a.status !== 'failed')
      .map((a) => ({
        id: a.id.slice(0, 8),
        fullId: a.id,
        role: a.role.name,
        roleId: a.role.id,
        status: a.status,
        task: a.taskId?.slice(0, 80) || null,
        parentId: a.parentId?.slice(0, 8) || null,
      }));

    const response = `<!-- CREW_ROSTER
== ACTIVE CREW MEMBERS ==
${roster.map((r) => `- ${r.id} | ${r.role} (${r.roleId}) | Status: ${r.status} | Task: ${r.task || 'idle'}${r.parentId ? ` | Parent: ${r.parentId}` : ''}`).join('\n')}

To message an agent, use their ID (first 8 chars is enough):
<!-- AGENT_MESSAGE {"to": "agent-id", "content": "your message"} -->
CREW_ROSTER -->`;

    logger.info('agent', `QUERY_CREW response sent to ${agent.role.name} (${agent.id.slice(0, 8)}): ${roster.length} agents`);
    agent.sendMessage(response);
  }

  /** Broadcast a message to all active agents under the same lead (siblings + parent) */
  private detectBroadcast(agent: Agent, data: string): void {
    const match = data.match(BROADCAST_REGEX);
    if (!match) return;

    try {
      const msg = JSON.parse(match[1]);
      if (!msg.content) return;

      // Find the lead (parent) for this agent's team
      const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
      if (!leadId) {
        logger.warn('message', `Broadcast from ${agent.role.name} (${agent.id.slice(0, 8)}) — no team lead found`);
        return;
      }

      // Find all team members: siblings (same parent) + the lead itself
      const recipients = this.getAll().filter((a) =>
        a.id !== agent.id &&
        (a.id === leadId || a.parentId === leadId) &&
        (a.status === 'running' || a.status === 'idle')
      );

      const fromLabel = `${agent.role.name} (${agent.id.slice(0, 8)})`;
      logger.info('message', `Broadcast from ${fromLabel} to ${recipients.length} agents: ${msg.content.slice(0, 80)}`);

      for (const recipient of recipients) {
        recipient.sendMessage(`[Broadcast from ${fromLabel}]: ${msg.content}`);
      }

      this.emit('agent:message_sent', {
        from: agent.id,
        fromRole: agent.role.name,
        to: 'all',
        toRole: 'Team',
        content: msg.content,
      });
    } catch {
      // ignore malformed broadcasts
    }
  }

  /** Notify parent when a child agent finishes its prompt (goes idle) */
  private notifyParentOfIdle(agent: Agent): void {
    if (!agent.parentId) return;
    const parent = this.agents.get(agent.parentId);
    if (!parent || (parent.status !== 'running' && parent.status !== 'idle')) return;

    // Update delegation records
    for (const [, del] of this.delegations) {
      if (del.toAgentId === agent.id && del.status === 'active') {
        del.status = 'completed';
        del.completedAt = new Date().toISOString();
        del.result = agent.messages.slice(-5).join('\n').slice(0, 4000);
      }
    }

    const rawPreview = agent.messages.slice(-5).join('\n').slice(0, 4000);
    // Strip <!-- ... --> command blocks from preview
    const cleanPreview = rawPreview.replace(/<!--[\s\S]*?-->/g, '').replace(/<!--[\s\S]*$/g, '').trim().slice(0, 3000);
    const summary = `[Agent Report] ${agent.role.name} (${agent.id.slice(0, 8)}) finished work.\nTask: ${agent.taskId || 'none'}\nOutput summary: ${cleanPreview || '(no output)'}`;

    logger.info('delegation', `Child ${agent.role.name} (${agent.id.slice(0, 8)}) finished → notifying parent ${parent.role.name} (${parent.id.slice(0, 8)})`);
    parent.sendMessage(summary);
    this.emit('agent:message_sent', {
      from: agent.id,
      fromRole: agent.role.name,
      to: parent.id,
      toRole: parent.role.name,
      content: summary,
    });
    this.emit('agent:completion_reported', { childId: agent.id, parentId: agent.parentId, status: 'completed' });
  }

  private notifyParentOfCompletion(agent: Agent, exitCode: number | null): void {
    if (!agent.parentId) return;
    const parent = this.agents.get(agent.parentId);
    if (!parent || (parent.status !== 'running' && parent.status !== 'idle')) return;

    // Update delegation records
    for (const [, del] of this.delegations) {
      if (del.toAgentId === agent.id && del.status === 'active') {
        del.status = exitCode === 0 ? 'completed' : 'failed';
        del.completedAt = new Date().toISOString();
        del.result = agent.messages.slice(-5).join('\n').slice(0, 4000);
      }
    }

    const status = exitCode === 0 ? 'completed successfully' : `failed (exit code ${exitCode})`;
    const rawPreview2 = agent.messages.slice(-5).join('\n').slice(0, 4000);
    const cleanPreview2 = rawPreview2.replace(/<!--[\s\S]*?-->/g, '').replace(/<!--[\s\S]*$/g, '').trim().slice(0, 3000);
    const summary = `[Agent Report] ${agent.role.name} (${agent.id.slice(0, 8)}) ${status}.\nTask: ${agent.taskId || 'none'}\nOutput summary: ${cleanPreview2 || '(no output)'}`;

    logger.info('delegation', `Child ${agent.role.name} (${agent.id.slice(0, 8)}) → parent ${parent.role.name} (${parent.id.slice(0, 8)}): ${status}`);
    parent.sendMessage(summary);
    this.emit('agent:message_sent', {
      from: agent.id,
      fromRole: agent.role.name,
      to: parent.id,
      toRole: parent.role.name,
      content: summary,
    });
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
