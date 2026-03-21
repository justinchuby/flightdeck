// packages/server/src/agents/commands/CommCommands.test.ts

import { describe, it, expect, vi } from 'vitest';
import { getCommCommands } from './CommCommands.js';
import type { CommandHandlerContext } from './types.js';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function createMockAgent(roleId: string) {
  return {
    id: `agent-${roleId}-123`,
    role: { id: roleId, name: roleId, description: '', systemPrompt: '', color: '', icon: '', builtIn: true },
    projectId: 'test-project',
    sendMessage: vi.fn(),
  };
}

function createMockContext(overrides: Partial<CommandHandlerContext> = {}): CommandHandlerContext {
  return {
    agentManager: {} as any,
    projectRegistry: {} as any,
    sessionId: 'test-session',
    integrationRouter: {
      sendToProject: vi.fn().mockReturnValue(true),
    } as any,
    ...overrides,
  };
}

describe('TELEGRAM_SEND role gate', () => {
  it('allows lead agent to send Telegram messages', () => {
    const ctx = createMockContext();
    const commands = getCommCommands(ctx);
    const telegramSend = commands.find(c => c.name === 'TELEGRAM_SEND');
    expect(telegramSend).toBeDefined();

    const agent = createMockAgent('lead');
    telegramSend!.handler(agent as any, '{"content": "Hello from lead"}');

    // Should have called sendToProject, not rejected
    expect(agent.sendMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('Only the project lead'),
    );
    expect(ctx.integrationRouter!.sendToProject).toHaveBeenCalledWith('test-project', 'Hello from lead');
  });

  it('rejects developer agent from sending Telegram messages', () => {
    const ctx = createMockContext();
    const commands = getCommCommands(ctx);
    const telegramSend = commands.find(c => c.name === 'TELEGRAM_SEND');

    const agent = createMockAgent('developer');
    telegramSend!.handler(agent as any, '{"content": "Hello from dev"}');

    expect(agent.sendMessage).toHaveBeenCalledWith(
      '[System] Only the project lead can send messages to Telegram. Use AGENT_MESSAGE to communicate through your lead.',
    );
    // Should NOT have called sendToProject
    expect(ctx.integrationRouter!.sendToProject).not.toHaveBeenCalled();
  });

  it('rejects architect agent from sending Telegram messages', () => {
    const ctx = createMockContext();
    const commands = getCommCommands(ctx);
    const telegramSend = commands.find(c => c.name === 'TELEGRAM_SEND');

    const agent = createMockAgent('architect');
    telegramSend!.handler(agent as any, '{"content": "Hello from architect"}');

    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Only the project lead'),
    );
    expect(ctx.integrationRouter!.sendToProject).not.toHaveBeenCalled();
  });

  it('rejects code-reviewer agent from sending Telegram messages', () => {
    const ctx = createMockContext();
    const commands = getCommCommands(ctx);
    const telegramSend = commands.find(c => c.name === 'TELEGRAM_SEND');

    const agent = createMockAgent('code-reviewer');
    telegramSend!.handler(agent as any, '{"content": "Hello from reviewer"}');

    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Only the project lead'),
    );
    expect(ctx.integrationRouter!.sendToProject).not.toHaveBeenCalled();
  });
});

describe('TELEGRAM_REPLY role gate', () => {
  it('rejects non-lead agent from replying to Telegram messages', () => {
    const ctx = createMockContext();
    const commands = getCommCommands(ctx);
    const telegramReply = commands.find(c => c.name === 'TELEGRAM_REPLY');
    expect(telegramReply).toBeDefined();

    const agent = createMockAgent('developer');
    telegramReply!.handler(agent as any, '{"messageId": "123", "content": "reply"}');

    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Only the project lead can reply'),
    );
  });

  it('allows lead agent to reply to Telegram messages', () => {
    const ctx = createMockContext({
      integrationRouter: {
        sendReply: vi.fn().mockReturnValue(true),
      } as any,
    });
    const commands = getCommCommands(ctx);
    const telegramReply = commands.find(c => c.name === 'TELEGRAM_REPLY');

    const agent = createMockAgent('lead');
    telegramReply!.handler(agent as any, '{"messageId": "123", "content": "reply from lead"}');

    // Should NOT have been rejected
    expect(agent.sendMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('Only the project lead'),
    );
  });
});
