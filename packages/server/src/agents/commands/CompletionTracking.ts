/**
 * Completion and delegation tracking.
 *
 * Handles notifying parents when child agents go idle or exit,
 * delegation lifecycle management, and cleanup of stale delegations.
 */
import type { Agent } from '../Agent.js';
import type { CommandHandlerContext, Delegation } from './types.js';
import type { DagTask } from '../../tasks/TaskDAG.js';
import { logger } from '../../utils/logger.js';
import { redact } from '../../utils/redaction.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ── Public API (called by CommandDispatcher thin wrappers) ────────────

/** Build a "newly ready" notification with idle agent info */
export function formatNewlyReadyMessage(
  ctx: CommandHandlerContext,
  leadId: string,
  completedTaskId: string,
  newlyReady: DagTask[],
): string {
  const readyNames = newlyReady.map(d => d.id).join(', ');
  let msg = `[System] DAG: Task "${completedTaskId}" done. Newly ready tasks: ${readyNames}.`;

  // Find idle agents that could work on these tasks
  const idleAgents = ctx.getAllAgents().filter(a =>
    a.parentId === leadId
    && a.status === 'idle'
    && a.id !== leadId
  );

  if (idleAgents.length > 0) {
    const idleLines = newlyReady.map(task => {
      const matching = idleAgents.filter(a => a.role.id === task.role);
      if (matching.length > 0) {
        return `  ${task.id} (${task.role}): idle agents → ${matching.map(a => `${a.role.name} (${a.id.slice(0, 8)})`).join(', ')}`;
      }
      return `  ${task.id} (${task.role}): no idle agents with matching role`;
    });
    msg += `\nIdle agents:\n${idleLines.join('\n')}`;
  }

  msg += '\nUse DELEGATE or CREATE_AGENT to assign them.';
  return msg;
}

