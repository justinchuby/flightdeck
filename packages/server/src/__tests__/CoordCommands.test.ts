import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCoordCommands } from '../agents/commands/CoordCommands.js';
import type { CommandHandlerContext } from '../agents/commands/types.js';

// Mock child_process.execFile for git command execution
const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
}));

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'agent-dev-abc123',
    parentId: 'agent-lead-000',
    role: { id: 'developer', name: 'Developer' },
    cwd: '/fake/worktree',
    sendMessage: vi.fn(),
    ...overrides,
  } as any;
}

function makeCtx(overrides: Record<string, any> = {}): CommandHandlerContext {
  return {
    lockRegistry: {
      acquire: vi.fn(),
      release: vi.fn(),
      getByAgent: vi.fn().mockReturnValue([]),
    },
    activityLedger: {
      log: vi.fn(),
    },
    getProjectIdForAgent: vi.fn().mockReturnValue(undefined),
    delegations: new Map(),
    reportedCompletions: new Set(),
    pendingSystemActions: new Map(),
    ...overrides,
  } as any;
}

function getCommitHandler(ctx: CommandHandlerContext) {
  const cmds = getCoordCommands(ctx);
  const commit = cmds.find((c) => c.name === 'COMMIT');
  if (!commit) throw new Error('COMMIT command not found');
  return commit;
}

// Helper: find the git add execFile call args
function getGitAddArgs(): string[] | undefined {
  const call = mockExecFile.mock.calls.find((args: any[]) => args[1]?.[0] === 'add');
  return call?.[1]; // return the args array: ['add', ...files]
}

// Helper: find the git commit execFile call args
function getGitCommitArgs(): string[] | undefined {
  const call = mockExecFile.mock.calls.find((args: any[]) => args[1]?.[0] === 'commit');
  return call?.[1]; // return the args array: ['commit', '-m', msg, '--', ...files]
}

// Helper: make mockExecFile resolve successfully (commit + post-commit dirty-tree check)
function mockExecFileSuccess(stdout = 'abc1234 feat: stuff\n 1 file changed', dirtyFiles?: string[], statusFiles?: string[]) {
  mockExecFile.mockImplementation((_file: string, args: string[], _opts: any, cb: Function) => {
    if (args[0] === 'status' && args[1] === '--porcelain') {
      // Pre-commit status check
      const lines = (statusFiles ?? []).join('\n');
      cb(null, { stdout: lines + '\n', stderr: '' });
    } else if (args[0] === 'diff' && args.includes('--')) {
      // Post-commit dirty-tree check (scoped)
      cb(null, { stdout: (dirtyFiles ?? []).join('\n') + '\n', stderr: '' });
    } else if (args[0] === 'ls-files') {
      // Post-commit untracked check
      cb(null, { stdout: '\n', stderr: '' });
    } else if (args[0] === 'add') {
      cb(null, { stdout: '', stderr: '' });
    } else {
      cb(null, { stdout, stderr: '' });
    }
  });
}

// Helper: make mockExecFile reject with error
function mockExecFileFailure(message = 'nothing to commit') {
  mockExecFile.mockImplementation((_file: string, _args: string[], _opts: any, cb: Function) => {
    cb(new Error(message), { stdout: '', stderr: message });
  });
}

// Helper: commit succeeds but dirty-tree check fails
function mockExecFileCommitOkVerifyFail(stdout = 'abc1234 feat: stuff\n 1 file changed') {
  mockExecFile.mockImplementation((_file: string, args: string[], _opts: any, cb: Function) => {
    if (args[0] === 'status' || args[0] === 'diff' || args[0] === 'ls-files') {
      cb(new Error('fatal: not a git repository'), { stdout: '', stderr: '' });
    } else if (args[0] === 'add') {
      cb(null, { stdout: '', stderr: '' });
    } else {
      cb(null, { stdout, stderr: '' });
    }
  });
}

