import { describe, it, expect, vi } from 'vitest';
import { getTaskCommands } from '../agents/commands/TaskCommands.js';
import type { CommandHandlerContext } from '../agents/commands/types.js';

function makeLeadAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'lead-001',
    parentId: undefined,
    role: { id: 'lead', name: 'Project Lead' },
    sendMessage: vi.fn(),
    ...overrides,
  } as any;
}

function makeChildAgent(parentId: string, overrides: Record<string, any> = {}) {
  return {
    id: 'child-001',
    parentId,
    role: { id: 'developer', name: 'Developer' },
    dagTaskId: undefined,
    sendMessage: vi.fn(),
    ...overrides,
  } as any;
}

function makeCtx(overrides: Record<string, any> = {}): CommandHandlerContext {
  return {
    taskDAG: {
      declareTaskBatch: vi.fn().mockReturnValue({ tasks: [], conflicts: [] }),
      addTask: vi.fn(),
      getStatus: vi.fn().mockReturnValue({ tasks: [], fileLockMap: {}, summary: {} }),
      getTransitionError: vi.fn().mockReturnValue(null),
      completeTask: vi.fn().mockReturnValue([]),
      getTask: vi.fn().mockReturnValue(null),
    },
    getAgent: vi.fn(),
    getProjectIdForAgent: vi.fn().mockReturnValue('proj-1'),
    activityLedger: { log: vi.fn() },
    reportedCompletions: new Set(),
    delegations: new Map(),
    emit: vi.fn(),
    ...overrides,
  } as any;
}

function getDeclareHandler(ctx: CommandHandlerContext) {
  const cmds = getTaskCommands(ctx);
  const cmd = cmds.find(c => c.name === 'DECLARE_TASKS');
  if (!cmd) throw new Error('DECLARE_TASKS command not found');
  return cmd;
}

function getCompleteHandler(ctx: CommandHandlerContext) {
  const cmds = getTaskCommands(ctx);
  const cmd = cmds.find(c => c.name === 'COMPLETE_TASK');
  if (!cmd) throw new Error('COMPLETE_TASK command not found');
  return cmd;
}

