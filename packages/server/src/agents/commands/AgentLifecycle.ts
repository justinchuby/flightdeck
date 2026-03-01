/**
 * Agent lifecycle command handlers.
 *
 * Commands: SPAWN_AGENT, CREATE_AGENT, DELEGATE, TERMINATE_AGENT, CANCEL_DELEGATION
 */
import type { Agent } from '../Agent.js';
import type { CommandHandlerContext, CommandEntry, Delegation } from './types.js';
import type { DagTask } from '../../tasks/TaskDAG.js';
import { descriptionSimilarity } from '../../tasks/TaskDAG.js';
import { MAX_CONCURRENCY_LIMIT } from '../../config.js';
import { maybeAutoCreateGroup } from './CommCommands.js';
import { logger } from '../../utils/logger.js';
import {
  parseCommandPayload,
  createAgentSchema,
  delegateSchema,
  terminateAgentSchema,
  cancelDelegationSchema,
} from './commandSchemas.js';

// ── Regex patterns ────────────────────────────────────────────────────

const SPAWN_REQUEST_REGEX = /⟦\s*SPAWN_AGENT\s*(\{.*?\})\s*⟧/s;
const CREATE_AGENT_REGEX = /⟦\s*CREATE_AGENT\s*(\{.*?\})\s*⟧/s;
const DELEGATE_REGEX = /⟦\s*DELEGATE\s*(\{.*?\})\s*⟧/s;
const TERMINATE_AGENT_REGEX = /⟦\s*TERMINATE_AGENT\s*(\{.*?\})\s*⟧/s;
const CANCEL_DELEGATION_REGEX = /⟦\s*CANCEL_DELEGATION\s*(\{.*?\})\s*⟧/s;

// ── Exported: command entry list ──────────────────────────────────────

export function getLifecycleCommands(ctx: CommandHandlerContext): CommandEntry[] {
  return [
    { regex: SPAWN_REQUEST_REGEX, name: 'SPAWN', handler: (a, d) => handleSpawnRequest(ctx, a, d) },
    { regex: CREATE_AGENT_REGEX, name: 'CREATE_AGENT', handler: (a, d) => handleCreateAgent(ctx, a, d) },
    { regex: DELEGATE_REGEX, name: 'DELEGATE', handler: (a, d) => handleDelegate(ctx, a, d) },
    { regex: TERMINATE_AGENT_REGEX, name: 'TERMINATE_AGENT', handler: (a, d) => handleTerminateAgent(ctx, a, d) },
    { regex: CANCEL_DELEGATION_REGEX, name: 'CANCEL_DELEGATION', handler: (a, d) => handleCancelDelegation(ctx, a, d) },
  ];
}

// ── Private handlers ──────────────────────────────────────────────────

function handleSpawnRequest(_ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(SPAWN_REQUEST_REGEX);
  if (!match) return;

  logger.warn('agent', `Agent ${agent.role.name} (${agent.id.slice(0, 8)}) attempted SPAWN_AGENT — rejected. Only the lead can create agents.`);
  agent.sendMessage(`[System] SPAWN_AGENT is not available. Only the Project Lead can create agents using CREATE_AGENT. If you need help, ask the lead via AGENT_MESSAGE.`);
}

