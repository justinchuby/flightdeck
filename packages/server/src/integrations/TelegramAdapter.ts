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
 * TelegramAdapter — Layer 1 of the 3-layer messaging architecture.
 *
 * Architecture: TelegramAdapter (Layer 1: transport) → IntegrationRouter (Layer 2: routing)
 *               → NotificationBatcher (Layer 3: event aggregation & delivery)
 *
 * Thin transport adapter wrapping a grammY Bot instance. Implements the
 * MessagingAdapter interface for Telegram-specific concerns:
 * - Bot initialization with token from config
 * - Long polling mode (no webhook / public URL needed)
 * - Command handlers (/status, /projects, /agents, /help)
 * - Inbound message routing to registered handlers
 * - Outbound message delivery with retry queue (3 attempts, 5-min TTL)
 * - Per-user rate limiting (keyed by Telegram user ID, not chat ID)
 * - Chat allowlist enforcement with user notification on rejection
 */
export class TelegramAdapter extends TypedEmitter<TelegramAdapterEvents> implements MessagingAdapter {
  readonly platform: MessagingPlatform = 'telegram';

  private bot: GrammyBot | null = null;
  private config: TelegramConfig;
  private messageHandlers: Array<(msg: InboundMessage) => void> = [];
  private rateBuckets: Map<string, RateBucket> = new Map();
  private rateLimitCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private startError: string | null = null;

  /** Bounded set of recently-seen Telegram update IDs for deduplication. */
  private seenUpdateIds: Set<number> = new Set();
  private static readonly MAX_SEEN_IDS = 1000;

  /** AbortController for graceful long-polling shutdown. */
  private abortController: AbortController | null = null;

  // Retry queue for failed outbound messages (in-memory, 5-min TTL)
  private retryQueue: Array<{ message: OutboundMessage; attempts: number; expiresAt: number }> = [];
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly MAX_RETRY_ATTEMPTS = 3;
  private static readonly RETRY_QUEUE_TTL_MS = 5 * 60 * 1000;

  // Command handlers that the IntegrationRouter can register
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

  /**
   * Start the bot with long polling. Lazy-imports grammY on first call
   * so the dependency is only loaded when Telegram is actually enabled.
   */
  async start(): Promise<void> {
    if (this.running) return;

    if (!this.config.botToken) {
      throw new Error(
        'Telegram bot token is required. Set TELEGRAM_BOT_TOKEN environment variable.',
      );
    }

    try {
      // Lazy import grammY — only load when Telegram is actually enabled
      const { Bot } = await import('grammy');
      this.bot = new Bot(this.config.botToken);
    } catch (err) {
      // H-5: Sanitize bot token from error messages before logging/throwing
      const safeMsg = sanitizeTokenFromError(err, this.config.botToken);
      this.startError = safeMsg;
      this.emit('error', { error: new Error(safeMsg), context: 'start' });
      throw new Error(`Telegram bot initialization failed: ${safeMsg}`);
    }

    this.setupDeduplicationMiddleware();
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

    // Drop any leftover webhook/getUpdates connection from a previous
    // instance (e.g. after a crash) to avoid 409 Conflict errors.
    try {
      await this.bot.api.deleteWebhook({ drop_pending_updates: false });
    } catch {
      // Best-effort — if this fails, bot.start() will still attempt polling
    }

    this.abortController = new AbortController();

    // Start long polling (non-blocking). Pass abort signal for instant shutdown.
    this.bot.start({
      allowed_updates: ['message'],
      signal: this.abortController.signal,
      onStart: () => {
        logger.info({ module: 'telegram', msg: 'Telegram bot started (long polling)' });
        this.running = true;
        this.startError = null;
        this.emit('started', undefined as unknown as void);
      },
    });
  }

  /** Get the last start error (if any) for status reporting — H-2. */
  getStartError(): string | null {
    return this.startError;
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

    // Signal abort to cancel long-polling immediately (no 30s hang)
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    try {
      await this.bot.stop();
    } catch (err) {
      // AbortError is expected when we abort the controller
      if ((err as Error).name !== 'AbortError') {
        logger.warn({ module: 'telegram', msg: 'Error stopping Telegram bot', error: (err as Error).message });
      }
    }

    this.bot = null;
    this.retryQueue = [];
    this.seenUpdateIds.clear();
    this.emit('stopped', undefined as unknown as void);
    logger.info({ module: 'telegram', msg: 'Telegram bot stopped' });
  }

