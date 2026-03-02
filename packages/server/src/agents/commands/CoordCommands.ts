/**
 * Coordination command handlers.
 *
 * Commands: LOCK_FILE, UNLOCK_FILE, ACTIVITY, DECISION, PROGRESS, COMMIT
 */
import type { Agent } from '../Agent.js';
import type { CommandHandlerContext, CommandEntry } from './types.js';
import { logger } from '../../utils/logger.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import {
  parseCommandPayload,
  lockFileSchema,
  unlockFileSchema,
  activitySchema,
  decisionSchema,
  commitSchema,
  progressSchema,
} from './commandSchemas.js';

const execFileAsync = promisify(execFile);

// ── Regex patterns ────────────────────────────────────────────────────

const LOCK_REQUEST_REGEX = /⟦⟦\s*LOCK_FILE\s*(\{.*?\})\s*⟧⟧/s;
const LOCK_RELEASE_REGEX = /⟦⟦\s*UNLOCK_FILE\s*(\{.*?\})\s*⟧⟧/s;
const ACTIVITY_REGEX = /⟦⟦\s*ACTIVITY\s*(\{.*?\})\s*⟧⟧/s;
const DECISION_REGEX = /⟦⟦\s*DECISION\s*(\{.*?\})\s*⟧⟧/s;
const PROGRESS_REGEX = /⟦⟦\s*PROGRESS\s*(\{.*?\})\s*⟧⟧/s;
const COMMIT_REGEX = /⟦⟦\s*COMMIT\s*(\{.*?\})\s*⟧⟧/s;

// ── Handlers ──────────────────────────────────────────────────────────