function handleCreateAgent(ctx: CommandHandlerContext, agent: Agent, data: string, _autoScaleRetry = false): void {
  const match = data.match(CREATE_AGENT_REGEX);
  if (!match) return;

  try {
    const req = parseCommandPayload(agent, match[1], createAgentSchema, 'CREATE_AGENT');
    if (!req) return;

    // Lead, architect, and agents with delegation capability can create agents
    const canCreate = agent.role.id === 'lead' || agent.role.id === 'architect'
      || ctx.capabilityInjector?.hasCommand(agent.id, 'CREATE_AGENT');
    if (!canCreate) {
      logger.warn('agent', `Agent ${agent.role.name} (${agent.id.slice(0, 8)}) attempted CREATE_AGENT — only leads and architects can create agents.`);
      agent.sendMessage(`[System] Only the Project Lead and Architects can create agents. Ask the lead if you need help from a specialist.`);
      return;
    }

    const role = ctx.roleRegistry.get(req.role);
    if (!role) {
      agent.sendMessage(`[System] Unknown role: ${req.role}. Available: ${ctx.roleRegistry.getAll().map(r => r.id).join(', ')}`);
      return;
    }

    const subLeadName = role.id === 'lead'
      ? (req.name || req.task?.slice(0, 60) || `Sub-project ${new Date().toLocaleDateString()}`)
      : undefined;
    const spawnOptions: { projectName?: string; projectId?: string } | undefined =
      (subLeadName || agent.projectId)
        ? { projectName: subLeadName, projectId: agent.projectId }
        : undefined;
    const child = ctx.spawnAgent(role, req.task, agent.id, true, req.model, agent.cwd, spawnOptions);
    if (role.id === 'lead') {
      child.hierarchyLevel = agent.hierarchyLevel + 1;
    }
    logger.info('agent', `${agent.role.name} (${agent.id.slice(0, 8)}) created ${role.name}${req.model ? ` (model: ${req.model})` : ''}: ${child.id.slice(0, 8)}`);

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
      ctx.delegations.set(delegation.id, delegation);

      // Link to DAG: mark the corresponding DAG task as running
      let dagNote = '';
      if (agent.role.id === 'lead') {
        const dagTask = ctx.taskDAG.findReadyTask(agent.id, {
          dagTaskId: req.dagTaskId,
          role: role.id,
          taskDescription: req.task,
        });
        if (dagTask) {
          const started = ctx.taskDAG.startTask(agent.id, dagTask.id, child.id);
          if (started) {
            dagNote = ` [DAG: "${dagTask.id}" → running]`;
            child.dagTaskId = dagTask.id;
            logger.info('delegation', `DAG linked: task "${dagTask.id}" → agent ${child.id.slice(0, 8)}`);
          }
        } else if (req.dagTaskId) {
          dagNote = `\n⚠️ DAG task "${req.dagTaskId}" not found or not ready. Check TASK_STATUS.`;
        } else {
          // Auto-create DAG task for untracked delegation
          const autoResult = autoCreateDagTask(ctx, agent.id, role.id, req.task, child.id, req.depends_on);
          if (autoResult.created) {
            dagNote = ` [DAG: auto-created "${autoResult.taskId}" → running]`;
            if (autoResult.depNotes.length) dagNote += `\n  ${autoResult.depNotes.join('\n  ')}`;
            child.dagTaskId = autoResult.taskId;
            logger.info('delegation', `DAG auto-created: task "${autoResult.taskId}" → agent ${child.id.slice(0, 8)}`);
          } else if (autoResult.duplicate) {
            dagNote = `\n⚠️ Similar DAG task exists: "${autoResult.duplicate}". Use dagTaskId: "${autoResult.duplicate}" to link explicitly.`;
          }
        }
      }

      const dagPrefix = child.dagTaskId ? `[DAG Task: ${child.dagTaskId}]\n` : '';
      const taskPrompt = req.context ? `${dagPrefix}${req.task}\n\nContext: ${req.context}` : `${dagPrefix}${req.task}`;
      child.sendMessage(taskPrompt);

      const dupMatch = req.task ? findSimilarActiveDelegation(ctx, req.task, child.id) : null;
      const dupNote = dupMatch ? `\n⚠ Note: Similar task already delegated to ${dupMatch.role} (${dupMatch.agentId.slice(0, 8)}): "${dupMatch.task}"` : '';
      const ackMsg = `[System] Queued: ${role.name} (${child.id.slice(0, 8)})${req.model ? ` [${req.model}]` : ''}${dagNote}${dupNote}`;
      agent.sendMessage(ackMsg);
      ctx.emit('agent:message_sent', {
        from: child.id, fromRole: role.name,
        to: agent.id, toRole: agent.role.name,
        content: ackMsg,
      });
      ctx.activityLedger.log(child.id, role.id, 'message_sent', `Created & delegated ack → ${agent.role.name} (${agent.id.slice(0, 8)})`, {
        toAgentId: agent.id, toRole: agent.role.id,
      });
      ctx.emit('agent:delegated', { parentId: agent.id, childId: child.id, delegation });

      ctx.activityLedger.log(agent.id, agent.role.id, 'delegated', `Created & delegated to ${role.name}: ${req.task.slice(0, 100)}`, {
        toAgentId: child.id, toRole: role.id, childId: child.id, childRole: role.id, delegationId: delegation.id,
      });
    } else {
      const ackMsg = `[System] Queued: ${role.name} (${child.id.slice(0, 8)})${req.model ? ` [${req.model}]` : ''} — ready for tasks.`;
      agent.sendMessage(ackMsg);
      ctx.emit('agent:message_sent', {
        from: child.id, fromRole: role.name,
        to: agent.id, toRole: agent.role.name,
        content: ackMsg,
      });
      ctx.activityLedger.log(child.id, role.id, 'message_sent', `Agent created ack → ${agent.role.name} (${agent.id.slice(0, 8)})`, {
        toAgentId: agent.id, toRole: agent.role.id,
      });
    }

    ctx.agentMemory.store(agent.id, child.id, 'role', role.name);
    if (req.model) ctx.agentMemory.store(agent.id, child.id, 'model', req.model);
    if (req.task) ctx.agentMemory.store(agent.id, child.id, 'task', req.task.slice(0, 200));

    ctx.emit('agent:sub_spawned', { parentId: agent.id, child: child.toJSON() });
  } catch (err: any) {
    if (_autoScaleRetry) throw err;
    if (err.message?.includes('Concurrency limit')) {
      const currentLimit = ctx.maxConcurrent;
      if (currentLimit >= MAX_CONCURRENCY_LIMIT) {
        agent.sendMessage(`[System] Concurrency limit reached hard cap (${MAX_CONCURRENCY_LIMIT}). Cannot create more agents.`);
        ctx.emit('agent:spawn_error', { agentId: agent.id, message: `Hard concurrency cap ${MAX_CONCURRENCY_LIMIT} reached` });
        return;
      }
      const newLimit = Math.min(currentLimit + 10, MAX_CONCURRENCY_LIMIT);
      ctx.maxConcurrent = newLimit;
      logger.info('agent', `Auto-scaled concurrency limit: ${currentLimit} → ${newLimit} (triggered by ${agent.role.name} ${agent.id.slice(0, 8)})`);
      agent.sendMessage(`[System] Concurrency limit auto-increased: ${currentLimit} → ${newLimit}. Retrying agent creation...`);
      ctx.emit('config:concurrency_changed', { old: currentLimit, new: newLimit, reason: 'auto-scale' });

      try {
        handleCreateAgent(ctx, agent, data, true);
        return;
      } catch (retryErr: any) {
        agent.sendMessage(`[System] Failed to create agent after auto-scaling: ${retryErr.message}`);
        ctx.emit('agent:spawn_error', { agentId: agent.id, message: retryErr.message });
        return;
      }
    } else {
      agent.sendMessage(`[System] Failed to create agent: ${err.message}`);
    }
    ctx.emit('agent:spawn_error', { agentId: agent.id, message: err.message });
  }
}

