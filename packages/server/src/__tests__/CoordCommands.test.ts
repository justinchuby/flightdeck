import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCoordCommands } from '../agents/commands/CoordCommands.js';
import type { CommandHandlerContext } from '../agents/commands/types.js';

// Mock child_process.exec for git command execution
const mockExec = vi.fn();
vi.mock('child_process', () => ({ exec: (...args: any[]) => mockExec(...args) }));

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

// Helper: make mockExec resolve successfully (both commit and verification)
function mockExecSuccess(stdout = 'abc1234 feat: stuff\n 1 file changed', verifyFiles?: string[]) {
  mockExec.mockImplementation((cmd: string, _opts: any, cb: Function) => {
    if (cmd.startsWith('git diff --name-only')) {
      cb(null, { stdout: (verifyFiles ?? []).join('\n') + '\n', stderr: '' });
    } else {
      cb(null, { stdout, stderr: '' });
    }
  });
}

// Helper: make mockExec reject with error
function mockExecFailure(message = 'nothing to commit') {
  mockExec.mockImplementation((_cmd: string, _opts: any, cb: Function) => {
    cb(new Error(message), { stdout: '', stderr: message });
  });
}

// Helper: commit succeeds but verification diff fails
function mockExecCommitOkVerifyFail(stdout = 'abc1234 feat: stuff\n 1 file changed') {
  mockExec.mockImplementation((cmd: string, _opts: any, cb: Function) => {
    if (cmd.startsWith('git diff --name-only')) {
      cb(new Error('fatal: bad object HEAD~1'), { stdout: '', stderr: '' });
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
      'LOCK', 'UNLOCK', 'ACTIVITY', 'DECISION', 'PROGRESS', 'COMMIT',
    ]);
  });

  it('executes scoped git add with locked files', async () => {
    mockExecSuccess(undefined, ['src/auth.ts', 'src/utils.ts']);
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

    commit.handler(agent, '[[[ COMMIT {"message": "Add auth module"} ]]]');

    expect(ctx.lockRegistry.getByAgent).toHaveBeenCalledWith('agent-dev-abc123');
    // Wait for async exec
    await vi.waitFor(() => expect(mockExec).toHaveBeenCalled());
    const cmd = mockExec.mock.calls[0][0] as string;
    expect(cmd).toContain("git add 'src/auth.ts' 'src/utils.ts'");
    expect(cmd).toContain('git commit');
    expect(cmd).toContain('Add auth module');
  });

  it('shell-quotes file paths with spaces and special characters', async () => {
    mockExecSuccess(undefined, ['src/my component/App.tsx', "docs/note's.md"]);
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

    commit.handler(agent, '[[[ COMMIT {"message": "Update docs"} ]]]');

    await vi.waitFor(() => expect(mockExec).toHaveBeenCalled());
    const cmd = mockExec.mock.calls[0][0] as string;
    expect(cmd).toContain("'src/my component/App.tsx'");
    // Single quotes in paths should be escaped
    expect(cmd).toContain("docs/note");
  });

  it('warns and returns when agent has no locks', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    commit.handler(agent, '[[[ COMMIT {"message": "test"} ]]]');

    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('No file locks held'),
    );
    expect(ctx.activityLedger.log).not.toHaveBeenCalled();
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('includes Co-authored-by trailer in commit command', async () => {
    mockExecSuccess(undefined, ['file.ts']);
    const ctx = makeCtx({
      lockRegistry: {
        getByAgent: vi.fn().mockReturnValue([{ filePath: 'file.ts' }]),
      },
    });
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    commit.handler(agent, '[[[ COMMIT {"message": "feat: stuff"} ]]]');

    await vi.waitFor(() => expect(mockExec).toHaveBeenCalled());
    const cmd = mockExec.mock.calls[0][0] as string;
    expect(cmd).toContain('Co-authored-by: Copilot');
  });

  it('uses default message when none provided', async () => {
    mockExecSuccess(undefined, ['file.ts']);
    const ctx = makeCtx({
      lockRegistry: {
        getByAgent: vi.fn().mockReturnValue([{ filePath: 'file.ts' }]),
      },
    });
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    commit.handler(agent, '[[[ COMMIT {} ]]]');

    await vi.waitFor(() => expect(mockExec).toHaveBeenCalled());
    const cmd = mockExec.mock.calls[0][0] as string;
    expect(cmd).toContain('Changes by Developer (agent-d');
  });

  it('logs commit to activity ledger after successful commit', async () => {
    mockExecSuccess(undefined, ['a.ts', 'b.ts']);
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

    commit.handler(agent, '[[[ COMMIT {"message": "ship it"} ]]]');

    // Activity ledger log now happens after async commit + verification
    await vi.waitFor(() => expect(ctx.activityLedger.log).toHaveBeenCalledWith(
      'agent-dev-abc123',
      'developer',
      'file_edit',
      expect.stringContaining('ship it'),
      expect.objectContaining({
        type: 'commit',
        files: ['a.ts', 'b.ts'],
        message: 'ship it',
      }),
    ));
  });

  it('sends success message after git commit succeeds', async () => {
    mockExecSuccess('abc1234 feat: ship it\n 2 files changed', ['file.ts']);
    const ctx = makeCtx({
      lockRegistry: {
        getByAgent: vi.fn().mockReturnValue([{ filePath: 'file.ts' }]),
      },
    });
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    commit.handler(agent, '[[[ COMMIT {"message": "ship it"} ]]]');

    await vi.waitFor(() => expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('COMMIT succeeded'),
    ));
  });

  it('sends failure message when git commit fails', async () => {
    mockExecFailure('nothing to commit, working tree clean');
    const ctx = makeCtx({
      lockRegistry: {
        getByAgent: vi.fn().mockReturnValue([{ filePath: 'file.ts' }]),
      },
    });
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    commit.handler(agent, '[[[ COMMIT {"message": "test"} ]]]');

    await vi.waitFor(() => expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('COMMIT failed'),
    ));
  });

  it('executes in agent cwd (worktree path)', async () => {
    mockExecSuccess(undefined, ['file.ts']);
    const ctx = makeCtx({
      lockRegistry: {
        getByAgent: vi.fn().mockReturnValue([{ filePath: 'file.ts' }]),
      },
    });
    const agent = makeAgent({ cwd: '/my/worktree/path' });
    const commit = getCommitHandler(ctx);

    commit.handler(agent, '[[[ COMMIT {"message": "test"} ]]]');

    await vi.waitFor(() => expect(mockExec).toHaveBeenCalled());
    const opts = mockExec.mock.calls[0][1];
    expect(opts.cwd).toBe('/my/worktree/path');
  });

  it('sends error on malformed JSON', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    commit.handler(agent, '[[[ COMMIT {not valid json} ]]]');

    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('COMMIT error'),
    );
  });

  it('ignores non-matching input', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    commit.handler(agent, 'just some regular text');

    expect(agent.sendMessage).not.toHaveBeenCalled();
  });
});
