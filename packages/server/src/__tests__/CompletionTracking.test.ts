import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Agent } from '../agents/Agent.js';
import type { CommandHandlerContext } from '../agents/commands/types.js';

// Mock child_process.execFile so checkDirtyLockedFiles can be tested
const mockExecFile = vi.fn();
vi.mock('child_process', () => ({ execFile: (...args: any[]) => mockExecFile(...args) }));

// Import AFTER mocking child_process
const { notifyParentOfCompletion } = await import('../agents/commands/CompletionTracking.js');

// ── Helpers ──────────────────────────────────────────────────────────

function makeAgent(overrides: Record<string, any> = {}): Agent {
  return {
    id: 'agent-child-001',
    parentId: 'agent-lead-001',
    role: { id: 'developer', name: 'Developer' },
    status: 'idle',
    cwd: '/fake/repo',
    sessionId: null,
    task: 'some task',
    dagTaskId: null,
    childIds: [],
    getRecentOutput: vi.fn().mockReturnValue('done'),
    getTaskOutput: vi.fn().mockReturnValue('done'),
    sendMessage: vi.fn(),
    ...overrides,
  } as any;
}

function makeParent(overrides: Record<string, any> = {}): Agent {
  return {
    id: 'agent-lead-001',
    parentId: undefined,
    role: { id: 'lead', name: 'Project Lead' },
    status: 'running',
    cwd: '/fake/repo',
    sendMessage: vi.fn(),
    ...overrides,
  } as any;
}

function makeCtx(overrides: Record<string, any> = {}): CommandHandlerContext {
  return {
    getAgent: vi.fn(),
    emit: vi.fn(),
    lockRegistry: {
      getByAgent: vi.fn().mockReturnValue([]),
    },
    activityLedger: { log: vi.fn() },
    delegations: new Map(),
    reportedCompletions: new Set(),
    taskDAG: {
      getTaskByAgent: vi.fn().mockReturnValue(null),
      getStatus: vi.fn().mockReturnValue({ summary: { pending: 0, ready: 0, running: 0 } }),
    },
    ...overrides,
  } as any;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('checkDirtyLockedFiles (via notifyParentOfCompletion)', () => {
  let parent: Agent;
  let child: Agent;
  let ctx: CommandHandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    parent = makeParent();
    child = makeAgent();
    ctx = makeCtx({
      getAgent: vi.fn().mockImplementation((id: string) =>
        id === parent.id ? parent : id === child.id ? child : undefined,
      ),
    });
  });

  it('warns parent when child terminates with dirty locked files', async () => {
    (ctx.lockRegistry.getByAgent as any).mockReturnValue([
      { filePath: 'src/main.ts' },
      { filePath: 'src/utils.ts' },
    ]);

    mockExecFile.mockImplementation((_file: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, { stdout: 'src/main.ts\nsrc/utils.ts\n', stderr: '' });
    });

    notifyParentOfCompletion(ctx, child, 0);
    // Flush the fire-and-forget promise chain
    await vi.waitFor(() => {
      expect((parent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('uncommitted changes in locked files'),
      );
    });

    expect((parent.sendMessage as any)).toHaveBeenCalledWith(
      expect.stringContaining('src/main.ts'),
    );
    expect((parent.sendMessage as any)).toHaveBeenCalledWith(
      expect.stringContaining('src/utils.ts'),
    );
  });

  it('does not warn parent when locked files are clean', async () => {
    (ctx.lockRegistry.getByAgent as any).mockReturnValue([
      { filePath: 'src/clean.ts' },
    ]);

    mockExecFile.mockImplementation((_file: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, { stdout: '\n', stderr: '' });
    });

    notifyParentOfCompletion(ctx, child, 0);
    // Let any pending microtasks resolve
    await new Promise(r => setTimeout(r, 10));

    // Parent gets the exit report but NOT a dirty-file warning
    const warningCalls = (parent.sendMessage as any).mock.calls.filter(
      (c: any[]) => c[0].includes('uncommitted changes'),
    );
    expect(warningCalls).toHaveLength(0);
  });

  it('does not warn when agent has no locks', async () => {
    (ctx.lockRegistry.getByAgent as any).mockReturnValue([]);

    notifyParentOfCompletion(ctx, child, 0);
    await new Promise(r => setTimeout(r, 10));

    // execFile should not be called at all — no locks to check
    expect(mockExecFile).not.toHaveBeenCalled();

    const warningCalls = (parent.sendMessage as any).mock.calls.filter(
      (c: any[]) => c[0].includes('uncommitted changes'),
    );
    expect(warningCalls).toHaveLength(0);
  });

  it('silently handles git failure without blocking termination', async () => {
    (ctx.lockRegistry.getByAgent as any).mockReturnValue([
      { filePath: 'src/broken.ts' },
    ]);

    mockExecFile.mockImplementation((_file: string, _args: string[], _opts: any, cb: Function) => {
      cb(new Error('git not found'), { stdout: '', stderr: 'git not found' });
    });

    notifyParentOfCompletion(ctx, child, 0);
    await new Promise(r => setTimeout(r, 10));

    // No dirty-file warning — error was swallowed
    const warningCalls = (parent.sendMessage as any).mock.calls.filter(
      (c: any[]) => c[0].includes('uncommitted changes'),
    );
    expect(warningCalls).toHaveLength(0);
  });

  it('truncates listing when more than 10 dirty files', async () => {
    const manyFiles = Array.from({ length: 13 }, (_, i) => ({ filePath: `src/file${i}.ts` }));
    (ctx.lockRegistry.getByAgent as any).mockReturnValue(manyFiles);

    const dirtyOutput = manyFiles.map(f => f.filePath).join('\n') + '\n';
    mockExecFile.mockImplementation((_file: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, { stdout: dirtyOutput, stderr: '' });
    });

    notifyParentOfCompletion(ctx, child, 0);
    await vi.waitFor(() => {
      expect((parent.sendMessage as any)).toHaveBeenCalledWith(
        expect.stringContaining('and 3 more'),
      );
    });
  });
});
