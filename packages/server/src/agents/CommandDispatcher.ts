import { Agent } from './Agent.js';
import type { AgentContextInfo } from './Agent.js';
import type { Role, RoleRegistry } from './RoleRegistry.js';
import type { ServerConfig } from '../config.js';
import type { FileLockRegistry } from '../coordination/FileLockRegistry.js';
import type { ActivityLedger } from '../coordination/ActivityLedger.js';
import type { MessageBus } from '../comms/MessageBus.js';
import type { DecisionLog } from '../coordination/DecisionLog.js';
import type { AgentMemory, MemoryEntry } from './AgentMemory.js';
import type { ChatGroupRegistry, GroupMessage } from '../comms/ChatGroupRegistry.js';
import { TaskDAG } from '../tasks/TaskDAG.js';
import type { DagTaskInput, DagTask } from '../tasks/TaskDAG.js';
import { logger } from '../utils/logger.js';

// ── Regex patterns for ACP commands ──────────────────────────────────
const SPAWN_REQUEST_REGEX = /\[\[\[\s*SPAWN_AGENT\s*(\{.*?\})\s*\]\]\]/s;
const CREATE_AGENT_REGEX = /\[\[\[\s*CREATE_AGENT\s*(\{.*?\})\s*\]\]\]/s;
const LOCK_REQUEST_REGEX = /\[\[\[\s*LOCK_FILE\s*(\{.*?\})\s*\]\]\]/s;
const LOCK_RELEASE_REGEX = /\[\[\[\s*UNLOCK_FILE\s*(\{.*?\})\s*\]\]\]/s;
const ACTIVITY_REGEX = /\[\[\[\s*ACTIVITY\s*(\{.*?\})\s*\]\]\]/s;
const AGENT_MESSAGE_REGEX = /\[\[\[\s*AGENT_MESSAGE\s*(\{.*?\})\s*\]\]\]/s;
const DELEGATE_REGEX = /\[\[\[\s*DELEGATE\s*(\{.*?\})\s*\]\]\]/s;
const DECISION_REGEX = /\[\[\[\s*DECISION\s*(\{.*?\})\s*\]\]\]/s;
const PROGRESS_REGEX = /\[\[\[\s*PROGRESS\s*(\{.*?\})\s*\]\]\]/s;
const QUERY_CREW_REGEX = /\[\[\[\s*QUERY_CREW\s*\]\]\]/s;
const BROADCAST_REGEX = /\[\[\[\s*BROADCAST\s*(\{.*?\})\s*\]\]\]/s;
const KILL_AGENT_REGEX = /\[\[\[\s*KILL_AGENT\s*(\{.*?\})\s*\]\]\]/s;
const CREATE_GROUP_REGEX = /\[\[\[\s*CREATE_GROUP\s*(\{.*?\})\s*\]\]\]/s;
const ADD_TO_GROUP_REGEX = /\[\[\[\s*ADD_TO_GROUP\s*(\{.*?\})\s*\]\]\]/s;
const REMOVE_FROM_GROUP_REGEX = /\[\[\[\s*REMOVE_FROM_GROUP\s*(\{.*?\})\s*\]\]\]/s;
const GROUP_MESSAGE_REGEX = /\[\[\[\s*GROUP_MESSAGE\s*(\{.*?\})\s*\]\]\]/s;
const LIST_GROUPS_REGEX = /\[\[\[\s*LIST_GROUPS\s*\]\]\]/s;
const DECLARE_TASKS_REGEX = /\[\[\[\s*DECLARE_TASKS\s*(\{.*?\})\s*\]\]\]/s;
const TASK_STATUS_REGEX = /\[\[\[\s*TASK_STATUS\s*\]\]\]/s;
const PAUSE_TASK_REGEX = /\[\[\[\s*PAUSE_TASK\s*(\{.*?\})\s*\]\]\]/s;
const RETRY_TASK_REGEX = /\[\[\[\s*RETRY_TASK\s*(\{.*?\})\s*\]\]\]/s;
const SKIP_TASK_REGEX = /\[\[\[\s*SKIP_TASK\s*(\{.*?\})\s*\]\]\]/s;
const ADD_TASK_REGEX = /\[\[\[\s*ADD_TASK\s*(\{.*?\})\s*\]\]\]/s;
const CANCEL_TASK_REGEX = /\[\[\[\s*CANCEL_TASK\s*(\{.*?\})\s*\]\]\]/s;

// ── Types ────────────────────────────────────────────────────────────

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

/**
 * Interface for services the CommandDispatcher needs from AgentManager.
 * Keeps the dependency explicit and testable.
 */
