import { Agent, isTerminalStatus } from './Agent.js';
import type { AgentContextInfo } from './Agent.js';
import type { Role, RoleRegistry } from './RoleRegistry.js';
import { MAX_CONCURRENCY_LIMIT } from '../config.js';
import type { ServerConfig } from '../config.js';
import type { FileLockRegistry } from '../coordination/FileLockRegistry.js';
import type { ActivityLedger } from '../coordination/ActivityLedger.js';
import type { MessageBus } from '../comms/MessageBus.js';
import type { DecisionLog } from '../coordination/DecisionLog.js';
import type { AgentMemory, MemoryEntry } from './AgentMemory.js';
import type { ChatGroupRegistry, GroupMessage } from '../comms/ChatGroupRegistry.js';
import { TaskDAG } from '../tasks/TaskDAG.js';
import type { DagTaskInput, DagTask } from '../tasks/TaskDAG.js';
import type { DeferredIssueRegistry } from '../tasks/DeferredIssueRegistry.js';
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
const TERMINATE_AGENT_REGEX = /\[\[\[\s*TERMINATE_AGENT\s*(\{.*?\})\s*\]\]\]/s;
const CREATE_GROUP_REGEX = /\[\[\[\s*CREATE_GROUP\s*(\{.*?\})\s*\]\]\]/s;
const ADD_TO_GROUP_REGEX = /\[\[\[\s*ADD_TO_GROUP\s*(\{.*?\})\s*\]\]\]/s;
const REMOVE_FROM_GROUP_REGEX = /\[\[\[\s*REMOVE_FROM_GROUP\s*(\{.*?\})\s*\]\]\]/s;
const GROUP_MESSAGE_REGEX = /\[\[\[\s*GROUP_MESSAGE\s*(\{.*?\})\s*\]\]\]/s;
const LIST_GROUPS_REGEX = /\[\[\[\s*LIST_GROUPS\s*\]\]\]/s;
const QUERY_GROUPS_REGEX = /\[\[\[\s*QUERY_GROUPS\s*\]\]\]/s;
const DECLARE_TASKS_REGEX = /\[\[\[\s*DECLARE_TASKS\s*(\{.*?\})\s*\]\]\]/s;
const TASK_STATUS_REGEX = /\[\[\[\s*TASK_STATUS\s*\]\]\]/s;
const QUERY_TASKS_REGEX = /\[\[\[\s*QUERY_TASKS\s*\]\]\]/s;
const PAUSE_TASK_REGEX = /\[\[\[\s*PAUSE_TASK\s*(\{.*?\})\s*\]\]\]/s;
const RETRY_TASK_REGEX = /\[\[\[\s*RETRY_TASK\s*(\{.*?\})\s*\]\]\]/s;
const SKIP_TASK_REGEX = /\[\[\[\s*SKIP_TASK\s*(\{.*?\})\s*\]\]\]/s;
const ADD_TASK_REGEX = /\[\[\[\s*ADD_TASK\s*(\{.*?\})\s*\]\]\]/s;
const CANCEL_TASK_REGEX = /\[\[\[\s*CANCEL_TASK\s*(\{.*?\})\s*\]\]\]/s;
const RESET_DAG_REGEX = /\[\[\[\s*RESET_DAG\s*\]\]\]/s;
const HALT_HEARTBEAT_REGEX = /\[\[\[\s*HALT_HEARTBEAT\s*\]\]\]/s;
const REQUEST_LIMIT_CHANGE_REGEX = /\[\[\[\s*REQUEST_LIMIT_CHANGE\s*(\{.*?\})\s*\]\]\]/s;
const CANCEL_DELEGATION_REGEX = /\[\[\[\s*CANCEL_DELEGATION\s*(\{.*?\})\s*\]\]\]/s;
const DEFER_ISSUE_REGEX = /\[\[\[\s*DEFER_ISSUE\s*(\{.*?\})\s*\]\]\]/s;
const QUERY_DEFERRED_REGEX = /\[\[\[\s*QUERY_DEFERRED\s*(\{.*?\})?\s*\]\]\]/s;
const RESOLVE_DEFERRED_REGEX = /\[\[\[\s*RESOLVE_DEFERRED\s*(\{.*?\})\s*\]\]\]/s;
const COMMIT_REGEX = /\[\[\[\s*COMMIT\s*(\{.*?\})\s*\]\]\]/s;

// ── Types ────────────────────────────────────────────────────────────

export interface Delegation {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  toRole: string;
  task: string;
  context?: string;
  status: 'active' | 'completed' | 'failed' | 'cancelled' | 'terminated';
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
  terminateAgent(id: string): boolean;
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
  deferredIssueRegistry: DeferredIssueRegistry;
  maxConcurrent: number;
  markHumanInterrupt(agentId: string): void;
}

// ── CommandDispatcher ────────────────────────────────────────────────

