/**
 * Coordination command handlers.
 *
 * Commands: LOCK_FILE, UNLOCK_FILE, ACTIVITY, DECISION, PROGRESS, COMMIT
 */
import type { Agent } from '../Agent.js';
import type { CommandHandlerContext, CommandEntry } from './types.js';
import { logger } from '../../utils/logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ── Regex patterns ────────────────────────────────────────────────────

const LOCK_REQUEST_REGEX = /\[\[\[\s*LOCK_FILE\s*(\{.*?\})\s*\]\]\]/s;
const LOCK_RELEASE_REGEX = /\[\[\[\s*UNLOCK_FILE\s*(\{.*?\})\s*\]\]\]/s;
const ACTIVITY_REGEX = /\[\[\[\s*ACTIVITY\s*(\{.*?\})\s*\]\]\]/s;
const DECISION_REGEX = /\[\[\[\s*DECISION\s*(\{.*?\})\s*\]\]\]/s;
const PROGRESS_REGEX = /\[\[\[\s*PROGRESS\s*(\{.*?\})\s*\]\]\]/s;
const COMMIT_REGEX = /\[\[\[\s*COMMIT\s*(\{.*?\})\s*\]\]\]/s;

// ── Handlers ──────────────────────────────────────────────────────────

function handleLockRequest(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(LOCK_REQUEST_REGEX);
  if (!match) return;

  try {
    const request = JSON.parse(match[1]);
    const agentRole = agent.role?.id ?? 'unknown';
    const result = ctx.lockRegistry.acquire(agent.id, agentRole, request.filePath, request.reason);
    if (result.ok) {
      ctx.activityLedger.log(agent.id, agentRole, 'lock_acquired', `Locked ${request.filePath}`, {
        filePath: request.filePath,
        reason: request.reason,
      });
      agent.sendMessage(`[System] Lock acquired on \`${request.filePath}\`. You may proceed with edits. Remember to release it when done with [[[ UNLOCK_FILE {"filePath": "${request.filePath}"} ]]]`);
    } else {
      const holderShort = result.holder?.slice(0, 8) ?? 'unknown';
      agent.sendMessage(`[System] Lock DENIED on \`${request.filePath}\` — currently held by agent ${holderShort}. Wait for them to release it, or coordinate via AGENT_MESSAGE.`);
      ctx.activityLedger.log(agent.id, agentRole, 'lock_denied', `Lock denied on ${request.filePath} (held by ${holderShort})`, {
        filePath: request.filePath,
        holder: result.holder,
      });
    }
  } catch (err) {
    logger.debug('command', 'Failed to parse LOCK_FILE command', { error: (err as Error).message });
  }
}

function handleLockRelease(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(LOCK_RELEASE_REGEX);
  if (!match) return;

  try {
    const request = JSON.parse(match[1]);
    const released = ctx.lockRegistry.release(agent.id, request.filePath);
    if (released) {
      const agentRole = agent.role?.id ?? 'unknown';
      ctx.activityLedger.log(agent.id, agentRole, 'lock_released', `Released ${request.filePath}`, {
        filePath: request.filePath,
      });
      agent.sendMessage(`[System] Lock released on \`${request.filePath}\`.`);
    }
  } catch (err) {
    logger.debug('command', 'Failed to parse UNLOCK_FILE command', { error: (err as Error).message });
  }
}

