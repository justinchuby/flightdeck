import { describe, it, expect, vi } from 'vitest';
import { getCoordCommands } from '../agents/commands/CoordCommands.js';
import type { CommandHandlerContext } from '../agents/commands/types.js';

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'agent-dev-abc123',
    parentId: 'agent-lead-000',
    role: { id: 'developer', name: 'Developer' },
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

describe('CoordCommands — COMMIT handler', () => {
  it('registers all 6 coordination commands', () => {
    const cmds = getCoordCommands(makeCtx());
    expect(cmds).toHaveLength(6);
    expect(cmds.map((c) => c.name)).toEqual([
      'LOCK', 'UNLOCK', 'ACTIVITY', 'DECISION', 'PROGRESS', 'COMMIT',
    ]);
  });

  it('scopes git add to currently locked files', () => {
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
    const msg = agent.sendMessage.mock.calls[0][0] as string;
    expect(msg).toContain('git add src/auth.ts src/utils.ts');
    expect(msg).toContain('Add auth module');
  });

  it('shell-escapes double quotes in commit message', () => {
    const ctx = makeCtx({
      lockRegistry: {
        getByAgent: vi.fn().mockReturnValue([{ filePath: 'file.ts' }]),
      },
    });
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    commit.handler(agent, '[[[ COMMIT {"message": "Fix \\"broken\\" test"} ]]]');

    const msg = agent.sendMessage.mock.calls[0][0] as string;
    expect(msg).toContain('Fix \\"broken\\" test');
    // Should not have unescaped double quotes in the middle of the commit message
    expect(msg).toMatch(/git commit -m "Fix \\"broken\\" test/);
  });

  it('warns and returns when agent has no locks', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    commit.handler(agent, '[[[ COMMIT {"message": "test"} ]]]');

    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('No file locks held'),
    );
    // Should NOT log to activity ledger when no files
    expect(ctx.activityLedger.log).not.toHaveBeenCalled();
  });

  it('handles file paths with spaces and special characters', () => {
    const ctx = makeCtx({
      lockRegistry: {
        getByAgent: vi.fn().mockReturnValue([
          { filePath: 'src/my component/App.tsx' },
          { filePath: 'docs/notes (draft).md' },
        ]),
      },
    });
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    commit.handler(agent, '[[[ COMMIT {"message": "Update docs"} ]]]');

    const msg = agent.sendMessage.mock.calls[0][0] as string;
    expect(msg).toContain('src/my component/App.tsx');
    expect(msg).toContain('docs/notes (draft).md');
  });

  it('includes Co-authored-by trailer in commit command', () => {
    const ctx = makeCtx({
      lockRegistry: {
        getByAgent: vi.fn().mockReturnValue([{ filePath: 'file.ts' }]),
      },
    });
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    commit.handler(agent, '[[[ COMMIT {"message": "feat: stuff"} ]]]');

    const msg = agent.sendMessage.mock.calls[0][0] as string;
    expect(msg).toContain('Co-authored-by: Copilot');
  });

  it('uses default message when none provided', () => {
    const ctx = makeCtx({
      lockRegistry: {
        getByAgent: vi.fn().mockReturnValue([{ filePath: 'file.ts' }]),
      },
    });
    const agent = makeAgent();
    const commit = getCommitHandler(ctx);

    commit.handler(agent, '[[[ COMMIT {} ]]]');

    const msg = agent.sendMessage.mock.calls[0][0] as string;
    expect(msg).toContain('Changes by Developer (agent-d');
  });

  it('logs commit to activity ledger', () => {
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
    );
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
