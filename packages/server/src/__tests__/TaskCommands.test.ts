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

function makeCtx(overrides: Record<string, any> = {}): CommandHandlerContext {
  return {
    taskDAG: {
      declareTaskBatch: vi.fn().mockReturnValue({ tasks: [], conflicts: [] }),
      addTask: vi.fn(),
      getStatus: vi.fn().mockReturnValue({ tasks: [], fileLockMap: {}, summary: {} }),
    },
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

describe('DECLARE_TASKS validation', () => {
  it('rejects task with missing id', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '[[[ DECLARE_TASKS {"tasks": [{"role": "developer"}]} ]]]');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Task at index 0 is missing required field "id"'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('rejects task with empty string id', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '[[[ DECLARE_TASKS {"tasks": [{"id": "", "role": "developer"}]} ]]]');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('missing required field "id"'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('rejects task with whitespace-only id', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '[[[ DECLARE_TASKS {"tasks": [{"id": "   ", "role": "developer"}]} ]]]');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('missing required field "id"'),
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
      expect.stringContaining('has invalid id (too long, max 100 chars)'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('rejects task with missing role', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '[[[ DECLARE_TASKS {"tasks": [{"id": "task-1"}]} ]]]');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Task at index 0 is missing required field "role"'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('rejects task with empty role', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '[[[ DECLARE_TASKS {"tasks": [{"id": "task-1", "role": "  "}]} ]]]');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('missing required field "role"'),
    );
    expect(ctx.taskDAG.declareTaskBatch).not.toHaveBeenCalled();
  });

  it('reports correct index for second invalid task', () => {
    const ctx = makeCtx();
    const agent = makeLeadAgent();
    const cmd = getDeclareHandler(ctx);
    cmd.handler(agent, '[[[ DECLARE_TASKS {"tasks": [{"id": "ok", "role": "dev"}, {"id": "bad"}]} ]]]');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Task at index 1 is missing required field "role"'),
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