export interface CommandContext {
  getAgent(id: string): Agent | undefined;
  getAllAgents(): Agent[];
  getRunningCount(): number;
  spawnAgent(role: Role, task?: string, parentId?: string, autopilot?: boolean, model?: string, cwd?: string): Agent;
  killAgent(id: string): boolean;
  emit(event: string, ...args: any[]): boolean;
  roleRegistry: RoleRegistry;
  config: ServerConfig;
  lockRegistry: FileLockRegistry;
  activityLedger: ActivityLedger;
  messageBus: MessageBus;
  decisionLog: DecisionLog;
  agentMemory: AgentMemory;
  chatGroupRegistry: ChatGroupRegistry;
  taskDAG: TaskDAG;
  maxConcurrent: number;
}

// ── CommandDispatcher ────────────────────────────────────────────────

export class CommandDispatcher {
  private textBuffers: Map<string, string> = new Map();
  private delegations: Map<string, Delegation> = new Map();
  private reportedCompletions: Set<string> = new Set();
  private ctx: CommandContext;

  constructor(ctx: CommandContext) {
    this.ctx = ctx;
  }

  // ── Public API ─────────────────────────────────────────────────────

  /**
   * Scan accumulated text buffer for complete command patterns.
   * When a pattern is found, execute it and remove it from the buffer.
   * Keep only trailing text that might be the start of a new command.
   */
  scanBuffer(agent: Agent): void {
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
      { regex: DECLARE_TASKS_REGEX, name: 'DECLARE_TASKS', handler: (a, d) => this.handleDeclareTasks(a, d) },
      { regex: TASK_STATUS_REGEX, name: 'TASK_STATUS', handler: (a, _d) => this.handleTaskStatus(a) },
      { regex: PAUSE_TASK_REGEX, name: 'PAUSE_TASK', handler: (a, d) => this.handlePauseTask(a, d) },
      { regex: RETRY_TASK_REGEX, name: 'RETRY_TASK', handler: (a, d) => this.handleRetryTask(a, d) },
      { regex: SKIP_TASK_REGEX, name: 'SKIP_TASK', handler: (a, d) => this.handleSkipTask(a, d) },
      { regex: ADD_TASK_REGEX, name: 'ADD_TASK', handler: (a, d) => this.handleAddTask(a, d) },
      { regex: CANCEL_TASK_REGEX, name: 'CANCEL_TASK', handler: (a, d) => this.handleCancelTask(a, d) },
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
    const lastOpen = buf.lastIndexOf('[[[');
    if (lastOpen >= 0) {
      // Keep from the last incomplete opening tag
      buf = buf.slice(lastOpen);
    } else if (buf.length > 500) {
      buf = buf.slice(-200);
    }
    this.textBuffers.set(agent.id, buf);
  }