describe('CoordCommands — COMMIT handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers all 6 coordination commands', () => {
    const cmds = getCoordCommands(makeCtx());
    expect(cmds).toHaveLength(6);
    expect(cmds.map((c) => c.name)).toEqual([
      'LOCK_FILE', 'UNLOCK_FILE', 'ACTIVITY', 'DECISION', 'PROGRESS', 'COMMIT',
    ]);
  });

  it('executes scoped git add with locked files', async () => {
    mockExecFileSuccess(undefined, ['src/auth.ts', 'src/utils.ts']);
    const ctx = makeCtx({
      lockRegistry: {
        getByAgent: vi.fn().mockReturnValue([
          { filePath: 'src/auth.ts' },
          { filePath: 'src/utils.ts' },
        ]),
      },
    });
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    await commit.handler(agent, '⟦⟦ COMMIT {"message": "Add auth module"} ⟧⟧');

    expect(ctx.lockRegistry.getByAgent).toHaveBeenCalledWith('agent-dev-abc123');
    const addArgs = getGitAddArgs()!;
    expect(addArgs).toContain('src/auth.ts');
    expect(addArgs).toContain('src/utils.ts');
    const commitArgs = getGitCommitArgs()!;
    // Message is in the -m arg which includes the full commit message
    const msgArg = commitArgs[commitArgs.indexOf('-m') + 1];
    expect(msgArg).toContain('Add auth module');
  });

  it('handles file paths with spaces and special characters', async () => {
    mockExecFileSuccess(undefined, ['src/my component/App.tsx', "docs/note's.md"]);
    const ctx = makeCtx({
      lockRegistry: {
        getByAgent: vi.fn().mockReturnValue([
          { filePath: 'src/my component/App.tsx' },
          { filePath: "docs/note's.md" },
        ]),
      },
    });
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    await commit.handler(agent, '⟦⟦ COMMIT {"message": "Update docs"} ⟧⟧');

    const addArgs = getGitAddArgs()!;
    // execFile passes args directly — no shell quoting needed
    expect(addArgs).toContain('src/my component/App.tsx');
    expect(addArgs).toContain("docs/note's.md");
  });

  it('warns and returns when agent has no locks', async () => {
    mockExecFileSuccess();
    const ctx = makeCtx();
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    await commit.handler(agent, '⟦⟦ COMMIT {"message": "test"} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('No file locks held'),
    );
    expect(ctx.activityLedger.log).not.toHaveBeenCalled();
    // Pre-commit untracked detection runs, but no git add/commit
    expect(getGitAddArgs()).toBeUndefined();
  });

  it('includes Co-authored-by trailer in commit command', async () => {
    mockExecFileSuccess(undefined, ['file.ts']);
    const ctx = makeCtx({
      lockRegistry: {
        getByAgent: vi.fn().mockReturnValue([{ filePath: 'file.ts' }]),
      },
    });
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    await commit.handler(agent, '⟦⟦ COMMIT {"message": "feat: stuff"} ⟧⟧');

    const commitArgs = getGitCommitArgs()!;
    expect(commitArgs.join(' ')).toContain('Co-authored-by: Copilot');
  });

  it('uses default message when none provided', async () => {
    mockExecFileSuccess(undefined, ['file.ts']);
    const ctx = makeCtx({
      lockRegistry: {
        getByAgent: vi.fn().mockReturnValue([{ filePath: 'file.ts' }]),
      },
    });
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    await commit.handler(agent, '⟦⟦ COMMIT {} ⟧⟧');

    const commitArgs = getGitCommitArgs()!;
    expect(commitArgs.join(' ')).toContain('Changes by Developer (agent-d');
  });

  it('logs commit to activity ledger after successful commit', async () => {
    mockExecFileSuccess(undefined, ['a.ts', 'b.ts']);
    const ctx = makeCtx({
      lockRegistry: {
        getByAgent: vi.fn().mockReturnValue([
          { filePath: 'a.ts' },
          { filePath: 'b.ts' },
        ]),
      },
    });
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    await commit.handler(agent, '⟦⟦ COMMIT {"message": "ship it"} ⟧⟧');

    // Activity ledger log now happens after async commit + verification
    expect(ctx.activityLedger.log).toHaveBeenCalledWith(
      'agent-dev-abc123',
      'developer',
      'file_edit',
      expect.stringContaining('ship it'),
      expect.objectContaining({
        type: 'commit',
        files: ['a.ts', 'b.ts'],
        message: 'ship it',
      }),
      expect.any(String),
    );
  });

  it('sends success message after git commit succeeds', async () => {
    mockExecFileSuccess('abc1234 feat: ship it\n 2 files changed', ['file.ts']);
    const ctx = makeCtx({
      lockRegistry: {
        getByAgent: vi.fn().mockReturnValue([{ filePath: 'file.ts' }]),
      },
    });
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    await commit.handler(agent, '⟦⟦ COMMIT {"message": "ship it"} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('COMMIT succeeded'),
    );
  });

  it('sends failure message when git commit fails', async () => {
    mockExecFileFailure('nothing to commit, working tree clean');
    const ctx = makeCtx({
      lockRegistry: {
        getByAgent: vi.fn().mockReturnValue([{ filePath: 'file.ts' }]),
      },
    });
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    await commit.handler(agent, '⟦⟦ COMMIT {"message": "test"} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('COMMIT failed'),
    );
  });

  it('executes in agent cwd (worktree path)', async () => {
    mockExecFileSuccess(undefined, ['file.ts']);
    const ctx = makeCtx({
      lockRegistry: {
        getByAgent: vi.fn().mockReturnValue([{ filePath: 'file.ts' }]),
      },
    });
    const agent = makeAgent({ cwd: '/my/worktree/path' });
    const commit = getCommitHandler(ctx);

    await commit.handler(agent, '⟦⟦ COMMIT {"message": "test"} ⟧⟧');

    // All execFile calls should use agent's cwd (opts is 3rd arg)
    for (const call of mockExecFile.mock.calls) {
      expect(call[2].cwd).toBe('/my/worktree/path');
    }
  });

  it('sends error on malformed JSON', async () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    await commit.handler(agent, '⟦⟦ COMMIT {not valid json} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('COMMIT error'),
    );
  });

  it('ignores non-matching input', async () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    await commit.handler(agent, 'just some regular text');

    expect(agent.sendMessage).not.toHaveBeenCalled();
  });

  // ── A6: Post-commit verification tests ──────────────────────────────

  it('does not warn when working tree is clean after commit', async () => {
    mockExecFileSuccess(undefined, []);
    const ctx = makeCtx({
      lockRegistry: {
        getByAgent: vi.fn().mockReturnValue([
          { filePath: 'src/auth.ts' },
          { filePath: 'src/utils.ts' },
        ]),
      },
    });
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    await commit.handler(agent, '⟦⟦ COMMIT {"message": "verified commit"} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('COMMIT succeeded'),
    );
    // Should NOT have a warning about dirty files
    const warnings = agent.sendMessage.mock.calls.filter(
      (c: any[]) => (c[0] as string).includes('Post-commit warning'),
    );
    expect(warnings).toHaveLength(0);
  });

  it('does not warn when dirty-tree check returns no files', async () => {
    mockExecFileSuccess(undefined, []);
    const ctx = makeCtx({
      lockRegistry: {
        getByAgent: vi.fn().mockReturnValue([
          { filePath: 'src/auth.ts' },
          { filePath: 'src/utils.ts' },
        ]),
      },
    });
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    await commit.handler(agent, '⟦⟦ COMMIT {"message": "partial commit"} ⟧⟧');

    // Should get success message but NOT a warning
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('COMMIT succeeded'),
    );
    expect(agent.sendMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('Post-commit warning'),
    );
  });

  it('does not warn when no dirty files remain', async () => {
    mockExecFileSuccess(undefined, []);
    const ctx = makeCtx({
      lockRegistry: {
        getByAgent: vi.fn().mockReturnValue([
          { filePath: 'a.ts' },
          { filePath: 'b.ts' },
          { filePath: 'c.ts' },
        ]),
      },
    });
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    await commit.handler(agent, '⟦⟦ COMMIT {"message": "empty commit"} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('COMMIT succeeded'),
    );
    expect(agent.sendMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('Post-commit warning'),
    );
  });

  it('gracefully handles dirty-tree check failure (best-effort)', async () => {
    mockExecFileCommitOkVerifyFail();
    const ctx = makeCtx({
      lockRegistry: {
        getByAgent: vi.fn().mockReturnValue([{ filePath: 'file.ts' }]),
      },
    });
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    await commit.handler(agent, '⟦⟦ COMMIT {"message": "test"} ⟧⟧');

    // Commit success message should still arrive
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('COMMIT succeeded'),
    );
    // No crash — dirty-tree check failure is swallowed
    const warnings = agent.sendMessage.mock.calls.filter(
      (c: any[]) => (c[0] as string).includes('Post-commit warning'),
    );
    expect(warnings).toHaveLength(0);
    // Activity ledger still logs (dirty-tree check is best-effort)
    expect(ctx.activityLedger.log).toHaveBeenCalled();
  });

  it('does not log to activity ledger on commit failure', async () => {
    mockExecFileFailure('nothing to commit');
    const ctx = makeCtx({
      lockRegistry: {
        getByAgent: vi.fn().mockReturnValue([{ filePath: 'file.ts' }]),
      },
    });
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    await commit.handler(agent, '⟦⟦ COMMIT {"message": "test"} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('COMMIT failed'),
    );
    // Activity ledger should NOT be called on failure
    expect(ctx.activityLedger.log).not.toHaveBeenCalled();
  });

  // ── COMMIT safety invariants ──────────────────────────────────────────

  describe('safety: only locked files are staged', () => {
    it('git add command contains EXACTLY the locked files and no others', async () => {
      mockExecFileSuccess(undefined, ['src/TaskDAG.ts', 'src/__tests__/TaskDAG.test.ts']);
      const ctx = makeCtx({
        lockRegistry: {
          getByAgent: vi.fn().mockReturnValue([
            { filePath: 'src/TaskDAG.ts' },
            { filePath: 'src/__tests__/TaskDAG.test.ts' },
          ]),
        },
      });
      const agent = makeAgent();
      const commit = getCommitHandler(ctx);

      await commit.handler(agent, '⟦⟦ COMMIT {"message": "scoped commit"} ⟧⟧');

      const addArgs = getGitAddArgs()!;
      // Must contain exactly these two files (plus 'add' subcommand)
      expect(addArgs).toContain('src/TaskDAG.ts');
      expect(addArgs).toContain('src/__tests__/TaskDAG.test.ts');
      // Must NOT use git add -A or git add .
      expect(addArgs).not.toContain('-A');
      expect(addArgs).not.toContain('.');
      // First arg is the 'add' subcommand, rest are file paths
      expect(addArgs[0]).toBe('add');
    });

    it('single locked file produces single-file git add', async () => {
      mockExecFileSuccess(undefined, ['README.md']);
      const ctx = makeCtx({
        lockRegistry: {
          getByAgent: vi.fn().mockReturnValue([
            { filePath: 'README.md' },
          ]),
        },
      });
      const agent = makeAgent();
      const commit = getCommitHandler(ctx);

      await commit.handler(agent, '⟦⟦ COMMIT {"message": "single file"} ⟧⟧');

      const addArgs = getGitAddArgs()!;
      // ['add', 'README.md']
      expect(addArgs).toEqual(['add', 'README.md']);
    });
  });

  describe('safety: cross-agent isolation', () => {
    it('queries lockRegistry with the committing agent ID only', async () => {
      mockExecFileSuccess(undefined, ['agent-a-file.ts']);
      const getByAgent = vi.fn().mockReturnValue([
        { filePath: 'agent-a-file.ts' },
      ]);
      const ctx = makeCtx({
        lockRegistry: { getByAgent },
      });
      const agentA = makeAgent({ id: 'agent-aaa-111' });
      const commit = getCommitHandler(ctx);

      commit.handler(agentA, '⟦⟦ COMMIT {"message": "agent A commit"} ⟧⟧');

      // Must query locks ONLY for the committing agent
      expect(getByAgent).toHaveBeenCalledWith('agent-aaa-111');
      expect(getByAgent).toHaveBeenCalledTimes(1);
    });

    it('agent B locks are invisible to agent A commit', async () => {
      // Simulate: Agent A has 1 lock, Agent B has 2 locks
      const getByAgent = vi.fn().mockImplementation((agentId: string) => {
        if (agentId === 'agent-aaa') return [{ filePath: 'a-file.ts' }];
        if (agentId === 'agent-bbb') return [{ filePath: 'b-file1.ts' }, { filePath: 'b-file2.ts' }];
        return [];
      });
      mockExecFileSuccess(undefined, ['a-file.ts']);
      const ctx = makeCtx({
        lockRegistry: { getByAgent },
      });
      const agentA = makeAgent({ id: 'agent-aaa' });
      const commit = getCommitHandler(ctx);

      await commit.handler(agentA, '⟦⟦ COMMIT {"message": "A only"} ⟧⟧');

      const addArgs = getGitAddArgs()!;
      // Agent A's file is staged
      expect(addArgs).toContain('a-file.ts');
      // Agent B's files are NOT staged
      expect(addArgs).not.toContain('b-file1.ts');
      expect(addArgs).not.toContain('b-file2.ts');
    });

    it('two agents committing simultaneously get their own scoped files', async () => {
      const getByAgent = vi.fn().mockImplementation((agentId: string) => {
        if (agentId === 'agent-x') return [{ filePath: 'x.ts' }];
        if (agentId === 'agent-y') return [{ filePath: 'y.ts' }];
        return [];
      });
      mockExecFileSuccess(undefined, ['x.ts']);
      const ctx = makeCtx({
        lockRegistry: { getByAgent },
      });
      const agentX = makeAgent({ id: 'agent-x' });
      const agentY = makeAgent({ id: 'agent-y' });
      const commit = getCommitHandler(ctx);

      await commit.handler(agentX, '⟦⟦ COMMIT {"message": "X work"} ⟧⟧');
      await commit.handler(agentY, '⟦⟦ COMMIT {"message": "Y work"} ⟧⟧');

      // Find git add calls by checking args[1][0] === 'add'
      const addCalls = mockExecFile.mock.calls
        .filter((args: any[]) => args[1]?.[0] === 'add')
        .map((args: any[]) => args[1] as string[]);
      expect(addCalls).toHaveLength(2);
      expect(addCalls[0]).toContain('x.ts');
      expect(addCalls[0]).not.toContain('y.ts');
      expect(addCalls[1]).toContain('y.ts');
      expect(addCalls[1]).not.toContain('x.ts');
    });
  });

  describe('safety: all locked files are staged', () => {
    it('every locked file appears in the git add command', async () => {
      const lockedFiles = [
        { filePath: 'src/a.ts' },
        { filePath: 'src/b.ts' },
        { filePath: 'src/c.ts' },
        { filePath: 'tests/a.test.ts' },
      ];
      mockExecFileSuccess(undefined, lockedFiles.map(l => l.filePath));
      const ctx = makeCtx({
        lockRegistry: {
          getByAgent: vi.fn().mockReturnValue(lockedFiles),
        },
      });
      const agent = makeAgent();
      const commit = getCommitHandler(ctx);

      await commit.handler(agent, '⟦⟦ COMMIT {"message": "all files"} ⟧⟧');

      const addArgs = getGitAddArgs()!;
      for (const lock of lockedFiles) {
        expect(addArgs).toContain(lock.filePath);
      }
    });
  });

  describe('safety: no locks means no commit', () => {
    it('refuses to commit and does not invoke git at all', async () => {
      mockExecFileSuccess();
      const ctx = makeCtx({
        lockRegistry: {
          getByAgent: vi.fn().mockReturnValue([]),
        },
      });
      const agent = makeAgent();
      const commit = getCommitHandler(ctx);

      await commit.handler(agent, '⟦⟦ COMMIT {"message": "no locks"} ⟧⟧');

      // Pre-commit untracked detection runs, but no git add/commit
      expect(getGitAddArgs()).toBeUndefined();
      expect(agent.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('No file locks held'),
      );
      expect(ctx.activityLedger.log).not.toHaveBeenCalled();
    });
  });

  describe('safety: post-commit verification', () => {
    it('runs dirty-tree check after commit succeeds', async () => {
      mockExecFileSuccess(undefined, []);
      const ctx = makeCtx({
        lockRegistry: {
          getByAgent: vi.fn().mockReturnValue([{ filePath: 'src/file.ts' }]),
        },
      });
      const agent = makeAgent();
      const commit = getCommitHandler(ctx);

      await commit.handler(agent, '⟦⟦ COMMIT {"message": "verify me"} ⟧⟧');

      // Pre-commit status + git add + git commit + 2 post-commit checks = 5 calls
      expect(mockExecFile).toHaveBeenCalledTimes(5);
      // First call: pre-commit status check (git status --porcelain)
      expect(mockExecFile.mock.calls[0][1][0]).toBe('status');
      // Second call: git add
      expect(mockExecFile.mock.calls[1][1][0]).toBe('add');
      expect(mockExecFile.mock.calls[1][1]).toContain('src/file.ts');
      // Third call: git commit
      expect(mockExecFile.mock.calls[2][1][0]).toBe('commit');
      expect(mockExecFile.mock.calls[2][1]).toContain('src/file.ts');
      // Fourth + fifth calls: scoped git diff and git ls-files (dirty-tree check)
      const postCommitSubcmds = [mockExecFile.mock.calls[3][1][0], mockExecFile.mock.calls[4][1][0]];
      expect(postCommitSubcmds).toContain('diff');
      expect(postCommitSubcmds).toContain('ls-files');
    });

    it('warns when dirty files remain after commit', async () => {
      // Post-commit check finds dirty files still in the working tree
      mockExecFileSuccess(undefined, ['src/leftover.ts']);
      const ctx = makeCtx({
        lockRegistry: {
          getByAgent: vi.fn().mockReturnValue([
            { filePath: 'src/modified.ts' },
          ]),
        },
      });
      const agent = makeAgent();
      const commit = getCommitHandler(ctx);

      await commit.handler(agent, '⟦⟦ COMMIT {"message": "partial modify"} ⟧⟧');

      expect(agent.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('COMMIT succeeded'),
      );
      expect(agent.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('Post-commit warning'),
      );
    });
  });

  // ── Fix 2: Honor req.files parameter ──────────────────────────────────

  describe('fix 2: honor req.files parameter', () => {
    it('merges req.files with locked files', async () => {
      mockExecFileSuccess(undefined, []);
      const ctx = makeCtx({
        lockRegistry: {
          getByAgent: vi.fn().mockReturnValue([{ filePath: 'src/locked.ts' }]),
        },
      });
      const agent = makeAgent();
      const commit = getCommitHandler(ctx);

      await commit.handler(agent, '⟦⟦ COMMIT {"message": "merge test", "files": ["src/extra.ts"]} ⟧⟧');

      const addArgs = getGitAddArgs()!;
      expect(addArgs).toContain('src/locked.ts');
      expect(addArgs).toContain('src/extra.ts');
    });

    it('warns about unlocked explicitly specified files', async () => {
      mockExecFileSuccess(undefined, []);
      const ctx = makeCtx({
        lockRegistry: {
          getByAgent: vi.fn().mockReturnValue([{ filePath: 'src/locked.ts' }]),
        },
      });
      const agent = makeAgent();
      const commit = getCommitHandler(ctx);

      await commit.handler(agent, '⟦⟦ COMMIT {"message": "test", "files": ["src/unlocked.ts"]} ⟧⟧');

      expect(agent.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining("don't hold locks for"),
      );
    });

    it('allows commit with only req.files when no locks held', async () => {
      mockExecFileSuccess(undefined, []);
      const ctx = makeCtx({
        lockRegistry: {
          getByAgent: vi.fn().mockReturnValue([]),
        },
      });
      const agent = makeAgent();
      const commit = getCommitHandler(ctx);

      await commit.handler(agent, '⟦⟦ COMMIT {"message": "manual files", "files": ["src/a.ts"]} ⟧⟧');

      const addArgs = getGitAddArgs()!;
      expect(addArgs).toContain('src/a.ts');
    });

    it('deduplicates when req.files overlaps with locks', async () => {
      mockExecFileSuccess(undefined, []);
      const ctx = makeCtx({
        lockRegistry: {
          getByAgent: vi.fn().mockReturnValue([{ filePath: 'src/shared.ts' }]),
        },
      });
      const agent = makeAgent();
      const commit = getCommitHandler(ctx);

      await commit.handler(agent, '⟦⟦ COMMIT {"message": "dedup", "files": ["src/shared.ts"]} ⟧⟧');

      const addArgs = getGitAddArgs()!;
      // File should appear only once in the add args (plus 'add' subcommand)
      const fileCount = addArgs.filter(a => a === 'src/shared.ts').length;
      expect(fileCount).toBe(1);
    });
  });

  // ── Untracked/modified file warning ─────────────────────────────────

  describe('uncommitted file warning', () => {
    it('warns about untracked files not included in commit', async () => {
      mockExecFileSuccess(undefined, [], ['?? src/foo.test.ts']);
      const ctx = makeCtx({
        lockRegistry: {
          getByAgent: vi.fn().mockReturnValue([{ filePath: 'src/foo.ts' }]),
        },
      });
      const agent = makeAgent();
      const commit = getCommitHandler(ctx);

      await commit.handler(agent, '⟦⟦ COMMIT {"message": "with untracked"} ⟧⟧');

      // No auto-inclusion — just warns the agent
      const addArgs = getGitAddArgs()!;
      expect(addArgs).toContain('src/foo.ts');
      expect(addArgs).not.toContain('src/foo.test.ts');
      expect(agent.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('uncommitted file(s) not in this commit'),
      );
      expect(agent.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('src/foo.test.ts'),
      );
    });

    it('warns about modified files not included in commit', async () => {
      mockExecFileSuccess(undefined, [], [' M packages/web/src/components/AcpOutput.tsx']);
      const ctx = makeCtx({
        lockRegistry: {
          getByAgent: vi.fn().mockReturnValue([{ filePath: 'packages/web/src/hooks/useWebSocket.ts' }]),
        },
      });
      const agent = makeAgent();
      const commit = getCommitHandler(ctx);

      await commit.handler(agent, '⟦⟦ COMMIT {"message": "partial changes"} ⟧⟧');

      expect(agent.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('uncommitted file(s) not in this commit'),
      );
      expect(agent.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('AcpOutput.tsx'),
      );
    });

    it('does NOT warn about files already in the commit', async () => {
      mockExecFileSuccess(undefined, [], [' M src/foo.ts']);
      const ctx = makeCtx({
        lockRegistry: {
          getByAgent: vi.fn().mockReturnValue([{ filePath: 'src/foo.ts' }]),
        },
      });
      const agent = makeAgent();
      const commit = getCommitHandler(ctx);

      await commit.handler(agent, '⟦⟦ COMMIT {"message": "all included"} ⟧⟧');

      const warnings = agent.sendMessage.mock.calls.filter(
        (c: any[]) => (c[0] as string).includes('uncommitted file(s)'),
      );
      expect(warnings).toHaveLength(0);
    });

    it('does NOT warn when no uncommitted files exist', async () => {
      mockExecFileSuccess(undefined, []);
      const ctx = makeCtx({
        lockRegistry: {
          getByAgent: vi.fn().mockReturnValue([{ filePath: 'src/foo.ts' }]),
        },
      });
      const agent = makeAgent();
      const commit = getCommitHandler(ctx);

      await commit.handler(agent, '⟦⟦ COMMIT {"message": "clean"} ⟧⟧');

      const warnings = agent.sendMessage.mock.calls.filter(
        (c: any[]) => (c[0] as string).includes('uncommitted file(s)'),
      );
      expect(warnings).toHaveLength(0);
    });

    it('warns about both untracked and modified files together', async () => {
      mockExecFileSuccess(undefined, [], ['?? src/new.ts', ' M src/changed.ts']);
      const ctx = makeCtx({
        lockRegistry: {
          getByAgent: vi.fn().mockReturnValue([{ filePath: 'src/main.ts' }]),
        },
      });
      const agent = makeAgent();
      const commit = getCommitHandler(ctx);

      await commit.handler(agent, '⟦⟦ COMMIT {"message": "multi"} ⟧⟧');

      expect(agent.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('2 uncommitted file(s)'),
      );
    });

    it('gracefully handles status check failure', async () => {
      mockExecFileCommitOkVerifyFail();
      const ctx = makeCtx({
        lockRegistry: {
          getByAgent: vi.fn().mockReturnValue([{ filePath: 'file.ts' }]),
        },
      });
      const agent = makeAgent();
      const commit = getCommitHandler(ctx);

      await commit.handler(agent, '⟦⟦ COMMIT {"message": "safe"} ⟧⟧');

      expect(agent.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('COMMIT succeeded'),
      );
    });
  });

  // ── Fix 3: Pre-release lock audit ─────────────────────────────────────

  describe('fix 3: pre-release lock audit', () => {
    it('blocks release when file has uncommitted changes', async () => {
      const ctx = makeCtx({
        lockRegistry: {
          release: vi.fn().mockReturnValue(true),
        },
      });
      const agent = makeAgent();

      // Mock execFile to return dirty file
      mockExecFile.mockImplementation((_file: string, args: string[], _opts: any, cb: Function) => {
        if (args[0] === 'diff') {
          cb(null, { stdout: 'src/dirty.ts\n', stderr: '' });
        } else {
          cb(null, { stdout: '', stderr: '' });
        }
      });

      const cmds = getCoordCommands(ctx);
      const unlock = cmds.find((c) => c.name === 'UNLOCK_FILE');
      unlock!.handler(agent, '⟦⟦ UNLOCK_FILE {"filePath": "src/dirty.ts"} ⟧⟧');

      await vi.waitFor(() => expect(agent.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('uncommitted changes'),
      ));
      // Lock should NOT be released — agent must commit first
      expect(ctx.lockRegistry.release).not.toHaveBeenCalled();
    });

    it('does not warn when releasing lock on clean file', async () => {
      const ctx = makeCtx({
        lockRegistry: {
          release: vi.fn().mockReturnValue(true),
        },
      });
      const agent = makeAgent();

      mockExecFile.mockImplementation((_file: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, { stdout: '\n', stderr: '' });
      });

      const cmds = getCoordCommands(ctx);
      const unlock = cmds.find((c) => c.name === 'UNLOCK_FILE');
      unlock!.handler(agent, '⟦⟦ UNLOCK_FILE {"filePath": "src/clean.ts"} ⟧⟧');

      await vi.waitFor(() => expect(ctx.lockRegistry.release).toHaveBeenCalled());
      // No warning about uncommitted changes
      const warnings = agent.sendMessage.mock.calls.filter(
        (c: any[]) => (c[0] as string).includes('uncommitted changes'),
      );
      expect(warnings).toHaveLength(0);
    });
  });
});
