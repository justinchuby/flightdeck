/**
 * Task DAG command handlers.
 *
 * Commands: DECLARE_TASKS, COMPLETE_TASK, TASK_STATUS, QUERY_TASKS, PAUSE_TASK,
 *           RETRY_TASK, REOPEN_TASK, SKIP_TASK, ADD_TASK, CANCEL_TASK, RESET_DAG,
 *           FORCE_READY, ASSIGN_TASK, REASSIGN_TASK
 */
import type { Agent } from '../Agent.js';
import type { DagTaskInput } from '../../tasks/TaskDAG.js';
import { TaskDAG } from '../../tasks/TaskDAG.js';
import type { CommandEntry, CommandHandlerContext } from './types.js';
import { formatNewlyReadyMessage } from './CompletionTracking.js';
import {
  parseCommandPayload,
  declareTasksSchema,
  addTaskSchema,
  taskIdSchema,
  completeTaskSchema,
  addDependencySchema,
  assignTaskSchema,
} from './commandSchemas.js';
import { deriveArgs } from './CommandHelp.js';
import { notifySecretary } from './secretaryNotifier.js';

// ── Helpers ─────────────────────────────────────────────────────────────

/** Mark active delegations for an agent as completed/cancelled. */
function markAgentDelegations(
  ctx: CommandHandlerContext,
  agentId: string,
  match: 'to' | 'from',
  status: 'completed' | 'cancelled',
  result?: string,
): number {
  let count = 0;
  for (const [, del] of ctx.delegations) {
    const matchId = match === 'to' ? del.toAgentId : del.fromAgentId;
    if (matchId === agentId && del.status === 'active') {
      del.status = status;
      del.completedAt = new Date().toISOString();
      if (result !== undefined) del.result = result;
      count++;
    }
  }
  return count;
}

// ── Regex patterns ────────────────────────────────────────────────────

const DECLARE_TASKS_REGEX = /⟦⟦\s*DECLARE_TASKS\s*([\[{].*?[\]}])\s*⟧⟧/s;
const TASK_STATUS_REGEX = /⟦⟦\s*TASK_STATUS\s*(?:\{[^}]*\})?\s*⟧⟧/s;
const QUERY_TASKS_REGEX = /⟦⟦\s*QUERY_TASKS\s*(?:\{[^}]*\})?\s*⟧⟧/s;
const PAUSE_TASK_REGEX = /⟦⟦\s*PAUSE_TASK\s*(\{.*?\})\s*⟧⟧/s;
const RESUME_TASK_REGEX = /⟦⟦\s*RESUME_TASK\s*(\{.*?\})\s*⟧⟧/s;
const RETRY_TASK_REGEX = /⟦⟦\s*RETRY_TASK\s*(\{.*?\})\s*⟧⟧/s;
const SKIP_TASK_REGEX = /⟦⟦\s*SKIP_TASK\s*(\{.*?\})\s*⟧⟧/s;
const ADD_TASK_REGEX = /⟦⟦\s*ADD_TASK\s*(\{.*?\})\s*⟧⟧/s;
const CANCEL_TASK_REGEX = /⟦⟦\s*CANCEL_TASK\s*(\{.*?\})\s*⟧⟧/s;
const COMPLETE_TASK_REGEX = /⟦⟦\s*COMPLETE_TASK\s*(\{.*?\})\s*⟧⟧/s;
const RESET_DAG_REGEX = /⟦⟦\s*RESET_DAG\s*(?:\{[^}]*\})?\s*⟧⟧/s;
const ADD_DEPENDENCY_REGEX = /⟦⟦\s*ADD_DEPENDENCY\s*(\{.*?\})\s*⟧⟧/s;
const REASSIGN_TASK_REGEX = /⟦⟦\s*REASSIGN_TASK\s*(\{.*?\})\s*⟧⟧/s;
const FORCE_READY_REGEX = /⟦⟦\s*FORCE_READY\s*(\{.*?\})\s*⟧⟧/s;
const REOPEN_TASK_REGEX = /⟦⟦\s*REOPEN_TASK\s*(\{.*?\})\s*⟧⟧/s;
const ASSIGN_TASK_REGEX = /⟦⟦\s*ASSIGN_TASK\s*(\{.*?\})\s*⟧⟧/s;