  /** Notify parent when a child agent finishes its prompt (goes idle) */
  notifyParentOfIdle(agent: Agent): void {
    if (!agent.parentId) return;
    const parent = this.ctx.getAgent(agent.parentId);
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
    // Strip [[[ ... ]]] command blocks from output
    const cleanPreview = rawOutput.replace(/\[\[\[[\s\S]*?\]\]\]/g, '').replace(/\[\[\[[\s\S]*$/g, '').trim().slice(-6000);
    const sessionLine = agent.sessionId ? `\nSession ID: ${agent.sessionId}` : '';
    const summary = `[Agent Report] ${agent.role.name} (${agent.id.slice(0, 8)}) finished work.\nTask: ${agent.task || 'none'}${sessionLine}\nOutput summary: ${cleanPreview || '(no output)'}`;

    logger.info('delegation', `Child ${agent.role.name} (${agent.id.slice(0, 8)}) finished → notifying parent ${parent.role.name} (${parent.id.slice(0, 8)})`);
    parent.sendMessage(summary);
    this.ctx.emit('agent:message_sent', {
      from: agent.id,
      fromRole: agent.role.name,
      to: parent.id,
      toRole: parent.role.name,
      content: summary,
    });
    this.ctx.emit('agent:completion_reported', { childId: agent.id, parentId: agent.parentId, status: 'completed' });

    // Check if this agent was running a DAG task
    if (agent.parentId) {
      const dagTask = this.ctx.taskDAG.getTaskByAgent(agent.parentId, agent.id);
      if (dagTask) {
        const newlyReady = this.ctx.taskDAG.completeTask(agent.parentId, dagTask.id);
        if (newlyReady.length > 0) {
          const dagParent = this.ctx.getAgent(agent.parentId);
          if (dagParent) {
            const delegated = this.autoDelegateReadyTasks(dagParent, newlyReady);
            if (delegated.length > 0) {
              dagParent.sendMessage(`[System] DAG: Task "${dagTask.id}" done. Auto-started: ${delegated.map(d => d.id).join(', ')}`);
            }
          }
        }
      }
    }
  }

  notifyParentOfCompletion(agent: Agent, exitCode: number | null): void {
    if (!agent.parentId) return;
    const parent = this.ctx.getAgent(agent.parentId);
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
    const cleanPreview2 = rawOutput2.replace(/\[\[\[[\s\S]*?\]\]\]/g, '').replace(/\[\[\[[\s\S]*$/g, '').trim().slice(-6000);
    const sessionLine2 = agent.sessionId ? `\nSession ID: ${agent.sessionId}` : '';
    const summary = `[Agent Report] ${agent.role.name} (${agent.id.slice(0, 8)}) ${status}.\nTask: ${agent.task || 'none'}${sessionLine2}\nOutput summary: ${cleanPreview2 || '(no output)'}`;

    logger.info('delegation', `Child ${agent.role.name} (${agent.id.slice(0, 8)}) → parent ${parent.role.name} (${parent.id.slice(0, 8)}): ${status}`);
    parent.sendMessage(summary);
    this.ctx.emit('agent:message_sent', {
      from: agent.id,
      fromRole: agent.role.name,
      to: parent.id,
      toRole: parent.role.name,
      content: summary,
    });
    this.ctx.emit('agent:completion_reported', { childId: agent.id, parentId: agent.parentId, status });

    if (agent.parentId && exitCode !== 0) {
      const dagTask = this.ctx.taskDAG.getTaskByAgent(agent.parentId, agent.id);
      if (dagTask) {
        this.ctx.taskDAG.failTask(agent.parentId, dagTask.id);
        const dagParent = this.ctx.getAgent(agent.parentId);
        if (dagParent) {
          dagParent.sendMessage(`[System] DAG: Task "${dagTask.id}" FAILED (exit ${exitCode}). Dependents blocked. Use RETRY_TASK or SKIP_TASK.`);
        }
      }
    }
  }

  getDelegations(parentId?: string): Delegation[] {
    const all = Array.from(this.delegations.values());
    return parentId ? all.filter((d) => d.fromAgentId === parentId) : all;
  }

  clearBuffer(agentId: string): void {
    this.textBuffers.delete(agentId);
  }

  appendToBuffer(agentId: string, data: string): void {
    const buf = (this.textBuffers.get(agentId) || '') + data;
    this.textBuffers.set(agentId, buf);
  }

  clearCompletionTracking(agentId: string): void {
    this.reportedCompletions.delete(`${agentId}:idle`);
    this.reportedCompletions.delete(`${agentId}:exit`);
  }

  /** Access delegations map for heartbeat checks */
  getDelegationsMap(): Map<string, Delegation> {
    return this.delegations;
  }

  // ── Detect / handle methods (private) ──────────────────────────────

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
        agent.sendMessage(`[System] CREATE_AGENT requires a "role" field. Available roles: ${this.ctx.roleRegistry.getAll().map(r => r.id).join(', ')}`);
        return;
      }

      const role = this.ctx.roleRegistry.get(req.role);
      if (!role) {
        agent.sendMessage(`[System] Unknown role: ${req.role}. Available: ${this.ctx.roleRegistry.getAll().map(r => r.id).join(', ')}`);
        return;
      }

      const child = this.ctx.spawnAgent(role, req.task, agent.id, true, req.model, agent.cwd);
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
        this.ctx.emit('agent:message_sent', {
          from: child.id, fromRole: role.name,
          to: agent.id, toRole: agent.role.name,
          content: ackMsg,
        });
        this.ctx.emit('agent:delegated', { parentId: agent.id, childId: child.id, delegation });

        this.ctx.activityLedger.log(agent.id, agent.role.id, 'delegated', `Created & delegated to ${role.name}: ${req.task.slice(0, 100)}`, {
          childId: child.id, childRole: role.id, delegationId: delegation.id,
        });
      } else {
        const ackMsg = `[System] Queued: ${role.name} (${child.id.slice(0, 8)})${req.model ? ` [${req.model}]` : ''} — ready for tasks.`;
        agent.sendMessage(ackMsg);
        this.ctx.emit('agent:message_sent', {
          from: child.id, fromRole: role.name,
          to: agent.id, toRole: agent.role.name,
          content: ackMsg,
        });
      }

      // Store memory for the lead
      this.ctx.agentMemory.store(agent.id, child.id, 'role', role.name);
      if (req.model) this.ctx.agentMemory.store(agent.id, child.id, 'model', req.model);
      if (req.task) this.ctx.agentMemory.store(agent.id, child.id, 'task', req.task.slice(0, 200));

      this.ctx.emit('agent:sub_spawned', agent.id, child.toJSON());
    } catch (err: any) {
      // Send meaningful error back to the lead with budget info
      if (err.message?.includes('Concurrency limit')) {
        const running = this.ctx.getRunningCount();
        const idle = this.ctx.getAllAgents().filter((a) => a.parentId === agent.id && a.status === 'idle');
        const idleList = idle.length > 0
          ? `\nIdle agents you can kill to free slots:\n${idle.map((a) => `- ${a.id.slice(0, 8)} — ${a.role.name}${a.sessionId ? ` (session: ${a.sessionId})` : ''}`).join('\n')}`
          : '\nNo idle agents to kill — wait for a running agent to finish.';
        agent.sendMessage(`[System] Cannot create agent: concurrency limit reached (${running}/${this.ctx.maxConcurrent}).${idleList}\nUse KILL_AGENT to free a slot, then try CREATE_AGENT again.`);
      } else {
        agent.sendMessage(`[System] Failed to create agent: ${err.message}`);
      }
      this.ctx.emit('agent:spawn_error', agent.id, err.message);
    }
  }

  private detectLockRequest(agent: Agent, data: string): void {
    const match = data.match(LOCK_REQUEST_REGEX);
    if (!match) return;

    try {
      const request = JSON.parse(match[1]);
      const agentRole = agent.role?.id ?? 'unknown';
      const result = this.ctx.lockRegistry.acquire(agent.id, agentRole, request.filePath, request.reason);
      if (result.ok) {
        this.ctx.activityLedger.log(agent.id, agentRole, 'lock_acquired', `Locked ${request.filePath}`, {
          filePath: request.filePath,
          reason: request.reason,
        });
        agent.sendMessage(`[System] Lock acquired on \`${request.filePath}\`. You may proceed with edits. Remember to release it when done with [[[ UNLOCK_FILE {"filePath": "${request.filePath}"} ]]]`);
      } else {
        const holderShort = result.holder?.slice(0, 8) ?? 'unknown';
        agent.sendMessage(`[System] Lock DENIED on \`${request.filePath}\` — currently held by agent ${holderShort}. Wait for them to release it, or coordinate via AGENT_MESSAGE.`);
        this.ctx.activityLedger.log(agent.id, agentRole, 'lock_denied', `Lock denied on ${request.filePath} (held by ${holderShort})`, {
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
      const released = this.ctx.lockRegistry.release(agent.id, request.filePath);
      if (released) {
        const agentRole = agent.role?.id ?? 'unknown';
        this.ctx.activityLedger.log(agent.id, agentRole, 'lock_released', `Released ${request.filePath}`, {
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
      this.ctx.activityLedger.log(
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
      const allAgents = this.ctx.getAllAgents();
      if (!this.ctx.getAgent(targetId)) {
        // Try short ID prefix match (agents see 8-char prefixes in context)
        const byPrefix = allAgents.find((a) => a.id.startsWith(msg.to) && (a.status === 'running' || a.status === 'idle'));
        if (byPrefix) {
          targetId = byPrefix.id;
        } else {
          // Try to find by role ID
          const byRoleId = allAgents.find((a) => a.role.id === msg.to && (a.status === 'running' || a.status === 'idle'));
          if (byRoleId) {
            targetId = byRoleId.id;
          } else {
            // Try by role name (case-insensitive)
            const lower = msg.to.toLowerCase();
            const byRoleName = allAgents.find((a) =>
              a.role.name.toLowerCase() === lower && (a.status === 'running' || a.status === 'idle')
            );
            if (byRoleName) {
              targetId = byRoleName.id;
            } else {
              // Try partial match on role
              const partial = allAgents.find((a) =>
                (a.role.id.includes(lower) || a.role.name.toLowerCase().includes(lower)) && (a.status === 'running' || a.status === 'idle')
              );
              if (partial) targetId = partial.id;
            }
          }
        }
      }

      const targetAgent = this.ctx.getAgent(targetId);
      if (!targetAgent) {
        logger.warn('message', `Cannot resolve target "${msg.to}" for message from ${agent.role.name} (${agent.id.slice(0, 8)})`);
        return;
      }

      this.ctx.messageBus.send({
        from: agent.id,
        to: targetId,
        type: 'request',
        content: msg.content,
      });

      logger.info('message', `Agent message: ${agent.role.name} (${agent.id.slice(0, 8)}) → ${targetAgent.role.name} (${targetId.slice(0, 8)})`, {
        contentPreview: msg.content.slice(0, 80),
      });
      this.ctx.emit('agent:message_sent', {
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
      const child = this.ctx.getAllAgents().find((a) =>
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
      this.ctx.agentMemory.store(agent.id, child.id, 'task', req.task.slice(0, 200));
      if (req.context) this.ctx.agentMemory.store(agent.id, child.id, 'context', req.context.slice(0, 200));

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
      this.ctx.emit('agent:message_sent', {
        from: child.id,
        fromRole: child.role.name,
        to: agent.id,
        toRole: agent.role.name,
        content: ackMsg,
      });

      this.ctx.activityLedger.log(agent.id, agent.role.id, 'delegated', `Delegated to ${child.role.name} (${child.id.slice(0, 8)}): ${req.task.slice(0, 100)}`, {
        childId: child.id,
        childRole: child.role.id,
        delegationId: delegation.id,
      });

      this.ctx.emit('agent:delegated', { parentId: agent.id, childId: child.id, delegation });
    } catch (err: any) {
      this.ctx.emit('agent:delegate_error', agent.id, err.message);
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
      const recorded = this.ctx.decisionLog.add(agent.id, agent.role?.id ?? 'unknown', decision.title, decision.rationale ?? '', needsConfirmation, leadId);
      logger.info('lead', `Decision by ${agent.role.name}: "${decision.title}"${needsConfirmation ? ' [needs confirmation]' : ''}`, { rationale: decision.rationale?.slice(0, 100) });
      // Include leadId so frontend routes to the correct project
      this.ctx.emit('lead:decision', {
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
      this.ctx.emit('lead:progress', { agentId: agent.id, ...progress });

      // Route progress to any secretary agent that shares the same parent
      const parentId = agent.parentId || agent.id;
      const secretaries = this.ctx.getAllAgents().filter(
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
    const allAgents = this.ctx.getAllAgents();
    const roster = allAgents
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

    const running = this.ctx.getRunningCount();
    const budgetLine = agent.role.id === 'lead'
      ? `\n== AGENT BUDGET ==\nRunning: ${running} / ${this.ctx.maxConcurrent} | Available slots: ${Math.max(0, this.ctx.maxConcurrent - running)}${running >= this.ctx.maxConcurrent ? ' | ⚠ AT CAPACITY' : ''}\n`
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
      const memories = this.ctx.agentMemory.getByLead(agent.id);
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

    const response = `[[[ CREW_ROSTER${humanMsgIndicator}
== ACTIVE CREW MEMBERS ==
${rosterLines}
${budgetLine}${siblingSection}${memorySection}
To assign a task to an agent, use their ID:
\`[[[ DELEGATE {"to": "agent-id", "task": "your task"} ]]]\`
To create a new agent:
\`[[[ CREATE_AGENT {"role": "developer", "model": "claude-opus-4.6", "task": "optional task"} ]]]\`
To kill an agent and free a slot:
\`[[[ KILL_AGENT {"id": "agent-id", "reason": "no longer needed"} ]]]\`
CREW_ROSTER ]]]`;

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
      const recipients = this.ctx.getAllAgents().filter((a) =>
        a.id !== agent.id &&
        (a.id === leadId || a.parentId === leadId) &&
        (a.status === 'running' || a.status === 'idle')
      );

      const fromLabel = `${agent.role.name} (${agent.id.slice(0, 8)})`;
      logger.info('message', `Broadcast from ${fromLabel} to ${recipients.length} agents: ${msg.content.slice(0, 80)}`);

      for (const recipient of recipients) {
        recipient.sendMessage(`[Broadcast from ${fromLabel}]: ${msg.content}`);
      }

      this.ctx.emit('agent:message_sent', {
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
      const target = this.ctx.getAllAgents().find((a) =>
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

      this.ctx.killAgent(target.id);

      const ackMsg = `[System] Killed ${roleName} (${shortId}).${sessionId ? ` Session ID: ${sessionId} — use this in CREATE_AGENT with "sessionId" to resume later.` : ''} Freed 1 agent slot. ${req.reason ? `Reason: ${req.reason}` : ''}`;
      agent.sendMessage(ackMsg);

      this.ctx.activityLedger.log(agent.id, agent.role.id, 'agent_killed', `Killed ${roleName} (${shortId})${req.reason ? ': ' + req.reason.slice(0, 100) : ''}`, {
        killedAgentId: target.id,
        killedRole: target.role.id,
        sessionId: sessionId || null,
      });

      logger.info('agent', `Lead ${agent.id.slice(0, 8)} killed ${roleName} (${shortId})${req.reason ? ': ' + req.reason : ''}`);
    } catch {
      // ignore malformed kill requests
    }
  }

  // ── Task DAG handlers ──────────────────────────────────────────────

  private handleDeclareTasks(agent: Agent, data: string): void {
    if (agent.role.id !== 'lead') {
      agent.sendMessage('[System] Only the Project Lead can declare task DAGs.');
      return;
    }
    const match = data.match(DECLARE_TASKS_REGEX);
    if (!match) return;
    try {
      const req = JSON.parse(match[1]);
      if (!req.tasks || !Array.isArray(req.tasks)) {
        agent.sendMessage('[System] DECLARE_TASKS requires a "tasks" array.');
        return;
      }
      const { tasks, conflicts } = this.ctx.taskDAG.declareTaskBatch(agent.id, req.tasks as DagTaskInput[]);
      let msg = `[System] Task DAG declared: ${tasks.length} tasks added.`;
      const readyCount = tasks.filter(t => t.dagStatus === 'ready').length;
      const pendingCount = tasks.filter(t => t.dagStatus === 'pending').length;
      msg += `\n  Ready: ${readyCount}, Pending (waiting on deps): ${pendingCount}`;
      if (conflicts.length > 0) {
        msg += '\n⚠️ FILE CONFLICTS detected (tasks share files without explicit dependency):';
        for (const c of conflicts) {
          msg += `\n  - ${c.file}: tasks [${c.tasks.join(', ')}]`;
        }
        msg += '\nConsider adding depends_on between these tasks or confirming parallel execution.';
      }
      // Auto-delegate ready tasks
      const readyTasks = tasks.filter(t => t.dagStatus === 'ready');
      const delegated = this.autoDelegateReadyTasks(agent, readyTasks);
      if (delegated.length > 0) {
        msg += `\nAuto-delegated ${delegated.length} ready tasks: ${delegated.map(d => d.id).join(', ')}`;
      }
      agent.sendMessage(msg);
      this.ctx.emit('dag:updated', { leadId: agent.id });
    } catch (err: any) {
      agent.sendMessage(`[System] DECLARE_TASKS error: ${err.message}`);
    }
  }

  private handleTaskStatus(agent: Agent): void {
    const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
    if (!leadId) {
      agent.sendMessage('[System] No task DAG found.');
      return;
    }
    const status = this.ctx.taskDAG.getStatus(leadId);
    if (status.tasks.length === 0) {
      agent.sendMessage('[System] No task DAG declared. Use DECLARE_TASKS to create one.');
      return;
    }
    const { tasks, fileLockMap, summary } = status;
    let msg = '== TASK DAG STATUS ==\n';
    msg += `Summary: ${summary.done} done, ${summary.running} running, ${summary.ready} ready, ${summary.pending} pending`;
    if (summary.failed > 0) msg += `, ${summary.failed} FAILED`;
    if (summary.blocked > 0) msg += `, ${summary.blocked} blocked`;
    if (summary.paused > 0) msg += `, ${summary.paused} paused`;
    if (summary.skipped > 0) msg += `, ${summary.skipped} skipped`;
    msg += '\n\nTasks:';
    for (const task of tasks) {
      const statusIcon = { pending: '⏳', ready: '🟢', running: '🔵', done: '✅', failed: '❌', blocked: '🚫', paused: '⏸️', skipped: '⏭️' }[task.dagStatus] || '?';
      msg += `\n  ${statusIcon} [${task.dagStatus.toUpperCase()}] ${task.id} (${task.role})`;
      if (task.description) msg += ` — ${task.description.slice(0, 80)}`;
      if (task.assignedAgentId) msg += ` [agent: ${task.assignedAgentId.slice(0, 8)}]`;
      if (task.dependsOn.length > 0) msg += `\n      depends_on: [${task.dependsOn.join(', ')}]`;
      if (task.files.length > 0) msg += `\n      files: [${task.files.join(', ')}]`;
    }
    if (Object.keys(fileLockMap).length > 0) {
      msg += '\n\nFile Lock Map:';
      for (const [file, info] of Object.entries(fileLockMap)) {
        msg += `\n  ${file} → ${info.taskId}${info.agentId ? ` (${info.agentId.slice(0, 8)})` : ''}`;
      }
    }
    agent.sendMessage(msg);
  }

  private handlePauseTask(agent: Agent, data: string): void {
    if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can pause tasks.'); return; }
    const match = data.match(PAUSE_TASK_REGEX);
    if (!match) return;
    try {
      const req = JSON.parse(match[1]);
      const ok = this.ctx.taskDAG.pauseTask(agent.id, req.id);
      agent.sendMessage(ok ? `[System] Task "${req.id}" paused.` : `[System] Cannot pause task "${req.id}" (must be pending or ready).`);
    } catch { agent.sendMessage('[System] PAUSE_TASK error: invalid payload.'); }
  }

  private handleRetryTask(agent: Agent, data: string): void {
    if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can retry tasks.'); return; }
    const match = data.match(RETRY_TASK_REGEX);
    if (!match) return;
    try {
      const req = JSON.parse(match[1]);
      const ok = this.ctx.taskDAG.retryTask(agent.id, req.id);
      if (ok) {
        agent.sendMessage(`[System] Task "${req.id}" reset to ready. Dependents unblocked.`);
        const ready = this.ctx.taskDAG.resolveReady(agent.id).filter(t => t.id === req.id);
        if (ready.length > 0) {
          const delegated = this.autoDelegateReadyTasks(agent, ready);
          if (delegated.length > 0) agent.sendMessage(`[System] Auto-delegated: ${delegated.map(d => d.id).join(', ')}`);
        }
      } else {
        agent.sendMessage(`[System] Cannot retry task "${req.id}" (must be failed).`);
      }
    } catch { agent.sendMessage('[System] RETRY_TASK error: invalid payload.'); }
  }

  private handleSkipTask(agent: Agent, data: string): void {
    if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can skip tasks.'); return; }
    const match = data.match(SKIP_TASK_REGEX);
    if (!match) return;
    try {
      const req = JSON.parse(match[1]);
      const ok = this.ctx.taskDAG.skipTask(agent.id, req.id);
      if (ok) {
        agent.sendMessage(`[System] Task "${req.id}" skipped. Dependents may now be ready.`);
        const ready = this.ctx.taskDAG.resolveReady(agent.id);
        const delegated = this.autoDelegateReadyTasks(agent, ready);
        if (delegated.length > 0) agent.sendMessage(`[System] Auto-delegated: ${delegated.map(d => d.id).join(', ')}`);
      } else {
        agent.sendMessage(`[System] Cannot skip task "${req.id}".`);
      }
    } catch { agent.sendMessage('[System] SKIP_TASK error: invalid payload.'); }
  }

  private handleAddTask(agent: Agent, data: string): void {
    if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can add tasks.'); return; }
    const match = data.match(ADD_TASK_REGEX);
    if (!match) return;
    try {
      const req = JSON.parse(match[1]) as DagTaskInput;
      if (!req.id || !req.role) { agent.sendMessage('[System] ADD_TASK requires "id" and "role".'); return; }
      const task = this.ctx.taskDAG.addTask(agent.id, req);
      let msg = `[System] Task "${task.id}" added (${task.dagStatus}).`;
      if (task.dagStatus === 'ready') {
        const delegated = this.autoDelegateReadyTasks(agent, [task]);
        if (delegated.length > 0) msg += ` Auto-delegated.`;
      }
      agent.sendMessage(msg);
    } catch (err: any) { agent.sendMessage(`[System] ADD_TASK error: ${err.message}`); }
  }

  private handleCancelTask(agent: Agent, data: string): void {
    if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can cancel tasks.'); return; }
    const match = data.match(CANCEL_TASK_REGEX);
    if (!match) return;
    try {
      const req = JSON.parse(match[1]);
      const ok = this.ctx.taskDAG.cancelTask(agent.id, req.id);
      agent.sendMessage(ok ? `[System] Task "${req.id}" cancelled.` : `[System] Cannot cancel task "${req.id}" (may be running or done).`);
    } catch { agent.sendMessage('[System] CANCEL_TASK error: invalid payload.'); }
  }

  /** Auto-delegate ready tasks to idle agents or create new ones */
  private autoDelegateReadyTasks(lead: Agent, readyTasks: DagTask[]): DagTask[] {
    const delegated: DagTask[] = [];
    for (const task of readyTasks) {
      // Find idle agent with matching role
      const idle = this.ctx.getAllAgents().find(a =>
        a.parentId === lead.id && a.role.id === task.role && a.status === 'idle'
      );
      if (idle) {
        // Reuse idle agent
        const taskPrompt = `[DAG Task] ${task.id}: ${task.description}\nFiles: ${task.files.join(', ') || 'none declared'}`;
        idle.task = task.description.slice(0, 500);
        idle.sendMessage(taskPrompt);
        this.ctx.taskDAG.startTask(lead.id, task.id, idle.id);
        delegated.push(task);
      } else {
        // Try to create new agent
        const role = this.ctx.roleRegistry?.get(task.role);
        if (role) {
          try {
            const child = this.ctx.spawnAgent(role, task.description, lead.id, true, task.model, lead.cwd);
            const taskPrompt = `[DAG Task] ${task.id}: ${task.description}\nFiles: ${task.files.join(', ') || 'none declared'}`;
            child.sendMessage(taskPrompt);
            this.ctx.taskDAG.startTask(lead.id, task.id, child.id);
            delegated.push(task);
          } catch {
            // Budget limit reached — task stays ready for later
          }
        }
      }
    }
    return delegated;
  }

  // ── Group chat handlers ────────────────────────────────────────────

  private detectCreateGroup(agent: Agent, data: string): void {
    const match = data.match(CREATE_GROUP_REGEX);
    if (!match) return;
    try {
      const req = JSON.parse(match[1]);
      if (!req.name || !req.members || !Array.isArray(req.members)) {
        agent.sendMessage('[System] CREATE_GROUP requires "name" (string) and "members" (array of agent IDs).');
        return;
      }
      // Determine the lead context for this group
      const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
      if (!leadId) {
        agent.sendMessage('[System] Cannot create group — no lead context found.');
        return;
      }
      // Resolve member IDs (support short prefixes) — find within the same team
      const resolvedIds: string[] = [];
      for (const memberId of req.members) {
        const resolved = this.ctx.getAllAgents().find((a) =>
          (a.id === memberId || a.id.startsWith(memberId)) && (a.parentId === leadId || a.id === leadId)
        );
        if (resolved) {
          resolvedIds.push(resolved.id);
        } else {
          agent.sendMessage(`[System] Cannot resolve agent "${memberId}" for group. Use QUERY_CREW to see available agents.`);
        }
      }
      const group = this.ctx.chatGroupRegistry.create(leadId, req.name, resolvedIds);
      const memberNames = group.memberIds.map((id) => {
        const a = this.ctx.getAgent(id);
        return a ? `${a.role.name} (${id.slice(0, 8)})` : id.slice(0, 8);
      }).join(', ');
      agent.sendMessage(`[System] Group "${req.name}" created with ${group.memberIds.length} members: ${memberNames}.`);

      // Notify all members (except creator)
      for (const memberId of group.memberIds) {
        if (memberId === agent.id) continue;
        const member = this.ctx.getAgent(memberId);
        if (member && (member.status === 'running' || member.status === 'idle')) {
          member.sendMessage(`[System] You've been added to group "${req.name}". Members: ${memberNames}.\nSend messages: [[[ GROUP_MESSAGE {"group": "${req.name}", "content": "your message"} ]]]`);
        }
      }

      this.ctx.emit('group:created', { group, leadId });
      logger.info('groups', `Agent ${agent.role.name} (${agent.id.slice(0, 8)}) created group "${req.name}" with ${group.memberIds.length} members`);
    } catch { /* ignore malformed */ }
  }

  private detectAddToGroup(agent: Agent, data: string): void {
    const match = data.match(ADD_TO_GROUP_REGEX);
    if (!match) return;
    try {
      const req = JSON.parse(match[1]);
      const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
      if (!leadId) { agent.sendMessage('[System] Cannot manage groups — no lead context found.'); return; }
      if (!req.group || !req.members) return;
      const resolvedIds = req.members.map((m: string) => {
        const found = this.ctx.getAllAgents().find((a) => (a.id === m || a.id.startsWith(m)) && (a.parentId === leadId || a.id === leadId));
        return found?.id;
      }).filter(Boolean) as string[];

      const added = this.ctx.chatGroupRegistry.addMembers(leadId, req.group, resolvedIds);
      if (added.length > 0) {
        // Send recent history to new members
        const history = this.ctx.chatGroupRegistry.getMessages(req.group, leadId, 20);
        for (const memberId of added) {
          const member = this.ctx.getAgent(memberId);
          if (member && (member.status === 'running' || member.status === 'idle')) {
            const allMembers = this.ctx.chatGroupRegistry.getMembers(req.group, leadId);
            const memberNames = allMembers.map((id) => {
              const a = this.ctx.getAgent(id);
              return a ? `${a.role.name} (${id.slice(0, 8)})` : id.slice(0, 8);
            }).join(', ');
            let historyText = '';
            if (history.length > 0) {
              historyText = '\nRecent messages:\n' + history.map((m) => `  [${m.fromRole} (${m.fromAgentId.slice(0, 8)})]: ${m.content}`).join('\n');
            }
            member.sendMessage(`[System] You've been added to group "${req.group}". Members: ${memberNames}.${historyText}\nSend messages: [[[ GROUP_MESSAGE {"group": "${req.group}", "content": "..."} ]]]`);
          }
        }
        const names = added.map((id) => this.ctx.getAgent(id)?.role.name || id.slice(0, 8)).join(', ');
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
      const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
      if (!leadId) { agent.sendMessage('[System] Cannot manage groups — no lead context found.'); return; }
      if (!req.group || !req.members) return;
      const resolvedIds = req.members.map((m: string) => {
        const found = this.ctx.getAllAgents().find((a) => a.id === m || a.id.startsWith(m));
        return found?.id;
      }).filter(Boolean) as string[];

      const removed = this.ctx.chatGroupRegistry.removeMembers(leadId, req.group, resolvedIds);
      if (removed.length > 0) {
        const names = removed.map((id) => this.ctx.getAgent(id)?.role.name || id.slice(0, 8)).join(', ');
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

      const message = this.ctx.chatGroupRegistry.sendMessage(req.group, leadId, agent.id, agent.role.name, req.content);
      if (!message) {
        agent.sendMessage(`[System] Cannot send to group "${req.group}" — you are not a member. Use LIST_GROUPS to see your groups.`);
        return;
      }

      // Deliver to all group members except sender
      const members = this.ctx.chatGroupRegistry.getMembers(req.group, leadId);
      let delivered = 0;
      for (const memberId of members) {
        if (memberId === agent.id) continue;
        const member = this.ctx.getAgent(memberId);
        if (member && (member.status === 'running' || member.status === 'idle')) {
          member.sendMessage(`[Group "${req.group}" — ${agent.role.name} (${agent.id.slice(0, 8)})]: ${req.content}`);
          delivered++;
        }
      }

      agent.sendMessage(`[System] Message delivered to ${delivered} group member(s) in "${req.group}".`);
      this.ctx.emit('group:message', { message, groupName: req.group, leadId });
      logger.info('groups', `Group message in "${req.group}": ${agent.role.name} (${agent.id.slice(0, 8)}) → ${delivered} recipients`);
    } catch { /* ignore */ }
  }

  private handleListGroups(agent: Agent): void {
    const groups = this.ctx.chatGroupRegistry.getGroupsForAgent(agent.id);
    if (groups.length === 0) {
      agent.sendMessage('[System] You are not a member of any groups.');
      return;
    }
    const lines = groups.map((g) => {
      const memberNames = g.memberIds.map((id) => {
        const a = this.ctx.getAgent(id);
        return a ? `${a.role.name} (${id.slice(0, 8)})` : id.slice(0, 8);
      }).join(', ');
      return `- "${g.name}" — ${g.memberIds.length} members: ${memberNames}`;
    });
    agent.sendMessage(`[System] Your groups:\n${lines.join('\n')}\nSend messages: [[[ GROUP_MESSAGE {"group": "name", "content": "..."} ]]]`);
  }
}