export function notifyParentOfIdle(ctx: CommandHandlerContext, agent: Agent): void {
  if (!agent.parentId) return;
  // Only send completion reports for agents with assigned work.
  // Agents cycling without a task or delegation (e.g., secretary, idle pools) shouldn't produce reports.
  const hasWork = agent.task || agent.dagTaskId
    || Array.from(ctx.delegations.values()).some(d => d.toAgentId === agent.id && d.status === 'active');
  if (!hasWork) return;
  const parent = ctx.getAgent(agent.parentId);
  if (!parent || (parent.status !== 'running' && parent.status !== 'idle')) return;

  const dedupKey = `${agent.id}:idle`;
  if (ctx.reportedCompletions.has(dedupKey)) return;
  ctx.reportedCompletions.add(dedupKey);

  // Suppress the "finished work" report when the agent already sent
  // COMPLETE_TASK for its DAG task.  The dedup key above is cleared each
  // time the agent goes running (to allow re-notification on the next
  // idle), so it alone is insufficient to prevent duplicates across turns.
  // Checking the DAG task status is the authoritative guard.
  if (agent.dagTaskId && agent.parentId) {
    const dagTask = ctx.taskDAG.getTask(agent.parentId, agent.dagTaskId);
    if (dagTask && dagTask.dagStatus === 'done') {
      return;
    }
  }

  // Same-turn race guard: the ACP adapter can report idle BEFORE
  // CommandDispatcher finishes parsing COMPLETE_TASK from the output buffer.
  // Check the raw output synchronously — if COMPLETE_TASK is present,
  // suppress this report since the COMPLETE_TASK handler will send its own.
  const rawOutput = agent.getTaskOutput(16000);
  const hasCompleteTask = /⟦⟦\s*COMPLETE_TASK\s*\{/.test(rawOutput);
  if (hasCompleteTask) {
    return;
  }

  // NOTE: We intentionally do NOT mark the delegation as completed here.
  // The agent's ACP state (running/idle) is the source of truth for display
  // status. Delegation completes when the agent explicitly calls COMPLETE_TASK
  // or when the agent process exits (see notifyParentOfCompletion). This
  // prevents the UI from showing "completed" while the agent is still
  // actively processing between idle/running cycles.

  const sentMessages = /⟦⟦\s*(AGENT_MESSAGE|BROADCAST|GROUP_MESSAGE|COMPLETE_TASK)\s*\{/.test(rawOutput);
  const outputNote = sentMessages
    ? 'Agent sent findings directly — see messages above.'
    : 'Agent completed without sending messages — consider following up.';
  const sessionLine = agent.sessionId ? `\nSession ID: ${agent.sessionId}` : '';
  const taskBrief = agent.task ? (agent.task.length > 150 ? agent.task.slice(0, 150) + '...' : agent.task) : 'none';
  const dagLabel = agent.dagTaskId ? ` [${agent.dagTaskId}]` : '';
  const summary = `[Agent Report]${dagLabel} ${agent.role.name} (${agent.id.slice(0, 8)}) finished work.\nTask: ${taskBrief}${sessionLine}\nOutput: ${outputNote}`;

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
  }, ctx.getProjectIdForAgent(agent.id) ?? '');
  ctx.emit('agent:completion_reported', { childId: agent.id, parentId: agent.parentId, status: 'completed' });

  if (agent.parentId) {
    const dagTask = ctx.taskDAG.getTaskByAgent(agent.parentId, agent.id);
    if (dagTask && dagTask.dagStatus === 'running') {
      const newlyReady = ctx.taskDAG.completeTask(agent.parentId, dagTask.id);
      if (newlyReady && newlyReady.length > 0) {
        const dagParent = ctx.getAgent(agent.parentId);
        if (dagParent) {
          dagParent.sendMessage(formatNewlyReadyMessage(ctx, agent.parentId!, dagTask.id, newlyReady));
        }
      }
      // Warn lead if DAG coverage drops below 80%
      checkCoverageWarning(ctx, agent.parentId!);
    } else if (!dagTask) {
      // If this agent was linked to a DAG task that's already been handled
      // (e.g., completed via COMPLETE_TASK), don't emit a spurious warning.
      const taskAlreadyTracked = agent.dagTaskId &&
        ctx.taskDAG.getTask(agent.parentId!, agent.dagTaskId) != null;
      if (!taskAlreadyTracked) {
        // Task genuinely not in DAG — nudge the lead to track it
        const dagStatus = ctx.taskDAG.getStatus(agent.parentId);
        if (dagStatus.summary.pending + dagStatus.summary.ready + dagStatus.summary.running > 0) {
          parent.sendMessage(`[System] ⚠ This task was NOT in the DAG. Use COMPLETE_TASK or ADD_TASK (with status "done") to keep the DAG current.`);
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
        del.result = redact(agent.getTaskOutput(16000)).text;
        if (ctx.activeDelegationRepository) {
          try {
            if (del.status === 'completed') ctx.activeDelegationRepository.complete(del.id);
            else ctx.activeDelegationRepository.fail(del.id);
          } catch { /* non-critical */ }
        }
      }
    }
    return;
  }

  // Suppress exit report when agent already completed its DAG task via
  // COMPLETE_TASK and exited cleanly.  Same rationale as in notifyParentOfIdle:
  // the dedup key may have been cleared between turns.
  if (exitCode === 0 && agent.dagTaskId && agent.parentId) {
    const dagTask = ctx.taskDAG.getTask(agent.parentId, agent.dagTaskId);
    if (dagTask && dagTask.dagStatus === 'done') {
      // Still mark delegations as completed
      for (const [, del] of ctx.delegations) {
        if (del.toAgentId === agent.id && del.status === 'active') {
          del.status = 'completed';
          del.completedAt = new Date().toISOString();
          del.result = redact(agent.getTaskOutput(16000)).text;
          if (ctx.activeDelegationRepository) {
            try { ctx.activeDelegationRepository.complete(del.id); } catch { /* non-critical */ }
          }
        }
      }
      return;
    }
  }

  let hadActiveDelegation = false;
  for (const [, del] of ctx.delegations) {
    if (del.toAgentId === agent.id && del.status === 'active') {
      hadActiveDelegation = true;
      del.status = exitCode === 0 ? 'completed' : 'failed';
      del.completedAt = new Date().toISOString();
      del.result = redact(agent.getTaskOutput(16000)).text;
      if (ctx.activeDelegationRepository) {
        try {
          if (del.status === 'completed') ctx.activeDelegationRepository.complete(del.id);
          else ctx.activeDelegationRepository.fail(del.id);
        } catch { /* non-critical */ }
      }
    }
  }

  // Only send exit reports for agents with assigned work.
  // Agents cycling without a task or delegation shouldn't produce reports, but still complete delegations above.
  if (!agent.task && !agent.dagTaskId && !hadActiveDelegation) return;

  const status = exitCode === -1 ? 'terminated' : exitCode === 0 ? 'completed successfully' : `failed (exit code ${exitCode})`;
  const rawOutput2 = agent.getTaskOutput(16000);
  const sentMessages2 = /⟦⟦\s*(AGENT_MESSAGE|BROADCAST|GROUP_MESSAGE|COMPLETE_TASK)\s*\{/.test(rawOutput2);
  const outputNote2 = sentMessages2
    ? 'Agent sent findings directly — see messages above.'
    : 'Agent completed without sending messages — consider following up.';
  const sessionLine2 = agent.sessionId ? `\nSession ID: ${agent.sessionId}` : '';
  const taskBrief2 = agent.task ? (agent.task.length > 150 ? agent.task.slice(0, 150) + '...' : agent.task) : 'none';
  const dagLabel2 = agent.dagTaskId ? ` [${agent.dagTaskId}]` : '';
  const summary = `[Agent Report]${dagLabel2} ${agent.role.name} (${agent.id.slice(0, 8)}) ${status}.\nTask: ${taskBrief2}${sessionLine2}\nOutput: ${outputNote2}`;

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
  }, ctx.getProjectIdForAgent(agent.id) ?? '');
  ctx.emit('agent:completion_reported', { childId: agent.id, parentId: agent.parentId, status });

  if (agent.parentId) {
    const dagTask = ctx.taskDAG.getTaskByAgent(agent.parentId, agent.id);
    if (dagTask && dagTask.dagStatus === 'running') {
      if (exitCode === 0) {
        const newlyReady = ctx.taskDAG.completeTask(agent.parentId, dagTask.id);
        if (newlyReady && newlyReady.length > 0) {
          const dagParent = ctx.getAgent(agent.parentId);
          if (dagParent) {
            dagParent.sendMessage(formatNewlyReadyMessage(ctx, agent.parentId!, dagTask.id, newlyReady));
          }
        }
        // Warn lead if DAG coverage drops below 80%
        checkCoverageWarning(ctx, agent.parentId!);
      } else {
        ctx.taskDAG.failTask(agent.parentId, dagTask.id, `Agent exited with code ${exitCode}`);
        const dagParent = ctx.getAgent(agent.parentId);
        if (dagParent) {
          dagParent.sendMessage(`[System] DAG: Task "${dagTask.id}" FAILED (exit ${exitCode}). Dependents blocked. Use RETRY_TASK or SKIP_TASK.`);
        }
      }
    } else if (!dagTask) {
      // If this agent was linked to a DAG task that's already been handled
      // (e.g., completed via COMPLETE_TASK), don't emit a spurious warning.
      const taskAlreadyTracked = agent.dagTaskId &&
        ctx.taskDAG.getTask(agent.parentId!, agent.dagTaskId) != null;
      if (!taskAlreadyTracked) {
        // Task genuinely not in DAG — nudge the lead to track it
        const dagStatus = ctx.taskDAG.getStatus(agent.parentId);
        if (dagStatus.summary.pending + dagStatus.summary.ready + dagStatus.summary.running > 0) {
          parent.sendMessage(`[System] ⚠ This task was NOT in the DAG. Use COMPLETE_TASK or ADD_TASK (with status "done") to keep the DAG current.`);
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
      if (ctx.activeDelegationRepository) {
        try { ctx.activeDelegationRepository.fail(del.id); } catch { /* non-critical */ }
      }
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

// ── DAG coverage warning ──────────────────────────────────────────────

/** Track which leads have already been warned about low coverage to avoid spamming */
const coverageWarningsSent = new Set<string>();

function checkCoverageWarning(ctx: CommandHandlerContext, leadId: string): void {
  if (coverageWarningsSent.has(leadId)) return;
  const activeAgents = ctx.getAllAgents()
    .filter(a => a.parentId === leadId && a.status !== 'terminated' && a.role.id !== 'secretary')
    .map(a => ({ id: a.id, role: a.role.id }));
  const dagStatus = ctx.taskDAG.getStatus(leadId, activeAgents);
  if (dagStatus.coverage && dagStatus.coverage.percentage < 80 && dagStatus.coverage.total >= 3) {
    coverageWarningsSent.add(leadId);
    const lead = ctx.getAgent(leadId);
    if (lead) {
      lead.sendMessage(`[System] ⚠️ DAG coverage is ${dagStatus.coverage.percentage}% — ${dagStatus.coverage.untracked} active agent(s) have no DAG task. Use TASK_STATUS to see details.`);
    }
  }
}

/** Reset coverage warning dedup (e.g., when DAG is modified). Exported for testing. */
export function resetCoverageWarning(leadId: string): void {
  coverageWarningsSent.delete(leadId);
}

// ── Pre-termination dirty-file check ─────────────────────────────────

function checkDirtyLockedFiles(ctx: CommandHandlerContext, agent: Agent, parent: Agent): void {
  let locks: { filePath: string }[];
  try {
    locks = ctx.lockRegistry.getByAgent(agent.id);
  } catch {
    return; // lockRegistry not available in this context
  }
  if (locks.length === 0) return;

  const cwd = agent.cwd || process.cwd();
  const filePaths = locks.map(l => l.filePath);

  execFileAsync('git', ['diff', '--name-only', '--', ...filePaths], { cwd, timeout: 10_000 })
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
