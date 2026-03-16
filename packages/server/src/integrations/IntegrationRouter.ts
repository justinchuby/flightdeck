// packages/server/src/integrations/IntegrationRouter.ts
// Deterministic message router — NOT an LLM-powered agent.
// Routes inbound messages from messaging platforms to the correct
// project lead, and formats outbound responses.

import { randomInt } from 'node:crypto';
import { logger } from '../utils/logger.js';
import type { AgentManager } from '../agents/AgentManager.js';
import type { ProjectRegistry } from '../projects/ProjectRegistry.js';
import type {
  InboundMessage,
  ChatSession,
  MessagingAdapter,
  TelegramConfig,
} from './types.js';
import { TelegramAdapter } from './TelegramAdapter.js';
import { NotificationBatcher } from './NotificationBatcher.js';
import type { ConfigStore } from '../config/ConfigStore.js';

/** Session TTL: 8 hours (AI crew sessions run for extended periods). */
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;



/**
 * IntegrationRouter — Layer 2 of the 3-layer messaging architecture.
 *
 * Architecture: TelegramAdapter (Layer 1: transport) → IntegrationRouter (Layer 2: routing)
 *               → NotificationBatcher (Layer 3: event aggregation & delivery)
 *
 * IntegrationRouter is a deterministic router (no LLM) that:
 * 1. Manages platform adapters (Telegram, future: Slack)
 * 2. Routes inbound messages to the correct project lead
 * 3. Maintains chat ↔ project session bindings (in-memory, 1h TTL)
 * 4. Registers command handlers on adapters (/status, /projects, /agents, /help)
 * 5. Coordinates with NotificationBatcher for outbound event delivery
 */
export interface PendingChallenge {
  code: string;
  chatId: string;
  platform: 'telegram' | 'slack';
  projectId: string;
  boundBy: string;
  createdAt: number;
  expiresAt: number;
}

/** Challenge TTL: 5 minutes. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Max verification attempts per chatId per window. */
const VERIFY_MAX_ATTEMPTS = 5;
/** Rate limit window for verification attempts (1 minute). */
const VERIFY_WINDOW_MS = 60_000;

