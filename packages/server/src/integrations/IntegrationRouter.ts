// packages/server/src/integrations/IntegrationRouter.ts
// Deterministic message router — NOT an LLM-powered agent.
// Routes inbound messages from messaging platforms to the correct
// project lead, and formats outbound responses.

import { logger } from '../utils/logger.js';
import type { AgentManager } from '../agents/AgentManager.js';
import type { ProjectRegistry } from '../projects/ProjectRegistry.js';
import type {
  InboundMessage,
  OutboundMessage,
  ChatSession,
  MessagingAdapter,
  TelegramConfig,
} from './types.js';
import { TelegramAdapter } from './TelegramAdapter.js';
import { NotificationBatcher } from './NotificationBatcher.js';
import type { ConfigStore } from '../config/ConfigStore.js';

/** Session TTL: 1 hour. */
const SESSION_TTL_MS = 60 * 60 * 1000;

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
export class IntegrationRouter {
  private adapters: Map<string, MessagingAdapter> = new Map();
  private sessions: Map<string, ChatSession> = new Map(); // chatId → session
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
    const config = this.configStore.current;
    const telegramConfig = config.telegram;

    if (telegramConfig?.enabled && telegramConfig.botToken) {
      const tgConfig = {
        ...telegramConfig,
        // Prefer env var over config file for the bot token
        botToken: process.env.TELEGRAM_BOT_TOKEN || telegramConfig.botToken,
      };
      await this.startTelegram(tgConfig);
    }

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

    // Also subscribe to notifications for this project
    this.notificationBatcher.subscribe(chatId, projectId);

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

  // ── Private ──────────────────────────────────────────────

  private async startTelegram(config: TelegramConfig): Promise<void> {
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
    // Sanitize ALL user-controlled fields — text AND displayName
    // (displayName comes from Telegram profile, attacker-controlled)
    const sanitizedText = sanitizeInput(msg.text);
    const sanitizedDisplayName = sanitizeInput(msg.displayName ?? 'Unknown');
    const sanitizedMsg = { ...msg, text: sanitizedText, displayName: sanitizedDisplayName };

    // Check bind command FIRST — it works even without an existing session
    if (sanitizedText.startsWith('bind ')) {
      const projectId = sanitizedText.slice(5).trim();
      if (!projectId) {
        const adapter = this.adapters.get(msg.platform);
        adapter?.sendMessage({
          platform: msg.platform,
          chatId: msg.chatId,
          text: '⚠️ Usage: bind <project-id>',
        }).catch(() => {});
        return;
      }
      this.bindSession(msg.chatId, msg.platform, projectId, msg.userId);
      const adapter = this.adapters.get(msg.platform);
      if (adapter) {
        adapter.sendMessage({
          platform: msg.platform,
          chatId: msg.chatId,
          text: `✅ Chat bound to project: ${projectId}`,
        }).catch(() => {});
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
        }).catch(() => { /* swallowed — adapter handles logging */ });
      }
      return;
    }

    // Route to project lead via AgentManager
    try {
      const leadAgent = this.agentManager.getByProject(session.projectId)
        .find(a => a.role.id === 'lead' && (a.status === 'running' || a.status === 'idle'));

      if (leadAgent) {
        leadAgent.sendMessage(`[Telegram from ${sanitizedMsg.displayName}]: ${sanitizedMsg.text}`);
      } else {
        const adapter = this.adapters.get(msg.platform);
        adapter?.sendMessage({
          platform: msg.platform,
          chatId: msg.chatId,
          text: '⚠️ No active project lead found for this project. The lead may have exited.',
        }).catch(() => {});
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
        adapter.stop().catch(() => {});
        this.adapters.delete('telegram');
      }
    }
  }
}

// ── Helpers ──────────────────────────────────────────────

const MAX_INPUT_LENGTH = 4000;

/** Sanitize user input: strip control chars, trim, limit length. */
function sanitizeInput(text: string): string {
  // Remove control characters (except newline/tab) and zero-width chars
  const cleaned = text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '')
    .trim();
  return cleaned.slice(0, MAX_INPUT_LENGTH);
}
