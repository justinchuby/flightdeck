import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Agent } from '../agents/Agent.js';
import type { CommandHandlerContext } from '../agents/commands/types.js';

// Mock child_process.execFile so checkDirtyLockedFiles can be tested
const mockExecFile = vi.fn();
vi.mock('child_process', () => ({ execFile: (...args: any[]) => mockExecFile(...args) }));

// Import AFTER mocking child_process
const { notifyParentOfCompletion, notifyParentOfIdle } = await import('../agents/commands/CompletionTracking.js');

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
    getProjectIdForAgent: vi.fn().mockReturnValue(undefined),
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

// ── Ghost 'not in DAG' warning tests ──────────────────────────────────

describe('ghost DAG warning suppression', () => {
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

  describe('notifyParentOfCompletion', () => {
    it('does NOT emit warning when task was already completed via COMPLETE_TASK', () => {
      // Agent has a dagTaskId — it was linked to the DAG
      child = makeAgent({ dagTaskId: 'task-1' });
      ctx = makeCtx({
        getAgent: vi.fn().mockImplementation((id: string) =>
          id === parent.id ? parent : id === child.id ? child : undefined,
        ),
        taskDAG: {
          getTaskByAgent: vi.fn().mockReturnValue(null), // task is 'done', not 'running'/'ready'
          getTask: vi.fn().mockReturnValue({ id: 'task-1', dagStatus: 'done' }), // task exists in DAG
          getStatus: vi.fn().mockReturnValue({ summary: { pending: 2, ready: 1, running: 0 } }),
        },
      });

      notifyParentOfCompletion(ctx, child, 0);

      // Should NOT contain the "not in the DAG" warning
      const warningCalls = (parent.sendMessage as any).mock.calls.filter(
        (c: any[]) => c[0].includes('NOT in the DAG'),
      );
      expect(warningCalls).toHaveLength(0);
    });

    it('DOES emit warning when task genuinely is not in the DAG', () => {
      // Agent has NO dagTaskId — it was never linked
      child = makeAgent({ dagTaskId: null });
      ctx = makeCtx({
        getAgent: vi.fn().mockImplementation((id: string) =>
          id === parent.id ? parent : id === child.id ? child : undefined,
        ),
        taskDAG: {
          getTaskByAgent: vi.fn().mockReturnValue(null),
          getTask: vi.fn().mockReturnValue(null), // task doesn't exist
          getStatus: vi.fn().mockReturnValue({ summary: { pending: 2, ready: 1, running: 0 } }),
        },
      });

      notifyParentOfCompletion(ctx, child, 0);

      const warningCalls = (parent.sendMessage as any).mock.calls.filter(
        (c: any[]) => c[0].includes('NOT in the DAG'),
      );
      expect(warningCalls).toHaveLength(1);
    });

    it('does NOT emit warning when task was skipped in DAG', () => {
      child = makeAgent({ dagTaskId: 'task-skipped' });
      ctx = makeCtx({
        getAgent: vi.fn().mockImplementation((id: string) =>
          id === parent.id ? parent : id === child.id ? child : undefined,
        ),
        taskDAG: {
          getTaskByAgent: vi.fn().mockReturnValue(null),
          getTask: vi.fn().mockReturnValue({ id: 'task-skipped', dagStatus: 'skipped' }),
          getStatus: vi.fn().mockReturnValue({ summary: { pending: 1, ready: 0, running: 0 } }),
        },
      });

      notifyParentOfCompletion(ctx, child, 0);

      const warningCalls = (parent.sendMessage as any).mock.calls.filter(
        (c: any[]) => c[0].includes('NOT in the DAG'),
      );
      expect(warningCalls).toHaveLength(0);
    });
  });

  describe('notifyParentOfIdle', () => {
    it('does NOT emit warning when task was already completed via COMPLETE_TASK', () => {
      child = makeAgent({ dagTaskId: 'task-1' });
      ctx = makeCtx({
        getAgent: vi.fn().mockImplementation((id: string) =>
          id === parent.id ? parent : id === child.id ? child : undefined,
        ),
        taskDAG: {
          getTaskByAgent: vi.fn().mockReturnValue(null),
          getTask: vi.fn().mockReturnValue({ id: 'task-1', dagStatus: 'done' }),
          getStatus: vi.fn().mockReturnValue({ summary: { pending: 2, ready: 1, running: 0 } }),
        },
      });

      notifyParentOfIdle(ctx, child);

      const warningCalls = (parent.sendMessage as any).mock.calls.filter(
        (c: any[]) => c[0].includes('NOT in the DAG'),
      );
      expect(warningCalls).toHaveLength(0);
    });

    it('DOES emit warning when task genuinely is not in the DAG', () => {
      child = makeAgent({ dagTaskId: null });
      ctx = makeCtx({
        getAgent: vi.fn().mockImplementation((id: string) =>
          id === parent.id ? parent : id === child.id ? child : undefined,
        ),
        taskDAG: {
          getTaskByAgent: vi.fn().mockReturnValue(null),
          getTask: vi.fn().mockReturnValue(null),
          getStatus: vi.fn().mockReturnValue({ summary: { pending: 2, ready: 1, running: 0 } }),
        },
      });

      notifyParentOfIdle(ctx, child);

      const warningCalls = (parent.sendMessage as any).mock.calls.filter(
        (c: any[]) => c[0].includes('NOT in the DAG'),
      );
      expect(warningCalls).toHaveLength(1);
    });
  });
});