/** Typed error for rate-limited requests. */
export class RateLimitError extends Error {
  readonly status = 429;
  constructor(message = 'Too many requests') {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class IntegrationRouter {
  private adapters: Map<string, MessagingAdapter> = new Map();
  private sessions: Map<string, ChatSession> = new Map(); // chatId → session
  private pendingChallenges: Map<string, PendingChallenge> = new Map(); // chatId → challenge
  private verifyAttempts: Map<string, number[]> = new Map(); // chatId → timestamps
  /** Tracks inbound message IDs awaiting replies. Key: messageId, Value: { chatId, platform, createdAt }. */
  private pendingReplies: Map<string, { chatId: string; platform: string; createdAt: number }> = new Map();
  private static readonly PENDING_REPLY_TTL_MS = 30 * 60 * 1000; // 30 minutes
  private static readonly PENDING_REPLY_MAX_SIZE = 100;
  private notificationBatcher: NotificationBatcher;
  private agentManager: AgentManager;
  private projectRegistry: ProjectRegistry | undefined;
  private configStore: ConfigStore;
  private sessionCleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    agentManager: AgentManager,
    projectRegistry: ProjectRegistry | undefined,
    configStore: ConfigStore,
    notificationBatcher: NotificationBatcher,
  ) {
    this.agentManager = agentManager;
    this.projectRegistry = projectRegistry;
    this.configStore = configStore;
    this.notificationBatcher = notificationBatcher;
  }

  /** Initialize and start all configured adapters. */
  async start(): Promise<void> {
    // Telegram requires manual enablement each server start via
    // PATCH /api/integrations/telegram { enabled: true } or the UI toggle.
    // It will NOT auto-start even if config says enabled: true.

    // Start session cleanup timer
    this.sessionCleanupTimer = setInterval(() => this.cleanExpiredSessions(), 60_000);
    this.sessionCleanupTimer.unref();

    // Wire NotificationBatcher to AgentManager
    this.notificationBatcher.wire(this.agentManager);

    // Listen for config changes to enable/disable integrations dynamically
    this.configStore.on('config:reloaded', () => {
      this.handleConfigChange();
    });

    logger.info({ module: 'integration-router', msg: 'IntegrationRouter started' });
  }

  /** Stop all adapters and clean up. */
  async stop(): Promise<void> {
    if (this.sessionCleanupTimer) {
      clearInterval(this.sessionCleanupTimer);
      this.sessionCleanupTimer = null;
    }

    this.notificationBatcher.flushAll();
    this.notificationBatcher.stop();

    for (const [name, adapter] of this.adapters) {
      try {
        await adapter.stop();
        logger.info({ module: 'integration-router', msg: `Stopped adapter: ${name}` });
      } catch (err) {
        logger.warn({ module: 'integration-router', msg: `Error stopping adapter: ${name}`, error: (err as Error).message });
      }
    }
    this.adapters.clear();
    this.sessions.clear();
  }

  /** Get a specific adapter by platform name. */
  getAdapter(platform: string): MessagingAdapter | undefined {
    return this.adapters.get(platform);
  }

  /** Get the NotificationBatcher instance. */
  getBatcher(): NotificationBatcher {
    return this.notificationBatcher;
  }

  /** Bind a chat to a project. */
  bindSession(chatId: string, platform: 'telegram' | 'slack', projectId: string, boundBy: string): ChatSession {
    const session: ChatSession = {
      chatId,
      platform,
      projectId,
      boundBy,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    this.sessions.set(chatId, session);

    // User must explicitly opt in to notifications via preferences UI
    logger.info({ module: 'integration-router', msg: 'Chat session bound', chatId, projectId });
    return session;
  }

  /** Get the session for a chat, if it exists and isn't expired. */
  getSession(chatId: string): ChatSession | undefined {
    const session = this.sessions.get(chatId);
    if (!session) return undefined;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(chatId);
      this.notificationBatcher.unsubscribe(chatId, session.projectId);
      return undefined;
    }
    // Refresh TTL on access
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return session;
  }

  /** Get all active sessions. */
  getAllSessions(): ChatSession[] {
    const now = Date.now();
    const result: ChatSession[] = [];
    for (const [chatId, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(chatId);
        this.notificationBatcher.unsubscribe(chatId, session.projectId);
      } else {
        result.push(session);
      }
    }
    return result;
  }

  // ── Challenge-response for session binding (B-1 / C-2) ────────────

  /**
   * Initiate a challenge: generate a 6-digit code, send it to the chat,
   * and store it as a pending challenge. Returns the challenge metadata
   * (without the code — the code is only sent to the chat).
   */
  async createChallenge(
    chatId: string,
    platform: 'telegram' | 'slack',
    projectId: string,
    boundBy: string,
  ): Promise<{ chatId: string; expiresAt: number }> {
    const adapter = this.adapters.get(platform);
    if (!adapter) throw new Error(`No adapter for platform: ${platform}`);

    const code = String(randomInt(100000, 999999));
    const challenge: PendingChallenge = {
      code,
      chatId,
      platform,
      projectId,
      boundBy,
      createdAt: Date.now(),
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    };
    this.pendingChallenges.set(chatId, challenge);

    // Send the verification code to the Telegram chat
    await adapter.sendMessage({
      platform,
      chatId,
      text: `🔐 Flightdeck verification code: ${code}\nEnter this code in the Flightdeck UI to bind this chat. Expires in 5 minutes.`,
    });

    logger.info({ module: 'integration-router', msg: 'Challenge issued', chatId, projectId });
    return { chatId, expiresAt: challenge.expiresAt };
  }

  /**
   * Verify a challenge code. If correct, binds the session and clears
   * the pending challenge. Returns the session on success, null on failure.
   * Throws if rate-limited (>5 attempts per minute per chatId).
   */
  verifyChallenge(chatId: string, code: string): ChatSession | null {
    // Per-chatId rate limiting against brute-force
    if (this.isVerifyRateLimited(chatId)) {
      logger.warn({ module: 'integration-router', msg: 'Verification rate-limited', chatId });
      throw new RateLimitError('Too many verification attempts. Try again in 1 minute.');
    }
    this.recordVerifyAttempt(chatId);

    const challenge = this.pendingChallenges.get(chatId);
    if (!challenge) return null;

    // Expired?
    if (challenge.expiresAt <= Date.now()) {
      this.pendingChallenges.delete(chatId);
      return null;
    }

    // Wrong code? (constant-time comparison not critical for 6-digit codes, but log attempt)
    if (challenge.code !== code) {
      logger.warn({ module: 'integration-router', msg: 'Challenge verification failed', chatId });
      return null;
    }

    // Success — bind the session and clear rate limit tracking
    this.pendingChallenges.delete(chatId);
    this.verifyAttempts.delete(chatId);
    return this.bindSession(chatId, challenge.platform, challenge.projectId, challenge.boundBy);
  }

  /** Get pending challenge for a chat (for testing/status). */
  getPendingChallenge(chatId: string): PendingChallenge | undefined {
    const challenge = this.pendingChallenges.get(chatId);
    if (challenge && challenge.expiresAt <= Date.now()) {
      this.pendingChallenges.delete(chatId);
      return undefined;
    }
    return challenge;
  }

  // ── Private ──────────────────────────────────────────────

  private isVerifyRateLimited(chatId: string): boolean {
    const now = Date.now();
    const attempts = this.verifyAttempts.get(chatId);
    if (!attempts) return false;
    const recent = attempts.filter((t) => now - t < VERIFY_WINDOW_MS);
    if (recent.length === 0) {
      this.verifyAttempts.delete(chatId);
      return false;
    }
    return recent.length >= VERIFY_MAX_ATTEMPTS;
  }

  private recordVerifyAttempt(chatId: string): void {
    const now = Date.now();
    const attempts = this.verifyAttempts.get(chatId) ?? [];
    // Prune expired entries and add new one
    const recent = attempts.filter((t) => now - t < VERIFY_WINDOW_MS);
    recent.push(now);
    this.verifyAttempts.set(chatId, recent);
  }

  private async startTelegram(config: TelegramConfig): Promise<void> {
    // Stop any existing adapter to avoid 409 Conflict (two getUpdates)
    const existing = this.adapters.get('telegram');
    if (existing) {
      await existing.stop();
      this.adapters.delete('telegram');
    }

    const adapter = new TelegramAdapter(config);

    // Register command handlers
    adapter.registerCommand('status', async () => {
      return this.handleStatusCommand();
    });

    adapter.registerCommand('projects', async () => {
      return this.handleProjectsCommand();
    });

    adapter.registerCommand('agents', async () => {
      return this.handleAgentsCommand();
    });

    // Register inbound message handler
    adapter.onMessage((msg) => this.handleInboundMessage(msg));

    // Register adapter with NotificationBatcher
    this.notificationBatcher.addAdapter(adapter);

    try {
      await adapter.start();
      this.adapters.set('telegram', adapter);
    } catch (err) {
      logger.error({ module: 'integration-router', msg: 'Failed to start Telegram adapter', error: (err as Error).message });
    }
  }

  /** Handle inbound messages — route to project lead if session exists. */
  private handleInboundMessage(msg: InboundMessage): void {
    // Sanitize ALL user-controlled fields (text, displayName, chatId, userId)
    const sanitizedMsg: InboundMessage = {
      ...msg,
      text: sanitizeInput(msg.text),
      displayName: sanitizeInput(msg.displayName ?? 'Unknown'),
      chatId: sanitizeInput(msg.chatId),
      userId: sanitizeInput(msg.userId),
    };

    // Check bind command FIRST — it works even without an existing session
    if (sanitizedMsg.text.startsWith('bind ')) {
      const projectId = sanitizedMsg.text.slice(5).trim();
      if (!projectId) {
        const adapter = this.adapters.get(msg.platform);
        adapter?.sendMessage({
          platform: msg.platform,
          chatId: msg.chatId,
          text: '⚠️ Usage: bind <project-id>',
        }).catch((err) => {
          logger.warn({ module: 'integration-router', msg: 'Failed to send bind usage hint', error: (err as Error).message });
        });
        return;
      }
      this.bindSession(msg.chatId, msg.platform, projectId, msg.userId);
      const adapter = this.adapters.get(msg.platform);
      if (adapter) {
        adapter.sendMessage({
          platform: msg.platform,
          chatId: msg.chatId,
          text: `✅ Chat bound to project: ${projectId}`,
        }).catch((err) => {
          logger.warn({ module: 'integration-router', msg: 'Failed to send bind confirmation', error: (err as Error).message });
        });
      }
      return;
    }

    const session = this.getSession(msg.chatId);

    if (!session) {
      // No active session — suggest binding
      const adapter = this.adapters.get(msg.platform);
      if (adapter) {
        adapter.sendMessage({
          platform: msg.platform,
          chatId: msg.chatId,
          text: 'No active project session. Use /projects to see available projects, then send "bind <project-id>" to connect this chat.',
        }).catch((err) => {
          logger.warn({ module: 'integration-router', msg: 'Failed to send no-session hint', error: (err as Error).message });
        });
      }
      return;
    }

    // Route to project lead via AgentManager
    try {
      const leadAgent = this.agentManager.getByProject(session.projectId)
        .find(a => a.role.id === 'lead' && (a.status === 'running' || a.status === 'idle'));

      if (leadAgent) {
        // Track this message for reply routing
        if (sanitizedMsg.messageId) {
          this.pendingReplies.set(sanitizedMsg.messageId, {
            chatId: sanitizedMsg.chatId,
            platform: sanitizedMsg.platform,
            createdAt: Date.now(),
          });
          this.pruneExpiredReplies();
        }
        // Use structured JSON — never interpolate user input into prompt strings
        leadAgent.sendMessage(JSON.stringify({
          source: 'telegram',
          chatId: sanitizedMsg.chatId,
          messageId: sanitizedMsg.messageId ?? null,
          userId: sanitizedMsg.userId,
          displayName: sanitizedMsg.displayName,
          text: sanitizedMsg.text,
          receivedAt: sanitizedMsg.receivedAt,
        }));
      } else {
        const adapter = this.adapters.get(msg.platform);
        adapter?.sendMessage({
          platform: msg.platform,
          chatId: msg.chatId,
          text: '⚠️ No active project lead found for this project. The lead may have exited.',
        }).catch((err) => {
          logger.warn({ module: 'integration-router', msg: 'Failed to send no-lead warning', error: (err as Error).message });
        });
      }
    } catch (err) {
      logger.warn({
        module: 'integration-router',
        msg: 'Failed to route message to lead',
        projectId: session.projectId,
        error: (err as Error).message,
      });
    }
  }

  /**
   * Send a reply to a specific inbound Telegram message.
   * Only sends if the messageId matches a pending inbound message (no unsolicited push).
   */
  sendReply(messageId: string, text: string): boolean {
    const pending = this.pendingReplies.get(messageId);
    if (!pending) {
      logger.warn({ module: 'integration-router', msg: 'No pending reply for messageId', messageId });
      return false;
    }

    const adapter = this.adapters.get(pending.platform);
    if (!adapter) {
      logger.warn({ module: 'integration-router', msg: 'No adapter for platform', platform: pending.platform });
      return false;
    }

    adapter.sendMessage({
      platform: pending.platform as 'telegram' | 'slack',
      chatId: pending.chatId,
      text,
      replyToMessageId: messageId,
    }).catch((err) => {
      logger.warn({ module: 'integration-router', msg: 'Reply delivery failed', messageId, error: (err as Error).message });
    });

    // Consume the pending reply
    this.pendingReplies.delete(messageId);
    return true;
  }

  /**
   * Send a message to the Telegram chat bound to a project.
   * Used by the TELEGRAM_SEND command for proactive lead→Telegram messaging
   * without requiring a prior inbound messageId.
   */
  sendToProject(projectId: string, text: string): boolean {
    // Find the session for this project
    const session = this.getSessionByProject(projectId);
    if (!session) {
      logger.warn({ module: 'integration-router', msg: 'No active session for project', projectId });
      return false;
    }

    const adapter = this.adapters.get(session.platform);
    if (!adapter) {
      logger.warn({ module: 'integration-router', msg: 'No adapter for platform', platform: session.platform });
      return false;
    }

    adapter.sendMessage({
      platform: session.platform,
      chatId: session.chatId,
      text,
    }).catch((err) => {
      logger.warn({ module: 'integration-router', msg: 'sendToProject delivery failed', projectId, error: (err as Error).message });
    });

    return true;
  }

  /** Find the active session bound to a given project ID. */
  private getSessionByProject(projectId: string): ChatSession | undefined {
    const now = Date.now();
    for (const [chatId, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(chatId);
        this.notificationBatcher.unsubscribe(chatId, session.projectId);
        continue;
      }
      if (session.projectId === projectId) {
        // Refresh TTL on access
        session.expiresAt = now + SESSION_TTL_MS;
        return session;
      }
    }
    return undefined;
  }

  /** Remove expired entries and enforce max size (FIFO eviction). */
  private pruneExpiredReplies(): void {
    const now = Date.now();
    for (const [id, entry] of this.pendingReplies) {
      if (now - entry.createdAt > IntegrationRouter.PENDING_REPLY_TTL_MS) {
        this.pendingReplies.delete(id);
      }
    }
    // FIFO eviction if over max size
    while (this.pendingReplies.size > IntegrationRouter.PENDING_REPLY_MAX_SIZE) {
      const oldest = this.pendingReplies.keys().next().value;
      if (oldest !== undefined) this.pendingReplies.delete(oldest);
    }
  }

  private handleStatusCommand(): string {
    const agents = this.agentManager.getAll();
    const running = agents.filter(a => a.status === 'running').length;
    const total = agents.length;
    const sessions = this.getAllSessions();

    const lines = [
      '🛩️ *Flightdeck Status*',
      '',
      `Agents: ${running} running / ${total} total`,
      `Active sessions: ${sessions.length}`,
    ];

    if (sessions.length > 0) {
      lines.push('', '*Bound projects:*');
      for (const s of sessions) {
        lines.push(`• \`${s.projectId}\``);
      }
    }

    return lines.join('\n');
  }

  private handleProjectsCommand(): string {
    if (!this.projectRegistry) {
      return 'Project registry not available.';
    }

    try {
      const projects = this.projectRegistry.list();
      if (projects.length === 0) {
        return 'No projects found.';
      }

      const lines = ['📁 *Projects*', ''];
      for (const p of projects.slice(0, 20)) {
        const status = (p as any).status ?? 'unknown';
        lines.push(`• \`${p.id}\` — ${p.name ?? 'Unnamed'} (${status})`);
      }

      if (projects.length > 20) {
        lines.push(`\n_...and ${projects.length - 20} more_`);
      }

      return lines.join('\n');
    } catch {
      return 'Failed to retrieve projects.';
    }
  }

  private handleAgentsCommand(): string {
    const agents = this.agentManager.getAll();
    if (agents.length === 0) {
      return 'No agents currently active.';
    }

    const lines = ['🤖 *Active Agents*', ''];
    for (const a of agents.slice(0, 30)) {
      const roleStr = typeof a.role === 'string' ? a.role : a.role?.id ?? 'unknown';
      const statusEmoji = a.status === 'running' ? '🟢' : a.status === 'idle' ? '🟡' : '⚪';
      lines.push(`${statusEmoji} \`${a.id.slice(0, 8)}\` — ${roleStr} (${a.status})`);
    }

    if (agents.length > 30) {
      lines.push(`\n_...and ${agents.length - 30} more_`);
    }

    return lines.join('\n');
  }

  private cleanExpiredSessions(): void {
    const now = Date.now();
    for (const [chatId, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(chatId);
        this.notificationBatcher.unsubscribe(chatId, session.projectId);
      }
    }
  }

  private handleConfigChange(): void {
    const config = this.configStore.current;
    const telegramConfig = config.telegram;

    const hasTelegram = this.adapters.has('telegram');
    const effectiveToken = process.env.TELEGRAM_BOT_TOKEN || telegramConfig.botToken;

    if (telegramConfig.enabled && effectiveToken && !hasTelegram) {
      // Enable Telegram
      this.startTelegram({ ...telegramConfig, botToken: effectiveToken }).catch(err => {
        logger.warn({ module: 'integration-router', msg: 'Failed to start Telegram on config change', error: (err as Error).message });
      });
    } else if ((!telegramConfig.enabled || !effectiveToken) && hasTelegram) {
      // Disable Telegram
      const adapter = this.adapters.get('telegram');
      if (adapter) {
        adapter.stop().catch((err) => {
          logger.warn({ module: 'integration-router', msg: 'Failed to stop Telegram adapter', error: (err as Error).message });
        });
        this.adapters.delete('telegram');
      }
    }
  }
}

// ── Helpers ──────────────────────────────────────────────

const MAX_INPUT_LENGTH = 4000;

/**
 * Prompt-injection patterns (adopted from knowledge pipeline's 4-layer sanitization).
 * Matched case-insensitively against all user-controlled input.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /ignore\s+(all\s+)?prior\s+instructions/i,
  /disregard\s+(all\s+)?previous/i,
  /override\s+(system|previous)\s+(prompt|instructions)/i,
  /you\s+are\s+now\s+a/i,
  /new\s+instructions?\s*:/i,
  /system\s*:\s*you/i,
  /\bdo\s+not\s+follow\b.*\binstructions\b/i,
  /\bforget\b.*\binstructions\b/i,
  /\bact\s+as\b.*\binstead\b/i,
];

/**
 * Sanitize user input: strip control chars, neutralize injection patterns,
 * trim, and limit length. Adopts the knowledge pipeline's defense-in-depth
 * approach (see knowledge/sanitize.ts).
 */
function sanitizeInput(text: string): string {
  // Layer 1: Remove control characters (except newline/tab) and zero-width chars
  let cleaned = text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '');

  // Layer 2: Strip XML tags that could escape trust boundaries
  cleaned = cleaned.replace(/<\s*\/?\s*project-context\s*>/gi, '[tag-removed]');

  // Layer 3: Neutralize prompt-injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, '[redacted]');
  }

  // Layer 4: Trim and truncate
  return cleaned.trim().slice(0, MAX_INPUT_LENGTH);
}