export class CommandDispatcher {
  private textBuffers: Map<string, string> = new Map();
  private delegations: Map<string, Delegation> = new Map();
  private reportedCompletions: Set<string> = new Set();
  private pendingSystemActions: Map<string, { type: string; value: number; agentId: string }> = new Map();
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
      { regex: TERMINATE_AGENT_REGEX, name: 'TERMINATE_AGENT', handler: (a, d) => this.detectTerminateAgent(a, d) },
      { regex: CREATE_GROUP_REGEX, name: 'CREATE_GROUP', handler: (a, d) => this.detectCreateGroup(a, d) },
      { regex: ADD_TO_GROUP_REGEX, name: 'ADD_TO_GROUP', handler: (a, d) => this.detectAddToGroup(a, d) },
      { regex: REMOVE_FROM_GROUP_REGEX, name: 'REMOVE_FROM_GROUP', handler: (a, d) => this.detectRemoveFromGroup(a, d) },
      { regex: GROUP_MESSAGE_REGEX, name: 'GROUP_MSG', handler: (a, d) => this.detectGroupMessage(a, d) },
      { regex: LIST_GROUPS_REGEX, name: 'LIST_GROUPS', handler: (a, _d) => this.handleListGroups(a) },
      { regex: QUERY_GROUPS_REGEX, name: 'QUERY_GROUPS', handler: (a, _d) => this.handleListGroups(a) },
      { regex: DECLARE_TASKS_REGEX, name: 'DECLARE_TASKS', handler: (a, d) => this.handleDeclareTasks(a, d) },
      { regex: TASK_STATUS_REGEX, name: 'TASK_STATUS', handler: (a, _d) => this.handleTaskStatus(a) },
      { regex: QUERY_TASKS_REGEX, name: 'QUERY_TASKS', handler: (a, _d) => this.handleTaskStatus(a) },
      { regex: PAUSE_TASK_REGEX, name: 'PAUSE_TASK', handler: (a, d) => this.handlePauseTask(a, d) },
      { regex: RETRY_TASK_REGEX, name: 'RETRY_TASK', handler: (a, d) => this.handleRetryTask(a, d) },
      { regex: SKIP_TASK_REGEX, name: 'SKIP_TASK', handler: (a, d) => this.handleSkipTask(a, d) },
      { regex: ADD_TASK_REGEX, name: 'ADD_TASK', handler: (a, d) => this.handleAddTask(a, d) },
      { regex: CANCEL_TASK_REGEX, name: 'CANCEL_TASK', handler: (a, d) => this.handleCancelTask(a, d) },
      { regex: RESET_DAG_REGEX, name: 'RESET_DAG', handler: (a, _d) => this.handleResetDAG(a) },
      { regex: HALT_HEARTBEAT_REGEX, name: 'HALT_HEARTBEAT', handler: (a, _d) => this.handleHaltHeartbeat(a) },
      { regex: REQUEST_LIMIT_CHANGE_REGEX, name: 'REQUEST_LIMIT_CHANGE', handler: (a, d) => this.handleRequestLimitChange(a, d) },
      { regex: CANCEL_DELEGATION_REGEX, name: 'CANCEL_DELEGATION', handler: (a, d) => this.handleCancelDelegation(a, d) },
      { regex: DEFER_ISSUE_REGEX, name: 'DEFER_ISSUE', handler: (a, d) => this.handleDeferIssue(a, d) },
      { regex: QUERY_DEFERRED_REGEX, name: 'QUERY_DEFERRED', handler: (a, d) => this.handleQueryDeferred(a, d) },
      { regex: RESOLVE_DEFERRED_REGEX, name: 'RESOLVE_DEFERRED', handler: (a, d) => this.handleResolveDeferred(a, d) },
      { regex: COMMIT_REGEX, name: 'COMMIT', handler: (a, d) => this.handleCommit(a, d) },
    ];

    let found = true;
    while (found) {
      found = false;
      // Find the leftmost match across ALL patterns to prevent inner [[[ from
      // being parsed before the outer command that contains them (issue #26).
      let best: { index: number; end: number; name: string; handler: (a: Agent, d: string) => void; text: string } | null = null;
      for (const { regex, name, handler } of patterns) {
        const match = buf.match(regex);
        if (match && match.index !== undefined) {
          if (!best || match.index < best.index) {
            best = { index: match.index, end: match.index + match[0].length, name, handler, text: match[0] };
          }
        }
      }
      if (best) {
        // Skip commands whose [[[ is nested inside another [[[ ]]] block
        if (CommandDispatcher.isInsideCommandBlock(buf, best.index)) {
          logger.debug('agent', `Skipped nested command: ${best.name} from ${agent.role.name} (${agent.id.slice(0, 8)})`);
          buf = buf.slice(0, best.index) + buf.slice(best.end);
          found = true;
        } else {
          logger.debug('agent', `Command: ${best.name} from ${agent.role.name} (${agent.id.slice(0, 8)})`);
          best.handler(agent, best.text);
          buf = buf.slice(0, best.index) + buf.slice(best.end);
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
        del.result = agent.getRecentOutput(8000);
      }
    }

    const rawOutput = agent.getRecentOutput(8000);
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
    this.ctx.activityLedger.log(agent.id, agent.role.id, 'message_sent', `Completion report → ${parent.role.name} (${parent.id.slice(0, 8)})`, {
      toAgentId: parent.id, toRole: parent.role.id,
    });
    this.ctx.emit('agent:completion_reported', { childId: agent.id, parentId: agent.parentId, status: 'completed' });

    // Check if this agent was running a DAG task
    if (agent.parentId) {
      const dagTask = this.ctx.taskDAG.getTaskByAgent(agent.parentId, agent.id);
      if (dagTask) {
        const newlyReady = this.ctx.taskDAG.completeTask(agent.parentId, dagTask.id);
        if (newlyReady && newlyReady.length > 0) {
          const dagParent = this.ctx.getAgent(agent.parentId);
          if (dagParent) {
            const readyNames = newlyReady.map(d => d.id).join(', ');
            dagParent.sendMessage(`[System] DAG: Task "${dagTask.id}" done. Newly ready tasks: ${readyNames}. Use DELEGATE or CREATE_AGENT to assign them.`);
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
          del.result = agent.getRecentOutput(8000);
        }
      }
      return;
    }

    // Update delegation records
    for (const [, del] of this.delegations) {
      if (del.toAgentId === agent.id && del.status === 'active') {
        del.status = exitCode === 0 ? 'completed' : 'failed';
        del.completedAt = new Date().toISOString();
        del.result = agent.getRecentOutput(8000);
      }
    }

    const status = exitCode === -1 ? 'terminated' : exitCode === 0 ? 'completed successfully' : `failed (exit code ${exitCode})`;
    const rawOutput2 = agent.getRecentOutput(8000);
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
    this.ctx.activityLedger.log(agent.id, agent.role.id, 'message_sent', `Exit report (${status}) → ${parent.role.name} (${parent.id.slice(0, 8)})`, {
      toAgentId: parent.id, toRole: parent.role.id,
    });
    this.ctx.emit('agent:completion_reported', { childId: agent.id, parentId: agent.parentId, status });

    if (agent.parentId) {
      const dagTask = this.ctx.taskDAG.getTaskByAgent(agent.parentId, agent.id);
      if (dagTask) {
        if (exitCode === 0) {
          const newlyReady = this.ctx.taskDAG.completeTask(agent.parentId, dagTask.id);
          if (newlyReady && newlyReady.length > 0) {
            const dagParent = this.ctx.getAgent(agent.parentId);
            if (dagParent) {
              const readyNames = newlyReady.map(d => d.id).join(', ');
              dagParent.sendMessage(`[System] DAG: Task "${dagTask.id}" done. Newly ready tasks: ${readyNames}. Use DELEGATE or CREATE_AGENT to assign them.`);
            }
          }
        } else {
          this.ctx.taskDAG.failTask(agent.parentId, dagTask.id);
          const dagParent = this.ctx.getAgent(agent.parentId);
          if (dagParent) {
            dagParent.sendMessage(`[System] DAG: Task "${dagTask.id}" FAILED (exit ${exitCode}). Dependents blocked. Use RETRY_TASK or SKIP_TASK.`);
          }
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

  /** Mark all active delegations involving an agent as failed (used when agent is terminated) */
  completeDelegationsForAgent(agentId: string): void {
    for (const [, del] of this.delegations) {
      if (del.status === 'active' && del.toAgentId === agentId) {
        del.status = 'failed';
      }
    }
  }

  /** Remove completed/failed/cancelled delegations older than the given age (ms). Returns count removed. */
  cleanupStaleDelegations(maxAgeMs = 300_000): number {
    const cutoff = Date.now() - maxAgeMs;
    let count = 0;
    for (const [id, del] of this.delegations) {
      if ((del.status === 'completed' || del.status === 'failed' || del.status === 'cancelled') && new Date(del.createdAt).getTime() <= cutoff) {
        this.delegations.delete(id);
        count++;
      }
    }
    return count;
  }

  /** Access delegations map for heartbeat checks */
  getDelegationsMap(): Map<string, Delegation> {
    return this.delegations;
  }

  /** Get and remove a pending system action by decision ID */
  consumePendingSystemAction(decisionId: string): { type: string; value: number; agentId: string } | undefined {
    const action = this.pendingSystemActions.get(decisionId);
    if (action) this.pendingSystemActions.delete(decisionId);
    return action;
  }

  // ── Detect / handle methods (private) ──────────────────────────────

  private detectSpawnRequest(agent: Agent, data: string): void {
    const match = data.match(SPAWN_REQUEST_REGEX);
    if (!match) return;

    // SPAWN_AGENT is deprecated — only the lead can create agents via CREATE_AGENT
    logger.warn('agent', `Agent ${agent.role.name} (${agent.id.slice(0, 8)}) attempted SPAWN_AGENT — rejected. Only the lead can create agents.`);
    agent.sendMessage(`[System] SPAWN_AGENT is not available. Only the Project Lead can create agents using CREATE_AGENT. If you need help, ask the lead via AGENT_MESSAGE.`);
  }

  private detectCreateAgent(agent: Agent, data: string, _autoScaleRetry = false): void {
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
        // Set projectName at creation so it won't change when tasks are delegated
        child.projectName = req.name || req.task?.slice(0, 60) || `Sub-project ${new Date().toLocaleDateString()}`;
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

        const dupMatch = req.task ? this.findSimilarActiveDelegation(req.task, child.id) : null;
        const dupNote = dupMatch ? `\n⚠ Note: Similar task already delegated to ${dupMatch.role} (${dupMatch.agentId.slice(0, 8)}): "${dupMatch.task}"` : '';
        const ackMsg = `[System] Queued: ${role.name} (${child.id.slice(0, 8)})${req.model ? ` [${req.model}]` : ''}${dupNote}`;
        agent.sendMessage(ackMsg);
        this.ctx.emit('agent:message_sent', {
          from: child.id, fromRole: role.name,
          to: agent.id, toRole: agent.role.name,
          content: ackMsg,
        });
        this.ctx.activityLedger.log(child.id, role.id, 'message_sent', `Created & delegated ack → ${agent.role.name} (${agent.id.slice(0, 8)})`, {
          toAgentId: agent.id, toRole: agent.role.id,
        });
        this.ctx.emit('agent:delegated', { parentId: agent.id, childId: child.id, delegation });

        this.ctx.activityLedger.log(agent.id, agent.role.id, 'delegated', `Created & delegated to ${role.name}: ${req.task.slice(0, 100)}`, {
          toAgentId: child.id, toRole: role.id, childId: child.id, childRole: role.id, delegationId: delegation.id,
        });
      } else {
        const ackMsg = `[System] Queued: ${role.name} (${child.id.slice(0, 8)})${req.model ? ` [${req.model}]` : ''} — ready for tasks.`;
        agent.sendMessage(ackMsg);
        this.ctx.emit('agent:message_sent', {
          from: child.id, fromRole: role.name,
          to: agent.id, toRole: agent.role.name,
          content: ackMsg,
        });
        this.ctx.activityLedger.log(child.id, role.id, 'message_sent', `Agent created ack → ${agent.role.name} (${agent.id.slice(0, 8)})`, {
          toAgentId: agent.id, toRole: agent.role.id,
        });
      }

      // Store memory for the lead
      this.ctx.agentMemory.store(agent.id, child.id, 'role', role.name);
      if (req.model) this.ctx.agentMemory.store(agent.id, child.id, 'model', req.model);
      if (req.task) this.ctx.agentMemory.store(agent.id, child.id, 'task', req.task.slice(0, 200));

      this.ctx.emit('agent:sub_spawned', { parentId: agent.id, child: child.toJSON() });
    } catch (err: any) {
      // If this is an auto-scale retry, propagate error to the parent catch
      if (_autoScaleRetry) throw err;
      // Auto-scale concurrency limit when the cap is hit (only once per attempt)
      if (err.message?.includes('Concurrency limit')) {
        const currentLimit = this.ctx.maxConcurrent;
        if (currentLimit >= MAX_CONCURRENCY_LIMIT) {
          agent.sendMessage(`[System] Concurrency limit reached hard cap (${MAX_CONCURRENCY_LIMIT}). Cannot create more agents.`);
          this.ctx.emit('agent:spawn_error', { agentId: agent.id, message: `Hard concurrency cap ${MAX_CONCURRENCY_LIMIT} reached` });
          return;
        }
        const newLimit = Math.min(currentLimit + 10, MAX_CONCURRENCY_LIMIT);
        this.ctx.maxConcurrent = newLimit;
        logger.info('agent', `Auto-scaled concurrency limit: ${currentLimit} → ${newLimit} (triggered by ${agent.role.name} ${agent.id.slice(0, 8)})`);
        agent.sendMessage(`[System] Concurrency limit auto-increased: ${currentLimit} → ${newLimit}. Retrying agent creation...`);
        this.ctx.emit('config:concurrency_changed', { old: currentLimit, new: newLimit, reason: 'auto-scale' });

        // Retry the CREATE_AGENT command after scaling up
        try {
          this.detectCreateAgent(agent, data, true);
          return;
        } catch (retryErr: any) {
          agent.sendMessage(`[System] Failed to create agent after auto-scaling: ${retryErr.message}`);
          this.ctx.emit('agent:spawn_error', { agentId: agent.id, message: retryErr.message });
          return;
        }
      } else {
        agent.sendMessage(`[System] Failed to create agent: ${err.message}`);
      }
      this.ctx.emit('agent:spawn_error', { agentId: agent.id, message: err.message });
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
    } catch (err) {
      logger.debug('command', 'Failed to parse LOCK_FILE command', { error: (err as Error).message });
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
    } catch (err) {
      logger.debug('command', 'Failed to parse UNLOCK_FILE command', { error: (err as Error).message });
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
    } catch (err) {
      logger.debug('command', 'Failed to parse ACTIVITY command', { error: (err as Error).message });
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
      this.ctx.activityLedger.log(agent.id, agent.role.id, 'message_sent', `Message → ${targetAgent.role.name} (${targetId.slice(0, 8)})`, {
        toAgentId: targetId, toRole: targetAgent.role.id,
      });
    } catch (err) {
      logger.debug('command', 'Failed to parse AGENT_MESSAGE command', { error: (err as Error).message });
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
      const dupMatch = this.findSimilarActiveDelegation(req.task, child.id);
      const dupNote = dupMatch ? `\n⚠ Note: Similar task already delegated to ${dupMatch.role} (${dupMatch.agentId.slice(0, 8)}): "${dupMatch.task}"` : '';
      const ackMsg = `[System] Task delegated: ${child.role.name} (${child.id.slice(0, 8)})${statusNote} — ${req.task.slice(0, 120)}${dupNote}`;
      agent.sendMessage(ackMsg);
      this.ctx.emit('agent:message_sent', {
        from: child.id,
        fromRole: child.role.name,
        to: agent.id,
        toRole: agent.role.name,
        content: ackMsg,
      });
      this.ctx.activityLedger.log(child.id, child.role.id, 'message_sent', `Delegation ack → ${agent.role.name} (${agent.id.slice(0, 8)})`, {
        toAgentId: agent.id, toRole: agent.role.id,
      });

      this.ctx.activityLedger.log(agent.id, agent.role.id, 'delegated', `Delegated to ${child.role.name} (${child.id.slice(0, 8)}): ${req.task.slice(0, 100)}`, {
        toAgentId: child.id, toRole: child.role.id, childId: child.id, childRole: child.role.id, delegationId: delegation.id,
      });

      this.ctx.emit('agent:delegated', { parentId: agent.id, childId: child.id, delegation });

      // Auto-create coordination group when 3+ agents share a keyword
      this.maybeAutoCreateGroup(agent);
    } catch (err: any) {
      this.ctx.emit('agent:delegate_error', { agentId: agent.id, message: err.message });
    }
  }

  /** When 3+ active delegations from the same lead share a keyword, auto-create a group. */
  private maybeAutoCreateGroup(lead: Agent): void {
    const active = [...this.delegations.values()].filter(
      d => d.fromAgentId === lead.id && d.status === 'active',
    );
    if (active.length < 3) return;

    // Extract first significant word (>3 chars, lowercase) from each task
    const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'implement', 'create', 'build', 'fix', 'add', 'review', 'update', 'check', 'test', 'run', 'verify', 'ensure', 'handle', 'process', 'manage']);
    const getKeyword = (task: string): string | null => {
      const words = task.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
      return words.find(w => w.length > 3 && !stopWords.has(w)) ?? null;
    };

    // Count keyword frequency across delegations
    const keywordAgents = new Map<string, Set<string>>();
    for (const d of active) {
      const kw = getKeyword(d.task);
      if (!kw) continue;
      if (!keywordAgents.has(kw)) keywordAgents.set(kw, new Set());
      keywordAgents.get(kw)!.add(d.toAgentId);
    }

    for (const [keyword, agentIds] of keywordAgents) {
      if (agentIds.size < 3) continue;
      const groupName = `${keyword}-team`;
      const memberIds = [...agentIds, lead.id];

      // create is idempotent (onConflictDoNothing), addMembers handles existing members
      this.ctx.chatGroupRegistry.create(lead.id, groupName, memberIds, lead.projectId);
      const newMembers = this.ctx.chatGroupRegistry.addMembers(lead.id, groupName, memberIds);

      // Only notify when new members are actually added
      if (newMembers.length === 0) continue;

      const names = [...agentIds].map(id => {
        const a = this.ctx.getAgent(id);
        return a ? `${a.role.name} (${id.slice(0, 8)})` : id.slice(0, 8);
      }).join(', ');
      this.ctx.chatGroupRegistry.sendMessage(groupName, lead.id, 'system', 'system',
        `Auto-created coordination group for parallel ${keyword} work. Members: ${names}`);
      lead.sendMessage(`[System] Auto-created group "${groupName}" for ${agentIds.size} agents working on ${keyword}.`);

      // Notify only newly added members
      for (const id of newMembers) {
        const member = this.ctx.getAgent(id);
        if (member && (member.status === 'running' || member.status === 'idle')) {
          member.sendMessage(`[System] You've been added to coordination group "${groupName}". Use GROUP_MESSAGE {"group": "${groupName}", "content": "..."} to communicate with your peers.`);
        }
      }
      break; // One auto-group per delegation event
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
      const recorded = this.ctx.decisionLog.add(agent.id, agent.role?.id ?? 'unknown', decision.title, decision.rationale ?? '', needsConfirmation, leadId, agent.projectId);
      logger.info('lead', `Decision by ${agent.role.name}: "${decision.title}"${needsConfirmation ? ' [needs confirmation]' : ''}`, { rationale: decision.rationale?.slice(0, 100) });
      // Include leadId so frontend routes to the correct project
      this.ctx.emit('lead:decision', {
        id: recorded.id,
        agentId: agent.id,
        agentRole: agent.role?.name ?? 'Unknown',
        leadId,
        projectId: agent.projectId,
        title: decision.title,
        rationale: decision.rationale,
        needsConfirmation,
        status: recorded.status,
      });
    } catch (err) {
      logger.debug('command', 'Failed to parse DECISION command', { error: (err as Error).message });
    }
  }

  private detectProgress(agent: Agent, data: string): void {
    const match = data.match(PROGRESS_REGEX);
    if (!match) return;

    try {
      const manual = JSON.parse(match[1]);
      const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;

      // When a DAG exists, attach a computed snapshot as a separate field
      let progress: Record<string, unknown> = { ...manual };
      if (leadId) {
        const dagStatus = this.ctx.taskDAG.getStatus(leadId);
        if (dagStatus.tasks.length > 0) {
          const { summary } = dagStatus;
          progress.dag = {
            summary: `${summary.done}/${dagStatus.tasks.length} tasks complete`,
            completed: dagStatus.tasks.filter(t => t.dagStatus === 'done').map(t => t.id),
            in_progress: dagStatus.tasks.filter(t => t.dagStatus === 'running').map(t => t.id),
            blocked: dagStatus.tasks.filter(t => t.dagStatus === 'blocked' || t.dagStatus === 'failed').map(t => t.id),
          };
          if (!progress.summary) {
            progress.summary = (progress.dag as any).summary;
          }
        }
      }

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
    } catch (err) {
      logger.debug('command', 'Failed to parse PROGRESS command', { error: (err as Error).message });
    }
  }

  /** Respond to QUERY_CREW with a full roster of active agents and their IDs */
  private handleQueryCrew(agent: Agent): void {
    const allAgents = this.ctx.getAllAgents();
    const roster = allAgents
      .filter((a) => !isTerminalStatus(a.status))
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
      // For top-level leads, separate own agents from other projects' agents
      const ownAgents = roster.filter(r => r.fullParentId === agent.id || r.fullId === agent.id);
      const otherAgents = roster.filter(r => r.fullParentId !== agent.id && r.fullId !== agent.id);
      rosterLines = ownAgents
        .map((r) => `- ${r.id} | ${r.role} (${r.roleId}) [${r.model}] | Status: ${r.status} | Task: ${r.task || 'idle'}`)
        .join('\n') || '(no agents created yet — use CREATE_AGENT to create specialists)';
      if (otherAgents.length > 0) {
        rosterLines += `\n\n== OTHER PROJECTS' AGENTS (read-only — you CANNOT delegate to these) ==\n` +
          otherAgents
            .map((r) => `- ${r.id} | ${r.role} (${r.roleId}) | Status: ${r.status} | Parent: ${r.parentId ?? 'none'}`)
            .join('\n');
      }
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
== YOUR CREW (you can DELEGATE to these) ==
${rosterLines}
${budgetLine}${siblingSection}${memorySection}
⚠️ You can only DELEGATE to agents you created (your crew). Agents from other projects will return "Agent not found".
To assign a task to an agent, use their ID:
\`[[[ DELEGATE {"to": "agent-id", "task": "your task"} ]]]\`
To create a new agent:
\`[[[ CREATE_AGENT {"role": "developer", "model": "claude-opus-4.6", "task": "optional task"} ]]]\`
To terminate an agent and free a slot:
\`[[[ TERMINATE_AGENT {"id": "agent-id", "reason": "no longer needed"} ]]]\`
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
      this.ctx.activityLedger.log(agent.id, agent.role.id, 'message_sent', `Broadcast to ${recipients.length} agents: ${msg.content.slice(0, 120)}`, {
        toAgentId: 'all', toRole: 'broadcast', recipientCount: recipients.length,
      });
    } catch (err) {
      logger.debug('command', 'Failed to parse BROADCAST command', { error: (err as Error).message });
    }
  }

  private detectTerminateAgent(agent: Agent, data: string): void {
    const match = data.match(TERMINATE_AGENT_REGEX);
    if (!match) return;

    try {
      const req = JSON.parse(match[1]);
      if (!req.id) return;

      // Only lead agents can terminate agents
      if (agent.role.id !== 'lead') {
        agent.sendMessage(`[System] Only the Project Lead can terminate agents.`);
        return;
      }

      // Find target (partial match) — must be a descendant of this lead (direct child or sub-lead's child)
      const allAgents = this.ctx.getAllAgents();
      const target = allAgents.find((a) =>
        (a.id === req.id || a.id.startsWith(req.id)) &&
        a.id !== agent.id
      );

      if (!target) {
        agent.sendMessage(`[System] Agent not found: ${req.id}. Use QUERY_CREW to see available agents.`);
        return;
      }

      // Walk up the parent chain to verify the requesting lead is an ancestor
      if (!this.isAncestor(agent.id, target, allAgents)) {
        agent.sendMessage(`[System] Cannot terminate ${target.role.name} (${target.id.slice(0, 8)}): it belongs to another lead. You can only terminate your own agents and sub-lead agents.`);
        return;
      }

      const sessionId = target.sessionId;
      const roleName = target.role.name;
      const shortId = target.id.slice(0, 8);

      this.ctx.terminateAgent(target.id);

      const ackMsg = `[System] Terminated ${roleName} (${shortId}).${sessionId ? ` Session ID: ${sessionId} — use this in CREATE_AGENT with "sessionId" to resume later.` : ''} Freed 1 agent slot. ${req.reason ? `Reason: ${req.reason}` : ''}`;
      agent.sendMessage(ackMsg);

      this.ctx.activityLedger.log(agent.id, agent.role.id, 'agent_terminated', `Terminated ${roleName} (${shortId})${req.reason ? ': ' + req.reason.slice(0, 100) : ''}`, {
        toAgentId: target.id, toRole: target.role.id,
        terminatedAgentId: target.id,
        terminatedRole: target.role.id,
        sessionId: sessionId || null,
      });

      logger.info('agent', `Lead ${agent.id.slice(0, 8)} terminated ${roleName} (${shortId})${req.reason ? ': ' + req.reason : ''}`);
    } catch (err) {
      logger.debug('command', 'Failed to parse TERMINATE_AGENT command', { error: (err as Error).message });
    }
  }

  /** Check if `ancestorId` is a parent, grandparent, etc. of `target` by walking up parentId chain */
  private isAncestor(ancestorId: string, target: Agent, allAgents: Agent[]): boolean {
    let current: Agent | undefined = target;
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current.id)) break; // prevent infinite loop
      visited.add(current.id);
      if (current.parentId === ancestorId) return true;
      current = current.parentId ? allAgents.find(a => a.id === current!.parentId) : undefined;
    }
    return false;
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
      // Notify lead about ready tasks for manual delegation
      const readyTasks = tasks.filter(t => t.dagStatus === 'ready');
      if (readyTasks.length > 0) {
        msg += `\n${readyTasks.length} tasks are ready: ${readyTasks.map(d => d.id).join(', ')}. Use DELEGATE or CREATE_AGENT to assign them.`;
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
        agent.sendMessage(`[System] Task "${req.id}" reset to ready. Dependents unblocked. Use DELEGATE or CREATE_AGENT to assign it.`);
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
        agent.sendMessage(`[System] Task "${req.id}" skipped. Dependents may now be ready. Use TASK_STATUS to check.`);      } else {
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
        msg += ` Ready for delegation — use DELEGATE or CREATE_AGENT to assign it.`;
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

  private handleResetDAG(agent: Agent): void {
    if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can reset the DAG.'); return; }
    const count = this.ctx.taskDAG.resetDAG(agent.id);
    if (count > 0) {
      agent.sendMessage(`[System] DAG reset: ${count} task(s) removed. You can now DECLARE_TASKS again.`);
    } else {
      agent.sendMessage('[System] No DAG tasks to reset.');
    }
  }

  private handleHaltHeartbeat(agent: Agent): void {
    if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can halt heartbeat.'); return; }
    this.ctx.markHumanInterrupt(agent.id);
    logger.info('lead', `Heartbeat halted by ${agent.role.name} (${agent.id.slice(0, 8)})`);
    this.ctx.activityLedger.log(agent.id, agent.role.id, 'heartbeat_halted', `Heartbeat halted by lead`, {});
    agent.sendMessage('[System] Heartbeat nudges paused. They will resume automatically when you start running again.');
  }

  private handleRequestLimitChange(agent: Agent, data: string): void {
    if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can request limit changes.'); return; }
    const match = data.match(REQUEST_LIMIT_CHANGE_REGEX);
    if (!match) return;
    try {
      const req = JSON.parse(match[1]);
      const newLimit = parseInt(req.limit, 10);
      if (!newLimit || newLimit < 1 || newLimit > 100) {
        agent.sendMessage('[System] REQUEST_LIMIT_CHANGE error: limit must be between 1 and 100.');
        return;
      }
      const currentLimit = this.ctx.maxConcurrent;
      const decision = this.ctx.decisionLog.add(
        agent.id,
        agent.role.name,
        `Increase agent limit from ${currentLimit} to ${newLimit}`,
        req.reason || `Need more concurrent agents to parallelize work (current: ${currentLimit}, requested: ${newLimit})`,
        true, // needsConfirmation
        agent.parentId || agent.id,
      );
      this.pendingSystemActions.set(decision.id, { type: 'set_max_concurrent', value: newLimit, agentId: agent.id });
      this.ctx.decisionLog.markSystemDecision(decision.id);
      logger.info('lead', `Limit change requested by ${agent.role.name} (${agent.id.slice(0, 8)}): ${currentLimit} → ${newLimit}`);
      this.ctx.activityLedger.log(agent.id, agent.role.id, 'limit_change_requested', `Requested agent limit change: ${currentLimit} → ${newLimit}`, { currentLimit, newLimit, reason: req.reason });
      agent.sendMessage(`[System] Your request to change the agent limit from ${currentLimit} to ${newLimit} has been submitted for user approval. You will be notified when the user responds.`);
    } catch { agent.sendMessage('[System] REQUEST_LIMIT_CHANGE error: invalid payload. Use {"limit": 15, "reason": "..."}'); }
  }

  /** Auto-delegate ready tasks to idle agents or create new ones */
  // ── Group chat handlers ────────────────────────────────────────────

  private detectCreateGroup(agent: Agent, data: string): void {
    const match = data.match(CREATE_GROUP_REGEX);
    if (!match) return;
    try {
      const req = JSON.parse(match[1]);
      if (!req.name || (!req.members && !req.roles) || (req.members && !Array.isArray(req.members))) {
        agent.sendMessage('[System] CREATE_GROUP requires "name" and either "members" (array of agent IDs) or "roles" (array of role names like ["developer", "designer"]).');
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

      // Role-based membership: auto-add all active agents with matching roles
      if (req.roles && Array.isArray(req.roles)) {
        const roleNames = req.roles.map((r: string) => r.toLowerCase());
        for (const a of this.ctx.getAllAgents()) {
          if ((a.parentId === leadId || a.id === leadId) && roleNames.includes(a.role.id.toLowerCase()) && !isTerminalStatus(a.status)) {
            if (!resolvedIds.includes(a.id)) resolvedIds.push(a.id);
          }
        }
      }

      // Explicit member IDs (merged with role-based)
      for (const memberId of (req.members ?? [])) {
        const resolved = this.ctx.getAllAgents().find((a) =>
          (a.id === memberId || a.id.startsWith(memberId)) && (a.parentId === leadId || a.id === leadId)
        );
        if (resolved) {
          resolvedIds.push(resolved.id);
        } else {
          agent.sendMessage(`[System] Cannot resolve agent "${memberId}" for group. Use QUERY_CREW to see available agents.`);
        }
      }
      // Ensure the calling agent is always a member of their own group
      if (!resolvedIds.includes(agent.id)) {
        resolvedIds.push(agent.id);
      }
      const group = this.ctx.chatGroupRegistry.create(leadId, req.name, resolvedIds, agent.projectId);
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
    } catch (err) { logger.debug('command', 'Failed to parse CREATE_GROUP command', { error: (err as Error).message }); }
  }

  private detectAddToGroup(agent: Agent, data: string): void {
    const match = data.match(ADD_TO_GROUP_REGEX);
    if (!match) return;
    try {
      const req = JSON.parse(match[1]);
      if (!req.group || !req.members) return;

      // Allow any group member to add others (not just the lead)
      // First, check if the agent is already a member of this group
      const existingGroup = this.ctx.chatGroupRegistry.findGroupForAgent(req.group, agent.id);
      let leadId: string | undefined;
      if (existingGroup) {
        leadId = existingGroup.leadId;
      } else {
        // Fall back to hierarchical resolution for new groups
        leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
      }
      if (!leadId) { agent.sendMessage('[System] Cannot manage groups — no lead context found.'); return; }

      // If agent is not a group member and not the lead, reject
      if (!existingGroup && agent.role.id !== 'lead' && agent.id !== leadId) {
        agent.sendMessage(`[System] You must be a member of "${req.group}" to add others. Ask a current member to add you first.`);
        return;
      }

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
    } catch (err) { logger.debug('command', 'Failed to parse ADD_TO_GROUP command', { error: (err as Error).message }); }
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
    } catch (err) { logger.debug('command', 'Failed to parse REMOVE_FROM_GROUP command', { error: (err as Error).message }); }
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
      this.ctx.activityLedger.log(agent.id, agent.role.id, 'group_message', `Group "${req.group}": ${req.content.slice(0, 120)}`, {
        groupName: req.group, recipientCount: delivered,
      });
      logger.info('groups', `Group message in "${req.group}": ${agent.role.name} (${agent.id.slice(0, 8)}) → ${delivered} recipients`);
    } catch (err) { logger.debug('command', 'Failed to parse GROUP_MESSAGE command', { error: (err as Error).message }); }
  }

  private handleListGroups(agent: Agent): void {
    const groups = this.ctx.chatGroupRegistry.getGroupsForAgent(agent.id);
    if (groups.length === 0) {
      agent.sendMessage('[System] You are not a member of any groups. Use CREATE_GROUP to create one.');
      return;
    }
    const lines = groups.map((g) => {
      const memberNames = g.memberIds.map((id) => {
        const a = this.ctx.getAgent(id);
        return a ? `${a.role.name} (${id.slice(0, 8)})` : id.slice(0, 8);
      }).join(', ');
      const { messageCount, lastMessage } = this.ctx.chatGroupRegistry.getGroupSummary(g.name, g.leadId);
      const msgInfo = messageCount > 0
        ? `${messageCount} msgs — last: ${lastMessage}`
        : 'no messages yet';
      return `- "${g.name}" — ${g.memberIds.length} members: ${memberNames}\n  ${msgInfo}`;
    });
    agent.sendMessage(`[System] Your groups (${groups.length}):\n${lines.join('\n')}\nSend messages: [[[ GROUP_MESSAGE {"group": "name", "content": "..."} ]]]`);
  }

  private handleCancelDelegation(agent: Agent, data: string): void {
    const match = data.match(CANCEL_DELEGATION_REGEX);
    if (!match) return;

    try {
      const req = JSON.parse(match[1]);

      // Only lead agents can cancel delegations
      if (agent.role.id !== 'lead') {
        logger.warn('delegation', `Non-lead agent ${agent.role.name} (${agent.id.slice(0, 8)}) attempted CANCEL_DELEGATION — rejected.`);
        agent.sendMessage(`[System] Only the Project Lead can cancel delegations.`);
        return;
      }

      // Support cancelling by agentId (all pending for that agent) or by delegationId (specific delegation)
      if (req.agentId) {
        const targetId = this.resolveAgentId(agent, req.agentId);
        if (!targetId) {
          agent.sendMessage(`[System] Agent not found: ${req.agentId}. Use QUERY_CREW to see available agents.`);
          return;
        }

        const targetAgent = this.ctx.getAgent(targetId);
        if (!targetAgent) {
          agent.sendMessage(`[System] Agent not found: ${req.agentId}.`);
          return;
        }

        // Cancel active delegations to this agent
        let cancelledCount = 0;
        for (const [, del] of this.delegations) {
          if (del.toAgentId === targetId && del.status === 'active' && del.fromAgentId === agent.id) {
            del.status = 'cancelled';
            del.completedAt = new Date().toISOString();
            cancelledCount++;
          }
        }

        // Clear the agent's pending message queue
        const cleared = targetAgent.clearPendingMessages();

        const summary = `[System] Cancelled ${cancelledCount} delegation(s) to ${targetAgent.role.name} (${targetId.slice(0, 8)}). Cleared ${cleared.count} queued message(s).`;
        agent.sendMessage(summary);

        this.ctx.activityLedger.log(agent.id, agent.role.id, 'delegation_cancelled', `Cancelled delegations to ${targetAgent.role.name} (${targetId.slice(0, 8)})`, {
          toAgentId: targetId, toRole: targetAgent.role.id,
          targetAgentId: targetId,
          cancelledDelegations: cancelledCount,
          clearedMessages: cleared.count,
        });

        logger.info('delegation', `Lead ${agent.id.slice(0, 8)} cancelled ${cancelledCount} delegation(s) to ${targetAgent.role.name} (${targetId.slice(0, 8)}), cleared ${cleared.count} queued message(s)`);

      } else if (req.delegationId) {
        const del = this.delegations.get(req.delegationId);
        if (!del) {
          agent.sendMessage(`[System] Delegation not found: ${req.delegationId}. Use TASK_STATUS to see active delegations.`);
          return;
        }
        if (del.fromAgentId !== agent.id) {
          agent.sendMessage(`[System] Cannot cancel delegation ${req.delegationId} — it belongs to another lead.`);
          return;
        }
        if (del.status !== 'active') {
          agent.sendMessage(`[System] Delegation ${req.delegationId} is already ${del.status} — cannot cancel.`);
          return;
        }

        del.status = 'cancelled';
        del.completedAt = new Date().toISOString();

        // Clear pending messages on the target agent
        const targetAgent = this.ctx.getAgent(del.toAgentId);
        const cleared = targetAgent ? targetAgent.clearPendingMessages() : { count: 0, previews: [] };

        agent.sendMessage(`[System] Delegation ${req.delegationId} cancelled. Cleared ${cleared.count} queued message(s) from ${del.toRole} (${del.toAgentId.slice(0, 8)}).`);

        this.ctx.activityLedger.log(agent.id, agent.role.id, 'delegation_cancelled', `Cancelled delegation ${req.delegationId}`, {
          toAgentId: del.toAgentId, toRole: del.toRole,
          delegationId: req.delegationId,
          targetAgentId: del.toAgentId,
          clearedMessages: cleared.count,
        });

        logger.info('delegation', `Lead ${agent.id.slice(0, 8)} cancelled delegation ${req.delegationId} to ${del.toRole} (${del.toAgentId.slice(0, 8)})`);

      } else {
        agent.sendMessage(`[System] CANCEL_DELEGATION requires either "agentId" or "delegationId". Example: [[[ CANCEL_DELEGATION {"agentId": "agent-id"} ]]]`);
      }
    } catch (err) {
      logger.debug('command', 'Failed to parse CANCEL_DELEGATION command', { error: (err as Error).message });
    }
  }

  /** Resolve a potentially short agent ID to a full ID within the lead's scope */
  private resolveAgentId(lead: Agent, idOrPrefix: string): string | null {
    const allAgents = this.ctx.getAllAgents();
    const match = allAgents.find((a) =>
      (a.id === idOrPrefix || a.id.startsWith(idOrPrefix)) &&
      (a.parentId === lead.id || a.id === lead.id)
    );
    return match?.id ?? null;
  }

  /**
   * Check if a position in the buffer is nested inside a [[[ ]]] command block.
   * Counts unmatched [[[ before the given position — depth > 0 means nested.
   * This prevents command injection via task text containing [[[ delimiters (#26).
   */
  private static isInsideCommandBlock(buf: string, pos: number): boolean {
    let depth = 0;
    for (let i = 0; i < pos - 2; i++) {
      if (buf[i] === '[' && buf[i + 1] === '[' && buf[i + 2] === '[') {
        depth++;
        i += 2;
      } else if (buf[i] === ']' && buf[i + 1] === ']' && buf[i + 2] === ']') {
        depth = Math.max(0, depth - 1);
        i += 2;
      }
    }
    return depth > 0;
  }

  /** Check active delegations for similar tasks and return a warning if found */
  private findSimilarActiveDelegation(task: string, excludeAgentId?: string): { agentId: string; role: string; task: string } | null {
    const STOP_WORDS = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'to', 'of', 'in', 'for', 'on', 'and', 'or', 'with', 'that', 'this', 'it', 'from', 'by', 'as', 'at', 'be', 'do', 'not', 'all', 'if', 'no', 'so']);
    const extractWords = (text: string): Set<string> => {
      return new Set(
        text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
          .filter(w => w.length > 2 && !STOP_WORDS.has(w))
      );
    };

    const taskWords = extractWords(task);
    if (taskWords.size === 0) return null;

    for (const [, del] of this.delegations) {
      if (del.status !== 'active') continue;
      if (excludeAgentId && del.toAgentId === excludeAgentId) continue;

      const delWords = extractWords(del.task);
      if (delWords.size === 0) continue;

      const shared = [...taskWords].filter(w => delWords.has(w)).length;
      const similarity = shared / Math.min(taskWords.size, delWords.size);
      if (similarity > 0.5) {
        const agent = this.ctx.getAgent(del.toAgentId);
        return {
          agentId: del.toAgentId,
          role: agent?.role.name || del.toRole,
          task: del.task.slice(0, 80),
        };
      }
    }
    return null;
  }

  // ── Deferred Issue handlers ────────────────────────────────────────

  private handleDeferIssue(agent: Agent, data: string): void {
    const match = data.match(DEFER_ISSUE_REGEX);
    if (!match) return;
    try {
      const req = JSON.parse(match[1]);
      if (!req.description) {
        agent.sendMessage('[System] DEFER_ISSUE requires a "description" field.');
        return;
      }
      const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
      if (!leadId) {
        agent.sendMessage('[System] Cannot defer issue: no lead context found.');
        return;
      }
      const issue = this.ctx.deferredIssueRegistry.add(
        leadId,
        agent.id,
        agent.role.name,
        req.description,
        req.severity || 'P1',
        req.sourceFile || req.file || '',
      );
      agent.sendMessage(`[System] Deferred issue #${issue.id} recorded (${issue.severity}): ${issue.description.slice(0, 100)}`);
      this.ctx.activityLedger.log(agent.id, agent.role.name, 'deferred_issue', `Deferred ${issue.severity}: ${issue.description.slice(0, 120)}`);
      this.ctx.emit('deferred_issue:created', { leadId, issue });
    } catch (err: any) {
      agent.sendMessage(`[System] DEFER_ISSUE error: ${err.message}`);
    }
  }

  private handleQueryDeferred(agent: Agent, data: string): void {
    const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
    if (!leadId) {
      agent.sendMessage('[System] No deferred issues context found.');
      return;
    }
    let statusFilter: 'open' | 'resolved' | 'dismissed' | undefined;
    const match = data.match(QUERY_DEFERRED_REGEX);
    if (match?.[1]) {
      try {
        const req = JSON.parse(match[1]);
        if (req.status && ['open', 'resolved', 'dismissed'].includes(req.status)) {
          statusFilter = req.status;
        }
      } catch { /* no filter, show all */ }
    }
    const issues = this.ctx.deferredIssueRegistry.list(leadId, statusFilter);
    if (issues.length === 0) {
      agent.sendMessage(`[System] No deferred issues${statusFilter ? ` with status "${statusFilter}"` : ''}.`);
      return;
    }
    let msg = `== DEFERRED ISSUES (${issues.length}) ==\n`;
    for (const issue of issues) {
      const icon = { open: '🔴', resolved: '✅', dismissed: '⚪' }[issue.status] || '?';
      msg += `\n${icon} #${issue.id} [${issue.severity}] ${issue.status.toUpperCase()}`;
      msg += `\n   ${issue.description.slice(0, 120)}`;
      if (issue.sourceFile) msg += `\n   File: ${issue.sourceFile}`;
      msg += `\n   Flagged by: ${issue.reviewerRole} (${issue.reviewerAgentId.slice(0, 8)}) at ${issue.createdAt}`;
    }
    agent.sendMessage(msg);
  }

  private handleResolveDeferred(agent: Agent, data: string): void {
    const match = data.match(RESOLVE_DEFERRED_REGEX);
    if (!match) return;
    try {
      const req = JSON.parse(match[1]);
      if (!req.id) {
        agent.sendMessage('[System] RESOLVE_DEFERRED requires an "id" field.');
        return;
      }
      const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
      if (!leadId) {
        agent.sendMessage('[System] No deferred issues context found.');
        return;
      }
      const action = req.dismiss ? 'dismiss' : 'resolve';
      const ok = action === 'dismiss'
        ? this.ctx.deferredIssueRegistry.dismiss(leadId, req.id)
        : this.ctx.deferredIssueRegistry.resolve(leadId, req.id);
      if (ok) {
        agent.sendMessage(`[System] Deferred issue #${req.id} ${action === 'dismiss' ? 'dismissed' : 'resolved'}.`);
      } else {
        agent.sendMessage(`[System] Deferred issue #${req.id} not found or already ${action === 'dismiss' ? 'dismissed' : 'resolved'}.`);
      }
    } catch (err: any) {
      agent.sendMessage(`[System] RESOLVE_DEFERRED error: ${err.message}`);
    }
  }

  private handleCommit(agent: Agent, data: string): void {
    const match = data.match(COMMIT_REGEX);
    if (!match) return;
    try {
      const req = JSON.parse(match[1]);
      const message = req.message || `Changes by ${agent.role.name} (${agent.id.slice(0, 8)})`;

      // Collect files this agent has locked (current + recently released)
      const currentLocks = this.ctx.lockRegistry.getByAgent(agent.id);
      const files = currentLocks.map(l => l.filePath);

      if (files.length === 0) {
        agent.sendMessage('[System] COMMIT: No file locks held. Lock files before committing, or specify files manually with {"message": "...", "files": ["path1", "path2"]}.');
        return;
      }

      const escapedMsg = message.replace(/"/g, '\\"');
      const fileList = files.join(' ');
      agent.sendMessage(`[System] Scoped commit ready. Run:\ngit add ${fileList} && git commit -m "${escapedMsg}\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"`);
      logger.info('commit', `COMMIT helper for ${agent.role.name} (${agent.id.slice(0, 8)}): ${files.length} files — ${message.slice(0, 80)}`);
    } catch (err: any) {
      agent.sendMessage(`[System] COMMIT error: use {"message": "your commit message"}`);
    }
  }
}
