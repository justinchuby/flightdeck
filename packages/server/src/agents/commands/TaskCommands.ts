/**
 * Task DAG command handlers.
 *
 * Commands: DECLARE_TASKS, COMPLETE_TASK, TASK_STATUS, QUERY_TASKS, PAUSE_TASK,
 *           RETRY_TASK, SKIP_TASK, ADD_TASK, CANCEL_TASK, RESET_DAG
 */
import type { Agent } from '../Agent.js';
import type { DagTaskInput } from '../../tasks/TaskDAG.js';
import type { CommandEntry, CommandHandlerContext } from './types.js';
import {
  parseCommandPayload,
  declareTasksSchema,
  addTaskSchema,
  taskIdSchema,
  completeTaskSchema,
  addDependencySchema,
} from './commandSchemas.js';

// ── Regex patterns ────────────────────────────────────────────────────

const DECLARE_TASKS_REGEX = /⟦⟦\s*DECLARE_TASKS\s*(\{.*?\})\s*⟧⟧/s;
const TASK_STATUS_REGEX = /⟦⟦\s*TASK_STATUS\s*⟧⟧/s;
const QUERY_TASKS_REGEX = /⟦⟦\s*QUERY_TASKS\s*⟧⟧/s;
const PAUSE_TASK_REGEX = /⟦⟦\s*PAUSE_TASK\s*(\{.*?\})\s*⟧⟧/s;
const RETRY_TASK_REGEX = /⟦⟦\s*RETRY_TASK\s*(\{.*?\})\s*⟧⟧/s;
const SKIP_TASK_REGEX = /⟦⟦\s*SKIP_TASK\s*(\{.*?\})\s*⟧⟧/s;
const ADD_TASK_REGEX = /⟦⟦\s*ADD_TASK\s*(\{.*?\})\s*⟧⟧/s;
const CANCEL_TASK_REGEX = /⟦⟦\s*CANCEL_TASK\s*(\{.*?\})\s*⟧⟧/s;
const COMPLETE_TASK_REGEX = /⟦⟦\s*COMPLETE_TASK\s*(\{.*?\})\s*⟧⟧/s;
const RESET_DAG_REGEX = /⟦⟦\s*RESET_DAG\s*⟧⟧/s;
const ADD_DEPENDENCY_REGEX = /⟦⟦\s*ADD_DEPENDENCY\s*(\{.*?\})\s*⟧⟧/s;

// ── Handlers ──────────────────────────────────────────────────────────

function handleDeclareTasks(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  if (agent.role.id !== 'lead') {
    agent.sendMessage('[System] Only the Project Lead can declare task DAGs.');
    return;
  }
  const match = data.match(DECLARE_TASKS_REGEX);
  if (!match) return;
  try {
    const req = parseCommandPayload(agent, match[1], declareTasksSchema, 'DECLARE_TASKS');
    if (!req) return;
    const { tasks, conflicts } = ctx.taskDAG.declareTaskBatch(agent.id, req.tasks as DagTaskInput[]);
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
    const readyTasks = tasks.filter(t => t.dagStatus === 'ready');
    if (readyTasks.length > 0) {
      msg += `\n${readyTasks.length} tasks are ready: ${readyTasks.map(d => d.id).join(', ')}. Use DELEGATE or CREATE_AGENT to assign them.`;
    }
    agent.sendMessage(msg);
    ctx.emit('dag:updated', { leadId: agent.id });
  } catch (err: any) {
    agent.sendMessage(`[System] DECLARE_TASKS error: ${err.message}`);
  }
}

