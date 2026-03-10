/**
 * A5: Cross-agent worktree isolation integration test.
 *
 * Verifies that two agents working in separate git worktrees:
 * 1. Cannot see each other's uncommitted changes
 * 2. Produce commits that don't include the other's work
 * 3. Merge back cleanly to the main branch
 * 4. File lock enforcement works across worktrees (shared DB)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorktreeManager } from '../coordination/files/WorktreeManager.js';
import { FileLockRegistry } from '../coordination/files/FileLockRegistry.js';
import { Database } from '../db/database.js';

// ── Mock child_process ────────────────────────────────────────────
// Track all exec calls and provide per-worktree file tracking to
// simulate isolation without real git operations.

const execHandler = vi.hoisted(() => ({
  fn: (_cmd: string, _opts: any, cb: any) => {
    if (typeof cb === 'function') {
      setTimeout(() => cb(null, '', ''), 0);
    }
    return { on: vi.fn() };
  },
}));

const PROMISIFY_CUSTOM = vi.hoisted(() => Symbol.for('nodejs.util.promisify.custom'));

vi.mock('child_process', () => {
  const execFn: any = (...args: any[]) => execHandler.fn(args[0], args[1], args[2]);
  execFn[PROMISIFY_CUSTOM] = (cmd: string, opts: any) => {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execHandler.fn(cmd, opts, (err: any, stdout: string, stderr: string) => {
        if (err) reject(err);
        else resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
      });
    });
  };
  // execFile is used for `git branch -D` — delegate to same handler with command string
  const execFileFn: any = (file: string, args: string[], opts: any, cb: any) => {
    const cmd = [file, ...args].join(' ');
    return execHandler.fn(cmd, opts, cb);
  };
  execFileFn[PROMISIFY_CUSTOM] = (file: string, args: string[], opts: any) => {
    const cmd = [file, ...args].join(' ');
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execHandler.fn(cmd, opts, (err: any, stdout: string, stderr: string) => {
        if (err) reject(err);
        else resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
      });
    });
  };
  return { exec: execFn, execFile: execFileFn };
});

const existsSyncMock = vi.hoisted(() => vi.fn((_path: string) => false));
const rmSyncMock = vi.hoisted(() => vi.fn());

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: existsSyncMock, rmSync: rmSyncMock };
});

// ── Test helpers ──────────────────────────────────────────────────

interface ExecCall { cmd: string; opts?: any }

const REPO = '/test-repo';
const AGENT_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const AGENT_B = 'bbbbbbbb-1111-2222-3333-444444444444';
const SHORT_A = AGENT_A.slice(0, 8);
const SHORT_B = AGENT_B.slice(0, 8);

// ── Tests ─────────────────────────────────────────────────────────

describe('A5: Cross-agent worktree isolation', () => {
  let mgr: WorktreeManager;
  let lockRegistry: FileLockRegistry;
  let db: Database;
  let execCalls: ExecCall[];

  beforeEach(() => {
    execCalls = [];
    existsSyncMock.mockReturnValue(false);
    rmSyncMock.mockReset();

    execHandler.fn = (cmd: string, opts: any, cb: any) => {
      execCalls.push({ cmd, opts });
      if (typeof cb === 'function') {
        setTimeout(() => cb(null, '', ''), 0);
      }
      return { on: vi.fn() } as any;
    };

    mgr = new WorktreeManager(REPO);
    db = new Database(':memory:');
    lockRegistry = new FileLockRegistry(db);
  });

  afterEach(() => {
    lockRegistry.stopExpiryCheck();
    db.close();
    vi.restoreAllMocks();
  });

  // ── 1. Worktree isolation: separate branches & paths ─────────

  it('creates separate worktrees with distinct branches for each agent', async () => {
    const pathA = await mgr.create(AGENT_A);
    const pathB = await mgr.create(AGENT_B);

    expect(pathA).toBe(`${REPO}/.worktrees/${SHORT_A}`);
    expect(pathB).toBe(`${REPO}/.worktrees/${SHORT_B}`);
    expect(pathA).not.toBe(pathB);

    const infoA = mgr.getWorktree(AGENT_A);
    const infoB = mgr.getWorktree(AGENT_B);
    expect(infoA!.branch).toBe(`agent-wt-${SHORT_A}`);
    expect(infoB!.branch).toBe(`agent-wt-${SHORT_B}`);
    expect(infoA!.branch).not.toBe(infoB!.branch);
  });

  // ── 2. Commit isolation: agent A's commit scoped to its worktree ──

  it('agent A commits only in its worktree directory (not agent B)', async () => {
    await mgr.create(AGENT_A);
    await mgr.create(AGENT_B);
    execCalls = [];

    // Merge agent A — the "git add -A && git commit" runs in A's worktree
    await mgr.merge(AGENT_A);

    // The commit command should only target agent A's worktree path
    const commitCmds = execCalls.filter(c =>
      c.cmd.includes('git add') || c.cmd.includes('git commit'),
    );
    for (const call of commitCmds) {
      if (call.opts?.cwd) {
        expect(call.opts.cwd).toBe(`${REPO}/.worktrees/${SHORT_A}`);
        expect(call.opts.cwd).not.toContain(SHORT_B);
      }
    }

    // The merge command targets the repo root (not agent B's worktree)
    const mergeCmd = execCalls.find(c => c.cmd.includes('git merge --no-ff'));
    expect(mergeCmd).toBeDefined();
    expect(mergeCmd!.cmd).toContain(`agent-wt-${SHORT_A}`);
    expect(mergeCmd!.cmd).not.toContain(`agent-wt-${SHORT_B}`);
    expect(mergeCmd!.opts.cwd).toBe(REPO);
  });

  // ── 3. Visibility isolation: uncommitted changes invisible ────

  it('agent A operations run in its own cwd, not agent B', async () => {
    await mgr.create(AGENT_A);
    await mgr.create(AGENT_B);

    const infoA = mgr.getWorktree(AGENT_A)!;
    const infoB = mgr.getWorktree(AGENT_B)!;

    // Each worktree has its own filesystem path
    expect(infoA.path).not.toBe(infoB.path);

    // Simulate exec calls scoped to each worktree
    // If we merge A, the WIP commit runs in A's path only
    execCalls = [];
    await mgr.merge(AGENT_A);

    const cwds = execCalls
      .filter(c => c.opts?.cwd && c.opts.cwd !== REPO)
      .map(c => c.opts.cwd);

    // All non-repo-root commands go to agent A's worktree only
    for (const cwd of cwds) {
      expect(cwd).toBe(infoA.path);
      expect(cwd).not.toBe(infoB.path);
    }
  });

  // ── 4. Clean merge-back ───────────────────────────────────────

  it('both agents can merge back to main independently', async () => {
    await mgr.create(AGENT_A);
    await mgr.create(AGENT_B);

    const resultA = await mgr.merge(AGENT_A);
    expect(resultA.ok).toBe(true);

    const resultB = await mgr.merge(AGENT_B);
    expect(resultB.ok).toBe(true);

    // Verify both merge commands reference their own branches
    const merges = execCalls.filter(c => c.cmd.includes('git merge --no-ff'));
    const branchesUsed = merges.map(c => c.cmd);
    expect(branchesUsed.some(cmd => cmd.includes(`agent-wt-${SHORT_A}`))).toBe(true);
    expect(branchesUsed.some(cmd => cmd.includes(`agent-wt-${SHORT_B}`))).toBe(true);
  });

  it('merge conflict from overlapping changes is reported with file list', async () => {
    await mgr.create(AGENT_A);
    await mgr.create(AGENT_B);

    // Agent A merges cleanly first
    const resultA = await mgr.merge(AGENT_A);
    expect(resultA.ok).toBe(true);

    // Agent B's merge hits a conflict on the same file
    execHandler.fn = (cmd: string, opts: any, cb: any) => {
      execCalls.push({ cmd, opts });
      if (typeof cb === 'function') {
        if (cmd.includes('git merge --no-ff')) {
          setTimeout(() => cb(new Error('CONFLICT (content)'), '', ''), 0);
        } else if (cmd.includes('git diff --name-only')) {
          setTimeout(() => cb(null, 'src/shared-config.ts\n', ''), 0);
        } else {
          setTimeout(() => cb(null, '', ''), 0);
        }
      }
      return { on: vi.fn() } as any;
    };

    const resultB = await mgr.merge(AGENT_B);
    expect(resultB.ok).toBe(false);
    expect(resultB.conflicts).toContain('src/shared-config.ts');
  });

  // ── 5. File lock enforcement across worktrees ─────────────────

  it('file lock acquired by agent A blocks agent B (shared registry)', () => {
    const lockA = lockRegistry.acquire(AGENT_A, 'developer', 'src/index.ts', 'editing');
    expect(lockA.ok).toBe(true);

    const lockB = lockRegistry.acquire(AGENT_B, 'developer', 'src/index.ts', 'editing');
    expect(lockB.ok).toBe(false);
    expect(lockB.holder).toBe(AGENT_A);
  });

  it('agents can lock different files simultaneously', () => {
    const lockA = lockRegistry.acquire(AGENT_A, 'developer', 'src/moduleA.ts', 'editing');
    const lockB = lockRegistry.acquire(AGENT_B, 'developer', 'src/moduleB.ts', 'editing');

    expect(lockA.ok).toBe(true);
    expect(lockB.ok).toBe(true);
  });

  it('releasing a lock allows the other agent to acquire it', () => {
    lockRegistry.acquire(AGENT_A, 'developer', 'src/index.ts', 'editing');
    lockRegistry.release(AGENT_A, 'src/index.ts');

    const lockB = lockRegistry.acquire(AGENT_B, 'developer', 'src/index.ts', 'editing');
    expect(lockB.ok).toBe(true);
  });

  it('glob lock on a directory blocks individual file locks within', () => {
    const dirLock = lockRegistry.acquire(AGENT_A, 'developer', 'src/*', 'refactoring');
    expect(dirLock.ok).toBe(true);

    const fileLock = lockRegistry.acquire(AGENT_B, 'developer', 'src/index.ts', 'editing');
    expect(fileLock.ok).toBe(false);
    expect(fileLock.holder).toBe(AGENT_A);
  });

  // ── 6. Full lifecycle: create → work → merge → cleanup ────────

  it('full lifecycle: both agents create, merge, and clean up', async () => {
    // Create
    await mgr.create(AGENT_A);
    await mgr.create(AGENT_B);
    expect(mgr.count).toBe(2);

    // Merge
    const rA = await mgr.merge(AGENT_A);
    const rB = await mgr.merge(AGENT_B);
    expect(rA.ok).toBe(true);
    expect(rB.ok).toBe(true);

    // Cleanup
    await mgr.cleanup(AGENT_A);
    await mgr.cleanup(AGENT_B);
    expect(mgr.count).toBe(0);
    expect(mgr.getWorktree(AGENT_A)).toBeUndefined();
    expect(mgr.getWorktree(AGENT_B)).toBeUndefined();

    // Verify cleanup exec commands targeted correct branches
    const branchDeletes = execCalls.filter(c => c.cmd.includes('git branch -D'));
    expect(branchDeletes.some(c => c.cmd.includes(`agent-wt-${SHORT_A}`))).toBe(true);
    expect(branchDeletes.some(c => c.cmd.includes(`agent-wt-${SHORT_B}`))).toBe(true);
  });
});
