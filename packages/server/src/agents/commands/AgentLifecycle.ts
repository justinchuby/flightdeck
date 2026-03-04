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

const SPAWN_REQUEST_REGEX = /⟦⟦\s*SPAWN_AGENT\s*(\{.*?\})\s*⟧⟧/s;
const CREATE_AGENT_REGEX = /⟦⟦\s*CREATE_AGENT\s*(\{.*?\})\s*⟧⟧/s;
const DELEGATE_REGEX = /⟦⟦\s*DELEGATE\s*(\{.*?\})\s*⟧⟧/s;
const TERMINATE_AGENT_REGEX = /⟦⟦\s*TERMINATE_AGENT\s*(\{.*?\})\s*⟧⟧/s;
const CANCEL_DELEGATION_REGEX = /⟦⟦\s*CANCEL_DELEGATION\s*(\{.*?\})\s*⟧⟧/s;

// ── Exported: command entry list ──────────────────────────────────────

export function getLifecycleCommands(ctx: CommandHandlerContext): CommandEntry[] {
  return [
    { regex: SPAWN_REQUEST_REGEX, name: 'SPAWN', handler: (a, d) => handleSpawnRequest(ctx, a, d) },
    { regex: CREATE_AGENT_REGEX, name: 'CREATE_AGENT', handler: (a, d) => handleCreateAgent(ctx, a, d), help: { description: 'Spawn a new agent with a role and task', example: 'CREATE_AGENT {"role": "developer", "task": "implement feature X"}', category: 'Agent Lifecycle', args: [
      { name: 'role', type: 'string', required: true, description: 'Agent role (developer, architect, etc.)' },
      { name: 'task', type: 'string', required: false, description: 'Task description for the agent' },
      { name: 'model', type: 'string', required: false, description: 'Model override (e.g. claude-opus-4.6)' },
      { name: 'context', type: 'string', required: false, description: 'Additional context to include' },
      { name: 'dagTaskId', type: 'string', required: false, description: 'DAG task ID to associate' },
      { name: 'depends_on', type: 'string[]', required: false, description: 'DAG task IDs this depends on' },
      { name: 'name', type: 'string', required: false, description: 'Display name for the agent' },
      { name: 'sessionId', type: 'string', required: false, description: 'Reuse an existing session' },
    ] } },
    { regex: DELEGATE_REGEX, name: 'DELEGATE', handler: (a, d) => handleDelegate(ctx, a, d), help: { description: 'Delegate a task to an existing agent', example: 'DELEGATE {"to": "agent-id", "task": "do something"}', category: 'Agent Lifecycle', args: [
      { name: 'to', type: 'string', required: true, description: 'Target agent ID' },
      { name: 'task', type: 'string', required: true, description: 'Task description' },
      { name: 'context', type: 'string', required: false, description: 'Additional context' },
      { name: 'dagTaskId', type: 'string', required: false, description: 'DAG task ID to associate' },
      { name: 'depends_on', type: 'string[]', required: false, description: 'DAG task IDs this depends on' },
    ] } },
    { regex: TERMINATE_AGENT_REGEX, name: 'TERMINATE_AGENT', handler: (a, d) => handleTerminateAgent(ctx, a, d), help: { description: 'Stop an agent', example: 'TERMINATE_AGENT {"id": "agent-id"}', category: 'Agent Lifecycle', args: [
      { name: 'id', type: 'string', required: true, description: 'Agent ID to terminate' },
      { name: 'reason', type: 'string', required: false, description: 'Reason for termination' },
    ] } },
    { regex: CANCEL_DELEGATION_REGEX, name: 'CANCEL_DELEGATION', handler: (a, d) => handleCancelDelegation(ctx, a, d), help: { description: 'Cancel an active delegation', example: 'CANCEL_DELEGATION {"delegationId": "del-id"}', category: 'Agent Lifecycle', args: [
      { name: 'agentId', type: 'string', required: false, description: 'Agent ID (either agentId or delegationId required)' },
      { name: 'delegationId', type: 'string', required: false, description: 'Delegation ID' },
    ] } },
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
          if (autoResult.linked) {
            dagNote = ` [DAG: linked to "${autoResult.taskId}" → running]`;
            child.dagTaskId = autoResult.taskId;
            logger.info('delegation', `DAG linked: task "${autoResult.taskId}" → agent ${child.id.slice(0, 8)}`);
          } else if (autoResult.created) {
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
      }, ctx.getProjectIdForAgent(agent.id) ?? '');
      ctx.emit('agent:delegated', { parentId: agent.id, childId: child.id, delegation });

      ctx.activityLedger.log(agent.id, agent.role.id, 'delegated', `Created & delegated to ${role.name}: ${req.task.slice(0, 100)}`, {
        toAgentId: child.id, toRole: role.id, childId: child.id, childRole: role.id, delegationId: delegation.id,
      }, ctx.getProjectIdForAgent(agent.id) ?? '');
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
      }, ctx.getProjectIdForAgent(agent.id) ?? '');
    }

    ctx.agentMemory.store(agent.id, child.id, 'role', role.name);
    if (req.model) ctx.agentMemory.store(agent.id, child.id, 'model', req.model);
    if (req.task) ctx.agentMemory.store(agent.id, child.id, 'task', req.task.slice(0, 200));

    maybeSuggestDagGroup(ctx, agent.id);
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
    child.taskOutputStartIndex = child.messages?.length ?? 0;

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
        if (autoResult.linked) {
          dagNote = ` [DAG: linked to "${autoResult.taskId}" → running]`;
          child.dagTaskId = autoResult.taskId;
          logger.info('delegation', `DAG linked: task "${autoResult.taskId}" → agent ${child.id.slice(0, 8)}`);
        } else if (autoResult.created) {
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
    }, ctx.getProjectIdForAgent(agent.id) ?? '');

    ctx.activityLedger.log(agent.id, agent.role.id, 'delegated', `Delegated to ${child.role.name} (${child.id.slice(0, 8)}): ${req.task.slice(0, 100)}`, {
      toAgentId: child.id, toRole: child.role.id, childId: child.id, childRole: child.role.id, delegationId: delegation.id,
    }, ctx.getProjectIdForAgent(agent.id) ?? '');

    ctx.emit('agent:delegated', { parentId: agent.id, childId: child.id, delegation });

    maybeAutoCreateGroup(ctx, agent, ctx.delegations);
    maybeSuggestDagGroup(ctx, agent.id);
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
    }, ctx.getProjectIdForAgent(agent.id) ?? '');

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
      }, ctx.getProjectIdForAgent(agent.id) ?? '');

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
      }, ctx.getProjectIdForAgent(agent.id) ?? '');

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
  for (const [, del] of ctx.delegations) {
    if (del.status !== 'active') continue;
    if (excludeAgentId && del.toAgentId === excludeAgentId) continue;

    const similarity = descriptionSimilarity(task, del.task);
    if (similarity > 0.6) {
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
  linked?: boolean;
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

  // Check for near-duplicate before auto-creating (active tasks only — done/skipped/cancelled are fair game for re-delegation)
  const existingTasks = ctx.taskDAG.getTasks(leadId);
  const nearDuplicate = existingTasks
    .filter(t => !['done', 'skipped', 'cancelled'].includes(t.dagStatus))
    .find(
      t => descriptionSimilarity(taskText, t.description, t.title) > NEAR_DUPLICATE_THRESHOLD
    );
  if (nearDuplicate) {
    // Link to existing declared task instead of creating a duplicate
    const linkableStatuses = ['ready', 'pending', 'blocked', 'paused', 'failed'];
    if (linkableStatuses.includes(nearDuplicate.dagStatus)) {
      // Try normal start first (works for 'ready'), then force-start for others
      const started = ctx.taskDAG.startTask(leadId, nearDuplicate.id, agentId)
        ?? ctx.taskDAG.forceStartTask(leadId, nearDuplicate.id, agentId);
      if (started) {
        logger.info('delegation', `DAG linked: delegation matched existing task "${nearDuplicate.id}" (was ${nearDuplicate.dagStatus})`);
        return { created: false, taskId: nearDuplicate.id, linked: true, depNotes };
      }
    }
    // Already running or can't link — warn instead
    return { created: false, taskId: '', duplicate: nearDuplicate.id, depNotes };
  }

  const autoId = generateAutoTaskId(role, taskText);
  let autoTask;
  try {
    autoTask = ctx.taskDAG.addTask(leadId, {
      id: autoId,
      role,
      title: taskText.slice(0, 120),
      description: taskText,
    });
  } catch (e: any) {
    logger.warn('delegation', `Auto-DAG creation failed for "${autoId}": ${e.message}`);
    return { created: false, taskId: autoId, depNotes };
  }

  const started = ctx.taskDAG.startTask(leadId, autoTask.id, agentId);
  if (!started) {
    return { created: false, taskId: autoId, depNotes };
  }

  // ── Dependency inference (Tier 1 + Tier 2, synchronous) ──
  // Tier 1: Explicit depends_on from payload
  const tier1 = explicitDeps || [];

  // Tier 2: Review role inference
  const tier2 = isReviewRole(role) ? inferReviewDependencies(ctx, leadId, taskText) : [];

  // Apply deterministic deps immediately
  const allSyncDeps = [...new Set([...tier1, ...tier2])];

  for (const depId of allSyncDeps) {
    const added = ctx.taskDAG.addDependency(leadId, autoTask.id, depId);
    if (added) {
      const source = tier1.includes(depId) ? 'explicit' : 'review';
      depNotes.push(`→ depends on "${depId}" (${source})`);
      logger.info('delegation', `Auto-linked "${autoId}" → depends on "${depId}" (${source})`);
    }
  }

  // Tier 3: Secretary-assisted inference (async, non-blocking)
  // Only if no deps found yet — ask the Secretary to analyze
  if (allSyncDeps.length === 0) {
    requestSecretaryDependencyAnalysis(ctx, leadId, autoId, taskText);
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
  // Exactly 8 hex chars to avoid matching commit SHAs, color codes, etc.
  for (const m of taskDesc.matchAll(/\b([0-9a-f]{8})\b/g)) {
    const refId = m[1];
    const task = allTasks.find(t => {
      const bareId = t.assignedAgentId?.replace(/^agent-/, '') ?? '';
      return bareId.startsWith(refId) && ['running', 'done'].includes(t.dagStatus);
    });
    if (task && !deps.includes(task.id)) deps.push(task.id);
  }

  // Strategy 2: DAG task ID reference (e.g., "review p0-2-autolink")
  // Prefer exact match; fall back to prefix only if no exact match found
  for (const m of taskDesc.matchAll(/\b(p\d+-\d+[-\w]*|auto-[-\w]+)\b/gi)) {
    const ref = m[1].toLowerCase();
    const exact = allTasks.find(t => t.id.toLowerCase() === ref);
    if (exact && !deps.includes(exact.id)) { deps.push(exact.id); continue; }
    const prefix = allTasks.find(t => t.id.toLowerCase().startsWith(ref));
    if (prefix && !deps.includes(prefix.id)) deps.push(prefix.id);
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

// ── Tier 3: Secretary-assisted dependency inference ───────────────────

/**
 * Send a message to the Secretary agent asking it to analyze the DAG
 * and identify any dependencies for the newly created task.
 * Non-blocking: Secretary replies asynchronously with ADD_DEPENDENCY commands.
 */
export function requestSecretaryDependencyAnalysis(
  ctx: CommandHandlerContext,
  leadId: string,
  newTaskId: string,
  taskDescription: string,
): void {
  // Find secretary agent for this lead
  const secretary = ctx.getAllAgents().find(a =>
    a.parentId === leadId && a.role.id === 'secretary' && a.status !== 'terminated'
  );
  if (!secretary) return;

  const activeTasks = ctx.taskDAG.getTasks(leadId)
    .filter(t => ['running', 'ready', 'pending'].includes(t.dagStatus) && t.id !== newTaskId)
    .map(t => `  - ${t.id}: ${t.description?.slice(0, 100) || t.role}`)
    .join('\n');

  if (!activeTasks) return;

  secretary.sendMessage(
    `[System] Dependency analysis needed for new task "${newTaskId}":\n` +
    `Description: ${taskDescription.slice(0, 500)}\n\n` +
    `Active tasks:\n${activeTasks}\n\n` +
    `Does "${newTaskId}" depend on any of these tasks? ` +
    `If yes, reply with ⟦⟦ ADD_DEPENDENCY {"taskId": "${newTaskId}", "depends_on": ["task-id-here"]} ⟧⟧. ` +
    `If no dependencies, ignore this message.`
  );
  logger.info('delegation', `Requested Secretary dependency analysis for "${newTaskId}"`);
}

// ── DAG-aware group chat suggestions ──────────────────────────────────

/** Track suggested group names per lead to avoid repeating suggestions. Exported for testing. */
export const suggestedGroupNames = new Map<string, Set<string>>();

const GROUP_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'all', 'its',
  'implement', 'create', 'build', 'fix', 'add', 'review', 'update', 'check',
  'test', 'run', 'verify', 'ensure', 'handle', 'process', 'manage', 'write',
  'read', 'make', 'use', 'new', 'agent', 'task', 'work', 'code', 'file',
  'changes', 'based', 'should', 'when', 'after', 'before', 'first', 'each',
  'your', 'their', 'about', 'will', 'been', 'have', 'need', 'also', 'done',
]);

/** Extract significant keywords from a task description. */
function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !GROUP_STOP_WORDS.has(w));
}

