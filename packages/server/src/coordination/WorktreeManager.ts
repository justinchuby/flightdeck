/**
 * WorktreeManager — Git worktree isolation for agents.
 *
 * Gives each agent an isolated copy of the repo via `git worktree`,
 * enabling true parallel file editing without file-lock contention.
 *
 * Lifecycle: create → agent works in isolated worktree → merge back → cleanup.
 * On server shutdown, cleanupAll() removes every active worktree.
 * On startup, cleanupOrphans() prunes leftovers from previous crashes.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { existsSync, rmSync } from 'fs';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

// ── Types ─────────────────────────────────────────────────────────

export interface WorktreeInfo {
  agentId: string;
  branch: string;
  path: string;
  createdAt: number;
}

export interface MergeResult {
  ok: boolean;
  conflicts?: string[];
  mergeCommit?: string;
  /** Files modified by the agent that were NOT in its lock set. */
  unlockedFiles?: string[];
}

/** Minimal interface for lock checking — avoids hard dependency on FileLockRegistry. */
export interface LockChecker {
  getByAgent(agentId: string): Array<{ filePath: string }>;
}

// ── Manager ───────────────────────────────────────────────────────

export class WorktreeManager extends EventEmitter {
  private worktrees: Map<string, WorktreeInfo> = new Map();
  private repoRoot: string;
  private lockChecker: LockChecker | null = null;

  constructor(repoRoot: string, lockChecker?: LockChecker) {
    super();
    this.repoRoot = repoRoot;
    this.lockChecker = lockChecker ?? null;
  }

  /** Create an isolated worktree for an agent. */
  async create(agentId: string): Promise<string> {
    const shortId = agentId.slice(0, 8);
    const branch = `agent-wt-${shortId}`;
    const worktreePath = join(this.repoRoot, '.worktrees', shortId);

    // Clean up stale worktree if one already exists at this path
    if (existsSync(worktreePath)) {
      await this.cleanup(agentId);
    }

    try {
      await execAsync(
        `git worktree add "${worktreePath}" -b "${branch}" HEAD`,
        { cwd: this.repoRoot, timeout: 10_000 },
      );

      // Symlink shared workspace so agents can communicate via .ai-crew/
      const sharedDir = join(this.repoRoot, '.ai-crew');
      const targetShared = join(worktreePath, '.ai-crew');
      if (existsSync(sharedDir) && !existsSync(targetShared)) {
        await execAsync(`ln -s "${sharedDir}" "${targetShared}"`, { timeout: 5_000 });
      }

      const info: WorktreeInfo = { agentId, branch, path: worktreePath, createdAt: Date.now() };
      this.worktrees.set(agentId, info);
      this.emit('worktree:created', info);
      logger.info('worktree', `Created worktree for ${shortId} at ${worktreePath}`);
      return worktreePath;
    } catch (err: any) {
      logger.error('worktree', `Failed to create worktree for ${shortId}: ${err.message}`);
      throw err;
    }
  }

  /** Merge agent's worktree branch back to the current branch. */
  async merge(agentId: string): Promise<MergeResult> {
    const info = this.worktrees.get(agentId);
    if (!info) return { ok: false, conflicts: ['No worktree found for agent'] };

    try {
      // Commit any uncommitted work in the worktree
      await execAsync(
        'git add -A && git diff --cached --quiet || git commit -m "WIP: agent work"',
        { cwd: info.path, timeout: 10_000, shell: '/bin/bash' },
      ).catch(() => {}); // Ignore if nothing to commit

      // A4: Validate merge only includes files the agent had locked
      const unlockedFiles = await this.validateMergeScope(agentId, info);

      // Attempt a no-ff merge of the agent branch
      await execAsync(
        `git merge --no-ff "${info.branch}" -m "Merge ${info.branch}"`,
        { cwd: this.repoRoot, timeout: 15_000 },
      );

      if (unlockedFiles.length > 0) {
        this.emit('worktree:unlocked_files', { agentId, branch: info.branch, files: unlockedFiles });
        logger.warn('worktree', `Agent ${agentId.slice(0, 8)} merged ${unlockedFiles.length} unlocked file(s): ${unlockedFiles.join(', ')}`);
      }

      this.emit('worktree:merged', { agentId, branch: info.branch });
      return { ok: true, unlockedFiles: unlockedFiles.length > 0 ? unlockedFiles : undefined };
    } catch (err: any) {
      // Merge failed — collect conflicting file list, then abort
      try {
        const { stdout } = await execAsync(
          'git diff --name-only --diff-filter=U',
          { cwd: this.repoRoot },
        );
        const conflicts = stdout.trim().split('\n').filter(Boolean);
        await execAsync('git merge --abort', { cwd: this.repoRoot, timeout: 5_000 });
        return { ok: false, conflicts };
      } catch {
        await execAsync('git merge --abort', { cwd: this.repoRoot, timeout: 5_000 }).catch(() => {});
        return { ok: false, conflicts: [err.message] };
      }
    }
  }