// ── Handlers ──────────────────────────────────────────────────────────

function handleDeclareTasks(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  if (agent.role.id !== 'lead') {
    agent.sendMessage('[System] Only the Project Lead can declare task DAGs.');
    return;
  }
  const match = data.match(DECLARE_TASKS_REGEX);
  if (!match) return;
  try {
    // Pre-parse to detect common format mistakes before Zod validation
    let raw: unknown;
    try {
      raw = JSON.parse(match[1]);
    } catch {
      agent.sendMessage('[System] DECLARE_TASKS error: invalid JSON payload. Check syntax and try again.');
      return;
    }

    // Bare array instead of {tasks: [...]}
    if (Array.isArray(raw)) {
      agent.sendMessage(
        '[System] DECLARE_TASKS error: expected {tasks: [...]} object, got a bare array.\n' +
        'Wrap your tasks: DECLARE_TASKS {"tasks": [...]}\n' +
        'Example: DECLARE_TASKS {"tasks": [{"taskId": "t1", "role": "developer", "description": "..."}]}',
      );
      return;
    }

    // Wrong field names with helpful hints
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const obj = raw as Record<string, unknown>;
      const tasks = Array.isArray(obj.tasks) ? obj.tasks : [];
      const hints: string[] = [];
      for (const task of tasks) {
        if (task && typeof task === 'object') {
          const t = task as Record<string, unknown>;
          if ('id' in t && !('taskId' in t)) hints.push('"id" → "taskId"');
          if ('deps' in t && !('dependsOn' in t)) hints.push('"deps" → "dependsOn"');
          if ('dependencies' in t && !('dependsOn' in t)) hints.push('"dependencies" → "dependsOn"');
          if ('title' in t && !('description' in t)) hints.push('"title" → "description"');
          if ('name' in t && !('taskId' in t)) hints.push('"name" → "taskId"');
          if ('type' in t && !('role' in t)) hints.push('"type" → "role"');
        }
      }
      if (hints.length > 0) {
        const unique = [...new Set(hints)];
        agent.sendMessage(
          `[System] DECLARE_TASKS hint: detected likely wrong field names. Did you mean:\n` +
          unique.map(h => `  • ${h}`).join('\n') +
          '\nRequired fields per task: taskId, role. Optional: description, dependsOn, files, priority.',
        );
        // Continue to Zod validation — it may still pass if required fields are present
      }
    }

    const req = parseCommandPayload(agent, match[1], declareTasksSchema, 'DECLARE_TASKS');
    if (!req) return;
    const projectId = ctx.getProjectIdForAgent(agent.id);
    const { tasks, conflicts, linkedAutoTasks } = ctx.taskDAG.declareTaskBatch(agent.id, req.tasks as DagTaskInput[], projectId);
    let msg = `[System] Task DAG declared: ${tasks.length} tasks added.`;
    if (linkedAutoTasks.length > 0) {
      msg += `\n🔗 Linked ${linkedAutoTasks.length} declared task(s) to existing auto-created tasks:`;
      for (const link of linkedAutoTasks) {
        msg += `\n  - "${link.declaredId}" → existing "${link.autoId}"`;
      }
    }
    const readyCount = tasks.filter(t => t.dagStatus === 'ready').length;
    const pendingCount = tasks.filter(t => t.dagStatus === 'pending').length;
    msg += `\n  Ready: ${readyCount}, Pending (waiting on deps): ${pendingCount}`;
    if (conflicts.length > 0) {
      msg += '\n⚠️ FILE CONFLICTS detected (tasks share files without explicit dependency):';
      for (const c of conflicts) {
        msg += `\n  - ${c.file}: tasks [${c.tasks.join(', ')}]`;
      }
      msg += '\nConsider adding dependsOn between these tasks or confirming parallel execution.';
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

  // Gather active child agents for coverage metric
  const activeAgents = ctx.getAllAgents()
    .filter(a => a.parentId === leadId && a.status !== 'terminated' && a.role.id !== 'secretary')
    .map(a => ({ id: a.id, role: a.role.id }));

  const status = ctx.taskDAG.getStatus(leadId, activeAgents);
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
    const statusIcon = ({ pending: '⏳', ready: '🟢', running: '🔵', done: '✅', failed: '❌', blocked: '🚫', paused: '⏸️', skipped: '⏭️', in_review: '🔍' } as Record<string, string>)[task.dagStatus] || '?';
    msg += `\n  ${statusIcon} [${task.dagStatus.toUpperCase()}] ${task.id} (${task.role})`;
    if (task.priority && task.priority > 0) msg += ` [P${task.priority}]`;
    if (task.description) msg += ` — ${task.description.slice(0, 80)}`;
    if (task.assignedAgentId) msg += ` [agent: ${task.assignedAgentId.slice(0, 8)}]`;
    if (task.dependsOn.length > 0) msg += `\n      dependsOn: [${task.dependsOn.join(', ')}]`;
    if (task.files.length > 0) msg += `\n      files: [${task.files.join(', ')}]`;
  }
  if (Object.keys(fileLockMap).length > 0) {
    msg += '\n\nFile Lock Map:';
    for (const [file, info] of Object.entries(fileLockMap)) {
      msg += `\n  ${file} → ${info.taskId}${info.agentId ? ` (${info.agentId.slice(0, 8)})` : ''}`;
    }
  }
  // Coverage metric
  if (status.coverage && status.coverage.total > 0) {
    msg += `\n\n📊 DAG Coverage: ${status.coverage.percentage}% (${status.coverage.tracked}/${status.coverage.total} active agents tracked)`;
    if (status.coverage.untrackedAgents.length > 0) {
      msg += `\n⚠️ Untracked agents: ${status.coverage.untrackedAgents.map(a => `${a.role} (${a.id.slice(0, 8)})`).join(', ')}`;
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
    const ok = ctx.taskDAG.pauseTask(agent.id, req.taskId);
    agent.sendMessage(ok ? `[System] Task "${req.taskId}" paused.` : `[System] Cannot pause task "${req.taskId}" (must be pending or ready).`);
  } catch { agent.sendMessage('[System] PAUSE_TASK error: invalid payload.'); }
}

function handleResumeTask(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can resume tasks.'); return; }
  const match = data.match(RESUME_TASK_REGEX);
  if (!match) return;
  try {
    const req = parseCommandPayload(agent, match[1], taskIdSchema, 'RESUME_TASK');
    if (!req) return;
    const ok = ctx.taskDAG.resumeTask(agent.id, req.taskId);
    if (ok) {
      const task = ctx.taskDAG.getTask(agent.id, req.taskId);
      agent.sendMessage(`[System] Task "${req.taskId}" resumed → ${task?.dagStatus || 'ready'}. Use DELEGATE or CREATE_AGENT to assign it.`);
    } else {
      agent.sendMessage(`[System] Cannot resume task "${req.taskId}" (must be paused).`);
    }
  } catch { agent.sendMessage('[System] RESUME_TASK error: invalid payload.'); }
}

function handleRetryTask(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can retry tasks.'); return; }
  const match = data.match(RETRY_TASK_REGEX);
  if (!match) return;
  try {
    const req = parseCommandPayload(agent, match[1], taskIdSchema, 'RETRY_TASK');
    if (!req) return;
    const ok = ctx.taskDAG.retryTask(agent.id, req.taskId);
    if (ok) {
      agent.sendMessage(`[System] Task "${req.taskId}" reset to ready. Dependents unblocked. Use DELEGATE or CREATE_AGENT to assign it.`);
    } else {
      agent.sendMessage(`[System] Cannot retry task "${req.taskId}" (must be failed).`);
    }
  } catch { agent.sendMessage('[System] RETRY_TASK error: invalid payload.'); }
}

function handleReopenTask(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can reopen tasks.'); return; }
  const match = data.match(REOPEN_TASK_REGEX);
  if (!match) return;
  try {
    const req = parseCommandPayload(agent, match[1], taskIdSchema, 'REOPEN_TASK');
    if (!req) return;
    const result = ctx.taskDAG.reopenTask(agent.id, req.taskId);
    if (result) {
      const allTasks = ctx.taskDAG.getTasks(agent.id);
      const startedDependents = allTasks.filter(t =>
        t.dependsOn.includes(req.taskId) && (t.dagStatus === 'running' || t.dagStatus === 'done')
      );
      let msg = `[System] Task "${req.taskId}" reopened → ${result.dagStatus}.`;
      if (startedDependents.length > 0) {
        const names = startedDependents.map(t => `"${t.id}" (${t.dagStatus})`).join(', ');
        msg += ` ⚠ Warning: ${startedDependents.length} dependent task(s) already started/completed: ${names}. Consider pausing or cancelling them.`;
      }
      agent.sendMessage(msg);
    } else {
      const error = ctx.taskDAG.getTransitionError(agent.id, req.taskId, 'reopen');
      if (error) {
        agent.sendMessage(`[System] ${TaskDAG.formatTransitionError(error)}`);
      } else {
        agent.sendMessage(`[System] Cannot reopen task "${req.taskId}" (must be done).`);
      }
    }
  } catch { agent.sendMessage('[System] REOPEN_TASK error: invalid payload.'); }
}

function handleSkipTask(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can skip tasks.'); return; }
  const match = data.match(SKIP_TASK_REGEX);
  if (!match) return;
  try {
    const req = parseCommandPayload(agent, match[1], taskIdSchema, 'SKIP_TASK');
    if (!req) return;
    const result = ctx.taskDAG.skipTask(agent.id, req.taskId);
    if (result) {
      // If a running task was skipped, clean up the orphaned agent
      if (typeof result === 'object' && result.skippedAgentId) {
        const skippedAgent = ctx.getAgent(result.skippedAgentId);
        if (skippedAgent) {
          skippedAgent.sendMessage(`[System] Task "${req.taskId}" was skipped by the Project Lead. Please stop working on it.`);
        }
        ctx.lockRegistry.releaseAll(result.skippedAgentId);
        markAgentDelegations(ctx, result.skippedAgentId, 'to', 'cancelled');
      }
      agent.sendMessage(`[System] Task "${req.taskId}" skipped. Dependents may now be ready. Use TASK_STATUS to check.`);
    } else {
      agent.sendMessage(`[System] Cannot skip task "${req.taskId}".`);
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
    const projectId = ctx.getProjectIdForAgent(agent.id);
    const task = ctx.taskDAG.addTask(agent.id, req, projectId);
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
    const ok = ctx.taskDAG.cancelTask(agent.id, req.taskId);
    agent.sendMessage(ok ? `[System] Task "${req.taskId}" cancelled.` : `[System] Cannot cancel task "${req.taskId}" (may be running or done).`);
  } catch { agent.sendMessage('[System] CANCEL_TASK error: invalid payload.'); }
}

function handleResetDAG(ctx: CommandHandlerContext, agent: Agent, _data: string): void {
  if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can reset the DAG.'); return; }
  const count = ctx.taskDAG.resetDAG(agent.id);
  const cancelledDelegations = markAgentDelegations(ctx, agent.id, 'from', 'cancelled');
  if (count > 0) {
    const delNote = cancelledDelegations > 0 ? ` ${cancelledDelegations} delegation(s) cancelled.` : '';
    agent.sendMessage(`[System] DAG reset: ${count} task(s) archived.${delNote} You can now DECLARE_TASKS again.`);
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

      // Store on agent for knowledge extraction on session end
      agent.completionSummary = summary;

      if (!agent.parentId) {
        agent.sendMessage('[System] COMPLETE_TASK failed: no parent agent found.');
        return;
      }

      const parent = ctx.getAgent(agent.parentId);

      // Determine the DAG task ID: explicit from payload, or from agent's assignment
      const taskId = req.taskId || agent.dagTaskId;

      // Relay to parent's DAG if we have a task ID
      if (taskId) {
        // Security: verify calling agent owns this task
        if (req.taskId && req.taskId !== agent.dagTaskId) {
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
          if (error.currentStatus === 'done') {
            agent.sendMessage(`[System] Task "${taskId}" is already done (auto-completed from agent report). No action needed.`);
            return;
          }
          // Task not completable — still notify parent via message
          if (parent) {
            parent.sendMessage(`[Agent Report] ${agent.role.name} (${agent.id.slice(0, 8)}) completed task "${taskId}".\nStatus: ${status}\nSummary: ${summary}`);
          }
          agent.sendMessage(`[System] Task "${taskId}" could not be marked done in DAG (status: ${error.currentStatus}). Parent notified.`);
          return;
        }

        const newlyReady = ctx.taskDAG.completeTask(agent.parentId, taskId);

        // Log to activity ledger so keyframes/milestones track completion
        ctx.activityLedger.log(agent.id, agent.role.id, 'task_completed',
          `Completed task "${taskId}": ${summary}`,
          { taskId }, ctx.getProjectIdForAgent(agent.id) ?? '');

        // Notify parent with completion details and newly ready tasks
        let parentMsg = `[Agent Report] ${agent.role.name} (${agent.id.slice(0, 8)}) completed DAG task "${taskId}".\nStatus: ${status}\nSummary: ${summary}`;
        if (newlyReady && newlyReady.length > 0) {
          parentMsg += '\n' + formatNewlyReadyMessage(ctx, agent.parentId!, taskId, newlyReady);
        }
        if (parent) {
          parent.sendMessage(parentMsg);
          ctx.emit('agent:message_sent', {
            from: agent.id, fromRole: agent.role.name,
            to: parent.id, toRole: parent.role.name,
            content: `COMPLETE_TASK [${taskId}]: ${summary}`,
          });
        }
        // Prevent duplicate report when agent goes idle after COMPLETE_TASK
        ctx.reportedCompletions.add(`${agent.id}:idle`);
        markAgentDelegations(ctx, agent.id, 'to', 'completed', summary);
        ctx.emit('dag:updated', { leadId: agent.parentId });
        notifySecretary(ctx, agent.parentId!, `[System] Task "${taskId}" completed by ${agent.role.name} (${agent.id.slice(0, 8)}): ${summary}`, agent.id);
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
        // Prevent duplicate report when agent goes idle after COMPLETE_TASK
        ctx.reportedCompletions.add(`${agent.id}:idle`);
        markAgentDelegations(ctx, agent.id, 'to', 'completed', summary);
        agent.sendMessage(`[System] Task completion signaled to parent. (No DAG task ID — use dagTaskId for DAG integration.)`);
      }
      // Clear task assignment — the work is done. This prevents the task-based
      // guard in notifyParentOfIdle from letting stale-task agents through after
      // the dedup key is cleared on running→idle cycles.
      agent.task = undefined;
      return;
    }

    // Lead: complete a DAG task by ID
    if (!req.taskId) {
      agent.sendMessage('[System] COMPLETE_TASK requires a "taskId" field (the DAG task ID).');
      return;
    }
    const summary = (req.summary || req.output || '').slice(0, 10_000) || undefined;

    // Store on agent for knowledge extraction on session end
    if (summary) agent.completionSummary = summary;
    const error = ctx.taskDAG.getTransitionError(agent.id, req.taskId, 'complete');
    if (error) {
      if (error.currentStatus === 'done' && error.attemptedAction === 'complete') {
        agent.sendMessage(`[System] Task "${req.taskId}" is already done (auto-completed from agent report). No action needed.`);
      } else {
        agent.sendMessage(`[System] ${TaskDAG.formatTransitionError(error)}`);
      }
      return;
    }
    const newlyReady = ctx.taskDAG.completeTask(agent.id, req.taskId);

    // Log to activity ledger so keyframes/milestones track completion
    ctx.activityLedger.log(agent.id, agent.role.id, 'task_completed',
      `Completed task "${req.taskId}"${summary ? ': ' + summary.slice(0, 200) : ''}`,
      { taskId: req.taskId }, ctx.getProjectIdForAgent(agent.id) ?? '');

    let msg = `[System] Task "${req.taskId}" marked as done.`;
    if (summary) msg += ` Summary: ${summary}`;
    if (newlyReady && newlyReady.length > 0) {
      msg += ' ' + formatNewlyReadyMessage(ctx, agent.id, req.taskId, newlyReady);
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
    for (const depId of req.dependsOn) {
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

function handleForceReady(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can force tasks to ready.'); return; }
  const match = data.match(FORCE_READY_REGEX);
  if (!match) return;
  try {
    const req = parseCommandPayload(agent, match[1], taskIdSchema, 'FORCE_READY');
    if (!req) return;
    const task = ctx.taskDAG.forceReady(agent.id, req.taskId);
    if (task) {
      agent.sendMessage(`[System] Task "${req.taskId}" forced to ready. Use DELEGATE or CREATE_AGENT to assign it.`);
    } else {
      const existing = ctx.taskDAG.getTask(agent.id, req.taskId);
      const hint = existing ? ` Current status: "${existing.dagStatus}". Must be pending or blocked.` : ' Task not found.';
      agent.sendMessage(`[System] Cannot force task "${req.taskId}" to ready.${hint}`);
    }
  } catch { agent.sendMessage('[System] FORCE_READY error: invalid payload.'); }
}

function handleReassignTask(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can reassign tasks.'); return; }
  const match = data.match(REASSIGN_TASK_REGEX);
  if (!match) return;
  try {
    const req = parseCommandPayload(agent, match[1], assignTaskSchema, 'REASSIGN_TASK');
    if (!req) return;

    // Resolve the new agent (supports short ID prefix matching, rejects ambiguous)
    const agentMatches = ctx.getAllAgents().filter(a =>
      (a.id === req.agentId || a.id.startsWith(req.agentId)) &&
      a.parentId === agent.id &&
      a.id !== agent.id
    );
    if (agentMatches.length === 0) {
      agent.sendMessage(`[System] Agent not found: "${req.agentId}". Use QUERY_CREW to see available agents.`);
      return;
    }
    if (agentMatches.length > 1) {
      agent.sendMessage(`[System] Ambiguous agent ID "${req.agentId}" matches ${agentMatches.length} agents. Use a longer prefix.`);
      return;
    }
    const newAgent = agentMatches[0];

    // Prevent self-reassignment
    const currentTask = ctx.taskDAG.getTask(agent.id, req.taskId);
    if (currentTask?.assignedAgentId === newAgent.id) {
      agent.sendMessage(`[System] Task "${req.taskId}" is already assigned to @${newAgent.id.slice(0, 8)}.`);
      return;
    }

    const result = ctx.taskDAG.reassignTask(agent.id, req.taskId, newAgent.id);
    if (!result) {
      const existing = ctx.taskDAG.getTask(agent.id, req.taskId);
      const hint = existing ? ` Current status: "${existing.dagStatus}". Must be running with an assigned agent.` : ' Task not found.';
      agent.sendMessage(`[System] Cannot reassign task "${req.taskId}".${hint}`);
      return;
    }

    // Clean up old agent: cancel delegation, release locks, notify
    const oldAgent = ctx.getAgent(result.oldAgentId);
    if (oldAgent) {
      oldAgent.sendMessage(`[System] Task "${req.taskId}" has been reassigned to another agent. Please stop working on it.`);
      oldAgent.dagTaskId = undefined;
    }
    ctx.lockRegistry.releaseAll(result.oldAgentId);
    // Cancel only the delegation for this specific task (not all of old agent's delegations)
    const taskDesc = ctx.taskDAG.getTask(agent.id, req.taskId)?.description;
    for (const [, del] of ctx.delegations) {
      if (del.toAgentId === result.oldAgentId && del.status === 'active' &&
          (del.task === taskDesc || del.task === req.taskId)) {
        del.status = 'cancelled';
        del.completedAt = new Date().toISOString();
        break; // Only cancel the matching delegation
      }
    }

    // Set up new agent: create delegation, set dagTaskId, notify
    const task = ctx.taskDAG.getTask(agent.id, req.taskId);
    const taskText = task?.description || req.taskId;
    const delegation: import('./types.js').Delegation = {
      id: `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fromAgentId: agent.id,
      toAgentId: newAgent.id,
      toRole: newAgent.role.id,
      task: taskText,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    ctx.delegations.set(delegation.id, delegation);
    newAgent.dagTaskId = req.taskId;
    newAgent.task = taskText;
    newAgent.sendMessage(`[DAG Task: ${req.taskId}]\n${taskText}`);

    const oldLabel = oldAgent ? `@${result.oldAgentId.slice(0, 8)}` : result.oldAgentId.slice(0, 8);
    agent.sendMessage(`[System] Task "${req.taskId}" reassigned from ${oldLabel} to @${newAgent.id.slice(0, 8)}. Old agent notified to stop; new agent has the task.`);
    notifySecretary(ctx, agent.id, `[System] Task "${req.taskId}" reassigned from ${oldLabel} to ${newAgent.role.name} (${newAgent.id.slice(0, 8)})`);
  } catch { agent.sendMessage('[System] REASSIGN_TASK error: invalid payload.'); }
}

function handleAssignTask(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can assign tasks.'); return; }
  const match = data.match(ASSIGN_TASK_REGEX);
  if (!match) return;
  try {
    const req = parseCommandPayload(agent, match[1], assignTaskSchema, 'ASSIGN_TASK');
    if (!req) return;

    const existing = ctx.taskDAG.getTask(agent.id, req.taskId);
    if (!existing) {
      agent.sendMessage(`[System] Cannot assign task "${req.taskId}": task not found.`);
      return;
    }

    // Resolve agent with prefix matching + ambiguity detection
    const matches = ctx.getAllAgents().filter(a =>
      (a.id === req.agentId || a.id.startsWith(req.agentId)) &&
      a.parentId === agent.id &&
      a.id !== agent.id
    );
    if (matches.length > 1) {
      agent.sendMessage(`[System] Ambiguous agent ID "${req.agentId}" matches ${matches.length} agents. Use a longer prefix.`);
      return;
    }
    const targetAgent = matches[0];
    if (!targetAgent) {
      agent.sendMessage(`[System] Agent not found: "${req.agentId}". Use QUERY_CREW to see available agents.`);
      return;
    }

    // Better error for already-running tasks
    if (existing.dagStatus === 'running') {
      const currentOwner = existing.assignedAgentId ? existing.assignedAgentId.slice(0, 8) : 'unknown';
      agent.sendMessage(`[System] Cannot assign task "${req.taskId}": already running, assigned to ${currentOwner}. Use REASSIGN_TASK to change.`);
      return;
    }

    // Try normal start first (works for ready tasks), then fall back to forceStart
    let task = ctx.taskDAG.startTask(agent.id, req.taskId, targetAgent.id);
    if (!task) {
      task = ctx.taskDAG.forceStartTask(agent.id, req.taskId, targetAgent.id);
    }

    if (task) {
      // Set dagTaskId on agent, create delegation record, notify agent
      targetAgent.dagTaskId = req.taskId;
      const taskText = existing.description || req.taskId;
      targetAgent.task = taskText;
      const delegation: import('./types.js').Delegation = {
        id: `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fromAgentId: agent.id,
        toAgentId: targetAgent.id,
        toRole: targetAgent.role.id,
        task: taskText,
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      ctx.delegations.set(delegation.id, delegation);
      targetAgent.sendMessage(`[DAG Task: ${req.taskId}]\n${taskText}`);

      agent.sendMessage(`[System] Task "${req.taskId}" assigned to @${targetAgent.id.slice(0, 8)} and moved to running.`);
      ctx.emit('dag:updated', { leadId: agent.id });
      notifySecretary(ctx, agent.id, `[System] Task "${req.taskId}" assigned to ${targetAgent.role.name} (${targetAgent.id.slice(0, 8)})`);
    } else {
      agent.sendMessage(`[System] Cannot assign task "${req.taskId}": current status is "${existing.dagStatus}". Task may already be completed or skipped.`);
    }
  } catch (err: any) { agent.sendMessage(`[System] ASSIGN_TASK error: ${err.message}`); }
}

// ── Module export ─────────────────────────────────────────────────────

export function getTaskCommands(ctx: CommandHandlerContext): CommandEntry[] {
  return [
    { regex: DECLARE_TASKS_REGEX, name: 'DECLARE_TASKS', handler: (a, d) => handleDeclareTasks(ctx, a, d), help: { description: 'Declare a set of tasks with dependencies', example: 'DECLARE_TASKS {"tasks": [{"taskId": "task-1", "role": "developer", "description": "..."}]}', category: 'Task DAG', args: deriveArgs(declareTasksSchema) } },
    { regex: COMPLETE_TASK_REGEX, name: 'COMPLETE_TASK', handler: (a, d) => handleCompleteTask(ctx, a, d), help: { description: 'Mark a task as done', example: 'COMPLETE_TASK {"summary": "what was accomplished"}', category: 'Task DAG', args: deriveArgs(completeTaskSchema) } },
    { regex: TASK_STATUS_REGEX, name: 'TASK_STATUS', handler: (a, _d) => handleTaskStatus(ctx, a, _d), help: { description: 'View the task DAG status', example: 'TASK_STATUS', category: 'Task DAG' } },
    { regex: QUERY_TASKS_REGEX, name: 'QUERY_TASKS', handler: (a, _d) => handleTaskStatus(ctx, a, _d) },
    { regex: PAUSE_TASK_REGEX, name: 'PAUSE_TASK', handler: (a, d) => handlePauseTask(ctx, a, d), help: { description: 'Pause a task', example: 'PAUSE_TASK {"taskId": "task-1"}', category: 'Task DAG', args: deriveArgs(taskIdSchema) } },
    { regex: RESUME_TASK_REGEX, name: 'RESUME_TASK', handler: (a, d) => handleResumeTask(ctx, a, d), help: { description: 'Resume a paused task', example: 'RESUME_TASK {"taskId": "task-1"}', category: 'Task DAG', args: deriveArgs(taskIdSchema) } },
    { regex: RETRY_TASK_REGEX, name: 'RETRY_TASK', handler: (a, d) => handleRetryTask(ctx, a, d), help: { description: 'Retry a failed task', example: 'RETRY_TASK {"taskId": "task-1"}', category: 'Task DAG', args: deriveArgs(taskIdSchema) } },
    { regex: REOPEN_TASK_REGEX, name: 'REOPEN_TASK', handler: (a, d) => handleReopenTask(ctx, a, d), help: { description: 'Reopen a completed task', example: 'REOPEN_TASK {"taskId": "task-1"}', category: 'Task DAG', args: deriveArgs(taskIdSchema) } },
    { regex: SKIP_TASK_REGEX, name: 'SKIP_TASK', handler: (a, d) => handleSkipTask(ctx, a, d), help: { description: 'Skip a task', example: 'SKIP_TASK {"taskId": "task-1"}', category: 'Task DAG', args: deriveArgs(taskIdSchema) } },
    { regex: ADD_TASK_REGEX, name: 'ADD_TASK', handler: (a, d) => handleAddTask(ctx, a, d), help: { description: 'Add a single task to the DAG', example: 'ADD_TASK {"taskId": "task-2", "role": "developer", "description": "..."}', category: 'Task DAG', args: deriveArgs(addTaskSchema) } },
    { regex: CANCEL_TASK_REGEX, name: 'CANCEL_TASK', handler: (a, d) => handleCancelTask(ctx, a, d), help: { description: 'Cancel a task', example: 'CANCEL_TASK {"taskId": "task-1"}', category: 'Task DAG', args: deriveArgs(taskIdSchema) } },
    { regex: RESET_DAG_REGEX, name: 'RESET_DAG', handler: (a, _d) => handleResetDAG(ctx, a, _d), help: { description: 'Reset the entire task DAG', example: 'RESET_DAG', category: 'Task DAG' } },
    { regex: ADD_DEPENDENCY_REGEX, name: 'ADD_DEPENDENCY', handler: (a, d) => handleAddDependency(ctx, a, d), help: { description: 'Add a dependency between tasks', example: 'ADD_DEPENDENCY {"taskId": "task-2", "dependsOn": ["task-1"]}', category: 'Task DAG', args: deriveArgs(addDependencySchema) } },
    { regex: FORCE_READY_REGEX, name: 'FORCE_READY', handler: (a, d) => handleForceReady(ctx, a, d), help: { description: 'Force a task to ready status', example: 'FORCE_READY {"taskId": "task-1"}', category: 'Task DAG', args: deriveArgs(taskIdSchema) } },
    { regex: ASSIGN_TASK_REGEX, name: 'ASSIGN_TASK', handler: (a, d) => handleAssignTask(ctx, a, d), help: { description: 'Assign a task to a specific agent', example: 'ASSIGN_TASK {"taskId": "task-2", "agentId": "agent-id"}', category: 'Task DAG', args: deriveArgs(assignTaskSchema) } },
    { regex: REASSIGN_TASK_REGEX, name: 'REASSIGN_TASK', handler: (a, d) => handleReassignTask(ctx, a, d), help: { description: 'Reassign a task to a different agent', example: 'REASSIGN_TASK {"taskId": "task-2", "agentId": "new-agent-id"}', category: 'Task DAG', args: deriveArgs(assignTaskSchema) } },
  ];
}
