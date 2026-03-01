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
    cmd.handler(agent, '[[[ DECLARE_TASKS {"tasks": [{"role": "developer"}]} ]]]');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "id"'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('rejects task with empty string id', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '[[[ DECLARE_TASKS {"tasks": [{"id": "", "role": "developer"}]} ]]]');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "id"'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('rejects task with whitespace-only id', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '[[[ DECLARE_TASKS {"tasks": [{"id": "   ", "role": "developer"}]} ]]]');
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
    cmd.handler(agent, `[[[ DECLARE_TASKS {"tasks": [{"id": "${longId}", "role": "developer"}]} ]]]`);
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('id too long (max 100 chars)'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('rejects task with missing role', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '[[[ DECLARE_TASKS {"tasks": [{"id": "task-1"}]} ]]]');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "role"'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('rejects task with empty role', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '[[[ DECLARE_TASKS {"tasks": [{"id": "task-1", "role": "  "}]} ]]]');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Missing required field "role"'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('reports correct path for second invalid task', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '[[[ DECLARE_TASKS {"tasks": [{"id": "ok", "role": "dev"}, {"id": "bad"}]} ]]]');
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
    cmd.handler(agent, '[[[ DECLARE_TASKS {"tasks": [{"id": "t1", "role": "developer"}]} ]]]');
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

    cmd.handler(agent, '[[[ COMPLETE_TASK {"summary": "Auth module implemented"} ]]]');

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

    cmd.handler(agent, '[[[ COMPLETE_TASK {"id": "explicit-task", "summary": "Done"} ]]]');

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

    cmd.handler(agent, '[[[ COMPLETE_TASK {"status": "done", "output": "All tests pass"} ]]]');

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

    cmd.handler(agent, '[[[ COMPLETE_TASK {"summary": "Build done"} ]]]');

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

    cmd.handler(agent, '[[[ COMPLETE_TASK {"summary": "Done with work"} ]]]');

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

    cmd.handler(agent, '[[[ COMPLETE_TASK {"summary": "Done"} ]]]');

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

    cmd.handler(agent, '[[[ COMPLETE_TASK {"summary": "Done again"} ]]]');

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

    cmd.handler(agent, '[[[ COMPLETE_TASK {"summary": "Implemented feature"} ]]]');

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

    cmd.handler(agent, '[[[ COMPLETE_TASK {} ]]]');

    expect(parent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Status: done'));
    expect(parent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('(no summary)'));
  });
});

describe('COMPLETE_TASK from lead agent', () => {
  it('completes DAG task by id', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '[[[ COMPLETE_TASK {"id": "task-1"} ]]]');

    expect(ctx.taskDAG.getTransitionError).toHaveBeenCalledWith(agent.id, 'task-1', 'complete');
    expect(ctx.taskDAG.completeTask).toHaveBeenCalledWith(agent.id, 'task-1');
    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('marked as done'));
  });

  it('requires id field for lead agents', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '[[[ COMPLETE_TASK {} ]]]');

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

    cmd.handler(agent, '[[[ COMPLETE_TASK {"id": "task-1"} ]]]');

    expect(agent.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Cannot complete task'));
    expect(ctx.taskDAG.completeTask).not.toHaveBeenCalled();
  });

  it('accepts output field as summary alias for lead', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getCompleteHandler(ctx);

    cmd.handler(agent, '[[[ COMPLETE_TASK {"id": "task-1", "output": "Build successful"} ]]]');

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

    cmd.handler(agent, '[[[ COMPLETE_TASK {"summary": "Done"} ]]]');

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

    cmd.handler(agent, '[[[ COMPLETE_TASK {"summary": "Done"} ]]]');

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
    handler.handler(agent, '[[[ COMPLETE_TASK {"id": "task-x", "summary": "done"} ]]]');
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
    handler.handler(agent, '[[[ COMPLETE_TASK {"id": "task-x", "summary": "done"} ]]]');
    expect(ctx.taskDAG.completeTask).toHaveBeenCalledWith('lead-001', 'task-x');
  });

  it('allows completion when task has no assignedAgentId (unassigned task)', () => {
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
    handler.handler(agent, '[[[ COMPLETE_TASK {"id": "task-x", "summary": "done"} ]]]');
    expect(ctx.taskDAG.completeTask).toHaveBeenCalledWith('lead-001', 'task-x');
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
    handler.handler(agent, '[[[ COMPLETE_TASK {"summary": "done"} ]]]');
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
    handler.handler(agent, `[[[ COMPLETE_TASK {"summary": "${longText}"} ]]]`);

    const parentAgent = ctx.getAgent('lead-001') as any;
    const parentMsg = parentAgent.sendMessage.mock.calls[0][0];
    // Summary in the message should be truncated to 10K
    expect(parentMsg.length).toBeLessThan(15_000);
  });
});
