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
  it('rejects task with missing id', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '⟦⟦ DECLARE_TASKS {"tasks": [{"role": "developer"}]} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "id"'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('rejects task with empty string id', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '⟦⟦ DECLARE_TASKS {"tasks": [{"id": "", "role": "developer"}]} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "id"'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('rejects task with whitespace-only id', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '⟦⟦ DECLARE_TASKS {"tasks": [{"id": "   ", "role": "developer"}]} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "id"'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('rejects task with id longer than 100 chars', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    const longId = 'x'.repeat(101);
    cmd.handler(agent, `⟦⟦ DECLARE_TASKS {"tasks": [{"id": "${longId}", "role": "developer"}]} ⟧⟧`);
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('id too long (max 100 chars)'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('rejects task with missing role', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '⟦⟦ DECLARE_TASKS {"tasks": [{"id": "task-1"}]} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "role"'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('rejects task with empty role', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '⟦⟦ DECLARE_TASKS {"tasks": [{"id": "task-1", "role": "  "}]} ⟧⟧');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "role"'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('reports correct path for second invalid task', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '⟦⟦ DECLARE_TASKS {"tasks": [{"id": "ok", "role": "dev"}, {"id": "bad"}]} ⟧⟧');
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
    cmd.handler(agent, '⟦⟦ DECLARE_TASKS {"tasks": [{"id": "t1", "role": "developer"}]} ⟧⟧');
    expect(ctx.taskDAG.declareTaskBatch).toHaveBeenCalledWith(agent.id, [{ id: 't1', role: 'developer' }]);
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

  it('uses explicit id from payload over agent.dagTaskId', () => {
    const parent = makeLeadAgent({ id: 'lead-001' });
    const ctx = makeCtx({
      getAgent: vi.fn().mockReturnValue(parent),
    });
    const agent = makeChildAgent('lead-001', { dagTaskId: 'old-task' });
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '⟦⟦ COMPLETE_TASK {"id": "explicit-task", "summary": "Done"} ⟧⟧');

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
      taskDAG: {
        ...makeCtx().taskDAG,
        getTransitionError: vi.fn().mockReturnValue(null),
        completeTask: vi.fn().mockReturnValue([{ id: 'deploy-task' }, { id: 'review-task' }]),
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
    expect(parent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('completed task "already-done"'));
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('could not be marked done in DAG'));
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

    cmd.handler(agent, '⟦⟦ COMPLETE_TASK {"id": "task-1"} ⟧⟧');

    expect(ctx.taskDAG.getTransitionError).toHaveBeenCalledWith(agent.id, 'task-1', 'complete');
    expect(ctx.taskDAG.completeTask).toHaveBeenCalledWith(agent.id, 'task-1');
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('marked as done'));
  });

  it('requires id field for lead agents', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '⟦⟦ COMPLETE_TASK {} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('requires an "id" field'));
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

    cmd.handler(agent, '⟦⟦ COMPLETE_TASK {"id": "task-1"} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Cannot complete task'));
    expect(ctx.taskDAG.completeTask).not.toHaveBeenCalled();
  });

  it('accepts output field as summary alias for lead', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '⟦⟦ COMPLETE_TASK {"id": "task-1", "output": "Build successful"} ⟧⟧');

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
    handler.handler(agent, '⟦⟦ COMPLETE_TASK {"id": "task-x", "summary": "done"} ⟧⟧');
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
    handler.handler(agent, '⟦⟦ COMPLETE_TASK {"id": "task-x", "summary": "done"} ⟧⟧');
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
    handler.handler(agent, '⟦⟦ COMPLETE_TASK {"id": "task-x", "summary": "done"} ⟧⟧');
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

    handler.handler(agent, '⟦⟦ ADD_DEPENDENCY {"taskId": "task-a", "depends_on": ["task-b"]} ⟧⟧');

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

    handler.handler(agent, '⟦⟦ ADD_DEPENDENCY {"taskId": "task-a", "depends_on": ["task-b"]} ⟧⟧');

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

    handler.handler(agent, '⟦⟦ ADD_DEPENDENCY {"taskId": "task-a", "depends_on": ["task-b"]} ⟧⟧');

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

    handler.handler(agent, '⟦⟦ ADD_DEPENDENCY {"taskId": "task-a", "depends_on": ["task-b", "task-c"]} ⟧⟧');

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

    handler.handler(agent, '⟦⟦ ADD_DEPENDENCY {"taskId": "task-a", "depends_on": ["task-b"]} ⟧⟧');

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

    handler.handler(agent, '⟦⟦ ADD_DEPENDENCY {"taskId": "task-a", "depends_on": ["task-b"]} ⟧⟧');

    expect(ctx.emit).toHaveBeenCalledWith('dag:updated', { leadId: 'lead-001' });
  });

  it('rejects invalid payload (missing taskId)', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const handler = getAddDependencyHandler(ctx);

    handler.handler(agent, '⟦⟦ ADD_DEPENDENCY {"depends_on": ["task-b"]} ⟧⟧');

    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('error'));
  });

  it('rejects invalid payload (empty depends_on)', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const handler = getAddDependencyHandler(ctx);

    handler.handler(agent, '⟦⟦ ADD_DEPENDENCY {"taskId": "task-a", "depends_on": []} ⟧⟧');

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

    handler.handler(agent, '⟦⟦ ADD_DEPENDENCY {"taskId": "task-a", "depends_on": ["task-b"]} ⟧⟧');

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
        getTask: vi.fn().mockReturnValue({ id: 'task-1', description: 'Fix the bug', dagStatus: 'running', assignedAgentId: 'new-agent-001' }),
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
    };
    const delegations = new Map([['del-1', oldDelegation]]);
    const ctx = makeCtx({
      taskDAG: {
        reassignTask: vi.fn().mockReturnValue({ oldAgentId: 'old-agent-001' }),
        getTask: vi.fn().mockReturnValue({ id: 'task-1', description: 'Fix the bug', dagStatus: 'running' }),
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
        getTask: vi.fn().mockReturnValue({ id: 'task-1', description: 'Fix bug', dagStatus: 'running' }),
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
});