describe('DECLARE_TASKS validation', () => {
  it('rejects task with missing taskId', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '⟦⟦ DECLARE_TASKS {"tasks": [{"role": "developer"}]} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "taskId"'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('rejects task with empty string taskId', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '⟦⟦ DECLARE_TASKS {"tasks": [{"taskId": "", "role": "developer"}]} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "taskId"'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('rejects task with whitespace-only taskId', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '⟦⟦ DECLARE_TASKS {"tasks": [{"taskId": "   ", "role": "developer"}]} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "taskId"'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('rejects task with taskId longer than 100 chars', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    const longId = 'x'.repeat(101);
    cmd.handler(agent, `⟦⟦ DECLARE_TASKS {"tasks": [{"taskId": "${longId}", "role": "developer"}]} ⟧⟧`);
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('taskId too long (max 100 chars)'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('rejects task with missing role', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '⟦⟦ DECLARE_TASKS {"tasks": [{"taskId": "task-1"}]} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "role"'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('rejects task with empty role', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '⟦⟦ DECLARE_TASKS {"tasks": [{"taskId": "task-1", "role": "  "}]} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "role"'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('reports correct path for second invalid task', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '⟦⟦ DECLARE_TASKS {"tasks": [{"taskId": "ok", "role": "dev"}, {"taskId": "bad"}]} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('tasks[1].role'),
    );
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "role"'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('passes valid tasks through to declareTaskBatch', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '⟦⟦ DECLARE_TASKS {"tasks": [{"taskId": "t1", "role": "developer"}]} ⟧⟧');
    expect(ctx.taskDAG.declareTaskBatch).toHaveBeenCalledWith(agent.id, [{ taskId: 't1', role: 'developer' }], 'proj-1');
  });
});

describe('COMPLETE_TASK from non-lead agents (DAG relay)', () => {
  it('relays completion to parent DAG via agent.dagTaskId', () => {
    const parent = makeLeadAgent({ id: 'lead-001' });
    const ctx = makeCtx({
      getAgent: vi.fn().mockReturnValue(parent),
    });
    const agent = makeChildAgent('lead-001', { dagTaskId: 'impl-auth' });
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '⟦⟦ COMPLETE_TASK {"summary": "Auth module implemented"} ⟧⟧');

    expect(ctx.taskDAG.getTransitionError).toHaveBeenCalledWith('lead-001', 'impl-auth', 'complete');
    expect(ctx.taskDAG.completeTask).toHaveBeenCalledWith('lead-001', 'impl-auth');
    expect(parent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('completed DAG task "impl-auth"'));
    expect(parent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Auth module implemented'));
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('marked as done in DAG'));
    expect(ctx.emit).toHaveBeenCalledWith('dag:updated', { leadId: 'lead-001' });
  });

  it('uses explicit taskId from payload over agent.dagTaskId', () => {
    const parent = makeLeadAgent({ id: 'lead-001' });
    const ctx = makeCtx({
      getAgent: vi.fn().mockReturnValue(parent),
    });
    const agent = makeChildAgent('lead-001', { dagTaskId: 'old-task' });
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '⟦⟦ COMPLETE_TASK {"taskId": "explicit-task", "summary": "Done"} ⟧⟧');

    expect(ctx.taskDAG.getTransitionError).toHaveBeenCalledWith('lead-001', 'explicit-task', 'complete');
    expect(ctx.taskDAG.completeTask).toHaveBeenCalledWith('lead-001', 'explicit-task');
  });

  it('includes status field in parent notification', () => {
    const parent = makeLeadAgent({ id: 'lead-001' });
    const ctx = makeCtx({
      getAgent: vi.fn().mockReturnValue(parent),
    });
    const agent = makeChildAgent('lead-001', { dagTaskId: 'task-1' });
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '⟦⟦ COMPLETE_TASK {"status": "done", "output": "All tests pass"} ⟧⟧');

    expect(parent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Status: done'));
    expect(parent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('All tests pass'));
  });

  it('reports newly ready tasks after DAG completion', () => {
    const parent = makeLeadAgent({ id: 'lead-001' });
    const ctx = makeCtx({
      getAgent: vi.fn().mockReturnValue(parent),
      getAllAgents: vi.fn().mockReturnValue([]),
      taskDAG: {
        ...makeCtx().taskDAG,
        getTransitionError: vi.fn().mockReturnValue(null),
        completeTask: vi.fn().mockReturnValue([{ id: 'deploy-task', role: 'developer' }, { id: 'review-task', role: 'reviewer' }]),
      },
    });
    const agent = makeChildAgent('lead-001', { dagTaskId: 'build-task' });
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '⟦⟦ COMPLETE_TASK {"summary": "Build done"} ⟧⟧');

    expect(parent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Newly ready tasks: deploy-task, review-task'));
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('2 task(s) now ready'));
  });

  it('falls back to message-only when no dagTaskId', () => {
    const parent = makeLeadAgent({ id: 'lead-001' });
    const ctx = makeCtx({
      getAgent: vi.fn().mockReturnValue(parent),
    });
    const agent = makeChildAgent('lead-001');
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '⟦⟦ COMPLETE_TASK {"summary": "Done with work"} ⟧⟧');

    expect(ctx.taskDAG.completeTask).not.toHaveBeenCalled();
    expect(parent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('completed task'));
    expect(parent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Done with work'));
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('No DAG task ID'));
  });

  it('fails gracefully when no parent agent found', () => {
    const agent = makeChildAgent(undefined as any);
    agent.parentId = undefined;
    const ctx = makeCtx();
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '⟦⟦ COMPLETE_TASK {"summary": "Done"} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('no parent agent found'));
    expect(ctx.taskDAG.completeTask).not.toHaveBeenCalled();
  });

  it('handles DAG transition error gracefully', () => {
    const parent = makeLeadAgent({ id: 'lead-001' });
    const ctx = makeCtx({
      getAgent: vi.fn().mockReturnValue(parent),
      taskDAG: {
        ...makeCtx().taskDAG,
        getTransitionError: vi.fn().mockReturnValue({ currentStatus: 'done', attemptedAction: 'complete', validStatuses: ['running', 'ready'] }),
        completeTask: vi.fn(),
      },
    });
    const agent = makeChildAgent('lead-001', { dagTaskId: 'already-done' });
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '⟦⟦ COMPLETE_TASK {"summary": "Done again"} ⟧⟧');

    expect(ctx.taskDAG.completeTask).not.toHaveBeenCalled();
    // Fix 2: "already done" gets a friendly message instead of an error
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('already done'));
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('No action needed'));
  });

  it('emits agent:message_sent event on successful relay', () => {
    const parent = makeLeadAgent({ id: 'lead-001' });
    const ctx = makeCtx({
      getAgent: vi.fn().mockReturnValue(parent),
    });
    const agent = makeChildAgent('lead-001', { dagTaskId: 'task-1' });
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '⟦⟦ COMPLETE_TASK {"summary": "Implemented feature"} ⟧⟧');

    expect(ctx.emit).toHaveBeenCalledWith('agent:message_sent', {
      from: agent.id,
      fromRole: 'Developer',
      to: parent.id,
      toRole: 'Project Lead',
      content: expect.stringContaining('COMPLETE_TASK [task-1]'),
    });
  });

  it('defaults status to done and summary to (no summary)', () => {
    const parent = makeLeadAgent({ id: 'lead-001' });
    const ctx = makeCtx({
      getAgent: vi.fn().mockReturnValue(parent),
    });
    const agent = makeChildAgent('lead-001', { dagTaskId: 'task-1' });
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '⟦⟦ COMPLETE_TASK {} ⟧⟧');

    expect(parent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Status: done'));
    expect(parent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('(no summary)'));
  });
});