  /** Clean up a worktree and its branch. */
  async cleanup(agentId: string): Promise<void> {
    const info = this.worktrees.get(agentId);
    const shortId = agentId.slice(0, 8);
    const branch = info?.branch ?? `agent-wt-${shortId}`;
    const worktreePath = info?.path ?? join(this.repoRoot, '.worktrees', shortId);

    try {
      if (existsSync(worktreePath)) {
        await execAsync(
          `git worktree remove "${worktreePath}" --force`,
          { cwd: this.repoRoot, timeout: 10_000 },
        );
      }
    } catch {
      // Force-remove the directory if git worktree remove fails
      if (existsSync(worktreePath)) rmSync(worktreePath, { recursive: true, force: true });
      await execAsync('git worktree prune', { cwd: this.repoRoot, timeout: 5_000 }).catch(() => {});
    }

    try {
      await execAsync(`git branch -D "${branch}"`, { cwd: this.repoRoot, timeout: 5_000 });
    } catch {
      // Branch may not exist — that's fine
    }

    this.worktrees.delete(agentId);
    this.emit('worktree:cleaned', { agentId });
    logger.info('worktree', `Cleaned up worktree for ${shortId}`);
  }

  /** Clean up all worktrees (call on server shutdown). */
  async cleanupAll(): Promise<void> {
    const agents = [...this.worktrees.keys()];
    await Promise.allSettled(agents.map(id => this.cleanup(id)));
  }

  /** Remove orphaned worktrees left by previous crashes. */
  async cleanupOrphans(): Promise<number> {
    const worktreeDir = join(this.repoRoot, '.worktrees');
    if (!existsSync(worktreeDir)) return 0;

    const { stdout } = await execAsync('git worktree list --porcelain', { cwd: this.repoRoot });
    const orphanPaths = stdout
      .split('\n')
      .filter(line => line.startsWith('worktree '))
      .map(line => line.replace('worktree ', ''))
      .filter(p => p.startsWith(worktreeDir));

    let cleaned = 0;
    for (const orphan of orphanPaths) {
      try {
        await execAsync(
          `git worktree remove "${orphan}" --force`,
          { cwd: this.repoRoot, timeout: 5_000 },
        );
        cleaned++;
      } catch {
        // Best-effort
      }
    }
    if (cleaned > 0) {
      await execAsync('git worktree prune', { cwd: this.repoRoot, timeout: 5_000 }).catch(() => {});
      logger.info('worktree', `Cleaned ${cleaned} orphaned worktrees`);
    }
    return cleaned;
  }

  /**
   * A4: Validate that the agent's branch only modifies files it had locked.
   * Returns list of modified files NOT covered by the agent's locks.
   * This is defense-in-depth — worktree isolation and COMMIT enforcement
   * should prevent this, but the hook catches anything that slips through.
   */
  private async validateMergeScope(agentId: string, info: WorktreeInfo): Promise<string[]> {
    if (!this.lockChecker) return [];

    try {
      // Get files changed in the agent's branch relative to the merge base
      const { stdout } = await execAsync(
        `git diff --name-only HEAD..."${info.branch}"`,
        { cwd: this.repoRoot, timeout: 10_000 },
      );
      const changedFiles = stdout.trim().split('\n').filter(Boolean);
      if (changedFiles.length === 0) return [];

      const lockedFiles = this.lockChecker.getByAgent(agentId).map(l => l.filePath);
      const lockedSet = new Set(lockedFiles);

      // Check each changed file against the agent's locks (including glob/prefix patterns)
      return changedFiles.filter(file => {
        if (lockedSet.has(file)) return false;
        // Check glob prefix patterns (e.g. "src/*" covers "src/foo.ts")
        for (const locked of lockedFiles) {
          if (locked.endsWith('/*') && file.startsWith(locked.slice(0, -1))) return false;
        }
        return true;
      });
    } catch {
      // If diff fails, don't block the merge — this is defense-in-depth
      return [];
    }
  }

  getWorktree(agentId: string): WorktreeInfo | undefined {
    return this.worktrees.get(agentId);
  }

  getAll(): WorktreeInfo[] {
    return [...this.worktrees.values()];
  }

  get count(): number {
    return this.worktrees.size;
  }
}
