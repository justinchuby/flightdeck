import { EventEmitter } from 'events';
import { Agent } from './Agent.js';
import type { AgentContextInfo, AgentMode } from './Agent.js';
import type { Role, RoleRegistry } from './RoleRegistry.js';
import type { ServerConfig } from '../config.js';
import type { FileLockRegistry } from '../coordination/FileLockRegistry.js';
import type { ActivityLedger } from '../coordination/ActivityLedger.js';
import type { MessageBus } from '../comms/MessageBus.js';
import type { DecisionLog } from '../coordination/DecisionLog.js';
import type { AgentMemory, MemoryEntry } from '../coordination/AgentMemory.js';
import type { ChatGroupRegistry, GroupMessage } from '../comms/ChatGroupRegistry.js';
import { logger } from '../utils/logger.js';
import { writeAgentFiles } from './agentFiles.js';

// JSON pattern agents can emit to request sub-agent spawning
const SPAWN_REQUEST_REGEX = /<!--\s*SPAWN_AGENT\s*(\{.*?\})\s*-->/s;
const CREATE_AGENT_REGEX = /<!--\s*CREATE_AGENT\s*(\{.*?\})\s*-->/s;
const LOCK_REQUEST_REGEX = /<!--\s*LOCK_REQUEST\s*(\{.*?\})\s*-->/s;
const LOCK_RELEASE_REGEX = /<!--\s*LOCK_RELEASE\s*(\{.*?\})\s*-->/s;
const ACTIVITY_REGEX = /<!--\s*ACTIVITY\s*(\{.*?\})\s*-->/s;
const AGENT_MESSAGE_REGEX = /<!--\s*AGENT_MESSAGE\s*(\{.*?\})\s*-->/s;
const DELEGATE_REGEX = /<!--\s*DELEGATE\s*(\{.*?\})\s*-->/s;
const DECISION_REGEX = /<!--\s*DECISION\s*(\{.*?\})\s*-->/s;
const PROGRESS_REGEX = /<!--\s*PROGRESS\s*(\{.*?\})\s*-->/s;
const QUERY_CREW_REGEX = /<!--\s*QUERY_CREW\s*-->/s;
const BROADCAST_REGEX = /<!--\s*BROADCAST\s*(\{.*?\})\s*-->/s;
const KILL_AGENT_REGEX = /<!--\s*KILL_AGENT\s*(\{.*?\})\s*-->/s;
const CREATE_GROUP_REGEX = /<!--\s*CREATE_GROUP\s*(\{.*?\})\s*-->/s;
const ADD_TO_GROUP_REGEX = /<!--\s*ADD_TO_GROUP\s*(\{.*?\})\s*-->/s;
const REMOVE_FROM_GROUP_REGEX = /<!--\s*REMOVE_FROM_GROUP\s*(\{.*?\})\s*-->/s;
const GROUP_MESSAGE_REGEX = /<!--\s*GROUP_MESSAGE\s*(\{.*?\})\s*-->/s;
const LIST_GROUPS_REGEX = /<!--\s*LIST_GROUPS\s*-->/s;

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
  private agentMemory: AgentMemory;
  private chatGroupRegistry: ChatGroupRegistry;
  /** If set, auto-kill agents after this many ms past the initial hung detection */
  private autoKillTimeoutMs: number | null;
  private hungTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private crashCounts: Map<string, number> = new Map();
  private maxRestarts: number;
  private autoRestart: boolean;
  private delegations: Map<string, Delegation> = new Map();
  private reportedCompletions: Set<string> = new Set();
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
    agentMemory: AgentMemory,
    chatGroupRegistry: ChatGroupRegistry,
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
    this.maxConcurrent = config.maxConcurrentAgents;
    this.maxRestarts = maxRestarts;
    this.autoRestart = autoRestart;
    this.autoKillTimeoutMs = null;

    // Start heartbeat timer to detect stalled teams
    this.heartbeatTimer = setInterval(() => this.heartbeatCheck(), 120_000);

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

  spawn(role: Role, task?: string, parentId?: string, mode?: AgentMode, autopilot?: boolean, model?: string, cwd?: string, resumeSessionId?: string): Agent {
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

    const agent = new Agent(role, this.config, task, parentId, peers, mode, autopilot);
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
      if (agent.mode === 'acp') {
        this.emit('agent:text', agent.id, data);
        // Buffer ACP text and scan for complete command patterns
        const buf = (this.textBuffers.get(agent.id) || '') + data;
        this.textBuffers.set(agent.id, buf);
        this.scanBuffer(agent);
      } else {
        this.emit('agent:data', agent.id, data);
        // PTY data arrives in larger chunks — match directly
        this.detectSpawnRequest(agent, data);
        this.detectCreateAgent(agent, data);
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

      // Clean up dedup tracking after a delay
      setTimeout(() => {
        this.reportedCompletions.delete(`${agent.id}:idle`);
        this.reportedCompletions.delete(`${agent.id}:exit`);
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
            const newAgent = this.spawn(agent.role, agent.task, agent.parentId, undefined, undefined, undefined, agent.cwd);
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
    const { role, task } = agent;
    agent.kill();
    this.agents.delete(id);
    const newAgent = this.spawn(role, task);
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
      { regex: SPAWN_REQUEST_REGEX, name: 'SPAWN', handler: (a, d) => this.detectSpawnRequest(a, d) },
      { regex: CREATE_AGENT_REGEX, name: 'CREATE_AGENT', handler: (a, d) => this.detectCreateAgent(a, d) },
      { regex: LOCK_REQUEST_REGEX, name: 'LOCK', handler: (a, d) => this.detectLockRequest(a, d) },
      { regex: LOCK_RELEASE_REGEX, name: 'UNLOCK', handler: (a, d) => this.detectLockRelease(a, d) },
      { regex: ACTIVITY_REGEX, name: 'ACTIVITY', handler: (a, d) => this.detectActivity(a, d) },
      { regex: AGENT_MESSAGE_REGEX, name: 'AGENT_MSG', handler: (a, d) => this.detectAgentMessage(a, d) },
      { regex: DELEGATE_REGEX, name: 'DELEGATE', handler: (a, d) => this.detectDelegate(a, d) },
      { regex: DECISION_REGEX, name: 'DECISION', handler: (a, d) => this.detectDecision(a, d) },
      { regex: PROGRESS_REGEX, name: 'PROGRESS', handler: (a, d) => this.detectProgress(a, d) },
      { regex: QUERY_CREW_REGEX, name: 'QUERY_CREW', handler: (a, _d) => this.handleQueryCrew(a) },
      { regex: BROADCAST_REGEX, name: 'BROADCAST', handler: (a, d) => this.detectBroadcast(a, d) },
      { regex: KILL_AGENT_REGEX, name: 'KILL_AGENT', handler: (a, d) => this.detectKillAgent(a, d) },
      { regex: CREATE_GROUP_REGEX, name: 'CREATE_GROUP', handler: (a, d) => this.detectCreateGroup(a, d) },
      { regex: ADD_TO_GROUP_REGEX, name: 'ADD_TO_GROUP', handler: (a, d) => this.detectAddToGroup(a, d) },
      { regex: REMOVE_FROM_GROUP_REGEX, name: 'REMOVE_FROM_GROUP', handler: (a, d) => this.detectRemoveFromGroup(a, d) },
      { regex: GROUP_MESSAGE_REGEX, name: 'GROUP_MSG', handler: (a, d) => this.detectGroupMessage(a, d) },
      { regex: LIST_GROUPS_REGEX, name: 'LIST_GROUPS', handler: (a, _d) => this.handleListGroups(a) },
    ];

    let found = true;
    while (found) {
      found = false;
      for (const { regex, name, handler } of patterns) {
        const match = buf.match(regex);
        if (match) {
          logger.debug('agent', `Command: ${name} from ${agent.role.name} (${agent.id.slice(0, 8)})`);
          handler(agent, match[0]);
          buf = buf.slice(0, match.index!) + buf.slice(match.index! + match[0].length);
          found = true;
        }
      }
    }

    // Lead processed output — mark human message as responded
    if (agent.role.id === 'lead' && !agent.humanMessageResponded) {
      agent.humanMessageResponded = true;
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

  private detectSpawnRequest(agent: Agent, data: string): void {
    const match = data.match(SPAWN_REQUEST_REGEX);
    if (!match) return;

    // SPAWN_AGENT is deprecated — only the lead can create agents via CREATE_AGENT
    logger.warn('agent', `Agent ${agent.role.name} (${agent.id.slice(0, 8)}) attempted SPAWN_AGENT — rejected. Only the lead can create agents.`);
    agent.sendMessage(`[System] SPAWN_AGENT is not available. Only the Project Lead can create agents using CREATE_AGENT. If you need help, ask the lead via AGENT_MESSAGE.`);
  }

  private detectCreateAgent(agent: Agent, data: string): void {
    const match = data.match(CREATE_AGENT_REGEX);
    if (!match) return;

    try {
      const req = JSON.parse(match[1]);

      // Only lead agents can create agents
      if (agent.role.id !== 'lead') {
        logger.warn('agent', `Non-lead agent ${agent.role.name} (${agent.id.slice(0, 8)}) attempted CREATE_AGENT — rejected.`);
        agent.sendMessage(`[System] Only the Project Lead can create agents. Ask the lead if you need help from a specialist.`);
        return;
      }

      if (!req.role) {
        agent.sendMessage(`[System] CREATE_AGENT requires a "role" field. Available roles: ${this.roleRegistry.getAll().map(r => r.id).join(', ')}`);
        return;
      }

      const role = this.roleRegistry.get(req.role);
      if (!role) {
        agent.sendMessage(`[System] Unknown role: ${req.role}. Available: ${this.roleRegistry.getAll().map(r => r.id).join(', ')}`);
        return;
      }

      const child = this.spawn(role, req.task, agent.id, 'acp', true, req.model, agent.cwd, req.sessionId);
      if (role.id === 'lead') {
        child.hierarchyLevel = agent.hierarchyLevel + 1;
      }
      logger.info('agent', `${agent.role.name} (${agent.id.slice(0, 8)}) created ${role.name}${req.model ? ` (model: ${req.model})` : ''}: ${child.id.slice(0, 8)}`);

      // If task is provided, send it and create a delegation record
      if (req.task) {
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

        const taskPrompt = req.context ? `${req.task}\n\nContext: ${req.context}` : req.task;
        child.sendMessage(taskPrompt);

        const ackMsg = `[System] Queued: ${role.name} (${child.id.slice(0, 8)})${req.model ? ` [${req.model}]` : ''}`;
        agent.sendMessage(ackMsg);
        this.emit('agent:message_sent', {
          from: child.id, fromRole: role.name,
          to: agent.id, toRole: agent.role.name,
          content: ackMsg,
        });
        this.emit('agent:delegated', { parentId: agent.id, childId: child.id, delegation });

        this.activityLedger.log(agent.id, agent.role.id, 'delegated', `Created & delegated to ${role.name}: ${req.task.slice(0, 100)}`, {
          childId: child.id, childRole: role.id, delegationId: delegation.id,
        });
      } else {
        const ackMsg = `[System] Queued: ${role.name} (${child.id.slice(0, 8)})${req.model ? ` [${req.model}]` : ''} — ready for tasks.`;
        agent.sendMessage(ackMsg);
        this.emit('agent:message_sent', {
          from: child.id, fromRole: role.name,
          to: agent.id, toRole: agent.role.name,
          content: ackMsg,
        });
      }

      // Store memory for the lead
      this.agentMemory.store(agent.id, child.id, 'role', role.name);
      if (req.model) this.agentMemory.store(agent.id, child.id, 'model', req.model);
      if (req.task) this.agentMemory.store(agent.id, child.id, 'task', req.task.slice(0, 200));

      this.emit('agent:sub_spawned', agent.id, child.toJSON());
    } catch (err: any) {
      // Send meaningful error back to the lead with budget info
      if (err.message?.includes('Concurrency limit')) {
        const running = this.getRunningCount();
        const idle = this.getAll().filter((a) => a.parentId === agent.id && a.status === 'idle');
        const idleList = idle.length > 0
          ? `\nIdle agents you can kill to free slots:\n${idle.map((a) => `- ${a.id.slice(0, 8)} — ${a.role.name}${a.sessionId ? ` (session: ${a.sessionId})` : ''}`).join('\n')}`
          : '\nNo idle agents to kill — wait for a running agent to finish.';
        agent.sendMessage(`[System] Cannot create agent: concurrency limit reached (${running}/${this.maxConcurrent}).${idleList}\nUse KILL_AGENT to free a slot, then try CREATE_AGENT again.`);
      } else {
        agent.sendMessage(`[System] Failed to create agent: ${err.message}`);
      }
      this.emit('agent:spawn_error', agent.id, err.message);
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

      // Only lead agents can delegate
      if (agent.role.id !== 'lead') {
        logger.warn('delegation', `Non-lead agent ${agent.role.name} (${agent.id.slice(0, 8)}) attempted DELEGATE — rejected.`);
        agent.sendMessage(`[System] Only the Project Lead can delegate tasks. Ask the lead via AGENT_MESSAGE if you need help.`);
        return;
      }

      // Find the target agent by ID (partial match supported: first 8 chars)
      const child = this.getAll().find((a) =>
        (a.id === req.to || a.id.startsWith(req.to)) &&
        a.parentId === agent.id &&
        a.id !== agent.id
      );

      if (!child) {
        agent.sendMessage(`[System] Agent not found: ${req.to}. Use CREATE_AGENT to create a new agent first, or use QUERY_CREW to see available agents.`);
        return;
      }

      // Track delegation
      const delegation: Delegation = {
        id: `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fromAgentId: agent.id,
        toAgentId: child.id,
        toRole: child.role.id,
        task: req.task,
        context: req.context,
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      this.delegations.set(delegation.id, delegation);

      // Update the agent's task to reflect the new assignment
      child.task = req.task;

      // Store memory for the lead
      this.agentMemory.store(agent.id, child.id, 'task', req.task.slice(0, 200));
      if (req.context) this.agentMemory.store(agent.id, child.id, 'context', req.context.slice(0, 200));

      // Send task + context to child
      const taskPrompt = req.context
        ? `${req.task}\n\nContext: ${req.context}`
        : req.task;
      // Reset dedup tracking for re-delegated agent
      this.reportedCompletions.delete(`${child.id}:idle`);
      this.reportedCompletions.delete(`${child.id}:exit`);
      child.sendMessage(taskPrompt);
      const statusNote = child.status === 'running' ? ' (agent is busy — task queued)' : '';
      const ackMsg = `[System] Task delegated: ${child.role.name} (${child.id.slice(0, 8)})${statusNote} — ${req.task.slice(0, 120)}`;
      agent.sendMessage(ackMsg);
      this.emit('agent:message_sent', {
        from: child.id,
        fromRole: child.role.name,
        to: agent.id,
        toRole: agent.role.name,
        content: ackMsg,
      });

      this.activityLedger.log(agent.id, agent.role.id, 'delegated', `Delegated to ${child.role.name} (${child.id.slice(0, 8)}): ${req.task.slice(0, 100)}`, {
        childId: child.id,
        childRole: child.role.id,
        delegationId: delegation.id,
      });

      this.emit('agent:delegated', { parentId: agent.id, childId: child.id, delegation });
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

      const needsConfirmation = decision.needsConfirmation === true;
      const leadId = agent.parentId || agent.id;
      const recorded = this.decisionLog.add(agent.id, agent.role?.id ?? 'unknown', decision.title, decision.rationale ?? '', needsConfirmation, leadId);
      logger.info('lead', `Decision by ${agent.role.name}: "${decision.title}"${needsConfirmation ? ' [needs confirmation]' : ''}`, { rationale: decision.rationale?.slice(0, 100) });
      // Include leadId so frontend routes to the correct project
      this.emit('lead:decision', {
        id: recorded.id,
        agentId: agent.id,
        agentRole: agent.role?.name ?? 'Unknown',
        leadId,
        title: decision.title,
        rationale: decision.rationale,
        needsConfirmation,
        status: recorded.status,
      });
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

      // Route progress to any secretary agent that shares the same parent
      const parentId = agent.parentId || agent.id;
      const secretaries = this.getAll().filter(
        (a) => a.role.id === 'secretary' && (a.parentId === parentId || a.id === parentId) && a.id !== agent.id,
      );
      for (const secretary of secretaries) {
        const progressMsg = `[Progress Update from ${agent.role.name} (${agent.id.slice(0, 8)})]\n${JSON.stringify(progress, null, 2)}`;
        secretary.sendMessage(progressMsg);
      }
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
        task: a.task?.slice(0, 80) || null,
        parentId: a.parentId?.slice(0, 8) || null,
        fullParentId: a.parentId || null,
        childCount: a.childIds.length,
        model: a.model || a.role.model || 'default',
      }));

    const running = this.getRunningCount();
    const budgetLine = agent.role.id === 'lead'
      ? `\n== AGENT BUDGET ==\nRunning: ${running} / ${this.maxConcurrent} | Available slots: ${Math.max(0, this.maxConcurrent - running)}${running >= this.maxConcurrent ? ' | ⚠ AT CAPACITY' : ''}\n`
      : '';

    // For sub-leads, scope to own children + sibling summary
    const isSubLead = agent.role.id === 'lead' && !!agent.parentId;
    let rosterLines: string;
    let siblingSection = '';
    if (isSubLead) {
      const ownChildren = roster.filter(r => r.fullParentId === agent.id);
      const siblingLeads = roster.filter(r => r.roleId === 'lead' && r.fullParentId === agent.parentId && r.fullId !== agent.id);
      rosterLines = ownChildren
        .map((r) => `- ${r.id} | ${r.role} (${r.roleId}) [${r.model}] | Status: ${r.status} | Task: ${r.task || 'idle'}`)
        .join('\n') || '(no agents created yet — use CREATE_AGENT to create specialists)';
      if (siblingLeads.length > 0) {
        siblingSection = `\n== SIBLING LEADS ==\n${siblingLeads.map(r => `- ${r.id} (${r.role}) — ${r.status}, managing ${r.childCount} agents`).join('\n')}\n`;
      }
    } else {
      rosterLines = roster
        .map((r) => `- ${r.id} | ${r.role} (${r.roleId}) [${r.model}] | Status: ${r.status} | Task: ${r.task || 'idle'}${r.parentId ? ` | Parent: ${r.parentId}` : ''}`)
        .join('\n');
    }

    // Include memory entries for the lead
    let memorySection = '';
    if (agent.role.id === 'lead') {
      const memories = this.agentMemory.getByLead(agent.id);
      if (memories.length > 0) {
        // Group by agent
        const byAgent = new Map<string, MemoryEntry[]>();
        for (const m of memories) {
          const list = byAgent.get(m.agentId) || [];
          list.push(m);
          byAgent.set(m.agentId, list);
        }
        const lines: string[] = [];
        for (const [agentId, entries] of byAgent) {
          const facts = entries.map(e => `${e.key}: ${e.value}`).join(', ');
          lines.push(`  - ${agentId.slice(0, 8)}: ${facts}`);
        }
        memorySection = `\n== AGENT MEMORY ==\nRecorded facts about your agents:\n${lines.join('\n')}\n`;
      }
    }

    // Check for unread human messages
    let humanMsgIndicator = '';
    if (agent.role.id === 'lead' && !agent.humanMessageResponded && agent.lastHumanMessageAt) {
      const agoMs = Date.now() - agent.lastHumanMessageAt.getTime();
      const agoMin = Math.floor(agoMs / 60000);
      const agoStr = agoMin < 1 ? 'just now' : `${agoMin}m ago`;
      humanMsgIndicator = `\n⚠️ UNREAD HUMAN MESSAGE (${agoStr}): "${agent.lastHumanMessageText}"\nRespond to this FIRST before continuing other work.\n`;
    }

    const response = `<!-- CREW_ROSTER${humanMsgIndicator}
== ACTIVE CREW MEMBERS ==
${rosterLines}
${budgetLine}${siblingSection}${memorySection}
To assign a task to an agent, use their ID:
\`<!-- DELEGATE {"to": "agent-id", "task": "your task"} -->\`
To create a new agent:
\`<!-- CREATE_AGENT {"role": "developer", "model": "claude-opus-4.6", "task": "optional task"} -->\`
To kill an agent and free a slot:
\`<!-- KILL_AGENT {"id": "agent-id", "reason": "no longer needed"} -->\`
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

  private detectKillAgent(agent: Agent, data: string): void {
    const match = data.match(KILL_AGENT_REGEX);
    if (!match) return;

    try {
      const req = JSON.parse(match[1]);
      if (!req.id) return;

      // Only lead agents can kill agents
      if (agent.role.id !== 'lead') {
        agent.sendMessage(`[System] Only the Project Lead can kill agents.`);
        return;
      }

      // Find target (partial match)
      const target = this.getAll().find((a) =>
        (a.id === req.id || a.id.startsWith(req.id)) &&
        a.parentId === agent.id &&
        a.id !== agent.id
      );

      if (!target) {
        agent.sendMessage(`[System] Agent not found: ${req.id}. Use QUERY_CREW to see available agents.`);
        return;
      }

      const sessionId = target.sessionId;
      const roleName = target.role.name;
      const shortId = target.id.slice(0, 8);

      this.kill(target.id);

      const ackMsg = `[System] Killed ${roleName} (${shortId}).${sessionId ? ` Session ID: ${sessionId} — use this in CREATE_AGENT with "sessionId" to resume later.` : ''} Freed 1 agent slot. ${req.reason ? `Reason: ${req.reason}` : ''}`;
      agent.sendMessage(ackMsg);

      this.activityLedger.log(agent.id, agent.role.id, 'agent_killed', `Killed ${roleName} (${shortId})${req.reason ? ': ' + req.reason.slice(0, 100) : ''}`, {
        killedAgentId: target.id,
        killedRole: target.role.id,
        sessionId: sessionId || null,
      });

      logger.info('agent', `Lead ${agent.id.slice(0, 8)} killed ${roleName} (${shortId})${req.reason ? ': ' + req.reason : ''}`);
    } catch {
      // ignore malformed kill requests
    }
  }

  /** Notify parent when a child agent finishes its prompt (goes idle) */
  private notifyParentOfIdle(agent: Agent): void {
    if (!agent.parentId) return;
    const parent = this.agents.get(agent.parentId);
    if (!parent || (parent.status !== 'running' && parent.status !== 'idle')) return;

    // Dedup: track that we reported this agent's idle state
    const dedupKey = `${agent.id}:idle`;
    if (this.reportedCompletions.has(dedupKey)) return;
    this.reportedCompletions.add(dedupKey);

    // Update delegation records
    for (const [, del] of this.delegations) {
      if (del.toAgentId === agent.id && del.status === 'active') {
        del.status = 'completed';
        del.completedAt = new Date().toISOString();
        del.result = agent.getBufferedOutput().slice(-8000);
      }
    }

    const rawOutput = agent.getBufferedOutput().slice(-8000);
    // Strip <!-- ... --> command blocks from output
    const cleanPreview = rawOutput.replace(/<!--[\s\S]*?-->/g, '').replace(/<!--[\s\S]*$/g, '').trim().slice(-6000);
    const sessionLine = agent.sessionId ? `\nSession ID: ${agent.sessionId}` : '';
    const summary = `[Agent Report] ${agent.role.name} (${agent.id.slice(0, 8)}) finished work.\nTask: ${agent.task || 'none'}${sessionLine}\nOutput summary: ${cleanPreview || '(no output)'}`;

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

    // Dedup: if idle report was already sent for this agent, skip the exit report
    // (the idle report already told the parent the work is done)
    const idleKey = `${agent.id}:idle`;
    const exitKey = `${agent.id}:exit`;
    if (this.reportedCompletions.has(exitKey)) return;
    this.reportedCompletions.add(exitKey);

    // If idle already reported, don't duplicate
    if (this.reportedCompletions.has(idleKey) && exitCode === 0) {
      // Still update delegation records but don't send another report
      for (const [, del] of this.delegations) {
        if (del.toAgentId === agent.id && del.status === 'active') {
          del.status = exitCode === 0 ? 'completed' : 'failed';
          del.completedAt = new Date().toISOString();
          del.result = agent.getBufferedOutput().slice(-8000);
        }
      }
      return;
    }

    // Update delegation records
    for (const [, del] of this.delegations) {
      if (del.toAgentId === agent.id && del.status === 'active') {
        del.status = exitCode === 0 ? 'completed' : 'failed';
        del.completedAt = new Date().toISOString();
        del.result = agent.getBufferedOutput().slice(-8000);
      }
    }

    const status = exitCode === 0 ? 'completed successfully' : `failed (exit code ${exitCode})`;
    const rawOutput2 = agent.getBufferedOutput().slice(-8000);
    const cleanPreview2 = rawOutput2.replace(/<!--[\s\S]*?-->/g, '').replace(/<!--[\s\S]*$/g, '').trim().slice(-6000);
    const sessionLine2 = agent.sessionId ? `\nSession ID: ${agent.sessionId}` : '';
    const summary = `[Agent Report] ${agent.role.name} (${agent.id.slice(0, 8)}) ${status}.\nTask: ${agent.task || 'none'}${sessionLine2}\nOutput summary: ${cleanPreview2 || '(no output)'}`;

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

  getChatGroupRegistry(): ChatGroupRegistry {
    return this.chatGroupRegistry;
  }

  private detectCreateGroup(agent: Agent, data: string): void {
    const match = data.match(CREATE_GROUP_REGEX);
    if (!match) return;
    try {
      const req = JSON.parse(match[1]);
      if (agent.role.id !== 'lead') {
        agent.sendMessage('[System] Only the Project Lead can create groups.');
        return;
      }
      if (!req.name || !req.members || !Array.isArray(req.members)) {
        agent.sendMessage('[System] CREATE_GROUP requires "name" (string) and "members" (array of agent IDs).');
        return;
      }
      // Resolve member IDs (support short prefixes)
      const resolvedIds: string[] = [];
      for (const memberId of req.members) {
        const resolved = this.getAll().find((a) =>
          (a.id === memberId || a.id.startsWith(memberId)) && a.parentId === agent.id
        );
        if (resolved) {
          resolvedIds.push(resolved.id);
        } else {
          agent.sendMessage(`[System] Cannot resolve agent "${memberId}" for group. Use QUERY_CREW to see available agents.`);
        }
      }
      const group = this.chatGroupRegistry.create(agent.id, req.name, resolvedIds);
      const memberNames = group.memberIds.map((id) => {
        const a = this.agents.get(id);
        return a ? `${a.role.name} (${id.slice(0, 8)})` : id.slice(0, 8);
      }).join(', ');
      agent.sendMessage(`[System] Group "${req.name}" created with ${group.memberIds.length} members: ${memberNames}.`);

      // Notify all members (except lead)
      for (const memberId of group.memberIds) {
        if (memberId === agent.id) continue;
        const member = this.agents.get(memberId);
        if (member && (member.status === 'running' || member.status === 'idle')) {
          member.sendMessage(`[System] You've been added to group "${req.name}". Members: ${memberNames}.\nSend messages: <!-- GROUP_MESSAGE {"group": "${req.name}", "content": "your message"} -->`);
        }
      }

      this.emit('group:created', { group, leadId: agent.id });
      logger.info('groups', `Lead ${agent.id.slice(0, 8)} created group "${req.name}" with ${group.memberIds.length} members`);
    } catch { /* ignore malformed */ }
  }

  private detectAddToGroup(agent: Agent, data: string): void {
    const match = data.match(ADD_TO_GROUP_REGEX);
    if (!match) return;
    try {
      const req = JSON.parse(match[1]);
      if (agent.role.id !== 'lead') {
        agent.sendMessage('[System] Only the Project Lead can manage group members.');
        return;
      }
      if (!req.group || !req.members) return;
      const resolvedIds = req.members.map((m: string) => {
        const found = this.getAll().find((a) => (a.id === m || a.id.startsWith(m)) && a.parentId === agent.id);
        return found?.id;
      }).filter(Boolean) as string[];

      const added = this.chatGroupRegistry.addMembers(agent.id, req.group, resolvedIds);
      if (added.length > 0) {
        // Send recent history to new members
        const history = this.chatGroupRegistry.getMessages(req.group, agent.id, 20);
        for (const memberId of added) {
          const member = this.agents.get(memberId);
          if (member && (member.status === 'running' || member.status === 'idle')) {
            const allMembers = this.chatGroupRegistry.getMembers(req.group, agent.id);
            const memberNames = allMembers.map((id) => {
              const a = this.agents.get(id);
              return a ? `${a.role.name} (${id.slice(0, 8)})` : id.slice(0, 8);
            }).join(', ');
            let historyText = '';
            if (history.length > 0) {
              historyText = '\nRecent messages:\n' + history.map((m) => `  [${m.fromRole} (${m.fromAgentId.slice(0, 8)})]: ${m.content}`).join('\n');
            }
            member.sendMessage(`[System] You've been added to group "${req.group}". Members: ${memberNames}.${historyText}\nSend messages: <!-- GROUP_MESSAGE {"group": "${req.group}", "content": "..."} -->`);
          }
        }
        const names = added.map((id) => this.agents.get(id)?.role.name || id.slice(0, 8)).join(', ');
        agent.sendMessage(`[System] Added ${names} to group "${req.group}".`);
      } else {
        agent.sendMessage(`[System] No new members added to "${req.group}" (already members or not found).`);
      }
    } catch { /* ignore */ }
  }

  private detectRemoveFromGroup(agent: Agent, data: string): void {
    const match = data.match(REMOVE_FROM_GROUP_REGEX);
    if (!match) return;
    try {
      const req = JSON.parse(match[1]);
      if (agent.role.id !== 'lead') {
        agent.sendMessage('[System] Only the Project Lead can manage group members.');
        return;
      }
      if (!req.group || !req.members) return;
      const resolvedIds = req.members.map((m: string) => {
        const found = this.getAll().find((a) => a.id === m || a.id.startsWith(m));
        return found?.id;
      }).filter(Boolean) as string[];

      const removed = this.chatGroupRegistry.removeMembers(agent.id, req.group, resolvedIds);
      if (removed.length > 0) {
        const names = removed.map((id) => this.agents.get(id)?.role.name || id.slice(0, 8)).join(', ');
        agent.sendMessage(`[System] Removed ${names} from group "${req.group}".`);
      }
    } catch { /* ignore */ }
  }

  private detectGroupMessage(agent: Agent, data: string): void {
    const match = data.match(GROUP_MESSAGE_REGEX);
    if (!match) return;
    try {
      const req = JSON.parse(match[1]);
      if (!req.group || !req.content) return;

      // Find the lead for this agent's team
      const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
      if (!leadId) {
        agent.sendMessage('[System] Cannot send group message — no team lead found.');
        return;
      }

      const message = this.chatGroupRegistry.sendMessage(req.group, leadId, agent.id, agent.role.name, req.content);
      if (!message) {
        agent.sendMessage(`[System] Cannot send to group "${req.group}" — you are not a member. Use LIST_GROUPS to see your groups.`);
        return;
      }

      // Deliver to all group members except sender
      const members = this.chatGroupRegistry.getMembers(req.group, leadId);
      let delivered = 0;
      for (const memberId of members) {
        if (memberId === agent.id) continue;
        const member = this.agents.get(memberId);
        if (member && (member.status === 'running' || member.status === 'idle')) {
          member.sendMessage(`[Group "${req.group}" — ${agent.role.name} (${agent.id.slice(0, 8)})]: ${req.content}`);
          delivered++;
        }
      }

      agent.sendMessage(`[System] Message delivered to ${delivered} group member(s) in "${req.group}".`);
      this.emit('group:message', { message, groupName: req.group, leadId });
      logger.info('groups', `Group message in "${req.group}": ${agent.role.name} (${agent.id.slice(0, 8)}) → ${delivered} recipients`);
    } catch { /* ignore */ }
  }

  private handleListGroups(agent: Agent): void {
    const groups = this.chatGroupRegistry.getGroupsForAgent(agent.id);
    if (groups.length === 0) {
      agent.sendMessage('[System] You are not a member of any groups.');
      return;
    }
    const lines = groups.map((g) => {
      const memberNames = g.memberIds.map((id) => {
        const a = this.agents.get(id);
        return a ? `${a.role.name} (${id.slice(0, 8)})` : id.slice(0, 8);
      }).join(', ');
      return `- "${g.name}" — ${g.memberIds.length} members: ${memberNames}`;
    });
    agent.sendMessage(`[System] Your groups:\n${lines.join('\n')}\nSend messages: <!-- GROUP_MESSAGE {"group": "name", "content": "..."} -->`);
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