  /** Send a message to a Telegram chat. Supports reply threading via replyToMessageId. */
  async sendMessage(message: OutboundMessage): Promise<void> {
    if (!this.bot) {
      logger.warn({ module: 'telegram', msg: 'Cannot send message — bot not running' });
      return;
    }

    try {
      const opts: Record<string, unknown> = {};
      if (message.parseMode) opts.parse_mode = message.parseMode;
      if (message.replyToMessageId) {
        opts.reply_parameters = { message_id: Number(message.replyToMessageId) };
      }
      await this.bot.api.sendMessage(
        message.chatId,
        message.text,
        Object.keys(opts).length > 0 ? opts : undefined,
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
    // Empty allowlist = deny all (secure default). Configure allowed chat IDs in settings.
    if (this.config.allowedChatIds.length === 0) return false;
    return this.config.allowedChatIds.includes(chatId);
  }

  // ── Private ──────────────────────────────────────────────

  /**
   * grammY middleware that drops updates with previously-seen update_id.
   * Uses a bounded Set (FIFO eviction at 1000 entries) to prevent
   * double-processing during restart-during-burst scenarios.
   */
  private setupDeduplicationMiddleware(): void {
    if (!this.bot) return;

    this.bot.use(async (ctx: { update: { update_id: number } }, next: () => Promise<void>) => {
      const updateId = ctx.update.update_id;

      if (this.seenUpdateIds.has(updateId)) {
        logger.debug({ module: 'telegram', msg: 'Duplicate update skipped', updateId });
        return;
      }

      this.seenUpdateIds.add(updateId);

      // FIFO eviction when over capacity
      if (this.seenUpdateIds.size > TelegramAdapter.MAX_SEEN_IDS) {
        const oldest = this.seenUpdateIds.values().next().value;
        if (oldest !== undefined) this.seenUpdateIds.delete(oldest);
      }

      await next();
    });
  }

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
        messageId: String(ctx.message.message_id),
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
      // H-5: Never log bot token — sanitize all error messages
      const safeMsg = sanitizeTokenFromError(err, this.config.botToken);

      // 409 Conflict from getUpdates is expected and self-resolving after
      // restart — the old long-poll connection lingers ~30s at Telegram's
      // servers. Log as WARN, not ERROR, to avoid false alarms.
      const is409 = safeMsg.includes('409') || safeMsg.includes('terminated by other getUpdates');
      if (is409) {
        logger.warn({ module: 'telegram', msg: 'Telegram polling conflict (transient, will self-resolve)', error: safeMsg });
        return;
      }

      logger.error({ module: 'telegram', msg: 'Bot error', error: safeMsg });
      this.emit('error', { error: new Error(safeMsg), context: 'bot.catch' });
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

  /**
   * Export retry queue snapshot for persistence (H-4).
   * Callers can persist this to SQLite and restore via `restoreRetryQueue`.
   */
  getRetryQueueSnapshot(): Array<{ message: OutboundMessage; attempts: number; expiresAt: number }> {
    return [...this.retryQueue];
  }

  /** Restore retry queue from persisted state (H-4). */
  restoreRetryQueue(entries: Array<{ message: OutboundMessage; attempts: number; expiresAt: number }>): void {
    const now = Date.now();
    // Only restore entries that haven't expired
    const valid = entries.filter(e => e.expiresAt > now && e.attempts < TelegramAdapter.MAX_RETRY_ATTEMPTS);
    this.retryQueue.push(...valid);
    if (valid.length > 0) {
      logger.info({ module: 'telegram', msg: `Restored ${valid.length} retry queue entries` });
      this.scheduleRetryFlush();
    }
  }
}

// ── Helpers ──────────────────────────────────────────────

/**
 * Sanitize bot token from error messages (H-5: AC-14.26).
 * grammY may include the token in error output — strip it before logging.
 */
function sanitizeTokenFromError(err: unknown, token: string): string {
  let raw: string;
  if (err instanceof Error) {
    raw = err.message;
  } else if (typeof err === 'object' && err !== null && 'message' in err) {
    raw = String((err as { message: unknown }).message);
  } else {
    raw = String(err);
  }
  if (!token) return raw;
  return raw.replaceAll(token, '[BOT_TOKEN_REDACTED]');
}