describe('COMPLETE_TASK from lead agent', () => {
  it('completes DAG task by id', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '⟦⟦ COMPLETE_TASK {"taskId": "task-1"} ⟧⟧');

    expect(ctx.taskDAG.getTransitionError).toHaveBeenCalledWith(agent.id, 'task-1', 'complete');
    expect(ctx.taskDAG.completeTask).toHaveBeenCalledWith(agent.id, 'task-1');
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('marked as done'));
  });

  it('requires taskId field for lead agents', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '⟦⟦ COMPLETE_TASK {} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('requires a "taskId" field'));
    expect(ctx.taskDAG.completeTask).not.toHaveBeenCalled();
  });

  it('reports transition error for lead', () => {
    const ctx = makeCtx({
      taskDAG: {
        ...makeCtx().taskDAG,
        getTransitionError: vi.fn().mockReturnValue({ currentStatus: 'pending', taskId: 'task-1', attemptedAction: 'complete', validStatuses: ['running', 'ready'] }),
        completeTask: vi.fn(),
      },
    });
    const agent = makeLeadAgent();
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '⟦⟦ COMPLETE_TASK {"taskId": "task-1"} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Cannot complete task'));
    expect(ctx.taskDAG.completeTask).not.toHaveBeenCalled();
  });

  it('accepts output field as summary alias for lead', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '⟦⟦ COMPLETE_TASK {"taskId": "task-1", "output": "Build successful"} ⟧⟧');

    expect(ctx.taskDAG.completeTask).toHaveBeenCalledWith(agent.id, 'task-1');
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Build successful'));
  });
});

describe('COMPLETE_TASK edge cases', () => {
  it('completes DAG task even when parent is terminated (getAgent returns undefined)', () => {
    const ctx = makeCtx({
      getAgent: vi.fn().mockReturnValue(undefined),
    });
    const agent = makeChildAgent('lead-001', { dagTaskId: 'task-1' });
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '⟦⟦ COMPLETE_TASK {"summary": "Done"} ⟧⟧');

    // DAG task should still be completed even though parent is gone
    expect(ctx.taskDAG.completeTask).toHaveBeenCalledWith('lead-001', 'task-1');
    expect(ctx.emit).toHaveBeenCalledWith('dag:updated', { leadId: 'lead-001' });
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('marked as done in DAG'));
  });

  it('skips parent notification when parent is terminated but still emits events', () => {
    const ctx = makeCtx({
      getAgent: vi.fn().mockReturnValue(undefined),
    });
    const agent = makeChildAgent('lead-001', { dagTaskId: 'task-1' });
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '⟦⟦ COMPLETE_TASK {"summary": "Done"} ⟧⟧');

    // agent:message_sent should NOT be emitted since parent doesn't exist
    expect(ctx.emit).not.toHaveBeenCalledWith('agent:message_sent', expect.anything());
    // But dag:updated should still fire
    expect(ctx.emit).toHaveBeenCalledWith('dag:updated', { leadId: 'lead-001' });
  });
});