function handleLockRequest(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(LOCK_REQUEST_REGEX);
  if (!match) return;

  try {
    const request = parseCommandPayload(agent, match[1], lockFileSchema, 'LOCK_FILE');
    if (!request) return;
    const agentRole = agent.role?.id ?? 'unknown';
    const result = ctx.lockRegistry.acquire(agent.id, agentRole, request.filePath, request.reason);
    if (result.ok) {
      ctx.activityLedger.log(agent.id, agentRole, 'lock_acquired', `Locked ${request.filePath}`, {
        filePath: request.filePath,
        reason: request.reason,
      });
      agent.sendMessage(`[System] Lock acquired on \`${request.filePath}\`. You may proceed with edits. Remember to release it when done with ⟦⟦ UNLOCK_FILE {"filePath": "${request.filePath}"} ⟧⟧`);
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
    const request = parseCommandPayload(agent, match[1], unlockFileSchema, 'UNLOCK_FILE');
    if (!request) return;

    // Pre-release lock audit — if file is dirty, warn and block release
    const cwd = agent.cwd || process.cwd();
    execFileAsync('git', ['diff', '--name-only', '--', request.filePath], { cwd, timeout: 10_000 })
      .then(({ stdout }) => {
        const dirtyFiles = stdout.trim().split('\n').filter(Boolean);
        if (dirtyFiles.length > 0) {
          agent.sendMessage(`[System] ⚠ Warning: \`${request.filePath}\` has uncommitted changes. COMMIT first, then retry UNLOCK_FILE.`);
          return; // Don't release — agent must commit first
        }
        releaseLock(ctx, agent, request.filePath);
      })
      .catch(() => {
        // Git check failed — release anyway (best-effort)
        releaseLock(ctx, agent, request.filePath);
      });
  } catch (err) {
    logger.debug('command', 'Failed to parse UNLOCK_FILE command', { error: (err as Error).message });
  }
}

function releaseLock(ctx: CommandHandlerContext, agent: Agent, filePath: string): void {
  const released = ctx.lockRegistry.release(agent.id, filePath);
  if (released) {
    const agentRole = agent.role?.id ?? 'unknown';
    ctx.activityLedger.log(agent.id, agentRole, 'lock_released', `Released ${filePath}`, { filePath });
    agent.sendMessage(`[System] Lock released on \`${filePath}\`.`);
  }
}

function handleActivity(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(ACTIVITY_REGEX);
  if (!match) return;

  try {
    const entry = parseCommandPayload(agent, match[1], activitySchema, 'ACTIVITY');
    if (!entry) return;
    const agentRole = agent.role?.id ?? 'unknown';
    ctx.activityLedger.log(
      agent.id,
      agentRole,
      entry.actionType ?? 'message_sent' as any,
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
    const decision = parseCommandPayload(agent, match[1], decisionSchema, 'DECISION');
    if (!decision) return;

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
    // Guard against oversized payloads before parsing (passthrough allows arbitrary extra keys)
    if (match[1].length > 50_000) {
      agent.sendMessage('[System] PROGRESS error: payload too large (max 50,000 characters).');
      return;
    }
    const parsed = parseCommandPayload(agent, match[1], progressSchema, 'PROGRESS');
    if (!parsed) return;
    const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;

    let progress: Record<string, unknown> = { ...parsed };
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

async function handleCommit(ctx: CommandHandlerContext, agent: Agent, data: string): Promise<void> {
  const match = data.match(COMMIT_REGEX);
  if (!match) return;
  try {
    const req = parseCommandPayload(agent, match[1], commitSchema, 'COMMIT');
    if (!req) return;
    const message = req.message || `Changes by ${agent.role.name} (${agent.id.slice(0, 8)})`;

    // Fix 2: Merge locked files with explicitly specified files
    const currentLocks = ctx.lockRegistry.getByAgent(agent.id);
    const lockedPaths = new Set(currentLocks.map(l => l.filePath));
    const explicitFiles = req.files ?? [];

    // Warn about explicitly specified files the agent doesn't hold locks for
    const unlockedExplicit = explicitFiles.filter(f => !lockedPaths.has(f));
    if (unlockedExplicit.length > 0) {
      agent.sendMessage(`[System] ⚠ Warning: You specified files you don't hold locks for: ${unlockedExplicit.join(', ')}. Proceeding anyway — but consider using LOCK_FILE first.`);
    }

    // Merge: locked files + any explicitly specified files (deduplicated)
    const allPaths = new Set([...lockedPaths, ...explicitFiles]);

    // Auto-include untracked files in directories where agent has locked files
    const cwd = agent.cwd || process.cwd();
    try {
      const { stdout: untrackedOut } = await execFileAsync('git', ['ls-files', '--others', '--exclude-standard'], { cwd, timeout: 10_000 });
      const untrackedFiles = untrackedOut.trim().split('\n').filter(Boolean);
      const lockedDirs = new Set([...allPaths].map(f => path.dirname(f)));
      const relatedUntracked = untrackedFiles.filter(f => lockedDirs.has(path.dirname(f)));
      relatedUntracked.forEach(f => allPaths.add(f));
      if (relatedUntracked.length > 0) {
        agent.sendMessage(`[System] Auto-including ${relatedUntracked.length} new file(s): ${relatedUntracked.join(', ')}`);
      }
    } catch {
      logger.debug('commit', `Untracked file detection failed for ${agent.id.slice(0, 8)}`);
    }

    const files = Array.from(allPaths);

    if (files.length === 0) {
      agent.sendMessage('[System] COMMIT: No file locks held and no files specified. Lock files before committing, or specify files manually with {"message": "...", "files": ["path1", "path2"]}.');
      return;
    }

    const trailer = 'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>';
    const commitMsg = `${message}\n\n${trailer}`;

    // Cross-platform: use execFile with args arrays (no shell quoting needed)
    await execFileAsync('git', ['add', ...files], { cwd, timeout: 30_000 })
      .then(() => execFileAsync('git', ['commit', '-m', commitMsg, '--', ...files], { cwd, timeout: 30_000 }))
      .then(async ({ stdout }) => {
        agent.sendMessage(`[System] COMMIT succeeded: ${stdout.trim().split('\n')[0]}`);

        // Post-commit dirty-tree warning — scoped to agent's files only
        try {
          const [{ stdout: modifiedOut }, { stdout: untrackedOut }] = await Promise.all([
            execFileAsync('git', ['diff', '--name-only', '--', ...files], { cwd, timeout: 10_000 }),
            execFileAsync('git', ['ls-files', '--others', '--exclude-standard'], { cwd, timeout: 10_000 }),
          ]);
          const modified = modifiedOut.trim().split('\n').filter(Boolean);
          // Filter untracked to files in directories near the committed files
          const committedDirs = new Set(files.map(f => path.dirname(f)));
          const untracked = untrackedOut.trim().split('\n').filter(f => f && committedDirs.has(path.dirname(f)));
          const dirtyFiles = [...modified, ...untracked];
          if (dirtyFiles.length > 0) {
            const listed = dirtyFiles.slice(0, 10).join(', ');
            const more = dirtyFiles.length > 10 ? ` (and ${dirtyFiles.length - 10} more)` : '';
            agent.sendMessage(`[System] ⚠ Post-commit warning: Working tree still has uncommitted files: ${listed}${more}. Run \`git status\` to review.`);
          }
        } catch {
          // Best-effort — don't fail the commit report if dirty-tree check fails
          logger.debug('commit', `Post-commit dirty-tree check skipped for ${agent.id.slice(0, 8)} (git command failed)`);
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
