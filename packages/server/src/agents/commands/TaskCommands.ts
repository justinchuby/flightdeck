/**
 * Task DAG command handlers.
 *
 * Commands: DECLARE_TASKS, COMPLETE_TASK, TASK_STATUS, QUERY_TASKS, PAUSE_TASK,
 *           RETRY_TASK, SKIP_TASK, ADD_TASK, CANCEL_TASK, RESET_DAG
 */
import type { Agent } from '../Agent.js';
import type { DagTaskInput } from '../../tasks/TaskDAG.js';
import type { CommandEntry, CommandHandlerContext } from './types.js';

// ── Regex patterns ────────────────────────────────────────────────────

const DECLARE_TASKS_REGEX = /\[\[\[\s*DECLARE_TASKS\s*(\{.*?\})\s*\]\]\]/s;
const TASK_STATUS_REGEX = /\[\[\[\s*TASK_STATUS\s*\]\]\]/s;
const QUERY_TASKS_REGEX = /\[\[\[\s*QUERY_TASKS\s*\]\]\]/s;
const PAUSE_TASK_REGEX = /\[\[\[\s*PAUSE_TASK\s*(\{.*?\})\s*\]\]\]/s;
const RETRY_TASK_REGEX = /\[\[\[\s*RETRY_TASK\s*(\{.*?\})\s*\]\]\]/s;
const SKIP_TASK_REGEX = /\[\[\[\s*SKIP_TASK\s*(\{.*?\})\s*\]\]\]/s;
const ADD_TASK_REGEX = /\[\[\[\s*ADD_TASK\s*(\{.*?\})\s*\]\]\]/s;
const CANCEL_TASK_REGEX = /\[\[\[\s*CANCEL_TASK\s*(\{.*?\})\s*\]\]\]/s;
const COMPLETE_TASK_REGEX = /\[\[\[\s*COMPLETE_TASK\s*(\{.*?\})\s*\]\]\]/s;
const RESET_DAG_REGEX = /\[\[\[\s*RESET_DAG\s*\]\]\]/s;

// ── Handlers ──────────────────────────────────────────────────────────

function handleDeclareTasks(ctx: CommandHandlerContext, agent: Agent, data: string): void {
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
    // Validate each task before passing to DAG (match ADD_TASK validation)
    for (let i = 0; i < req.tasks.length; i++) {
      const t = req.tasks[i];
      const id = typeof t.id === 'string' ? t.id.trim() : '';
      if (!id) {
        agent.sendMessage(`[System] DECLARE_TASKS error: Task at index ${i} is missing required field "id".`);
        return;
      }
      if (id.length > 100) {
        agent.sendMessage(`[System] DECLARE_TASKS error: Task "${id.slice(0, 20)}..." has invalid id (too long, max 100 chars).`);
        return;
      }
      if (!t.role || (typeof t.role === 'string' && !t.role.trim())) {
        agent.sendMessage(`[System] DECLARE_TASKS error: Task at index ${i} is missing required field "role".`);
        return;
      }
    }
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
    const req = JSON.parse(match[1]);
    const ok = ctx.taskDAG.pauseTask(agent.id, req.id);
    agent.sendMessage(ok ? `[System] Task "${req.id}" paused.` : `[System] Cannot pause task "${req.id}" (must be pending or ready).`);
  } catch { agent.sendMessage('[System] PAUSE_TASK error: invalid payload.'); }
}

function handleRetryTask(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  if (agent.role.id !== 'lead') { agent.sendMessage('[System] Only the Project Lead can retry tasks.'); return; }
  const match = data.match(RETRY_TASK_REGEX);
  if (!match) return;
  try {
    const req = JSON.parse(match[1]);
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
    const req = JSON.parse(match[1]);
    const ok = ctx.taskDAG.skipTask(agent.id, req.id);
    if (ok) {
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
    const req = JSON.parse(match[1]) as DagTaskInput;
    if (!req.id || !req.role) { agent.sendMessage('[System] ADD_TASK requires "id" and "role".'); return; }
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
    const req = JSON.parse(match[1]);
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
    const req = JSON.parse(match[1]);

    // Non-lead agents: signal delegation completion to parent
    if (agent.role.id !== 'lead') {
      if (agent.parentId) {
        const parent = ctx.getAgent(agent.parentId);
        if (parent) {
          const summary = req.summary || '(no summary)';
          parent.sendMessage(`[Agent Report] ${agent.role.name} (${agent.id.slice(0, 8)}) completed task.\nSummary: ${summary}`);
          ctx.emit('agent:message_sent', {
            from: agent.id, fromRole: agent.role.name,
            to: parent.id, toRole: parent.role.name,
            content: `COMPLETE_TASK: ${summary}`,
          });
        }
      }
      agent.sendMessage(`[System] Task completion signaled to parent.`);
      return;
    }

    // Lead: complete a DAG task by ID
    if (!req.id) {
      agent.sendMessage('[System] COMPLETE_TASK requires an "id" field (the DAG task ID).');
      return;
    }
    const error = ctx.taskDAG.getTransitionError(agent.id, req.id, 'complete');
    if (error) {
      agent.sendMessage(`[System] Cannot complete task "${req.id}": ${error.currentStatus === 'not_found' ? 'task not found.' : `current status is "${error.currentStatus}". Must be running or ready.`}`);
      return;
    }
    const newlyReady = ctx.taskDAG.completeTask(agent.id, req.id);
    let msg = `[System] Task "${req.id}" marked as done.`;
    if (newlyReady && newlyReady.length > 0) {
      const readyNames = newlyReady.map(d => d.id).join(', ');
      msg += ` Newly ready tasks: ${readyNames}. Use DELEGATE or CREATE_AGENT to assign them.`;
    }
    agent.sendMessage(msg);
  } catch (err: any) {
    agent.sendMessage(`[System] COMPLETE_TASK error: ${err.message}`);
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
  ];
}
