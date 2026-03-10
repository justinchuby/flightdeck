import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorktreeManager } from '../coordination/files/WorktreeManager.js';

// ── Mock child_process ────────────────────────────────────────────
// Keep a mutable handler so individual tests can customize exec behavior.
// The handler uses standard exec callback: (err, stdout, stderr).
const execHandler = vi.hoisted(() => ({
  fn: (_cmd: string, _opts: any, cb: any) => {
    if (typeof cb === 'function') {
      setTimeout(() => cb(null, '', ''), 0);
    }
    return { on: vi.fn() };
  },
}));

// We need the custom promisify symbol so `promisify(exec)` resolves
// with `{ stdout, stderr }` just like the real Node.js exec.
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
  const execFileFn: any = (file: string, args: string[], opts: any, cb: any) => {
    const cmd = `${file} ${args.join(' ')}`;
    return execHandler.fn(cmd, opts, cb);
  };
  execFileFn[PROMISIFY_CUSTOM] = (file: string, args: string[], opts: any) => {
    const cmd = `${file} ${args.join(' ')}`;
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execHandler.fn(cmd, opts, (err: any, stdout: string, stderr: string) => {
        if (err) reject(err);
        else resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
      });
    });
  };
  return { exec: execFn, execFile: execFileFn };
});

// Mock fs.existsSync / rmSync / symlinkSync — default: nothing exists
const existsSyncMock = vi.hoisted(() => vi.fn((_path: string) => false));
const rmSyncMock = vi.hoisted(() => vi.fn());
const symlinkSyncMock = vi.hoisted(() => vi.fn());

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: existsSyncMock, rmSync: rmSyncMock, symlinkSync: symlinkSyncMock };
});

// ── Helpers ───────────────────────────────────────────────────────

let execCalls: Array<{ cmd: string; opts?: any }> = [];