describe('COMPLETE_TASK security', () => {
  it('denies completion when explicit id belongs to another agent', () => {
    const ctx = makeCtx({
      taskDAG: {
        ...makeCtx().taskDAG,
        getTask: vi.fn().mockReturnValue({ id: 'task-x', assignedAgentId: 'other-agent-999', dagStatus: 'running' }),
        getTransitionError: vi.fn().mockReturnValue(null),
        completeTask: vi.fn(),
      },
    });
    const agent = makeChildAgent('lead-001', { dagTaskId: 'my-task' });
    const handler = getCompleteHandler(ctx);
    handler.handler(agent, '⟦⟦ COMPLETE_TASK {"taskId": "task-x", "summary": "done"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('denied'));
    expect(ctx.taskDAG.completeTask).not.toHaveBeenCalled();
  });

  it('allows completion when explicit id matches calling agent', () => {
    const ctx = makeCtx({
      taskDAG: {
        ...makeCtx().taskDAG,
        getTask: vi.fn().mockReturnValue({ id: 'task-x', assignedAgentId: 'child-001', dagStatus: 'running' }),
        getTransitionError: vi.fn().mockReturnValue(null),
        completeTask: vi.fn().mockReturnValue([]),
      },
      getAgent: vi.fn().mockReturnValue(makeLeadAgent()),
    });
    const agent = makeChildAgent('lead-001', { dagTaskId: 'my-task' });
    const handler = getCompleteHandler(ctx);
    handler.handler(agent, '⟦⟦ COMPLETE_TASK {"taskId": "task-x", "summary": "done"} ⟧⟧');
    expect(ctx.taskDAG.completeTask).toHaveBeenCalledWith('lead-001', 'task-x');
  });

  it('denies completion when task is unassigned (no assignedAgentId)', () => {
    const ctx = makeCtx({
      taskDAG: {
        ...makeCtx().taskDAG,
        getTask: vi.fn().mockReturnValue({ id: 'task-x', assignedAgentId: undefined, dagStatus: 'running' }),
        getTransitionError: vi.fn().mockReturnValue(null),
        completeTask: vi.fn().mockReturnValue([]),
      },
      getAgent: vi.fn().mockReturnValue(makeLeadAgent()),
    });
    const agent = makeChildAgent('lead-001', { dagTaskId: 'my-task' });
    const handler = getCompleteHandler(ctx);
    handler.handler(agent, '⟦⟦ COMPLETE_TASK {"taskId": "task-x", "summary": "done"} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('denied'));
    expect(ctx.taskDAG.completeTask).not.toHaveBeenCalled();
  });

  it('skips auth check when using own dagTaskId (not explicit id)', () => {
    const ctx = makeCtx({
      taskDAG: {
        ...makeCtx().taskDAG,
        getTask: vi.fn(),
        getTransitionError: vi.fn().mockReturnValue(null),
        completeTask: vi.fn().mockReturnValue([]),
      },
      getAgent: vi.fn().mockReturnValue(makeLeadAgent()),
    });
    const agent = makeChildAgent('lead-001', { dagTaskId: 'my-task' });
    const handler = getCompleteHandler(ctx);
    handler.handler(agent, '⟦⟦ COMPLETE_TASK {"summary": "done"} ⟧⟧');
    expect(ctx.taskDAG.getTask).not.toHaveBeenCalled();
    expect(ctx.taskDAG.completeTask).toHaveBeenCalledWith('lead-001', 'my-task');
  });

  it('truncates oversized summary and output fields', () => {
    const longText = 'x'.repeat(20_000);
    const ctx = makeCtx({
      taskDAG: {
        ...makeCtx().taskDAG,
        getTransitionError: vi.fn().mockReturnValue(null),
        completeTask: vi.fn().mockReturnValue([]),
      },
      getAgent: vi.fn().mockReturnValue(makeLeadAgent()),
    });
    const agent = makeChildAgent('lead-001', { dagTaskId: 'task-1' });
    const handler = getCompleteHandler(ctx);
    handler.handler(agent, `⟦⟦ COMPLETE_TASK {"summary": "${longText}"} ⟧⟧`);

    const parentAgent = ctx.getAgent('lead-001') as any;
    const parentMsg = parentAgent.sendMessage.mock.calls[0][0];
    // Summary in the message should be truncated to 10K
    expect(parentMsg.length).toBeLessThan(15_000);
  });
});

// ── ADD_DEPENDENCY tests ────────────────────────────────────────────

describe('ADD_DEPENDENCY command', () => {
  function getAddDependencyHandler(ctx: CommandHandlerContext) {
    const commands = getTaskCommands(ctx);
    return commands.find(c => c.name === 'ADD_DEPENDENCY')!;
  }

  it('adds dependency via lead agent', () => {
    const ctx = makeCtx({
      taskDAG: {
        ...makeCtx().taskDAG,
        addDependency: vi.fn().mockReturnValue(true),
      },
    });
    const agent = makeLeadAgent();
    const handler = getAddDependencyHandler(ctx);

    handler.handler(agent, '⟦⟦ ADD_DEPENDENCY {"taskId": "task-a", "dependsOn": ["task-b"]} ⟧⟧');

    expect(ctx.taskDAG.addDependency).toHaveBeenCalledWith('lead-001', 'task-a', 'task-b');
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('✓'));
  });

  it('adds dependency via non-lead agent assigned to the task', () => {
    const ctx = makeCtx({
      taskDAG: {
        ...makeCtx().taskDAG,
        getTask: vi.fn().mockReturnValue({ id: 'task-a', assignedAgentId: 'child-001', dagStatus: 'running' }),
        addDependency: vi.fn().mockReturnValue(true),
      },
    });
    const agent = makeChildAgent('lead-001');
    const handler = getAddDependencyHandler(ctx);

    handler.handler(agent, '⟦⟦ ADD_DEPENDENCY {"taskId": "task-a", "dependsOn": ["task-b"]} ⟧⟧');

    expect(ctx.taskDAG.addDependency).toHaveBeenCalledWith('lead-001', 'task-a', 'task-b');
  });

  it('denies non-lead agent adding dependency to unassigned task', () => {
    const ctx = makeCtx({
      taskDAG: {
        ...makeCtx().taskDAG,
        getTask: vi.fn().mockReturnValue({ id: 'task-a', assignedAgentId: 'other-agent', dagStatus: 'running' }),
        addDependency: vi.fn(),
      },
    });
    const agent = makeChildAgent('lead-001');
    const handler = getAddDependencyHandler(ctx);

    handler.handler(agent, '⟦⟦ ADD_DEPENDENCY {"taskId": "task-a", "dependsOn": ["task-b"]} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('denied'));
    expect(ctx.taskDAG.addDependency).not.toHaveBeenCalled();
  });

  it('adds multiple dependencies at once', () => {
    const ctx = makeCtx({
      taskDAG: {
        ...makeCtx().taskDAG,
        addDependency: vi.fn().mockReturnValue(true),
      },
    });
    const agent = makeLeadAgent();
    const handler = getAddDependencyHandler(ctx);

    handler.handler(agent, '⟦⟦ ADD_DEPENDENCY {"taskId": "task-a", "dependsOn": ["task-b", "task-c"]} ⟧⟧');

    expect(ctx.taskDAG.addDependency).toHaveBeenCalledTimes(2);
    expect(ctx.taskDAG.addDependency).toHaveBeenCalledWith('lead-001', 'task-a', 'task-b');
    expect(ctx.taskDAG.addDependency).toHaveBeenCalledWith('lead-001', 'task-a', 'task-c');
  });

  it('reports skipped when addDependency returns false (cycle/dup)', () => {
    const ctx = makeCtx({
      taskDAG: {
        ...makeCtx().taskDAG,
        addDependency: vi.fn().mockReturnValue(false),
      },
    });
    const agent = makeLeadAgent();
    const handler = getAddDependencyHandler(ctx);

    handler.handler(agent, '⟦⟦ ADD_DEPENDENCY {"taskId": "task-a", "dependsOn": ["task-b"]} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('skipped'));
  });

  it('emits dag:updated after adding dependency', () => {
    const ctx = makeCtx({
      taskDAG: {
        ...makeCtx().taskDAG,
        addDependency: vi.fn().mockReturnValue(true),
      },
    });
    const agent = makeLeadAgent();
    const handler = getAddDependencyHandler(ctx);

    handler.handler(agent, '⟦⟦ ADD_DEPENDENCY {"taskId": "task-a", "dependsOn": ["task-b"]} ⟧⟧');

    expect(ctx.emit).toHaveBeenCalledWith('dag:updated', { leadId: 'lead-001' });
  });

  it('rejects invalid payload (missing taskId)', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const handler = getAddDependencyHandler(ctx);

    handler.handler(agent, '⟦⟦ ADD_DEPENDENCY {"dependsOn": ["task-b"]} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('error'));
  });

  it('rejects invalid payload (empty dependsOn)', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const handler = getAddDependencyHandler(ctx);

    handler.handler(agent, '⟦⟦ ADD_DEPENDENCY {"taskId": "task-a", "dependsOn": []} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('error'));
  });

  it('rejects agent with no parentId and no lead role', () => {
    const ctx = makeCtx();
    const agent = {
      id: 'orphan-001',
      parentId: undefined,
      role: { id: 'developer', name: 'Developer' },
      sendMessage: vi.fn(),
    } as any;
    const handler = getAddDependencyHandler(ctx);

    handler.handler(agent, '⟦⟦ ADD_DEPENDENCY {"taskId": "task-a", "dependsOn": ["task-b"]} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('cannot determine lead'));
  });
});

// ── REASSIGN_TASK tests ──────────────────────────────────────────────

function getReassignHandler(ctx: CommandHandlerContext) {
  const cmds = getTaskCommands(ctx);
  const cmd = cmds.find(c => c.name === 'REASSIGN_TASK');
  if (!cmd) throw new Error('REASSIGN_TASK command not found');
  return cmd;
}

describe('REASSIGN_TASK', () => {
  it('reassigns a running task to a new agent', () => {
    const oldAgent = makeChildAgent('lead-001', { id: 'old-agent-001' });
    const newAgent = makeChildAgent('lead-001', { id: 'new-agent-001' });
    const ctx = makeCtx({
      taskDAG: {
        reassignTask: vi.fn().mockReturnValue({ oldAgentId: 'old-agent-001' }),
        getTask: vi.fn()
          .mockReturnValueOnce({ id: 'task-1', description: 'Fix the bug', dagStatus: 'running', assignedAgentId: 'old-agent-001' })
          .mockReturnValue({ id: 'task-1', description: 'Fix the bug', dagStatus: 'running', assignedAgentId: 'new-agent-001' }),
      },
      getAgent: vi.fn().mockImplementation((id: string) => id === 'old-agent-001' ? oldAgent : undefined),
      getAllAgents: vi.fn().mockReturnValue([oldAgent, newAgent]),
      lockRegistry: { releaseAll: vi.fn() },
      delegations: new Map(),
    });
    const agent = makeLeadAgent();
    const handler = getReassignHandler(ctx);

    handler.handler(agent, '⟦⟦ REASSIGN_TASK {"taskId": "task-1", "agentId": "new-agent-001"} ⟧⟧');

    expect(ctx.taskDAG.reassignTask).toHaveBeenCalledWith('lead-001', 'task-1', 'new-agent-001');
    expect(oldAgent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('reassigned'));
    expect(newAgent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Fix the bug'));
    expect(newAgent.dagTaskId).toBe('task-1');
    expect(ctx.lockRegistry.releaseAll).toHaveBeenCalledWith('old-agent-001');
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('reassigned'));
  });

  it('rejects non-lead agents', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent({ role: { id: 'developer', name: 'Developer' } });
    const handler = getReassignHandler(ctx);

    handler.handler(agent, '⟦⟦ REASSIGN_TASK {"taskId": "task-1", "agentId": "agent-2"} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Only the Project Lead'));
  });

  it('rejects when new agent not found', () => {
    const ctx = makeCtx({
      getAllAgents: vi.fn().mockReturnValue([]),
    });
    const agent = makeLeadAgent();
    const handler = getReassignHandler(ctx);

    handler.handler(agent, '⟦⟦ REASSIGN_TASK {"taskId": "task-1", "agentId": "nonexistent"} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Agent not found'));
  });

  it('rejects when task is not running', () => {
    const newAgent = makeChildAgent('lead-001', { id: 'new-agent-001' });
    const ctx = makeCtx({
      taskDAG: {
        reassignTask: vi.fn().mockReturnValue(null),
        getTask: vi.fn().mockReturnValue({ id: 'task-1', dagStatus: 'pending' }),
      },
      getAllAgents: vi.fn().mockReturnValue([newAgent]),
    });
    const agent = makeLeadAgent();
    const handler = getReassignHandler(ctx);

    handler.handler(agent, '⟦⟦ REASSIGN_TASK {"taskId": "task-1", "agentId": "new-agent-001"} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Cannot reassign'));
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('pending'));
  });

  it('cancels old delegation when reassigning', () => {
    const oldAgent = makeChildAgent('lead-001', { id: 'old-agent-001' });
    const newAgent = makeChildAgent('lead-001', { id: 'new-agent-001' });
    const oldDelegation = {
      id: 'del-1',
      fromAgentId: 'lead-001',
      toAgentId: 'old-agent-001',
      toRole: 'developer',
      task: 'Fix the bug',
      status: 'active' as const,
      createdAt: new Date().toISOString(),
      completedAt: undefined as string | undefined,
    };
    const delegations = new Map([['del-1', oldDelegation]]);
    const ctx = makeCtx({
      taskDAG: {
        reassignTask: vi.fn().mockReturnValue({ oldAgentId: 'old-agent-001' }),
        getTask: vi.fn().mockReturnValue({ id: 'task-1', description: 'Fix the bug', dagStatus: 'running', assignedAgentId: 'old-agent-001' }),
      },
      getAgent: vi.fn().mockImplementation((id: string) => id === 'old-agent-001' ? oldAgent : undefined),
      getAllAgents: vi.fn().mockReturnValue([oldAgent, newAgent]),
      lockRegistry: { releaseAll: vi.fn() },
      delegations,
    });
    const agent = makeLeadAgent();
    const handler = getReassignHandler(ctx);

    handler.handler(agent, '⟦⟦ REASSIGN_TASK {"taskId": "task-1", "agentId": "new-agent-001"} ⟧⟧');

    expect(oldDelegation.status).toBe('cancelled');
    expect(oldDelegation.completedAt).toBeDefined();
    // New delegation should be created
    expect(delegations.size).toBe(2);
  });

  it('supports short agent ID prefix matching', () => {
    const newAgent = makeChildAgent('lead-001', { id: 'new-agent-full-uuid' });
    const ctx = makeCtx({
      taskDAG: {
        reassignTask: vi.fn().mockReturnValue({ oldAgentId: 'old-agent-001' }),
        getTask: vi.fn().mockReturnValue({ id: 'task-1', description: 'Fix bug', dagStatus: 'running', assignedAgentId: 'old-agent-001' }),
      },
      getAgent: vi.fn().mockReturnValue(undefined),
      getAllAgents: vi.fn().mockReturnValue([newAgent]),
      lockRegistry: { releaseAll: vi.fn() },
      delegations: new Map(),
    });
    const agent = makeLeadAgent();
    const handler = getReassignHandler(ctx);

    handler.handler(agent, '⟦⟦ REASSIGN_TASK {"taskId": "task-1", "agentId": "new-agent"} ⟧⟧');

    // Should resolve short ID to full agent
    expect(ctx.taskDAG.reassignTask).toHaveBeenCalledWith('lead-001', 'task-1', 'new-agent-full-uuid');
  });

  it('rejects ambiguous agent ID prefix', () => {
    const agentA = makeChildAgent('lead-001', { id: 'agent-alpha-001' });
    const agentB = makeChildAgent('lead-001', { id: 'agent-beta-002' });
    const ctx = makeCtx({
      taskDAG: {
        reassignTask: vi.fn(),
        getTask: vi.fn(),
      },
      getAllAgents: vi.fn().mockReturnValue([agentA, agentB]),
    });
    const agent = makeLeadAgent();
    const handler = getReassignHandler(ctx);

    handler.handler(agent, '\u27E6\u27E6 REASSIGN_TASK {"taskId": "task-1", "agentId": "agent"} \u27E7\u27E7');

    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Ambiguous agent ID'));
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('2 agents'));
    expect(ctx.taskDAG.reassignTask).not.toHaveBeenCalled();
  });

  it('prevents self-reassignment to same agent', () => {
    const currentAgent = makeChildAgent('lead-001', { id: 'current-agent-001' });
    const ctx = makeCtx({
      taskDAG: {
        reassignTask: vi.fn(),
        getTask: vi.fn().mockReturnValue({ id: 'task-1', description: 'Fix bug', dagStatus: 'running', assignedAgentId: 'current-agent-001' }),
      },
      getAllAgents: vi.fn().mockReturnValue([currentAgent]),
    });
    const agent = makeLeadAgent();
    const handler = getReassignHandler(ctx);

    handler.handler(agent, '\u27E6\u27E6 REASSIGN_TASK {"taskId": "task-1", "agentId": "current-agent-001"} \u27E7\u27E7');

    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('already assigned'));
    expect(ctx.taskDAG.reassignTask).not.toHaveBeenCalled();
  });

  it('only cancels task-specific delegation, not other delegations', () => {
    const oldAgent = makeChildAgent('lead-001', { id: 'old-agent-001' });
    const newAgent = makeChildAgent('lead-001', { id: 'new-agent-001' });
    const taskDelegation = {
      id: 'del-task', fromAgentId: 'lead-001', toAgentId: 'old-agent-001',
      toRole: 'developer', task: 'Fix the bug', status: 'active' as const, createdAt: new Date().toISOString(),
    };
    const otherDelegation = {
      id: 'del-other', fromAgentId: 'lead-001', toAgentId: 'old-agent-001',
      toRole: 'developer', task: 'Write docs', status: 'active' as const, createdAt: new Date().toISOString(),
    };
    const delegations = new Map([['del-task', taskDelegation], ['del-other', otherDelegation]]);
    const ctx = makeCtx({
      taskDAG: {
        reassignTask: vi.fn().mockReturnValue({ oldAgentId: 'old-agent-001' }),
        getTask: vi.fn().mockReturnValue({ id: 'task-1', description: 'Fix the bug', dagStatus: 'running', assignedAgentId: 'old-agent-001' }),
      },
      getAgent: vi.fn().mockImplementation((id: string) => id === 'old-agent-001' ? oldAgent : undefined),
      getAllAgents: vi.fn().mockReturnValue([oldAgent, newAgent]),
      lockRegistry: { releaseAll: vi.fn() },
      delegations,
    });
    const agent = makeLeadAgent();
    const handler = getReassignHandler(ctx);

    handler.handler(agent, '\u27E6\u27E6 REASSIGN_TASK {"taskId": "task-1", "agentId": "new-agent-001"} \u27E7\u27E7');

    // Task-specific delegation should be cancelled
    expect(taskDelegation.status).toBe('cancelled');
    // Other delegation should remain active
    expect(otherDelegation.status).toBe('active');
  });
});