function handleDelegate(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(DELEGATE_REGEX);
  if (!match) return;

  try {
    const req = parseCommandPayload(agent, match[1], delegateSchema, 'DELEGATE');
    if (!req) return;

    // Lead, architect, and agents with delegation capability can delegate
    const canDelegate = agent.role.id === 'lead' || agent.role.id === 'architect'
      || ctx.capabilityInjector?.hasCommand(agent.id, 'DELEGATE');
    if (!canDelegate) {
      logger.warn('delegation', `Agent ${agent.role.name} (${agent.id.slice(0, 8)}) attempted DELEGATE — only leads and architects can delegate.`);
      agent.sendMessage(`[System] Only the Project Lead and Architects can delegate tasks. Ask the lead via AGENT_MESSAGE if you need help.`);
      return;
    }

    const child = ctx.getAllAgents().find((a) =>
      (a.id === req.to || a.id.startsWith(req.to)) &&
      a.parentId === agent.id &&
      a.id !== agent.id
    );

    if (!child) {
      agent.sendMessage(`[System] Agent not found: ${req.to}. Use CREATE_AGENT to create a new agent first, or use QUERY_CREW to see available agents.`);
      return;
    }

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
    ctx.delegations.set(delegation.id, delegation);

    child.task = req.task;

    // Link to DAG: mark the corresponding DAG task as running
    let dagNote = '';
    if (agent.role.id === 'lead') {
      const dagTask = ctx.taskDAG.findReadyTask(agent.id, {
        dagTaskId: req.dagTaskId,
        role: child.role.id,
        taskDescription: req.task,
      });
      if (dagTask) {
        const started = ctx.taskDAG.startTask(agent.id, dagTask.id, child.id);
        if (started) {
          dagNote = ` [DAG: "${dagTask.id}" → running]`;
          child.dagTaskId = dagTask.id;
          logger.info('delegation', `DAG linked: task "${dagTask.id}" → agent ${child.id.slice(0, 8)}`);
        }
      } else if (req.dagTaskId) {
        dagNote = `\n⚠️ DAG task "${req.dagTaskId}" not found or not ready. Check TASK_STATUS.`;
      } else {
        // Auto-create DAG task for untracked delegation
        const autoResult = autoCreateDagTask(ctx, agent.id, child.role.id, req.task, child.id, req.depends_on);
        if (autoResult.created) {
          dagNote = ` [DAG: auto-created "${autoResult.taskId}" → running]`;
          if (autoResult.depNotes.length) dagNote += `\n  ${autoResult.depNotes.join('\n  ')}`;
          child.dagTaskId = autoResult.taskId;
          logger.info('delegation', `DAG auto-created: task "${autoResult.taskId}" → agent ${child.id.slice(0, 8)}`);
        } else if (autoResult.duplicate) {
          dagNote = `\n⚠️ Similar DAG task exists: "${autoResult.duplicate}". Use dagTaskId: "${autoResult.duplicate}" to link explicitly.`;
        }
      }
    }
    ctx.agentMemory.store(agent.id, child.id, 'task', req.task.slice(0, 200));
    if (req.context) ctx.agentMemory.store(agent.id, child.id, 'context', req.context.slice(0, 200));

    const dagPrefix = child.dagTaskId ? `[DAG Task: ${child.dagTaskId}]\n` : '';
    const taskPrompt = req.context
      ? `${dagPrefix}${req.task}\n\nContext: ${req.context}`
      : `${dagPrefix}${req.task}`;
    ctx.reportedCompletions.delete(`${child.id}:idle`);
    ctx.reportedCompletions.delete(`${child.id}:exit`);
    child.sendMessage(taskPrompt);
    const statusNote = child.status === 'running' ? ' (agent is busy — task queued)' : '';
    const dupMatch = findSimilarActiveDelegation(ctx, req.task, child.id);
    const dupNote = dupMatch ? `\n⚠ Note: Similar task already delegated to ${dupMatch.role} (${dupMatch.agentId.slice(0, 8)}): "${dupMatch.task}"` : '';
    const ackMsg = `[System] Task delegated: ${child.role.name} (${child.id.slice(0, 8)})${statusNote}${dagNote} — ${req.task.slice(0, 120)}${dupNote}`;
    agent.sendMessage(ackMsg);
    ctx.emit('agent:message_sent', {
      from: child.id,
      fromRole: child.role.name,
      to: agent.id,
      toRole: agent.role.name,
      content: ackMsg,
    });
    ctx.activityLedger.log(child.id, child.role.id, 'message_sent', `Delegation ack → ${agent.role.name} (${agent.id.slice(0, 8)})`, {
      toAgentId: agent.id, toRole: agent.role.id,
    });

    ctx.activityLedger.log(agent.id, agent.role.id, 'delegated', `Delegated to ${child.role.name} (${child.id.slice(0, 8)}): ${req.task.slice(0, 100)}`, {
      toAgentId: child.id, toRole: child.role.id, childId: child.id, childRole: child.role.id, delegationId: delegation.id,
    });

    ctx.emit('agent:delegated', { parentId: agent.id, childId: child.id, delegation });

    maybeAutoCreateGroup(ctx, agent, ctx.delegations);
  } catch (err: any) {
    ctx.emit('agent:delegate_error', { agentId: agent.id, message: err.message });
  }
}

