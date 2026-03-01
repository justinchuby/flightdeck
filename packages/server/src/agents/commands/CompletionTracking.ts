/**
 * Completion and delegation tracking.
 *
 * Handles notifying parents when child agents go idle or exit,
 * delegation lifecycle management, and cleanup of stale delegations.
 */
import type { Agent } from '../Agent.js';
import type { CommandHandlerContext, Delegation } from './types.js';
import { logger } from '../../utils/logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
  const cleanPreview = rawOutput.replace(/⟦⟦[\s\S]*?⟧⟧/g, '').replace(/⟦⟦[\s\S]*$/g, '').trim().slice(-12000);
  const sessionLine = agent.sessionId ? `\nSession ID: ${agent.sessionId}` : '';
  const taskBrief = agent.task ? (agent.task.length > 150 ? agent.task.slice(0, 150) + '...' : agent.task) : 'none';
  const dagLabel = agent.dagTaskId ? ` [${agent.dagTaskId}]` : '';
  const summary = `[Agent Report]${dagLabel} ${agent.role.name} (${agent.id.slice(0, 8)}) finished work.\nTask: ${taskBrief}${sessionLine}\nOutput summary: ${cleanPreview || '(no output)'}`;

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
    if (dagTask && dagTask.dagStatus === 'running') {
      const newlyReady = ctx.taskDAG.completeTask(agent.parentId, dagTask.id);
      if (newlyReady && newlyReady.length > 0) {
        const dagParent = ctx.getAgent(agent.parentId);
        if (dagParent) {
          const readyNames = newlyReady.map(d => d.id).join(', ');
          dagParent.sendMessage(`[System] DAG: Task "${dagTask.id}" done. Newly ready tasks: ${readyNames}. Use DELEGATE or CREATE_AGENT to assign them.`);
        }
      }
    } else if (!dagTask) {
      // Task not in DAG — nudge the lead to track it
      const dagStatus = ctx.taskDAG.getStatus(agent.parentId);
      if (dagStatus.summary.pending + dagStatus.summary.ready + dagStatus.summary.running > 0) {
        parent.sendMessage(`[System] ⚠ This task was NOT in the DAG. Use COMPLETE_TASK or ADD_TASK (with status "done") to keep the DAG current.`);
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
  const cleanPreview2 = rawOutput2.replace(/⟦⟦[\s\S]*?⟧⟧/g, '').replace(/⟦⟦[\s\S]*$/g, '').trim().slice(-12000);
  const sessionLine2 = agent.sessionId ? `\nSession ID: ${agent.sessionId}` : '';
  const taskBrief2 = agent.task ? (agent.task.length > 150 ? agent.task.slice(0, 150) + '...' : agent.task) : 'none';
  const dagLabel2 = agent.dagTaskId ? ` [${agent.dagTaskId}]` : '';
  const summary = `[Agent Report]${dagLabel2} ${agent.role.name} (${agent.id.slice(0, 8)}) ${status}.\nTask: ${taskBrief2}${sessionLine2}\nOutput summary: ${cleanPreview2 || '(no output)'}`;

  logger.info('delegation', `Child ${agent.role.name} (${agent.id.slice(0, 8)}) → parent ${parent.role.name} (${parent.id.slice(0, 8)}): ${status}`);
  parent.sendMessage(summary);

  // Fix 4: Pre-termination commit check — warn parent if agent has dirty locked files
  checkDirtyLockedFiles(ctx, agent, parent);
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
    if (dagTask && dagTask.dagStatus === 'running') {
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
    } else if (!dagTask) {
      // Task not in DAG — nudge the lead to track it
      const dagStatus = ctx.taskDAG.getStatus(agent.parentId);
      if (dagStatus.summary.pending + dagStatus.summary.ready + dagStatus.summary.running > 0) {
        parent.sendMessage(`[System] ⚠ This task was NOT in the DAG. Use COMPLETE_TASK or ADD_TASK (with status "done") to keep the DAG current.`);
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

// ── Fix 4: Pre-termination dirty-file check ──────────────────────────

function checkDirtyLockedFiles(ctx: CommandHandlerContext, agent: Agent, parent: Agent): void {
  let locks: { filePath: string }[];
  try {
    locks = ctx.lockRegistry.getByAgent(agent.id);
  } catch {
    return; // lockRegistry not available in this context
  }
  if (locks.length === 0) return;

  const cwd = agent.cwd || process.cwd();
  const filePaths = locks.map(l => `'${l.filePath.replace(/'/g, "'\\''")}'`).join(' ');

  execAsync(`git diff --name-only -- ${filePaths}`, { cwd, timeout: 10_000 })
    .then(({ stdout }) => {
      const dirtyFiles = stdout.trim().split('\n').filter(Boolean);
      if (dirtyFiles.length > 0) {
        const listed = dirtyFiles.slice(0, 10).join(', ');
        const more = dirtyFiles.length > 10 ? ` (and ${dirtyFiles.length - 10} more)` : '';
        parent.sendMessage(`[System] ⚠ Warning: Agent ${agent.role.name} (${agent.id.slice(0, 8)}) terminated with uncommitted changes in locked files: ${listed}${more}. These changes may be lost.`);
      }
    })
    .catch(() => {
      // Best-effort — don't block termination flow if git check fails
    });
}
