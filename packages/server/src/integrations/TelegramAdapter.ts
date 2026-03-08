// packages/server/src/integrations/TelegramAdapter.ts
// Thin transport adapter wrapping grammY for Telegram Bot API.
// Uses long polling (no webhook / public URL needed).

import { TypedEmitter } from '../utils/TypedEmitter.js';
import { logger } from '../utils/logger.js';
import type {
  MessagingAdapter,
  MessagingPlatform,
  InboundMessage,
  OutboundMessage,
  TelegramConfig,
} from './types.js';

// grammY types — lazy-imported in start() to avoid hard dependency
type GrammyBot = import('grammy').Bot;

interface TelegramAdapterEvents {
  'message': InboundMessage;
  'error': { error: Error; context?: string };
  'started': void;
  'stopped': void;
}

/** Rate limiter bucket per user. */
interface RateBucket {
  count: number;
  resetAt: number;
}

/**
 * TelegramAdapter wraps a grammY Bot instance and implements the
 * MessagingAdapter interface. It handles:
 * - Bot initialization with token from config
 * - Command handlers (/status, /projects, /agents, /help)
 * - Inbound message routing to registered handlers
 * - Outbound message delivery with retry queue
 * - Per-user rate limiting
 * - Long polling mode
 */
export class TelegramAdapter extends TypedEmitter<TelegramAdapterEvents> implements MessagingAdapter {
  readonly platform: MessagingPlatform = 'telegram';

  private bot: GrammyBot | null = null;
  private config: TelegramConfig;
  private messageHandlers: Array<(msg: InboundMessage) => void> = [];
  private rateBuckets: Map<string, RateBucket> = new Map();
  private rateLimitCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  // Retry queue for failed outbound messages (in-memory, 5-min TTL)
  private retryQueue: Array<{ message: OutboundMessage; attempts: number; expiresAt: number }> = [];
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly MAX_RETRY_ATTEMPTS = 3;
  private static readonly RETRY_QUEUE_TTL_MS = 5 * 60 * 1000;

  // Command handlers that the IntegrationAgent can register
  private commandHandlers: Map<string, (chatId: string, args: string) => Promise<string>> = new Map();

  constructor(config: TelegramConfig) {
    super();
    this.config = config;
  }

  /**
   * Register a handler for a bot command (e.g. /status, /projects).
   * The handler receives the chatId and any args after the command, and returns
   * a response string.
   */
  registerCommand(command: string, handler: (chatId: string, args: string) => Promise<string>): void {
    this.commandHandlers.set(command, handler);
  }

  /** Register a handler for inbound messages. */
  onMessage(handler: (message: InboundMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  /** Start the bot with long polling. */
  async start(): Promise<void> {
    if (this.running) return;

    if (!this.config.botToken) {
      throw new Error(
        'Telegram bot token is required. Set TELEGRAM_BOT_TOKEN environment variable.',
      );
    }

    // Lazy import grammY — only load when Telegram is actually enabled
    const { Bot } = await import('grammy');
    this.bot = new Bot(this.config.botToken);

    this.setupCommandHandlers();
    this.setupMessageHandler();
    this.setupErrorHandler();

    // Start rate limit bucket cleanup
    this.rateLimitCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of this.rateBuckets) {
        if (bucket.resetAt <= now) this.rateBuckets.delete(key);
      }
    }, 60_000);
    this.rateLimitCleanupTimer.unref();

