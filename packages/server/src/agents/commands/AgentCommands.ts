/**
 * Agent lifecycle command handlers.
 *
 * Commands: SPAWN_AGENT, CREATE_AGENT, DELEGATE, TERMINATE_AGENT, CANCEL_DELEGATION
 *
 * Also owns delegation state (Map), completion tracking (Set), and the
 * public API methods: notifyParentOfIdle, notifyParentOfCompletion,
 * getDelegations, completeDelegationsForAgent, cleanupStaleDelegations, etc.
 */
import type { Agent } from '../Agent.js';
import type { CommandHandlerContext, CommandEntry, Delegation } from './types.js';
import { MAX_CONCURRENCY_LIMIT } from '../../config.js';
import { maybeAutoCreateGroup } from './CommCommands.js';
import { logger } from '../../utils/logger.js';

// ── Regex patterns ────────────────────────────────────────────────────

const SPAWN_REQUEST_REGEX = /\[\[\[\s*SPAWN_AGENT\s*(\{.*?\})\s*\]\]\]/s;
const CREATE_AGENT_REGEX = /\[\[\[\s*CREATE_AGENT\s*(\{.*?\})\s*\]\]\]/s;
const DELEGATE_REGEX = /\[\[\[\s*DELEGATE\s*(\{.*?\})\s*\]\]\]/s;
const TERMINATE_AGENT_REGEX = /\[\[\[\s*TERMINATE_AGENT\s*(\{.*?\})\s*\]\]\]/s;
const CANCEL_DELEGATION_REGEX = /\[\[\[\s*CANCEL_DELEGATION\s*(\{.*?\})\s*\]\]\]/s;

// ── Exported: command entry list ──────────────────────────────────────

export function getAgentCommands(ctx: CommandHandlerContext): CommandEntry[] {
  return [
    { regex: SPAWN_REQUEST_REGEX, name: 'SPAWN', handler: (a, d) => handleSpawnRequest(ctx, a, d) },
    { regex: CREATE_AGENT_REGEX, name: 'CREATE_AGENT', handler: (a, d) => handleCreateAgent(ctx, a, d) },
    { regex: DELEGATE_REGEX, name: 'DELEGATE', handler: (a, d) => handleDelegate(ctx, a, d) },
    { regex: TERMINATE_AGENT_REGEX, name: 'TERMINATE_AGENT', handler: (a, d) => handleTerminateAgent(ctx, a, d) },
    { regex: CANCEL_DELEGATION_REGEX, name: 'CANCEL_DELEGATION', handler: (a, d) => handleCancelDelegation(ctx, a, d) },
  ];
}

// ── Public API (called by CommandDispatcher thin wrappers) ────────────