function handleTerminateAgent(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(TERMINATE_AGENT_REGEX);
  if (!match) return;

  try {
    const req = parseCommandPayload(agent, match[1], terminateAgentSchema, 'TERMINATE_AGENT');
    if (!req) return;

    if (agent.role.id !== 'lead') {
      agent.sendMessage(`[System] Only the Project Lead can terminate agents.`);
      return;
    }

    const allAgents = ctx.getAllAgents();
    const target = allAgents.find((a) =>
      (a.id === req.id || a.id.startsWith(req.id)) &&
      a.id !== agent.id
    );

    if (!target) {
      agent.sendMessage(`[System] Agent not found: ${req.id}. Use QUERY_CREW to see available agents.`);
      return;
    }

    if (!isAncestor(agent.id, target, allAgents)) {
      agent.sendMessage(`[System] Cannot terminate ${target.role.name} (${target.id.slice(0, 8)}): it belongs to another lead. You can only terminate your own agents and sub-lead agents.`);
      return;
    }

    const sessionId = target.sessionId;
    const roleName = target.role.name;
    const shortId = target.id.slice(0, 8);

    ctx.terminateAgent(target.id);

    const ackMsg = `[System] Terminated ${roleName} (${shortId}).${sessionId ? ` Session ID: ${sessionId} — use this in CREATE_AGENT with "sessionId" to resume later.` : ''} Freed 1 agent slot. ${req.reason ? `Reason: ${req.reason}` : ''}`;
    agent.sendMessage(ackMsg);

    ctx.activityLedger.log(agent.id, agent.role.id, 'agent_terminated', `Terminated ${roleName} (${shortId})${req.reason ? ': ' + req.reason.slice(0, 100) : ''}`, {
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

function handleCancelDelegation(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(CANCEL_DELEGATION_REGEX);
  if (!match) return;

  try {
    const req = parseCommandPayload(agent, match[1], cancelDelegationSchema, 'CANCEL_DELEGATION');
    if (!req) return;

    if (agent.role.id !== 'lead') {
      logger.warn('delegation', `Non-lead agent ${agent.role.name} (${agent.id.slice(0, 8)}) attempted CANCEL_DELEGATION — rejected.`);
      agent.sendMessage(`[System] Only the Project Lead can cancel delegations.`);
      return;
    }

    if (req.agentId) {
      const targetId = resolveAgentId(ctx, agent, req.agentId);
      if (!targetId) {
        agent.sendMessage(`[System] Agent not found: ${req.agentId}. Use QUERY_CREW to see available agents.`);
        return;
      }

      const targetAgent = ctx.getAgent(targetId);
      if (!targetAgent) {
        agent.sendMessage(`[System] Agent not found: ${req.agentId}.`);
        return;
      }

      let cancelledCount = 0;
      for (const [, del] of ctx.delegations) {
        if (del.toAgentId === targetId && del.status === 'active' && del.fromAgentId === agent.id) {
          del.status = 'cancelled';
          del.completedAt = new Date().toISOString();
          cancelledCount++;
        }
      }

      const cleared = targetAgent.clearPendingMessages();

      const summary = `[System] Cancelled ${cancelledCount} delegation(s) to ${targetAgent.role.name} (${targetId.slice(0, 8)}). Cleared ${cleared.count} queued message(s).`;
      agent.sendMessage(summary);

      ctx.activityLedger.log(agent.id, agent.role.id, 'delegation_cancelled', `Cancelled delegations to ${targetAgent.role.name} (${targetId.slice(0, 8)})`, {
        toAgentId: targetId, toRole: targetAgent.role.id,
        targetAgentId: targetId,
        cancelledDelegations: cancelledCount,
        clearedMessages: cleared.count,
      });

      logger.info('delegation', `Lead ${agent.id.slice(0, 8)} cancelled ${cancelledCount} delegation(s) to ${targetAgent.role.name} (${targetId.slice(0, 8)}), cleared ${cleared.count} queued message(s)`);

    } else if (req.delegationId) {
      const del = ctx.delegations.get(req.delegationId);
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

      const targetAgent = ctx.getAgent(del.toAgentId);
      const cleared = targetAgent ? targetAgent.clearPendingMessages() : { count: 0, previews: [] };

      agent.sendMessage(`[System] Delegation ${req.delegationId} cancelled. Cleared ${cleared.count} queued message(s) from ${del.toRole} (${del.toAgentId.slice(0, 8)}).`);

      ctx.activityLedger.log(agent.id, agent.role.id, 'delegation_cancelled', `Cancelled delegation ${req.delegationId}`, {
        toAgentId: del.toAgentId, toRole: del.toRole,
        delegationId: req.delegationId,
        targetAgentId: del.toAgentId,
        clearedMessages: cleared.count,
      });

      logger.info('delegation', `Lead ${agent.id.slice(0, 8)} cancelled delegation ${req.delegationId} to ${del.toRole} (${del.toAgentId.slice(0, 8)})`);

    }
  } catch (err) {
    logger.debug('command', 'Failed to parse CANCEL_DELEGATION command', { error: (err as Error).message });
  }
}

// ── Private helpers ───────────────────────────────────────────────────

function isAncestor(ancestorId: string, target: Agent, allAgents: Agent[]): boolean {
  let current: Agent | undefined = target;
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    if (current.parentId === ancestorId) return true;
    current = current.parentId ? allAgents.find(a => a.id === current!.parentId) : undefined;
  }
  return false;
}

function resolveAgentId(ctx: CommandHandlerContext, lead: Agent, idOrPrefix: string): string | null {
  const allAgents = ctx.getAllAgents();
  const match = allAgents.find((a) =>
    (a.id === idOrPrefix || a.id.startsWith(idOrPrefix)) &&
    (a.parentId === lead.id || a.id === lead.id)
  );
  return match?.id ?? null;
}

function findSimilarActiveDelegation(ctx: CommandHandlerContext, task: string, excludeAgentId?: string): { agentId: string; role: string; task: string } | null {
  const STOP_WORDS = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'to', 'of', 'in', 'for', 'on', 'and', 'or', 'with', 'that', 'this', 'it', 'from', 'by', 'as', 'at', 'be', 'do', 'not', 'all', 'if', 'no', 'so']);
  const extractWords = (text: string): Set<string> => {
    return new Set(
      text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    );
  };

  const taskWords = extractWords(task);
  if (taskWords.size === 0) return null;

  for (const [, del] of ctx.delegations) {
    if (del.status !== 'active') continue;
    if (excludeAgentId && del.toAgentId === excludeAgentId) continue;

    const delWords = extractWords(del.task);
    if (delWords.size === 0) continue;

    const shared = [...taskWords].filter(w => delWords.has(w)).length;
    const similarity = shared / Math.min(taskWords.size, delWords.size);
    if (similarity > 0.5) {
      const agent = ctx.getAgent(del.toAgentId);
      return {
        agentId: del.toAgentId,
        role: agent?.role.name || del.toRole,
        task: del.task.slice(0, 80),
      };
    }
  }
  return null;
}

// ── Auto-DAG helpers ──────────────────────────────────────────────────

/** Threshold for near-duplicate detection (reuses descriptionSimilarity from TaskDAG) */
const NEAR_DUPLICATE_THRESHOLD = 0.6;

interface AutoCreateResult {
  created: boolean;
  taskId: string;
  duplicate?: string;
  depNotes: string[];
}

/**
 * Auto-create a DAG task for an untracked delegation.
 * Applies 3-tier dependency inference:
 *   Tier 1: Explicit depends_on from payload
 *   Tier 2: Review role inference (code-reviewer, critical-reviewer)
 *   Tier 3: Natural language parsing ("after X finishes", "once Y reports")
 */
function autoCreateDagTask(
  ctx: CommandHandlerContext,
  leadId: string,
  role: string,
  taskText: string,
  agentId: string,
  explicitDeps?: string[],
): AutoCreateResult {
  const depNotes: string[] = [];

  // Check for near-duplicate before auto-creating
  const existingTasks = ctx.taskDAG.getTasks(leadId);
  const nearDuplicate = existingTasks.find(
    t => descriptionSimilarity(taskText, t.description, t.title) > NEAR_DUPLICATE_THRESHOLD
  );
  if (nearDuplicate) {
    return { created: false, taskId: '', duplicate: nearDuplicate.id, depNotes };
  }

  const autoId = generateAutoTaskId(role, taskText);
  const autoTask = ctx.taskDAG.addTask(leadId, {
    id: autoId,
    role,
    title: taskText.slice(0, 120),
    description: taskText,
  });

  const started = ctx.taskDAG.startTask(leadId, autoTask.id, agentId);
  if (!started) {
    return { created: false, taskId: autoId, depNotes };
  }

  // ── 3-tier dependency inference ──
  // Tier 1: Explicit depends_on from payload
  const tier1 = explicitDeps || [];

  // Tier 2: Review role inference
  const tier2 = isReviewRole(role) ? inferReviewDependencies(ctx, leadId, taskText) : [];

  // Tier 3: Natural language dependency parsing
  const tier3 = inferSequentialDependencies(ctx, leadId, taskText);

  // Merge and deduplicate (explicit wins, then review, then NL)
  const allDeps = [...new Set([...tier1, ...tier2, ...tier3])];

  for (const depId of allDeps) {
    const added = ctx.taskDAG.addDependency(leadId, autoTask.id, depId);
    if (added) {
      const source = tier1.includes(depId) ? 'explicit' : tier2.includes(depId) ? 'review' : 'inferred';
      depNotes.push(`→ depends on "${depId}" (${source})`);
      logger.info('delegation', `Auto-linked "${autoId}" → depends on "${depId}" (${source})`);
    }
  }

  return { created: true, taskId: autoId, depNotes };
}

/** Generate a readable auto-task ID from role and task description */
export function generateAutoTaskId(role: string, task: string): string {
  const words = task.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 3)
    .join('-');
  const suffix = Date.now().toString(36).slice(-4);
  return `auto-${role}-${words || 'task'}-${suffix}`;
}

