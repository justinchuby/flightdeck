// packages/server/src/integrations/TelegramAdapter.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TelegramConfig, InboundMessage, OutboundMessage } from './types.js';

// Mock logger to suppress output
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Hoist mock state so it's accessible inside vi.mock factory
const {
  mockSendMessage,
  mockCommandHandlers,
  mockOnHandlers,
  mockCatchHolder,
  mockStartHolder,
  mockStopFn,
} = vi.hoisted(() => ({
  mockSendMessage: vi.fn().mockResolvedValue(undefined),
  mockCommandHandlers: new Map<string, (ctx: any) => Promise<void>>(),
  mockOnHandlers: new Map<string, (ctx: any) => Promise<void>>(),
  mockCatchHolder: { handler: null as ((err: any) => void) | null },
  mockStartHolder: { callback: null as (() => void) | null },
  mockStopFn: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('grammy', () => {
  class MockBot {
    api = { sendMessage: mockSendMessage };
    command(cmd: string, handler: (ctx: any) => Promise<void>) {
      mockCommandHandlers.set(cmd, handler);
    }
    on(event: string, handler: (ctx: any) => Promise<void>) {
      mockOnHandlers.set(event, handler);
    }
    catch(handler: (err: any) => void) {
      mockCatchHolder.handler = handler;
    }
    start(opts?: { onStart?: () => void }) {
      mockStartHolder.callback = opts?.onStart ?? null;
      if (opts?.onStart) {
        // Call synchronously for test predictability
        opts.onStart();
      }
    }
    stop = mockStopFn;
  }
  return { Bot: MockBot };
});

// Must import after mocks are set up
import { TelegramAdapter } from './TelegramAdapter.js';

function createConfig(overrides: Partial<TelegramConfig> = {}): TelegramConfig {
  return {
    enabled: true,
    botToken: 'test-bot-token-12345',
    allowedChatIds: [],
    rateLimitPerMinute: 20,
    ...overrides,
  };
}

describe('TelegramAdapter', () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCommandHandlers.clear();
    mockOnHandlers.clear();
    mockCatchHolder.handler = null;
    mockStartHolder.callback = null;
  });

  afterEach(async () => {
    if (adapter) {
      await adapter.stop();
    }
  });

  // ── Construction ──────────────────────────────────────────

  it('constructs with config', () => {
    adapter = new TelegramAdapter(createConfig());
    expect(adapter.platform).toBe('telegram');
    expect(adapter.isRunning()).toBe(false);
  });

  // ── Start / Stop ──────────────────────────────────────────

  it('starts the bot with long polling', async () => {
    adapter = new TelegramAdapter(createConfig());
    await adapter.start();

    // Trigger the onStart callback
    // onStart called synchronously in mock;

    expect(adapter.isRunning()).toBe(true);
  });

  it('throws if no bot token', async () => {
    adapter = new TelegramAdapter(createConfig({ botToken: '' }));
    await expect(adapter.start()).rejects.toThrow('Telegram bot token is required');
  });

  it('does not start twice', async () => {
    adapter = new TelegramAdapter(createConfig());
    await adapter.start();

    // Already running — second start should be a no-op
    expect(adapter.isRunning()).toBe(true);
    await adapter.start(); // should not throw or re-initialize
    expect(adapter.isRunning()).toBe(true);
  });

  it('stops gracefully', async () => {
    adapter = new TelegramAdapter(createConfig());
    await adapter.start();
    // onStart called synchronously in mock;

    expect(adapter.isRunning()).toBe(true);
    await adapter.stop();
    expect(adapter.isRunning()).toBe(false);
  });

  it('stop is a no-op when not running', async () => {
    adapter = new TelegramAdapter(createConfig());
    await adapter.stop(); // should not throw
  });

  // ── Command Handlers ──────────────────────────────────────

  it('registers custom command handlers', async () => {
    adapter = new TelegramAdapter(createConfig());

    const handler = vi.fn().mockResolvedValue('response text');
    adapter.registerCommand('status', handler);

    await adapter.start();
    // onStart called synchronously in mock;

    // The handler should have been registered on the bot
    expect(mockCommandHandlers.has('status')).toBe(true);
  });

  it('help command sends help text', async () => {
    adapter = new TelegramAdapter(createConfig());
    await adapter.start();
    // onStart called synchronously in mock;

    const helpHandler = mockCommandHandlers.get('help');
    expect(helpHandler).toBeDefined();

    const ctx = {
      chat: { id: 123 },
      reply: vi.fn().mockResolvedValue(undefined),
    };
    await helpHandler!(ctx);

    expect(ctx.reply).toHaveBeenCalledOnce();
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Flightdeck Bot Commands'),
      expect.objectContaining({ parse_mode: 'Markdown' }),
    );
  });

  it('command handler rejects non-allowlisted chat', async () => {
    adapter = new TelegramAdapter(createConfig({ allowedChatIds: ['999'] }));

    const handler = vi.fn().mockResolvedValue('response');
    adapter.registerCommand('test', handler);

    await adapter.start();
    // onStart called synchronously in mock;

    const cmdHandler = mockCommandHandlers.get('test');
    const ctx = {
      chat: { id: 123 },
      match: '',
      reply: vi.fn(),
    };
    await cmdHandler!(ctx);

    // Handler should NOT have been called since chat 123 is not in allowlist
    expect(handler).not.toHaveBeenCalled();
    // But should reply with a rejection message (M7 fix)
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('not authorized'),
    );
  });

  // ── Message Handling ──────────────────────────────────────

  it('routes inbound text messages to handlers', async () => {
    adapter = new TelegramAdapter(createConfig());
    const msgHandler = vi.fn();
    adapter.onMessage(msgHandler);

    await adapter.start();
    // onStart called synchronously in mock;

    const textHandler = mockOnHandlers.get('message:text');
    expect(textHandler).toBeDefined();

    const ctx = {
      chat: { id: 456 },
      from: { id: 789, first_name: 'Alice', last_name: 'Smith' },
      message: { text: 'Hello bot' },
      reply: vi.fn(),
    };
    await textHandler!(ctx);

    expect(msgHandler).toHaveBeenCalledOnce();
    const msg: InboundMessage = msgHandler.mock.calls[0][0];
    expect(msg.platform).toBe('telegram');
    expect(msg.chatId).toBe('456');
    expect(msg.userId).toBe('789');
    expect(msg.displayName).toBe('Alice Smith');
    expect(msg.text).toBe('Hello bot');
    expect(msg.receivedAt).toBeGreaterThan(0);
  });

  it('rejects messages from non-allowlisted chats', async () => {
    adapter = new TelegramAdapter(createConfig({ allowedChatIds: ['111'] }));
    const msgHandler = vi.fn();
    adapter.onMessage(msgHandler);

    await adapter.start();
    // onStart called synchronously in mock;

    const textHandler = mockOnHandlers.get('message:text');
    const ctx = {
      chat: { id: 456 },
      from: { id: 789, first_name: 'Eve' },
      message: { text: 'hack' },
      reply: vi.fn(),
    };
    await textHandler!(ctx);

    expect(msgHandler).not.toHaveBeenCalled();
  });

  // ── Rate Limiting ─────────────────────────────────────────

  it('rate-limits messages per chat', async () => {
    adapter = new TelegramAdapter(createConfig({ rateLimitPerMinute: 2 }));
    const msgHandler = vi.fn();
    adapter.onMessage(msgHandler);

    await adapter.start();
    // onStart called synchronously in mock;

    const textHandler = mockOnHandlers.get('message:text');
    const makeCtx = (text: string) => ({
      chat: { id: 100 },
      from: { id: 1, first_name: 'Bob' },
      message: { text },
      reply: vi.fn(),
    });

    // First 2 messages should pass
    const ctx1 = makeCtx('msg1');
    await textHandler!(ctx1);
    expect(msgHandler).toHaveBeenCalledTimes(1);

    const ctx2 = makeCtx('msg2');
    await textHandler!(ctx2);
    expect(msgHandler).toHaveBeenCalledTimes(2);

    // Third message should be rate limited
    const ctx3 = makeCtx('msg3');
    await textHandler!(ctx3);
    expect(msgHandler).toHaveBeenCalledTimes(2); // Still 2
    expect(ctx3.reply).toHaveBeenCalledWith(expect.stringContaining('Rate limit'));
  });

  // ── Sending Messages ──────────────────────────────────────

  it('sends outbound messages', async () => {
    adapter = new TelegramAdapter(createConfig());
    await adapter.start();
    // onStart called synchronously in mock;

    const msg: OutboundMessage = {
      platform: 'telegram',
      chatId: '123',
      text: 'Hello from Flightdeck',
    };
    await adapter.sendMessage(msg);

    expect(mockSendMessage).toHaveBeenCalledWith('123', 'Hello from Flightdeck', undefined);
  });

  it('sends with parse mode', async () => {
    adapter = new TelegramAdapter(createConfig());
    await adapter.start();
    // onStart called synchronously in mock;

    await adapter.sendMessage({
      platform: 'telegram',
      chatId: '123',
      text: '*bold* text',
      parseMode: 'Markdown',
    });

    expect(mockSendMessage).toHaveBeenCalledWith('123', '*bold* text', { parse_mode: 'Markdown' });
  });

  it('does not send when bot is not running', async () => {
    adapter = new TelegramAdapter(createConfig());
    // Don't start

    await adapter.sendMessage({
      platform: 'telegram',
      chatId: '123',
      text: 'test',
    });

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('enqueues retry on send failure', async () => {
    adapter = new TelegramAdapter(createConfig());
    await adapter.start();
    // onStart called synchronously in mock;

    mockSendMessage.mockRejectedValueOnce(new Error('Network error'));

    await adapter.sendMessage({
      platform: 'telegram',
      chatId: '123',
      text: 'will fail',
    });

    // Should have logged a warning (no throw)
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  // ── Chat Allowlist ────────────────────────────────────────

  it('allows all chats when allowlist is empty', () => {
    adapter = new TelegramAdapter(createConfig({ allowedChatIds: [] }));
    expect(adapter.isChatAllowed('any-id')).toBe(true);
  });

  it('rejects chats not in allowlist', () => {
    adapter = new TelegramAdapter(createConfig({ allowedChatIds: ['100', '200'] }));
    expect(adapter.isChatAllowed('100')).toBe(true);
    expect(adapter.isChatAllowed('200')).toBe(true);
    expect(adapter.isChatAllowed('300')).toBe(false);
  });

  // ── Error Handling ────────────────────────────────────────

  it('emits error events from bot.catch', async () => {
    adapter = new TelegramAdapter(createConfig());
    const errorHandler = vi.fn();
    adapter.on('error', errorHandler);

    await adapter.start();
    // onStart called synchronously in mock;

    expect(mockCatchHolder.handler).not.toBeNull();
    mockCatchHolder.handler!({ message: 'Bot error', error: new Error('test error') });

    expect(errorHandler).toHaveBeenCalledOnce();
    expect(errorHandler.mock.calls[0][0].error.message).toBe('test error');
  });

  // ── Events ────────────────────────────────────────────────

  it('emits started event', async () => {
    adapter = new TelegramAdapter(createConfig());
    const startedHandler = vi.fn();
    adapter.on('started', startedHandler);

    await adapter.start();
    // onStart called synchronously in mock;

    expect(startedHandler).toHaveBeenCalledOnce();
  });

  it('emits stopped event', async () => {
    adapter = new TelegramAdapter(createConfig());
    const stoppedHandler = vi.fn();
    adapter.on('stopped', stoppedHandler);

    await adapter.start();
    // onStart called synchronously in mock;
    await adapter.stop();

    expect(stoppedHandler).toHaveBeenCalledOnce();
  });

  // ── Regression: M7 — allowlist now sends rejection message ──

  it('sends rejection message to non-allowlisted chats', async () => {
    adapter = new TelegramAdapter(createConfig({ allowedChatIds: ['999'] }));
    const msgHandler = vi.fn();
    adapter.onMessage(msgHandler);

    await adapter.start();
    // onStart called synchronously in mock;

    const textHandler = mockOnHandlers.get('message:text');
    const ctx = {
      chat: { id: 456 },
      from: { id: 789, first_name: 'Eve' },
      message: { text: 'hello' },
      reply: vi.fn(),
    };
    await textHandler!(ctx);

    // Should NOT route the message
    expect(msgHandler).not.toHaveBeenCalled();
    // Should INFORM the user they're blocked (not silent)
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('not authorized'),
    );
  });

  it('sends rejection message on /help from non-allowlisted chat', async () => {
    adapter = new TelegramAdapter(createConfig({ allowedChatIds: ['999'] }));

    await adapter.start();
    // onStart called synchronously in mock;

    const helpHandler = mockCommandHandlers.get('help');
    const ctx = {
      chat: { id: 456 },
      from: { id: 789 },
      reply: vi.fn(),
    };
    await helpHandler!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('not authorized'),
    );
  });

  // ── Regression: M5 — rate limit by userId, not chatId ──

  it('rate-limits by userId, not chatId (group chat support)', async () => {
    adapter = new TelegramAdapter(createConfig({ rateLimitPerMinute: 2 }));
    const msgHandler = vi.fn();
    adapter.onMessage(msgHandler);

    await adapter.start();
    // onStart called synchronously in mock;

    const textHandler = mockOnHandlers.get('message:text');

    // Two different users in the same group chat should each get their own rate bucket
    const makeCtx = (userId: number, text: string) => ({
      chat: { id: 100 }, // same chatId (group)
      from: { id: userId, first_name: 'User' },
      message: { text },
      reply: vi.fn(),
    });

    // User A: 2 messages (hits limit)
    await textHandler!(makeCtx(1, 'msg1'));
    await textHandler!(makeCtx(1, 'msg2'));
    expect(msgHandler).toHaveBeenCalledTimes(2);

    // User A: 3rd message should be rate limited
    const ctx3 = makeCtx(1, 'msg3');
    await textHandler!(ctx3);
    expect(msgHandler).toHaveBeenCalledTimes(2);
    expect(ctx3.reply).toHaveBeenCalledWith(expect.stringContaining('Rate limit'));

    // User B: should NOT be rate limited (different userId)
    await textHandler!(makeCtx(2, 'msg1'));
    expect(msgHandler).toHaveBeenCalledTimes(3);
  });
});