// ── Duplicate Agent Report suppression tests ──────────────────────────

describe('suppress duplicate Agent Report when COMPLETE_TASK already sent', () => {
  let parent: Agent;
  let child: Agent;
  let ctx: CommandHandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    parent = makeParent();
    child = makeAgent({ dagTaskId: 'task-1' });
    ctx = makeCtx({
      getAgent: vi.fn().mockImplementation((id: string) =>
        id === parent.id ? parent : id === child.id ? child : undefined,
      ),
      taskDAG: {
        getTaskByAgent: vi.fn().mockReturnValue(null),
        getTask: vi.fn().mockReturnValue({ id: 'task-1', dagStatus: 'done' }),
        getStatus: vi.fn().mockReturnValue({ summary: { pending: 0, ready: 0, running: 0 } }),
      },
    });
  });

  describe('notifyParentOfIdle', () => {
    it('suppresses "finished work" report when DAG task is already done', () => {
      notifyParentOfIdle(ctx, child);

      // Parent should NOT receive the "finished work" report
      const reportCalls = (parent.sendMessage as any).mock.calls.filter(
        (c: any[]) => c[0].includes('finished work'),
      );
      expect(reportCalls).toHaveLength(0);
      expect((parent.sendMessage as any)).not.toHaveBeenCalled();
    });

    it('still sends "finished work" report when DAG task is still running and no COMPLETE_TASK in output', () => {
      child = makeAgent({
        dagTaskId: 'task-1',
        getTaskOutput: vi.fn().mockReturnValue('some work output without commands'),
      });
      ctx = makeCtx({
        getAgent: vi.fn().mockImplementation((id: string) =>
          id === parent.id ? parent : id === child.id ? child : undefined,
        ),
        taskDAG: {
          getTaskByAgent: vi.fn().mockReturnValue(null),
          getTask: vi.fn().mockReturnValue({ id: 'task-1', dagStatus: 'running' }),
          getStatus: vi.fn().mockReturnValue({ summary: { pending: 0, ready: 0, running: 1 } }),
        },
      });

      notifyParentOfIdle(ctx, child);

      const reportCalls = (parent.sendMessage as any).mock.calls.filter(
        (c: any[]) => c[0].includes('finished work'),
      );
      expect(reportCalls).toHaveLength(1);
    });

    it('suppresses report when COMPLETE_TASK is in output buffer (same-turn race)', () => {
      // DAG task is still 'running' (COMPLETE_TASK hasn't been parsed yet),
      // but the raw output already contains the command
      child = makeAgent({
        dagTaskId: 'task-1',
        getTaskOutput: vi.fn().mockReturnValue('Done!\n⟦⟦ COMPLETE_TASK {"summary": "finished"} ⟧⟧'),
      });
      ctx = makeCtx({
        getAgent: vi.fn().mockImplementation((id: string) =>
          id === parent.id ? parent : id === child.id ? child : undefined,
        ),
        taskDAG: {
          getTaskByAgent: vi.fn().mockReturnValue(null),
          getTask: vi.fn().mockReturnValue({ id: 'task-1', dagStatus: 'running' }),
          getStatus: vi.fn().mockReturnValue({ summary: { pending: 0, ready: 0, running: 1 } }),
        },
      });

      notifyParentOfIdle(ctx, child);

      expect((parent.sendMessage as any)).not.toHaveBeenCalled();
    });

    it('suppresses report even after dedup key is cleared (multi-turn scenario)', () => {
      // Simulate: COMPLETE_TASK sets dedup key, then agent goes running
      // (which clears dedup), then goes idle again
      ctx.reportedCompletions.add(`${child.id}:idle`);
      // Clear dedup (as happens when agent goes running)
      ctx.reportedCompletions.delete(`${child.id}:idle`);

      // Now idle fires again — dedup key is gone, but DAG task is done
      notifyParentOfIdle(ctx, child);

      expect((parent.sendMessage as any)).not.toHaveBeenCalled();
    });

    it('sends report for agents without a DAG task (no dagTaskId)', () => {
      child = makeAgent({ dagTaskId: null });
      ctx = makeCtx({
        getAgent: vi.fn().mockImplementation((id: string) =>
          id === parent.id ? parent : id === child.id ? child : undefined,
        ),
        taskDAG: {
          getTaskByAgent: vi.fn().mockReturnValue(null),
          getTask: vi.fn().mockReturnValue(null),
          getStatus: vi.fn().mockReturnValue({ summary: { pending: 0, ready: 0, running: 0 } }),
        },
      });

      notifyParentOfIdle(ctx, child);

      const reportCalls = (parent.sendMessage as any).mock.calls.filter(
        (c: any[]) => c[0].includes('finished work'),
      );
      expect(reportCalls).toHaveLength(1);
    });
  });

  describe('notifyParentOfCompletion', () => {
    it('suppresses exit report when DAG task is done and exit is clean', () => {
      notifyParentOfCompletion(ctx, child, 0);

      // Parent should NOT receive the exit report
      const reportCalls = (parent.sendMessage as any).mock.calls.filter(
        (c: any[]) => c[0].includes('completed successfully') || c[0].includes('finished work'),
      );
      expect(reportCalls).toHaveLength(0);
    });

    it('still sends exit report when agent crashes (non-zero exit)', () => {
      notifyParentOfCompletion(ctx, child, 1);

      const reportCalls = (parent.sendMessage as any).mock.calls.filter(
        (c: any[]) => c[0].includes('failed'),
      );
      expect(reportCalls).toHaveLength(1);
    });

    it('marks delegations as completed even when suppressing exit report', () => {
      const delegation = {
        id: 'del-1',
        fromAgentId: parent.id,
        toAgentId: child.id,
        status: 'active',
        createdAt: new Date().toISOString(),
        completedAt: undefined as string | undefined,
        result: undefined as string | undefined,
      };
      ctx.delegations.set('del-1', delegation as any);

      notifyParentOfCompletion(ctx, child, 0);

      expect(delegation.status).toBe('completed');
      expect(delegation.completedAt).toBeDefined();
    });

    it('still sends report when DAG task is running (not yet completed)', () => {
      ctx = makeCtx({
        getAgent: vi.fn().mockImplementation((id: string) =>
          id === parent.id ? parent : id === child.id ? child : undefined,
        ),
        taskDAG: {
          getTaskByAgent: vi.fn().mockReturnValue(null),
          getTask: vi.fn().mockReturnValue({ id: 'task-1', dagStatus: 'running' }),
          getStatus: vi.fn().mockReturnValue({ summary: { pending: 0, ready: 0, running: 1 } }),
        },
      });

      notifyParentOfCompletion(ctx, child, 0);

      const reportCalls = (parent.sendMessage as any).mock.calls.filter(
        (c: any[]) => c[0].includes('completed successfully'),
      );
      expect(reportCalls).toHaveLength(1);
    });
  });
});