export function notifyParentOfIdle(ctx: CommandHandlerContext, agent: Agent): void {
  if (!agent.parentId) return;
  const parent = ctx.getAgent(agent.parentId);
  if (!parent || (parent.status !== 'running' && parent.status !== 'idle')) return;

  const dedupKey = `${agent.id}:idle`;
  if (ctx.reportedCompletions.has(dedupKey)) return;
  ctx.reportedCompletions.add(dedupKey);

  for (const [, del] of ctx.delegations) {
    if (del.toAgentId === agent.id && del.status === 'active') {
      del.status = 'completed';
      del.completedAt = new Date().toISOString();
      del.result = agent.getRecentOutput(16000);
    }
  }

  const rawOutput = agent.getRecentOutput(16000);
  const cleanPreview = rawOutput.replace(/\[\[\[[\s\S]*?\]\]\]/g, '').replace(/\[\[\[[\s\S]*$/g, '').trim().slice(-12000);
  const sessionLine = agent.sessionId ? `\nSession ID: ${agent.sessionId}` : '';
  const taskBrief = agent.task ? (agent.task.length > 150 ? agent.task.slice(0, 150) + '...' : agent.task) : 'none';
  const summary = `[Agent Report] ${agent.role.name} (${agent.id.slice(0, 8)}) finished work.\nTask: ${taskBrief}${sessionLine}\nOutput summary: ${cleanPreview || '(no output)'}`;

  logger.info('delegation', `Child ${agent.role.name} (${agent.id.slice(0, 8)}) finished → notifying parent ${parent.role.name} (${parent.id.slice(0, 8)})`);
  parent.sendMessage(summary);
  ctx.emit('agent:message_sent', {
    from: agent.id,
    fromRole: agent.role.name,
    to: parent.id,
    toRole: parent.role.name,
    content: summary,
  });
  ctx.activityLedger.log(agent.id, agent.role.id, 'message_sent', `Completion report → ${parent.role.name} (${parent.id.slice(0, 8)})`, {
    toAgentId: parent.id, toRole: parent.role.id,
  });
  ctx.emit('agent:completion_reported', { childId: agent.id, parentId: agent.parentId, status: 'completed' });

  if (agent.parentId) {
    const dagTask = ctx.taskDAG.getTaskByAgent(agent.parentId, agent.id);
    if (dagTask) {
      const newlyReady = ctx.taskDAG.completeTask(agent.parentId, dagTask.id);
      if (newlyReady && newlyReady.length > 0) {
        const dagParent = ctx.getAgent(agent.parentId);
        if (dagParent) {
          const readyNames = newlyReady.map(d => d.id).join(', ');
          dagParent.sendMessage(`[System] DAG: Task "${dagTask.id}" done. Newly ready tasks: ${readyNames}. Use DELEGATE or CREATE_AGENT to assign them.`);
        }
      }
    }
  }
}

export function notifyParentOfCompletion(ctx: CommandHandlerContext, agent: Agent, exitCode: number | null): void {
  if (!agent.parentId) return;
  const parent = ctx.getAgent(agent.parentId);
  if (!parent || (parent.status !== 'running' && parent.status !== 'idle')) return;

  const idleKey = `${agent.id}:idle`;
  const exitKey = `${agent.id}:exit`;
  if (ctx.reportedCompletions.has(exitKey)) return;
  ctx.reportedCompletions.add(exitKey);

  if (ctx.reportedCompletions.has(idleKey) && exitCode === 0) {
    for (const [, del] of ctx.delegations) {
      if (del.toAgentId === agent.id && del.status === 'active') {
        del.status = exitCode === 0 ? 'completed' : 'failed';
        del.completedAt = new Date().toISOString();
        del.result = agent.getRecentOutput(16000);
      }
    }
    return;
  }

  for (const [, del] of ctx.delegations) {
    if (del.toAgentId === agent.id && del.status === 'active') {
      del.status = exitCode === 0 ? 'completed' : 'failed';
      del.completedAt = new Date().toISOString();
      del.result = agent.getRecentOutput(16000);
    }
  }

  const status = exitCode === -1 ? 'terminated' : exitCode === 0 ? 'completed successfully' : `failed (exit code ${exitCode})`;
  const rawOutput2 = agent.getRecentOutput(16000);
  const cleanPreview2 = rawOutput2.replace(/\[\[\[[\s\S]*?\]\]\]/g, '').replace(/\[\[\[[\s\S]*$/g, '').trim().slice(-12000);
  const sessionLine2 = agent.sessionId ? `\nSession ID: ${agent.sessionId}` : '';
  const taskBrief2 = agent.task ? (agent.task.length > 150 ? agent.task.slice(0, 150) + '...' : agent.task) : 'none';
  const summary = `[Agent Report] ${agent.role.name} (${agent.id.slice(0, 8)}) ${status}.\nTask: ${taskBrief2}${sessionLine2}\nOutput summary: ${cleanPreview2 || '(no output)'}`;

  logger.info('delegation', `Child ${agent.role.name} (${agent.id.slice(0, 8)}) → parent ${parent.role.name} (${parent.id.slice(0, 8)}): ${status}`);
  parent.sendMessage(summary);
  ctx.emit('agent:message_sent', {
    from: agent.id,
    fromRole: agent.role.name,
    to: parent.id,
    toRole: parent.role.name,
    content: summary,
  });
  ctx.activityLedger.log(agent.id, agent.role.id, 'message_sent', `Exit report (${status}) → ${parent.role.name} (${parent.id.slice(0, 8)})`, {
    toAgentId: parent.id, toRole: parent.role.id,
  });
  ctx.emit('agent:completion_reported', { childId: agent.id, parentId: agent.parentId, status });

  if (agent.parentId) {
    const dagTask = ctx.taskDAG.getTaskByAgent(agent.parentId, agent.id);
    if (dagTask) {
      if (exitCode === 0) {
        const newlyReady = ctx.taskDAG.completeTask(agent.parentId, dagTask.id);
        if (newlyReady && newlyReady.length > 0) {
          const dagParent = ctx.getAgent(agent.parentId);
          if (dagParent) {
            const readyNames = newlyReady.map(d => d.id).join(', ');
            dagParent.sendMessage(`[System] DAG: Task "${dagTask.id}" done. Newly ready tasks: ${readyNames}. Use DELEGATE or CREATE_AGENT to assign them.`);
          }
        }
      } else {
        ctx.taskDAG.failTask(agent.parentId, dagTask.id);
        const dagParent = ctx.getAgent(agent.parentId);
        if (dagParent) {
          dagParent.sendMessage(`[System] DAG: Task "${dagTask.id}" FAILED (exit ${exitCode}). Dependents blocked. Use RETRY_TASK or SKIP_TASK.`);
        }
      }
    }
  }
}

export function getDelegations(ctx: CommandHandlerContext, parentId?: string): Delegation[] {
  const all = Array.from(ctx.delegations.values());
  return parentId ? all.filter((d) => d.fromAgentId === parentId) : all;
}

export function clearCompletionTracking(ctx: CommandHandlerContext, agentId: string): void {
  ctx.reportedCompletions.delete(`${agentId}:idle`);
  ctx.reportedCompletions.delete(`${agentId}:exit`);
}

export function completeDelegationsForAgent(ctx: CommandHandlerContext, agentId: string): void {
  for (const [, del] of ctx.delegations) {
    if (del.status === 'active' && del.toAgentId === agentId) {
      del.status = 'failed';
    }
  }
}

export function cleanupStaleDelegations(ctx: CommandHandlerContext, maxAgeMs = 300_000): number {
  const cutoff = Date.now() - maxAgeMs;
  let count = 0;
  for (const [id, del] of ctx.delegations) {
    if ((del.status === 'completed' || del.status === 'failed' || del.status === 'cancelled') && new Date(del.createdAt).getTime() <= cutoff) {
      ctx.delegations.delete(id);
      count++;
    }
  }
  return count;
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
    const req = JSON.parse(match[1]);

    // Lead, architect, and agents with delegation capability can create agents
    const canCreate = agent.role.id === 'lead' || agent.role.id === 'architect'
      || ctx.capabilityInjector?.hasCommand(agent.id, 'CREATE_AGENT');
    if (!canCreate) {
      logger.warn('agent', `Agent ${agent.role.name} (${agent.id.slice(0, 8)}) attempted CREATE_AGENT — only leads and architects can create agents.`);
      agent.sendMessage(`[System] Only the Project Lead and Architects can create agents. Ask the lead if you need help from a specialist.`);
      return;
    }

    if (!req.role) {
      agent.sendMessage(`[System] CREATE_AGENT requires a "role" field. Available roles: ${ctx.roleRegistry.getAll().map(r => r.id).join(', ')}`);
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
        const dagTask = req.dagTaskId
          ? ctx.taskDAG.getTask(agent.id, req.dagTaskId)
          : ctx.taskDAG.findReadyTaskByRole(agent.id, role.id);
        if (dagTask) {
          const started = ctx.taskDAG.startTask(agent.id, dagTask.id, child.id);
          if (started) {
            dagNote = ` [DAG: "${dagTask.id}" → running]`;
            logger.info('delegation', `DAG linked: task "${dagTask.id}" → agent ${child.id.slice(0, 8)}`);
          }
        } else if (ctx.taskDAG.hasActiveTasks(agent.id)) {
          dagNote = `\n⚠️ You have an active DAG plan. Use ADD_TASK to track this delegation, or include dagTaskId to link to an existing task.`;
        } else if (ctx.taskDAG.hasAnyTasks(agent.id)) {
          dagNote = `\n💡 Your previous plan is complete. Consider using DECLARE_TASKS to plan this new phase of work.`;
        }
      }

      const taskPrompt = req.context ? `${req.task}\n\nContext: ${req.context}` : req.task;
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
    const req = JSON.parse(match[1]);
    if (!req.to || !req.task) return;

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
      const dagTask = req.dagTaskId
        ? ctx.taskDAG.getTask(agent.id, req.dagTaskId)
        : ctx.taskDAG.findReadyTaskByRole(agent.id, child.role.id);
      if (dagTask) {
        const started = ctx.taskDAG.startTask(agent.id, dagTask.id, child.id);
        if (started) {
          dagNote = ` [DAG: "${dagTask.id}" → running]`;
          logger.info('delegation', `DAG linked: task "${dagTask.id}" → agent ${child.id.slice(0, 8)}`);
        }
      } else if (ctx.taskDAG.hasActiveTasks(agent.id)) {
        dagNote = `\n⚠️ You have an active DAG plan. Use ADD_TASK to track this delegation, or include dagTaskId to link to an existing task.`;
      } else if (ctx.taskDAG.hasAnyTasks(agent.id)) {
        dagNote = `\n💡 Your previous plan is complete. Consider using DECLARE_TASKS to plan this new phase of work.`;
      }
    }
    ctx.agentMemory.store(agent.id, child.id, 'task', req.task.slice(0, 200));
    if (req.context) ctx.agentMemory.store(agent.id, child.id, 'context', req.context.slice(0, 200));

    const taskPrompt = req.context
      ? `${req.task}\n\nContext: ${req.context}`
      : req.task;
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
    const req = JSON.parse(match[1]);
    if (!req.id) return;

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
    const req = JSON.parse(match[1]);

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

    } else {
      agent.sendMessage(`[System] CANCEL_DELEGATION requires either "agentId" or "delegationId". Example: [[[ CANCEL_DELEGATION {"agentId": "agent-id"} ]]]`);
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