function isReviewRole(role: string): boolean {
  return ['code-reviewer', 'critical-reviewer'].includes(role);
}

// ── Tier 2: Review dependency inference ───────────────────────────────

/**
 * Infer dependencies for review tasks by detecting what's being reviewed.
 * Strategies: agent ID reference, task ID reference, role reference.
 */
export function inferReviewDependencies(
  ctx: CommandHandlerContext,
  leadId: string,
  taskDesc: string,
): string[] {
  const deps: string[] = [];
  const allTasks = ctx.taskDAG.getTasks(leadId);

  // Strategy 1: Agent ID reference (e.g., "review commit by 0b85de78")
  for (const m of taskDesc.matchAll(/\b([0-9a-f]{8,})\b/g)) {
    const refId = m[1];
    const task = allTasks.find(t =>
      t.assignedAgentId?.startsWith(refId) &&
      ['running', 'done'].includes(t.dagStatus)
    );
    if (task && !deps.includes(task.id)) deps.push(task.id);
  }

  // Strategy 2: DAG task ID reference (e.g., "review p0-2-autolink")
  for (const m of taskDesc.matchAll(/\b(p\d+-\d+[-\w]*|auto-[-\w]+)\b/gi)) {
    const task = allTasks.find(t =>
      t.id.toLowerCase() === m[1].toLowerCase() ||
      t.id.toLowerCase().startsWith(m[1].toLowerCase())
    );
    if (task && !deps.includes(task.id)) deps.push(task.id);
  }

  // Strategy 3: Role reference (e.g., "review the developer's work")
  if (deps.length === 0) {
    const roleMatch = taskDesc.match(/(?:by|from)\s+(?:the\s+)?(\w+)/i);
    if (roleMatch) {
      const refRole = roleMatch[1].toLowerCase();
      const task = allTasks
        .filter(t => t.role === refRole && ['running', 'done'].includes(t.dagStatus))
        .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
        [0];
      if (task) deps.push(task.id);
    }
  }

  return deps;
}