function handleTaskStatus(ctx: CommandHandlerContext, agent: Agent, _data: string): void {
  const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
  if (!leadId) {
    agent.sendMessage('[System] No task DAG found.');
    return;
  }
  const status = ctx.taskDAG.getStatus(leadId);
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

function handlePauseTask(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can pause tasks.'); return; }
  const match = data.match(PAUSE_TASK_REGEX);
  if (!match) return;
  try {
    const req = parseCommandPayload(agent, match[1], taskIdSchema, 'PAUSE_TASK');
    if (!req) return;
    const ok = ctx.taskDAG.pauseTask(agent.id, req.id);
    agent.sendMessage(ok ? `[System] Task "${req.id}" paused.` : `[System] Cannot pause task "${req.id}" (must be pending or ready).`);
  } catch { agent.sendMessage('[System] PAUSE_TASK error: invalid payload.'); }
}

function handleRetryTask(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can retry tasks.'); return; }
  const match = data.match(RETRY_TASK_REGEX);
  if (!match) return;
  try {
    const req = parseCommandPayload(agent, match[1], taskIdSchema, 'RETRY_TASK');
    if (!req) return;
    const ok = ctx.taskDAG.retryTask(agent.id, req.id);
    if (ok) {
      agent.sendMessage(`[System] Task "${req.id}" reset to ready. Dependents unblocked. Use DELEGATE or CREATE_AGENT to assign it.`);
    } else {
      agent.sendMessage(`[System] Cannot retry task "${req.id}" (must be failed).`);
    }
  } catch { agent.sendMessage('[System] RETRY_TASK error: invalid payload.'); }
}

function handleSkipTask(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can skip tasks.'); return; }
  const match = data.match(SKIP_TASK_REGEX);
  if (!match) return;
  try {
    const req = parseCommandPayload(agent, match[1], taskIdSchema, 'SKIP_TASK');
    if (!req) return;
    const result = ctx.taskDAG.skipTask(agent.id, req.id);
    if (result) {
      // If a running task was skipped, clean up the orphaned agent
      if (typeof result === 'object' && result.skippedAgentId) {
        const skippedAgent = ctx.getAgent(result.skippedAgentId);
        if (skippedAgent) {
          skippedAgent.sendMessage(`[System] Task "${req.id}" was skipped by the Project Lead. Please stop working on it.`);
        }
        ctx.lockRegistry.releaseAll(result.skippedAgentId);
        // Cancel the active delegation to the orphaned agent
        for (const [, del] of ctx.delegations) {
          if (del.toAgentId === result.skippedAgentId && del.status === 'active') {
            del.status = 'cancelled';
            del.completedAt = new Date().toISOString();
          }
        }
      }
      agent.sendMessage(`[System] Task "${req.id}" skipped. Dependents may now be ready. Use TASK_STATUS to check.`);
    } else {
      agent.sendMessage(`[System] Cannot skip task "${req.id}".`);
    }
  } catch { agent.sendMessage('[System] SKIP_TASK error: invalid payload.'); }
}

function handleAddTask(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can add tasks.'); return; }
  const match = data.match(ADD_TASK_REGEX);
  if (!match) return;
  try {
    const req = parseCommandPayload(agent, match[1], addTaskSchema, 'ADD_TASK');
    if (!req) return;
    const task = ctx.taskDAG.addTask(agent.id, req);
    let msg = `[System] Task "${task.id}" added (${task.dagStatus}).`;
    if (task.dagStatus === 'ready') {
      msg += ` Ready for delegation — use DELEGATE or CREATE_AGENT to assign it.`;
    }
    agent.sendMessage(msg);
  } catch (err: any) { agent.sendMessage(`[System] ADD_TASK error: ${err.message}`); }
}

function handleCancelTask(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can cancel tasks.'); return; }
  const match = data.match(CANCEL_TASK_REGEX);
  if (!match) return;
  try {
    const req = parseCommandPayload(agent, match[1], taskIdSchema, 'CANCEL_TASK');
    if (!req) return;
    const ok = ctx.taskDAG.cancelTask(agent.id, req.id);
    agent.sendMessage(ok ? `[System] Task "${req.id}" cancelled.` : `[System] Cannot cancel task "${req.id}" (may be running or done).`);
  } catch { agent.sendMessage('[System] CANCEL_TASK error: invalid payload.'); }
}

function handleResetDAG(ctx: CommandHandlerContext, agent: Agent, _data: string): void {
  if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can reset the DAG.'); return; }
  const count = ctx.taskDAG.resetDAG(agent.id);
  if (count > 0) {
    agent.sendMessage(`[System] DAG reset: ${count} task(s) removed. You can now DECLARE_TASKS again.`);
  } else {
    agent.sendMessage('[System] No DAG tasks to reset.');
  }
}

function handleCompleteTask(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(COMPLETE_TASK_REGEX);
  if (!match) return;

  try {
    const req = parseCommandPayload(agent, match[1], completeTaskSchema, 'COMPLETE_TASK');
    if (!req) return;

    // Non-lead agents: relay completion to parent lead's DAG
    if (agent.role.id !== 'lead') {
      const MAX_FIELD_LENGTH = 10_000;
      const summary = (req.summary || req.output || '(no summary)').slice(0, MAX_FIELD_LENGTH);
      const status = (req.status || 'done').slice(0, 200);

      if (!agent.parentId) {
        agent.sendMessage('[System] COMPLETE_TASK failed: no parent agent found.');
        return;
      }

      const parent = ctx.getAgent(agent.parentId);

      // Determine the DAG task ID: explicit from payload, or from agent's assignment
      const taskId = req.id || agent.dagTaskId;

      // Relay to parent's DAG if we have a task ID
      if (taskId) {
        // Security: verify calling agent owns this task
        if (req.id && req.id !== agent.dagTaskId) {
          const task = ctx.taskDAG.getTask(agent.parentId, taskId);
          if (task) {
            // Deny if task is assigned to a different agent
            if (task.assignedAgentId && task.assignedAgentId !== agent.id) {
              agent.sendMessage(`[System] COMPLETE_TASK denied: task "${taskId}" is assigned to another agent.`);
              return;
            }
            // Deny if task is unassigned — non-leads can only complete their own tasks
            if (!task.assignedAgentId) {
              agent.sendMessage(`[System] COMPLETE_TASK denied: task "${taskId}" is not assigned to you. Only the lead can complete unassigned tasks.`);
              return;
            }
          }
        }

        const error = ctx.taskDAG.getTransitionError(agent.parentId, taskId, 'complete');
        if (error) {
          // Task not completable — still notify parent via message
          if (parent) {
            parent.sendMessage(`[Agent Report] ${agent.role.name} (${agent.id.slice(0, 8)}) completed task "${taskId}".\nStatus: ${status}\nSummary: ${summary}`);
          }
          agent.sendMessage(`[System] Task "${taskId}" could not be marked done in DAG (status: ${error.currentStatus}). Parent notified.`);
          return;
        }

        const newlyReady = ctx.taskDAG.completeTask(agent.parentId, taskId);

        // Notify parent with completion details and newly ready tasks
        let parentMsg = `[Agent Report] ${agent.role.name} (${agent.id.slice(0, 8)}) completed DAG task "${taskId}".\nStatus: ${status}\nSummary: ${summary}`;
        if (newlyReady && newlyReady.length > 0) {
          const readyNames = newlyReady.map(d => d.id).join(', ');
          parentMsg += `\nNewly ready tasks: ${readyNames}. Use DELEGATE or CREATE_AGENT to assign them.`;
        }
        if (parent) {
          parent.sendMessage(parentMsg);
          ctx.emit('agent:message_sent', {
            from: agent.id, fromRole: agent.role.name,
            to: parent.id, toRole: parent.role.name,
            content: `COMPLETE_TASK [${taskId}]: ${summary}`,
          });
        }
        ctx.emit('dag:updated', { leadId: agent.parentId });
        agent.sendMessage(`[System] Task "${taskId}" marked as done in DAG.${newlyReady && newlyReady.length > 0 ? ` ${newlyReady.length} task(s) now ready.` : ''}`);
      } else {
        // No DAG task ID — fallback to message-only notification
        if (parent) {
          parent.sendMessage(`[Agent Report] ${agent.role.name} (${agent.id.slice(0, 8)}) completed task.\nStatus: ${status}\nSummary: ${summary}`);
          ctx.emit('agent:message_sent', {
            from: agent.id, fromRole: agent.role.name,
            to: parent.id, toRole: parent.role.name,
            content: `COMPLETE_TASK: ${summary}`,
          });
        }
        agent.sendMessage(`[System] Task completion signaled to parent. (No DAG task ID — use dagTaskId for DAG integration.)`);
      }
      return;
    }

    // Lead: complete a DAG task by ID
    if (!req.id) {
      agent.sendMessage('[System] COMPLETE_TASK requires an "id" field (the DAG task ID).');
      return;
    }
    const summary = (req.summary || req.output || '').slice(0, 10_000) || undefined;
    const error = ctx.taskDAG.getTransitionError(agent.id, req.id, 'complete');
    if (error) {
      agent.sendMessage(`[System] Cannot complete task "${req.id}": ${error.currentStatus === 'not_found' ? 'task not found.' : `current status is "${error.currentStatus}". Must be running or ready.`}`);
      return;
    }
    const newlyReady = ctx.taskDAG.completeTask(agent.id, req.id);
    let msg = `[System] Task "${req.id}" marked as done.`;
    if (summary) msg += ` Summary: ${summary}`;
    if (newlyReady && newlyReady.length > 0) {
      const readyNames = newlyReady.map(d => d.id).join(', ');
      msg += ` Newly ready tasks: ${readyNames}. Use DELEGATE or CREATE_AGENT to assign them.`;
    }
    agent.sendMessage(msg);
  } catch (err: any) {
    agent.sendMessage(`[System] COMPLETE_TASK error: ${err.message}`);
  }
}

function handleAddDependency(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(ADD_DEPENDENCY_REGEX);
  if (!match) return;
  try {
    const req = parseCommandPayload(agent, match[1], addDependencySchema, 'ADD_DEPENDENCY');
    if (!req) return;

    // Determine the lead that owns the DAG.
    // If the agent is a lead, use their own ID; otherwise use their parent's ID.
    const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
    if (!leadId) {
      agent.sendMessage('[System] ADD_DEPENDENCY error: cannot determine lead. Only agents with a parent lead can add dependencies.');
      return;
    }

    // Authorization: non-lead agents can only add dependencies to tasks assigned to them
    if (agent.role.id !== 'lead' && agent.role.id !== 'secretary') {
      const task = ctx.taskDAG.getTask(leadId, req.taskId);
      if (!task || task.assignedAgentId !== agent.id) {
        agent.sendMessage(`[System] ADD_DEPENDENCY denied: you can only add dependencies to tasks assigned to you.`);
        return;
      }
    }

    const results: string[] = [];
    for (const depId of req.depends_on) {
      const added = ctx.taskDAG.addDependency(leadId, req.taskId, depId);
      if (added) {
        results.push(`✓ "${req.taskId}" → depends on "${depId}"`);
      } else {
        results.push(`⚠️ "${req.taskId}" → "${depId}" (skipped — duplicate or would create cycle)`);
      }
    }

    agent.sendMessage(`[System] ADD_DEPENDENCY results:\n${results.join('\n')}`);
    ctx.emit('dag:updated', { leadId });
  } catch (err: any) {
    agent.sendMessage(`[System] ADD_DEPENDENCY error: ${err.message}`);
  }
}

// ── Module export ─────────────────────────────────────────────────────

export function getTaskCommands(ctx: CommandHandlerContext): CommandEntry[] {
  return [
    { regex: DECLARE_TASKS_REGEX, name: 'DECLARE_TASKS', handler: (a, d) => handleDeclareTasks(ctx, a, d) },
    { regex: COMPLETE_TASK_REGEX, name: 'COMPLETE_TASK', handler: (a, d) => handleCompleteTask(ctx, a, d) },
    { regex: TASK_STATUS_REGEX, name: 'TASK_STATUS', handler: (a, _d) => handleTaskStatus(ctx, a, _d) },
    { regex: QUERY_TASKS_REGEX, name: 'QUERY_TASKS', handler: (a, _d) => handleTaskStatus(ctx, a, _d) },
    { regex: PAUSE_TASK_REGEX, name: 'PAUSE_TASK', handler: (a, d) => handlePauseTask(ctx, a, d) },
    { regex: RETRY_TASK_REGEX, name: 'RETRY_TASK', handler: (a, d) => handleRetryTask(ctx, a, d) },
    { regex: SKIP_TASK_REGEX, name: 'SKIP_TASK', handler: (a, d) => handleSkipTask(ctx, a, d) },
    { regex: ADD_TASK_REGEX, name: 'ADD_TASK', handler: (a, d) => handleAddTask(ctx, a, d) },
    { regex: CANCEL_TASK_REGEX, name: 'CANCEL_TASK', handler: (a, d) => handleCancelTask(ctx, a, d) },
    { regex: RESET_DAG_REGEX, name: 'RESET_DAG', handler: (a, _d) => handleResetDAG(ctx, a, _d) },
    { regex: ADD_DEPENDENCY_REGEX, name: 'ADD_DEPENDENCY', handler: (a, d) => handleAddDependency(ctx, a, d) },
  ];
}