function setDefaultExec() {
  execHandler.fn = (cmd: string, opts: any, cb: any) => {
    execCalls.push({ cmd, opts });
    if (typeof cb === 'function') {
      setTimeout(() => cb(null, '', ''), 0);
    }
    return { on: vi.fn() } as any;
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('WorktreeManager', () => {
  let mgr: WorktreeManager;
  const REPO = '/repo';
  const AGENT_ID = 'abcdef01-2345-6789-abcd-ef0123456789';
  const SHORT = AGENT_ID.slice(0, 8); // abcdef01

  beforeEach(() => {
    execCalls = [];
    existsSyncMock.mockReturnValue(false);
    rmSyncMock.mockReset();
    symlinkSyncMock.mockReset();
    setDefaultExec();
    mgr = new WorktreeManager(REPO);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── create ────────────────────────────────────────────────────

  it('creates a worktree with correct branch and path', async () => {
    const path = await mgr.create(AGENT_ID);

    expect(path).toBe(`${REPO}/.worktrees/${SHORT}`);
    const addCmd = execCalls.find(c => c.cmd.includes('git worktree add'));
    expect(addCmd).toBeDefined();
    expect(addCmd!.cmd).toContain(`-b "agent-wt-${SHORT}"`);
    expect(addCmd!.cmd).toContain('HEAD');
    expect(addCmd!.opts.cwd).toBe(REPO);

    const info = mgr.getWorktree(AGENT_ID);
    expect(info).toBeDefined();
    expect(info!.branch).toBe(`agent-wt-${SHORT}`);
    expect(info!.agentId).toBe(AGENT_ID);
    expect(mgr.count).toBe(1);
  });

  it('symlinks .flightdeck when shared dir exists', async () => {
    existsSyncMock
      .mockReturnValueOnce(false)  // worktreePath doesn't exist
      .mockReturnValueOnce(true)   // sharedDir exists
      .mockReturnValueOnce(false); // targetShared doesn't exist

    await mgr.create(AGENT_ID);

    expect(symlinkSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('.flightdeck'),
      expect.stringContaining('.flightdeck'),
      'junction',
    );
  });

  it('emits worktree:created event', async () => {
    const spy = vi.fn();
    mgr.on('worktree:created', spy);

    await mgr.create(AGENT_ID);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: AGENT_ID, branch: `agent-wt-${SHORT}` }),
    );
  });

  it('handles duplicate create gracefully by cleaning up first', async () => {
    await mgr.create(AGENT_ID);

    // Simulate the worktree path now exists on disk
    existsSyncMock.mockReturnValue(true);

    const cleanupSpy = vi.spyOn(mgr, 'cleanup');
    await mgr.create(AGENT_ID);

    expect(cleanupSpy).toHaveBeenCalledWith(AGENT_ID);
    expect(mgr.count).toBe(1);
  });

  // ── merge ─────────────────────────────────────────────────────

  it('returns error when merging unknown agent', async () => {
    const result = await mgr.merge('unknown-agent');
    expect(result.ok).toBe(false);
    expect(result.conflicts).toContain('No worktree found for agent');
  });

  it('merge returns ok: true for clean merge', async () => {
    await mgr.create(AGENT_ID);
    execCalls = [];

    const result = await mgr.merge(AGENT_ID);

    expect(result.ok).toBe(true);
    const mergeCmd = execCalls.find(c => c.cmd.includes('git merge'));
    expect(mergeCmd).toBeDefined();
    expect(mergeCmd!.cmd).toContain(`agent-wt-${SHORT}`);
  });

  it('emits worktree:merged event on successful merge', async () => {
    await mgr.create(AGENT_ID);
    const spy = vi.fn();
    mgr.on('worktree:merged', spy);

    await mgr.merge(AGENT_ID);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: AGENT_ID, branch: `agent-wt-${SHORT}` }),
    );
  });

  it('merge detects conflicts and returns file list', async () => {
    await mgr.create(AGENT_ID);
    execCalls = [];

    // Customize exec: merge fails, diff returns conflicts, abort succeeds
    execHandler.fn = (cmd: string, opts: any, cb: any) => {
      execCalls.push({ cmd, opts });
      if (typeof cb === 'function') {
        if (cmd.includes('git merge --no-ff')) {
          setTimeout(() => cb(new Error('CONFLICT'), '', ''), 0);
        } else if (cmd.includes('git diff --name-only --diff-filter=U')) {
          setTimeout(() => cb(null, 'src/index.ts\nsrc/utils.ts\n', ''), 0);
        } else {
          setTimeout(() => cb(null, '', ''), 0);
        }
      }
      return { on: vi.fn() } as any;
    };

    const result = await mgr.merge(AGENT_ID);

    expect(result.ok).toBe(false);
    expect(result.conflicts).toEqual(['src/index.ts', 'src/utils.ts']);
  });

  // ── merge scope validation (A4) ──────────────────────────────

  it('merge reports unlocked files when lockChecker is provided', async () => {
    const lockChecker = {
      getByAgent: vi.fn().mockReturnValue([
        { filePath: 'src/auth.ts' },
      ]),
    };
    const mgrWithLock = new WorktreeManager(REPO, lockChecker);

    // Need to set up the default exec for this new manager
    await mgrWithLock.create(AGENT_ID);
    execCalls = [];

    // diff --name-only HEAD...branch returns 2 files, only 1 is locked
    execHandler.fn = (cmd: string, opts: any, cb: any) => {
      execCalls.push({ cmd, opts });
      if (typeof cb === 'function') {
        if (cmd.includes('git diff --name-only HEAD...')) {
          setTimeout(() => cb(null, 'src/auth.ts\nsrc/secret.ts\n', ''), 0);
        } else {
          setTimeout(() => cb(null, '', ''), 0);
        }
      }
      return { on: vi.fn() } as any;
    };

    const result = await mgrWithLock.merge(AGENT_ID);

    expect(result.ok).toBe(true);
    expect(result.unlockedFiles).toEqual(['src/secret.ts']);
    expect(lockChecker.getByAgent).toHaveBeenCalledWith(AGENT_ID);
  });

  it('merge emits worktree:unlocked_files event for unlocked files', async () => {
    const lockChecker = {
      getByAgent: vi.fn().mockReturnValue([{ filePath: 'src/ok.ts' }]),
    };
    const mgrWithLock = new WorktreeManager(REPO, lockChecker);
    await mgrWithLock.create(AGENT_ID);

    const spy = vi.fn();
    mgrWithLock.on('worktree:unlocked_files', spy);

    execCalls = [];
    execHandler.fn = (cmd: string, opts: any, cb: any) => {
      execCalls.push({ cmd, opts });
      if (typeof cb === 'function') {
        if (cmd.includes('git diff --name-only HEAD...')) {
          setTimeout(() => cb(null, 'src/ok.ts\nsrc/bad.ts\n', ''), 0);
        } else {
          setTimeout(() => cb(null, '', ''), 0);
        }
      }
      return { on: vi.fn() } as any;
    };

    await mgrWithLock.merge(AGENT_ID);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: AGENT_ID,
        files: ['src/bad.ts'],
      }),
    );
  });

  it('merge returns no unlockedFiles when all changed files are locked', async () => {
    const lockChecker = {
      getByAgent: vi.fn().mockReturnValue([
        { filePath: 'src/a.ts' },
        { filePath: 'src/b.ts' },
      ]),
    };
    const mgrWithLock = new WorktreeManager(REPO, lockChecker);
    await mgrWithLock.create(AGENT_ID);

    execCalls = [];
    execHandler.fn = (cmd: string, opts: any, cb: any) => {
      execCalls.push({ cmd, opts });
      if (typeof cb === 'function') {
        if (cmd.includes('git diff --name-only HEAD...')) {
          setTimeout(() => cb(null, 'src/a.ts\nsrc/b.ts\n', ''), 0);
        } else {
          setTimeout(() => cb(null, '', ''), 0);
        }
      }
      return { on: vi.fn() } as any;
    };

    const result = await mgrWithLock.merge(AGENT_ID);

    expect(result.ok).toBe(true);
    expect(result.unlockedFiles).toBeUndefined();
  });

  it('merge validation handles glob prefix locks (src/*)', async () => {
    const lockChecker = {
      getByAgent: vi.fn().mockReturnValue([
        { filePath: 'src/*' },
      ]),
    };
    const mgrWithLock = new WorktreeManager(REPO, lockChecker);
    await mgrWithLock.create(AGENT_ID);

    execCalls = [];
    execHandler.fn = (cmd: string, opts: any, cb: any) => {
      execCalls.push({ cmd, opts });
      if (typeof cb === 'function') {
        if (cmd.includes('git diff --name-only HEAD...')) {
          setTimeout(() => cb(null, 'src/deep/nested.ts\ndocs/readme.md\n', ''), 0);
        } else {
          setTimeout(() => cb(null, '', ''), 0);
        }
      }
      return { on: vi.fn() } as any;
    };

    const result = await mgrWithLock.merge(AGENT_ID);

    expect(result.ok).toBe(true);
    // src/deep/nested.ts is covered by src/*; docs/readme.md is NOT
    expect(result.unlockedFiles).toEqual(['docs/readme.md']);
  });

  it('merge skips validation when no lockChecker provided', async () => {
    await mgr.create(AGENT_ID);
    execCalls = [];

    const result = await mgr.merge(AGENT_ID);

    expect(result.ok).toBe(true);
    expect(result.unlockedFiles).toBeUndefined();
    // No diff --name-only HEAD... call (only the git add/commit and merge commands)
    const diffScopeCmd = execCalls.find(c => c.cmd.includes('git diff --name-only HEAD...'));
    expect(diffScopeCmd).toBeUndefined();
  });

  it('merge validation is defense-in-depth: does not block merge on diff failure', async () => {
    const lockChecker = {
      getByAgent: vi.fn().mockReturnValue([{ filePath: 'src/ok.ts' }]),
    };
    const mgrWithLock = new WorktreeManager(REPO, lockChecker);
    await mgrWithLock.create(AGENT_ID);

    execCalls = [];
    execHandler.fn = (cmd: string, opts: any, cb: any) => {
      execCalls.push({ cmd, opts });
      if (typeof cb === 'function') {
        if (cmd.includes('git diff --name-only HEAD...')) {
          // Diff command fails
          setTimeout(() => cb(new Error('git diff failed'), '', ''), 0);
        } else {
          setTimeout(() => cb(null, '', ''), 0);
        }
      }
      return { on: vi.fn() } as any;
    };

    const result = await mgrWithLock.merge(AGENT_ID);

    // Merge still succeeds even if validation fails
    expect(result.ok).toBe(true);
    expect(result.unlockedFiles).toBeUndefined();
  });

  // ── cleanup ───────────────────────────────────────────────────

  it('cleanup removes worktree and branch', async () => {
    await mgr.create(AGENT_ID);
    existsSyncMock.mockReturnValue(true);
    execCalls = [];

    await mgr.cleanup(AGENT_ID);

    const removeCmd = execCalls.find(c => c.cmd.includes('git worktree remove'));
    const branchCmd = execCalls.find(c => c.cmd.includes('git branch -D'));
    expect(removeCmd).toBeDefined();
    expect(branchCmd).toBeDefined();
    expect(branchCmd!.cmd).toContain(`agent-wt-${SHORT}`);

    expect(mgr.getWorktree(AGENT_ID)).toBeUndefined();
    expect(mgr.count).toBe(0);
  });

  it('emits worktree:cleaned event', async () => {
    await mgr.create(AGENT_ID);
    const spy = vi.fn();
    mgr.on('worktree:cleaned', spy);

    await mgr.cleanup(AGENT_ID);

    expect(spy).toHaveBeenCalledWith({ agentId: AGENT_ID });
  });

  it('handles cleanup of non-existent worktree without throwing', async () => {
    await expect(mgr.cleanup('nonexistent-id')).resolves.not.toThrow();
  });

  // ── cleanupAll ────────────────────────────────────────────────

  it('cleanupAll removes all worktrees', async () => {
    const AGENT_B = 'bbbbbbbb-2345-6789-abcd-ef0123456789';
    await mgr.create(AGENT_ID);
    await mgr.create(AGENT_B);
    expect(mgr.count).toBe(2);

    await mgr.cleanupAll();

    expect(mgr.count).toBe(0);
    expect(mgr.getAll()).toEqual([]);
  });

  // ── getAll ────────────────────────────────────────────────────

  it('getAll returns active worktree list', async () => {
    const AGENT_B = 'bbbbbbbb-2345-6789-abcd-ef0123456789';
    await mgr.create(AGENT_ID);
    await mgr.create(AGENT_B);

    const all = mgr.getAll();
    expect(all).toHaveLength(2);
    expect(all.map(w => w.agentId)).toContain(AGENT_ID);
    expect(all.map(w => w.agentId)).toContain(AGENT_B);
  });

  // ── cleanupOrphans ────────────────────────────────────────────

  it('cleanupOrphans returns 0 when .worktrees dir does not exist', async () => {
    existsSyncMock.mockReturnValue(false);
    const count = await mgr.cleanupOrphans();
    expect(count).toBe(0);
  });

  it('cleanupOrphans removes stale worktrees', async () => {
    existsSyncMock.mockReturnValue(true);

    execHandler.fn = (cmd: string, opts: any, cb: any) => {
      execCalls.push({ cmd, opts });
      if (typeof cb === 'function') {
        if (cmd.includes('git worktree list')) {
          const output = [
            `worktree ${REPO}`,
            'HEAD abc123',
            'branch refs/heads/main',
            '',
            `worktree ${REPO}/.worktrees/orphan01`,
            'HEAD def456',
            'branch refs/heads/agent-wt-orphan01',
            '',
          ].join('\n');
          setTimeout(() => cb(null, output, ''), 0);
        } else {
          setTimeout(() => cb(null, '', ''), 0);
        }
      }
      return { on: vi.fn() } as any;
    };

    const count = await mgr.cleanupOrphans();
    expect(count).toBe(1);

    const pruneCmd = execCalls.find(c => c.cmd.includes('git worktree prune'));
    expect(pruneCmd).toBeDefined();
  });
});