/**
 * After auto-DAG task creation, check if 3+ agents share common keywords
 * in their DAG task descriptions. If so, suggest a group to the lead.
 * Only suggests — does not auto-create.
 */
export function maybeSuggestDagGroup(
  ctx: CommandHandlerContext,
  leadId: string,
): void {
  const tasks = ctx.taskDAG.getTasks(leadId)
    .filter(t => ['running', 'ready'].includes(t.dagStatus) && t.assignedAgentId);

  if (tasks.length < 3) return;

  // Build keyword → agent mapping (multi-keyword per task)
  const keywordAgents = new Map<string, Set<string>>();
  const agentTaskDesc = new Map<string, string>();
  for (const task of tasks) {
    const keywords = extractKeywords(task.description || task.title || task.role);
    agentTaskDesc.set(task.assignedAgentId!, task.description || task.title || task.role);
    for (const kw of keywords) {
      if (!keywordAgents.has(kw)) keywordAgents.set(kw, new Set());
      keywordAgents.get(kw)!.add(task.assignedAgentId!);
    }
  }

  // Find clusters: keywords shared by 3+ agents
  const clusters = new Map<string, Set<string>>();
  for (const [keyword, agents] of keywordAgents) {
    if (agents.size >= 3) {
      // Group overlapping agent sets by merging into the best keyword
      let merged = false;
      for (const [existingKw, existingAgents] of clusters) {
        const overlap = [...agents].filter(a => existingAgents.has(a)).length;
        if (overlap >= 2) {
          // Merge into existing cluster, keep the keyword with more agents
          for (const a of agents) existingAgents.add(a);
          merged = true;
          break;
        }
      }
      if (!merged) {
        clusters.set(keyword, new Set(agents));
      }
    }
  }

  if (clusters.size === 0) return;

  // Check existing groups and prior suggestions to avoid re-suggesting
  const existingGroups = ctx.chatGroupRegistry.getGroups(leadId);
  const existingGroupNames = new Set(existingGroups.map(g => g.name.toLowerCase()));
  if (!suggestedGroupNames.has(leadId)) suggestedGroupNames.set(leadId, new Set());
  const alreadySuggested = suggestedGroupNames.get(leadId)!;

  const lead = ctx.getAgent(leadId);
  if (!lead) return;

  for (const [keyword, agentIds] of clusters) {
    const groupName = `${keyword}-team`;
    if (existingGroupNames.has(groupName)) continue;
    if (alreadySuggested.has(groupName)) continue;

    const memberList = [...agentIds].map(id => {
      const a = ctx.getAgent(id);
      return a ? `${a.role.name} (${id.slice(0, 8)})` : id.slice(0, 8);
    }).join(', ');

    const memberIds = JSON.stringify([...agentIds, leadId]);

    lead.sendMessage(
      `[System suggestion] ${agentIds.size} agents are working on ${keyword}-related tasks: ${memberList}. ` +
      `Consider creating a coordination group:\n` +
      `⟦⟦ CREATE_GROUP {"name": "${groupName}", "members": ${memberIds}} ⟧⟧`
    );
    alreadySuggested.add(groupName);
    logger.info('delegation', `Suggested group "${groupName}" for ${agentIds.size} agents on ${keyword} tasks`);
    break; // One suggestion per delegation event
  }
}