// ── Tier 3: Natural language dependency parsing ───────────────────────

/** Patterns that indicate a dependency on another agent/task completing */
const NL_DEP_PATTERNS = [
  /(?:after|once|when)\s+(?:agent\s+)?([0-9a-f]{8,})\s+(?:finishes|completes|reports|is done)/gi,
  /(?:after|once|when)\s+(?:the\s+)?(\w+)\s+(?:finishes|completes|reports|is done)/gi,
  /(?:depends on|blocked by|requires|needs)\s+(?:task\s+)?["']?([\w-]+)["']?/gi,
  /(?:after|once)\s+["']?([\w-]+)["']?\s+(?:is\s+)?(?:done|complete|finished)/gi,
];

/**
 * Parse natural language to detect sequential dependencies.
 * Handles patterns like "after agent X finishes", "once architect reports",
 * "depends on task-id", "blocked by p0-2-autolink".
 */
export function inferSequentialDependencies(
  ctx: CommandHandlerContext,
  leadId: string,
  taskDesc: string,
): string[] {
  const deps: string[] = [];
  const allTasks = ctx.taskDAG.getTasks(leadId);

  for (const pattern of NL_DEP_PATTERNS) {
    // Reset regex lastIndex for each call since they're global
    pattern.lastIndex = 0;
    for (const match of taskDesc.matchAll(pattern)) {
      const ref = match[1];

      // Try as agent ID (hex string)
      if (/^[0-9a-f]{8,}$/.test(ref)) {
        const byAgent = allTasks.find(t =>
          t.assignedAgentId?.startsWith(ref) &&
          ['running', 'done', 'ready'].includes(t.dagStatus)
        );
        if (byAgent && !deps.includes(byAgent.id)) { deps.push(byAgent.id); continue; }
      }

      // Try as task ID (exact match)
      const byTaskId = allTasks.find(t => t.id.toLowerCase() === ref.toLowerCase());
      if (byTaskId && !deps.includes(byTaskId.id)) { deps.push(byTaskId.id); continue; }

      // Try as role name
      const byRole = allTasks
        .filter(t => t.role === ref.toLowerCase() && ['running', 'done'].includes(t.dagStatus))
        .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
        [0];
      if (byRole && !deps.includes(byRole.id)) deps.push(byRole.id);
    }
  }

  return deps;
}