    // Start long polling (non-blocking)
    this.bot.start({
      onStart: () => {
        logger.info({ module: 'telegram', msg: 'Telegram bot started (long polling)' });
        this.running = true;
        this.emit('started', undefined as unknown as void);
      },
    });
  }

  /** Stop the bot gracefully. */
  async stop(): Promise<void> {
    if (!this.running || !this.bot) return;

    this.running = false;

    if (this.rateLimitCleanupTimer) {
      clearInterval(this.rateLimitCleanupTimer);
      this.rateLimitCleanupTimer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    try {
      await this.bot.stop();
    } catch (err) {
      logger.warn({ module: 'telegram', msg: 'Error stopping Telegram bot', error: (err as Error).message });
    }

    this.bot = null;
    this.retryQueue = [];
    this.emit('stopped', undefined as unknown as void);
    logger.info({ module: 'telegram', msg: 'Telegram bot stopped' });
  }

  /** Send a message to a Telegram chat. */
  async sendMessage(message: OutboundMessage): Promise<void> {
    if (!this.bot) {
      logger.warn({ module: 'telegram', msg: 'Cannot send message — bot not running' });
      return;
    }

    try {
      await this.bot.api.sendMessage(
        message.chatId,
        message.text,
        message.parseMode ? { parse_mode: message.parseMode as 'MarkdownV2' | 'HTML' } : undefined,
      );
    } catch (err) {
      logger.warn({
        module: 'telegram',
        msg: 'Failed to send Telegram message',
        chatId: message.chatId,
        error: (err as Error).message,
      });
      this.enqueueRetry(message);
    }
  }

  /** Whether the bot is currently running. */
  isRunning(): boolean {
    return this.running;
  }

  /** Check if a chat ID is in the allowlist. Empty list = allow all. */
  isChatAllowed(chatId: string): boolean {
    if (this.config.allowedChatIds.length === 0) return true;
    return this.config.allowedChatIds.includes(chatId);
  }

  // ── Private ──────────────────────────────────────────────

  private setupCommandHandlers(): void {
    if (!this.bot) return;

    // Built-in /help command
    this.bot.command('help', async (ctx) => {
      const chatId = String(ctx.chat.id);
      if (!this.isChatAllowed(chatId)) {
        await ctx.reply('🚫 This chat is not authorized to use Flightdeck. Contact your admin to add this chat ID to the allowlist.');
        logger.info({ module: 'telegram', msg: 'Blocked non-allowlisted help request', chatId });
        return;
      }

      const helpText = [
        '🛩️ *Flightdeck Bot Commands*',
        '',
        '/status — Show active projects and agent counts',
        '/projects — List all projects',
        '/agents — List running agents',
        '/help — Show this help message',
        '',
        'Send any message to interact with your project lead.',
      ].join('\n');

      await ctx.reply(helpText, { parse_mode: 'Markdown' });
    });

    // Wire registered command handlers
    for (const [command, handler] of this.commandHandlers) {
      this.bot.command(command, async (ctx) => {
        const chatId = String(ctx.chat.id);
        const userId = String(ctx.from?.id ?? ctx.chat.id);
        if (!this.isChatAllowed(chatId)) {
          await ctx.reply('🚫 This chat is not authorized to use Flightdeck. Contact your admin to add this chat ID to the allowlist.');
          logger.info({ module: 'telegram', msg: 'Blocked non-allowlisted chat', chatId });
          return;
        }
        if (!this.checkRateLimit(userId)) {
          await ctx.reply('⏳ Rate limit exceeded. Please wait a moment.');
          return;
        }

        try {
          const args = ctx.match ?? '';
          const response = await handler(chatId, args);
          await ctx.reply(response, { parse_mode: 'Markdown' });
        } catch (err) {
          logger.warn({ module: 'telegram', msg: `Command /${command} failed`, error: (err as Error).message });
          await ctx.reply('❌ An error occurred processing your command.');
        }
      });
    }
  }

  private setupMessageHandler(): void {
    if (!this.bot) return;

    this.bot.on('message:text', async (ctx) => {
      const chatId = String(ctx.chat.id);
      const userId = String(ctx.from.id);
      if (!this.isChatAllowed(chatId)) {
        await ctx.reply('🚫 This chat is not authorized to use Flightdeck. Contact your admin to add this chat ID to the allowlist.');
        logger.info({ module: 'telegram', msg: 'Blocked non-allowlisted message', chatId, userId });
        return;
      }
      if (!this.checkRateLimit(userId)) {
        await ctx.reply('⏳ Rate limit exceeded. Please wait a moment.');
        return;
      }

      const inbound: InboundMessage = {
        platform: 'telegram',
        chatId,
        userId: String(ctx.from.id),
        displayName: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ''),
        text: ctx.message.text,
        receivedAt: Date.now(),
      };

      // Notify all registered handlers
      for (const handler of this.messageHandlers) {
        try {
          handler(inbound);
        } catch (err) {
          logger.warn({ module: 'telegram', msg: 'Message handler threw', error: (err as Error).message });
        }
      }
    });
  }

  private setupErrorHandler(): void {
    if (!this.bot) return;

    this.bot.catch((err) => {
      logger.error({ module: 'telegram', msg: 'Bot error', error: err.message });
      this.emit('error', { error: err.error instanceof Error ? err.error : new Error(String(err.error)), context: 'bot.catch' });
    });
  }

  /** Per-user rate limiting. Returns true if within limit. */
  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const windowMs = 60_000;
    let bucket = this.rateBuckets.get(userId);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.rateBuckets.set(userId, bucket);
    }

    bucket.count++;
    return bucket.count <= this.config.rateLimitPerMinute;
  }

  /** Add a failed message to the retry queue with exponential backoff. */
  private enqueueRetry(message: OutboundMessage): void {
    const entry = {
      message,
      attempts: 1,
      expiresAt: Date.now() + TelegramAdapter.RETRY_QUEUE_TTL_MS,
    };
    this.retryQueue.push(entry);
    this.scheduleRetryFlush();
  }

  private scheduleRetryFlush(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.flushRetryQueue();
    }, 5_000);
    this.retryTimer.unref();
  }

  private async flushRetryQueue(): Promise<void> {
    if (!this.bot || this.retryQueue.length === 0) return;

    const now = Date.now();
    const remaining: typeof this.retryQueue = [];

    for (const entry of this.retryQueue) {
      if (entry.expiresAt <= now) continue; // TTL expired, drop it
      if (entry.attempts >= TelegramAdapter.MAX_RETRY_ATTEMPTS) continue; // Max retries, drop it

      try {
        await this.bot.api.sendMessage(
          entry.message.chatId,
          entry.message.text,
          entry.message.parseMode
            ? { parse_mode: entry.message.parseMode as 'MarkdownV2' | 'HTML' }
            : undefined,
        );
      } catch {
        entry.attempts++;
        remaining.push(entry);
      }
    }

    this.retryQueue = remaining;
    if (remaining.length > 0) {
      this.scheduleRetryFlush();
    }
  }
}