function handleActivity(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(ACTIVITY_REGEX);
  if (!match) return;

  try {
    const entry = JSON.parse(match[1]);
    const agentRole = agent.role?.id ?? 'unknown';
    ctx.activityLedger.log(
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

function handleDecision(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(DECISION_REGEX);
  if (!match) return;

  try {
    const decision = JSON.parse(match[1]);
    if (!decision.title) return;

    const needsConfirmation = decision.needsConfirmation === true;
    const leadId = agent.parentId || agent.id;
    const recorded = ctx.decisionLog.add(agent.id, agent.role?.id ?? 'unknown', decision.title, decision.rationale ?? '', needsConfirmation, leadId, agent.projectId);
    logger.info('lead', `Decision by ${agent.role.name}: "${decision.title}"${needsConfirmation ? ' [needs confirmation]' : ''}`, { rationale: decision.rationale?.slice(0, 100) });
    ctx.emit('lead:decision', {
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

function handleProgress(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(PROGRESS_REGEX);
  if (!match) return;

  try {
    const manual = JSON.parse(match[1]);
    const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;

    let progress: Record<string, unknown> = { ...manual };
    if (leadId) {
      const dagStatus = ctx.taskDAG.getStatus(leadId);
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
    ctx.emit('lead:progress', { agentId: agent.id, ...progress });

    const parentId = agent.parentId || agent.id;
    const secretaries = ctx.getAllAgents().filter(
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

function handleCommit(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(COMMIT_REGEX);
  if (!match) return;
  try {
    const req = JSON.parse(match[1]);
    const message = req.message || `Changes by ${agent.role.name} (${agent.id.slice(0, 8)})`;

    const currentLocks = ctx.lockRegistry.getByAgent(agent.id);
    const files = currentLocks.map(l => l.filePath);

    if (files.length === 0) {
      agent.sendMessage('[System] COMMIT: No file locks held. Lock files before committing, or specify files manually with {"message": "...", "files": ["path1", "path2"]}.');
      return;
    }

    const cwd = agent.cwd || process.cwd();
    // Shell-quote each file path to handle spaces and special characters
    const quotedFiles = files.map(f => `'${f.replace(/'/g, "'\\''")}'`).join(' ');
    const escapedMsg = message.replace(/'/g, "'\\''");
    const trailer = 'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>';
    const commitMsg = `${escapedMsg}\n\n${trailer}`;

    // Execute scoped git add + commit directly (enforced, not suggested)
    execAsync(`git add ${quotedFiles} && git commit -m '${commitMsg}'`, { cwd, timeout: 30_000 })
      .then(async ({ stdout }) => {
        agent.sendMessage(`[System] COMMIT succeeded: ${stdout.trim().split('\n')[0]}`);

        // A6: Post-commit verification — confirm files actually landed on HEAD
        try {
          const { stdout: diffOut } = await execAsync('git diff --name-only HEAD~1', { cwd, timeout: 10_000 });
          const committedFiles = diffOut.trim().split('\n').filter(Boolean);
          const missing = files.filter(f => !committedFiles.includes(f));
          if (missing.length > 0) {
            agent.sendMessage(`[System] Warning: ${missing.length} expected file(s) not found in commit: ${missing.join(', ')}`);
            logger.warn('commit', `Post-commit verification: ${missing.length} files missing for ${agent.id.slice(0, 8)}: ${missing.join(', ')}`);
          }
        } catch {
          // Verification is best-effort — don't fail the commit if diff fails
          logger.debug('commit', `Post-commit verification skipped for ${agent.id.slice(0, 8)} (git diff failed)`);
        }

        // Log to ActivityLedger only after verified commit
        ctx.activityLedger.log(agent.id, agent.role?.id ?? 'unknown', 'file_edit',
          `Commit: ${message.slice(0, 120)} (${files.length} files)`,
          { type: 'commit', files, message },
        );
        logger.info('commit', `COMMIT for ${agent.role.name} (${agent.id.slice(0, 8)}): ${files.length} files — ${message.slice(0, 80)}`);
      })
      .catch((err: any) => {
        agent.sendMessage(`[System] COMMIT failed: ${err.message?.split('\n')[0] ?? 'unknown error'}`);
        logger.warn('commit', `COMMIT exec failed for ${agent.id.slice(0, 8)}: ${err.message}`);
      });
  } catch (err: any) {
    agent.sendMessage(`[System] COMMIT error: use {"message": "your commit message"}`);
  }
}

// ── Module export ─────────────────────────────────────────────────────

export function getCoordCommands(ctx: CommandHandlerContext): CommandEntry[] {
  return [
    { regex: LOCK_REQUEST_REGEX, name: 'LOCK', handler: (a, d) => handleLockRequest(ctx, a, d) },
    { regex: LOCK_RELEASE_REGEX, name: 'UNLOCK', handler: (a, d) => handleLockRelease(ctx, a, d) },
    { regex: ACTIVITY_REGEX, name: 'ACTIVITY', handler: (a, d) => handleActivity(ctx, a, d) },
    { regex: DECISION_REGEX, name: 'DECISION', handler: (a, d) => handleDecision(ctx, a, d) },
    { regex: PROGRESS_REGEX, name: 'PROGRESS', handler: (a, d) => handleProgress(ctx, a, d) },
    { regex: COMMIT_REGEX, name: 'COMMIT', handler: (a, d) => handleCommit(ctx, a, d) },
  ];
}
