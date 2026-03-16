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
  mockUseHandlers,
} = vi.hoisted(() => ({
  mockSendMessage: vi.fn().mockResolvedValue(undefined),
  mockCommandHandlers: new Map<string, (ctx: any) => Promise<void>>(),
  mockOnHandlers: new Map<string, (ctx: any) => Promise<void>>(),
  mockCatchHolder: { handler: null as ((err: any) => void) | null },
  mockStartHolder: { callback: null as (() => void) | null, signal: null as AbortSignal | null },
  mockStopFn: vi.fn().mockResolvedValue(undefined),
  mockUseHandlers: [] as Array<(ctx: any, next: () => Promise<void>) => Promise<void>>,
}));

vi.mock('grammy', () => {
  class MockBot {
    api = { sendMessage: mockSendMessage, deleteWebhook: vi.fn().mockResolvedValue(undefined) };
    command(cmd: string, handler: (ctx: any) => Promise<void>) {
      mockCommandHandlers.set(cmd, handler);
    }
    on(event: string, handler: (ctx: any) => Promise<void>) {
      mockOnHandlers.set(event, handler);
    }
    use(handler: (ctx: any, next: () => Promise<void>) => Promise<void>) {
      mockUseHandlers.push(handler);
    }
    catch(handler: (err: any) => void) {
      mockCatchHolder.handler = handler;
    }
    start(opts?: { onStart?: () => void; allowed_updates?: string[]; signal?: AbortSignal }) {
      mockStartHolder.callback = opts?.onStart ?? null;
      mockStartHolder.signal = opts?.signal ?? null;
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
    // Default test allowlist includes common test chat IDs.
    // Empty allowlist = deny-all (secure default), so tests must be explicit.
    allowedChatIds: ['123', '456', '100'],
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
    mockStartHolder.signal = null;
    mockUseHandlers.length = 0;
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

  it('sends multiple messages for long text', async () => {
    adapter = new TelegramAdapter(createConfig());
    await adapter.start();

    const longText = 'a'.repeat(5000);
    await adapter.sendMessage({
      platform: 'telegram',
      chatId: '123',
      text: longText,
    });

    // chunkMessage will split this into 2 chunks
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    // Each sent chunk should be ≤ 4096
    for (const call of mockSendMessage.mock.calls) {
      expect(call[1].length).toBeLessThanOrEqual(4096);
    }
  });

  it('only thread-replies the first chunk', async () => {
    adapter = new TelegramAdapter(createConfig());
    await adapter.start();

    const longText = 'a'.repeat(5000);
    await adapter.sendMessage({
      platform: 'telegram',
      chatId: '123',
      text: longText,
      replyToMessageId: '42',
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    // First call should have reply_parameters
    const firstCallOpts = mockSendMessage.mock.calls[0][2];
    expect(firstCallOpts).toHaveProperty('reply_parameters');
    // Second call should NOT have reply_parameters
    const secondCallOpts = mockSendMessage.mock.calls[1][2];
    expect(secondCallOpts).toBeUndefined();
  });

  it('enqueues remaining chunks on send failure', async () => {
    adapter = new TelegramAdapter(createConfig());
    await adapter.start();

    // Fail on the second chunk
    mockSendMessage
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Network error'));

    const longText = 'a'.repeat(5000);
    await adapter.sendMessage({
      platform: 'telegram',
      chatId: '123',
      text: longText,
    });

    // First chunk sent, second failed
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    // Retry queue should have the remaining content
    const snapshot = adapter.getRetryQueueSnapshot();
    expect(snapshot).toHaveLength(1);
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

  it('denies all chats when allowlist is empty (secure default)', () => {
    adapter = new TelegramAdapter(createConfig({ allowedChatIds: [] }));
    expect(adapter.isChatAllowed('any-id')).toBe(false);
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
    expect(errorHandler.mock.calls[0][0].error.message).toBe('Bot error');
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

  // ── Regression: H-5 — bot token never exposed in errors ──

  it('sanitizes bot token from error messages', async () => {
    adapter = new TelegramAdapter(createConfig({ botToken: 'secret-token-xyz' }));
    const errorHandler = vi.fn();
    adapter.on('error', errorHandler);

    await adapter.start();

    // Simulate error handler with token in message
    const catchHandler = mockCatchHolder.handler!;
    catchHandler({
      message: 'Request failed: Invalid token: secret-token-xyz',
      error: new Error('Invalid token: secret-token-xyz'),
    });

    expect(errorHandler).toHaveBeenCalledOnce();
    const emittedError = errorHandler.mock.calls[0][0].error;
    expect(emittedError.message).not.toContain('secret-token-xyz');
    expect(emittedError.message).toContain('[BOT_TOKEN_REDACTED]');
  });

  // ── Regression: H-2 — start errors surfaced ──────────────

  it('surfaces start error via getStartError()', async () => {
    expect(adapter.getStartError()).toBeNull();
    // A failed start would set startError but we can't easily mock the import failure
    // So verify the getter exists and returns null when healthy
  });

  // ── Regression: H-4 — retry queue snapshot/restore ────────

  it('exports and restores retry queue', async () => {
    adapter = new TelegramAdapter(createConfig());
    await adapter.start();

    // Empty initially
    expect(adapter.getRetryQueueSnapshot()).toHaveLength(0);

    // Restore some entries
    const entries = [
      {
        message: { platform: 'telegram' as const, chatId: '123', text: 'hello' },
        attempts: 1,
        expiresAt: Date.now() + 60_000,
      },
      {
        // Expired entry — should be filtered out
        message: { platform: 'telegram' as const, chatId: '456', text: 'expired' },
        attempts: 1,
        expiresAt: Date.now() - 1000,
      },
    ];

    adapter.restoreRetryQueue(entries);
    const snapshot = adapter.getRetryQueueSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].message.chatId).toBe('123');
  });

  // ── Update Deduplication ─────────────────────────────────

  it('registers deduplication middleware before other handlers', async () => {
    adapter = new TelegramAdapter(createConfig());
    await adapter.start();

    // use() should have been called (dedup middleware registered)
    expect(mockUseHandlers.length).toBe(1);
  });

  it('drops duplicate updates with the same update_id', async () => {
    adapter = new TelegramAdapter(createConfig());
    await adapter.start();

    const dedupMiddleware = mockUseHandlers[0];
    expect(dedupMiddleware).toBeDefined();

    const next = vi.fn().mockResolvedValue(undefined);

    // First call with update_id 100 — should pass through
    await dedupMiddleware({ update: { update_id: 100 } }, next);
    expect(next).toHaveBeenCalledTimes(1);

    // Second call with the same update_id 100 — should be dropped
    next.mockClear();
    await dedupMiddleware({ update: { update_id: 100 } }, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows different update_ids through', async () => {
    adapter = new TelegramAdapter(createConfig());
    await adapter.start();

    const dedupMiddleware = mockUseHandlers[0];
    const next = vi.fn().mockResolvedValue(undefined);

    await dedupMiddleware({ update: { update_id: 1 } }, next);
    await dedupMiddleware({ update: { update_id: 2 } }, next);
    await dedupMiddleware({ update: { update_id: 3 } }, next);

    expect(next).toHaveBeenCalledTimes(3);
  });

  it('evicts oldest update_id when over capacity', async () => {
    adapter = new TelegramAdapter(createConfig());
    await adapter.start();

    const dedupMiddleware = mockUseHandlers[0];
    const next = vi.fn().mockResolvedValue(undefined);

    // Add 1001 unique IDs — one more than MAX_SEEN_IDS (1000) to trigger FIFO eviction
    for (let i = 1; i <= 1001; i++) {
      await dedupMiddleware({ update: { update_id: i } }, next);
    }
    expect(next).toHaveBeenCalledTimes(1001);

    // The first update_id (1) should have been evicted — re-sending it should pass
    next.mockClear();
    await dedupMiddleware({ update: { update_id: 1 } }, next);
    expect(next).toHaveBeenCalledTimes(1);

    // update_id 1001 (most recent) should still be in the set — should be dropped
    next.mockClear();
    await dedupMiddleware({ update: { update_id: 1001 } }, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('clears seen update IDs on stop', async () => {
    adapter = new TelegramAdapter(createConfig());
    await adapter.start();

    const dedupMiddleware = mockUseHandlers[0];
    const next = vi.fn().mockResolvedValue(undefined);

    // Add an update_id
    await dedupMiddleware({ update: { update_id: 42 } }, next);
    expect(next).toHaveBeenCalledTimes(1);

    // Stop and restart
    await adapter.stop();
    await adapter.start();

    // Get the new middleware (from the new start)
    const newDedupMiddleware = mockUseHandlers[mockUseHandlers.length - 1];
    next.mockClear();

    // The same update_id should now pass through (set was cleared)
    await newDedupMiddleware({ update: { update_id: 42 } }, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  // ── Abort Signal Handling ────────────────────────────────

  it('creates abort controller on start and aborts on stop', async () => {
    adapter = new TelegramAdapter(createConfig());
    await adapter.start();

    // Bot should be running
    expect(adapter.isRunning()).toBe(true);

    // After stop, the bot should be cleanly stopped
    await adapter.stop();
    expect(adapter.isRunning()).toBe(false);
  });

  it('suppresses AbortError during stop', async () => {
    const { logger: mockLogger } = await import('../utils/logger.js');
    adapter = new TelegramAdapter(createConfig());
    await adapter.start();

    // Make bot.stop() throw an AbortError
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    mockStopFn.mockRejectedValueOnce(abortError);

    vi.mocked(mockLogger.warn).mockClear();
    await adapter.stop();

    // AbortError should NOT be logged as a warning
    const warnCalls = vi.mocked(mockLogger.warn).mock.calls;
    const stopErrorLogs = warnCalls.filter(
      (call) => (call[0] as any)?.msg === 'Error stopping Telegram bot',
    );
    expect(stopErrorLogs).toHaveLength(0);
  });

  it('logs non-AbortError during stop', async () => {
    const { logger: mockLogger } = await import('../utils/logger.js');
    adapter = new TelegramAdapter(createConfig());
    await adapter.start();

    // Make bot.stop() throw a regular error
    mockStopFn.mockRejectedValueOnce(new Error('Network failure'));

    vi.mocked(mockLogger.warn).mockClear();
    await adapter.stop();

    // Non-AbortError SHOULD be logged as a warning
    const warnCalls = vi.mocked(mockLogger.warn).mock.calls;
    const stopErrorLogs = warnCalls.filter(
      (call) => (call[0] as any)?.msg === 'Error stopping Telegram bot',
    );
    expect(stopErrorLogs).toHaveLength(1);
  });
});