describe('Already-done task returns friendly message', () => {
  it('lead gets friendly message when completing an already-done task', () => {
    const ctx = makeCtx({
      taskDAG: {
        ...makeCtx().taskDAG,
        getTransitionError: vi.fn().mockReturnValue({ currentStatus: 'done', attemptedAction: 'complete', validStatuses: ['running', 'ready'] }),
      },
    });
    const agent = makeLeadAgent();
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '⟦⟦ COMPLETE_TASK {"taskId": "task-1"} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('already done'));
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('No action needed'));
    expect(ctx.taskDAG.completeTask).not.toHaveBeenCalled();
  });

  it('lead still gets error for truly invalid transition (e.g. pending)', () => {
    const ctx = makeCtx({
      taskDAG: {
        ...makeCtx().taskDAG,
        getTransitionError: vi.fn().mockReturnValue({ taskId: 'task-1', currentStatus: 'pending', attemptedAction: 'complete', validStatuses: ['running', 'ready'] }),
      },
    });
    const agent = makeLeadAgent();
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '⟦⟦ COMPLETE_TASK {"taskId": "task-1"} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Cannot complete'));
    expect(agent.sendMessage).not.toHaveBeenCalledWith(expect.stringContaining('already done'));
  });
});

describe('TASK_STATUS includes DAG coverage metric', () => {
  it('includes coverage metric when active agents exist', () => {
    const ctx = makeCtx({
      getAllAgents: vi.fn().mockReturnValue([
        { id: 'agent-1', parentId: 'lead-001', status: 'running', role: { id: 'developer', name: 'Developer' } },
        { id: 'agent-2', parentId: 'lead-001', status: 'idle', role: { id: 'reviewer', name: 'Reviewer' } },
      ]),
      taskDAG: {
        ...makeCtx().taskDAG,
        getStatus: vi.fn().mockReturnValue({
          tasks: [{ id: 'task-1', role: 'developer', dagStatus: 'running', assignedAgentId: 'agent-1', description: 'Build API', dependsOn: [], files: [] }],
          fileLockMap: {},
          summary: { pending: 0, ready: 0, running: 1, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 },
          coverage: { tracked: 1, untracked: 1, total: 2, percentage: 50, untrackedAgents: [{ id: 'agent-2', role: 'reviewer' }] },
        }),
      },
    });
    const agent = makeLeadAgent();
    const cmds = getTaskCommands(ctx);
    const cmd = cmds.find(c => c.name === 'TASK_STATUS')!;

    cmd.handler(agent, '⟦⟦ TASK_STATUS ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('DAG Coverage: 50%'));
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Untracked agents'));
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('reviewer'));
  });
});
