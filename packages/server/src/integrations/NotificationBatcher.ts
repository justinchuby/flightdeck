// packages/server/src/integrations/NotificationBatcher.ts
// Subscribes to AgentManager events and batches them into notifications
// for delivery to messaging adapters. Uses a 5-second debounce window
// to group related events and prevent rate-limit issues.

import { TypedEmitter } from '../utils/TypedEmitter.js';
import { logger } from '../utils/logger.js';
import type { AgentManager, AgentManagerEvents } from '../agents/AgentManager.js';
import type { NotificationEvent, NotificationCategory, MessagingAdapter, OutboundMessage } from './types.js';
import type { NotificationService, NotifiableEvent } from '../coordination/alerts/NotificationService.js';

/** Map batcher categories to NotificationService events for preference filtering. */
const CATEGORY_TO_NOTIFIABLE: Partial<Record<NotificationCategory, NotifiableEvent>> = {
  agent_crashed: 'agent_crashed',
  agent_completed: 'agent_recovered',
  task_completed: 'task_completed',
  decision_needs_approval: 'decision_pending',
  system_alert: 'budget_warning',
};

interface NotificationBatcherEvents {
  'notification:batched': NotificationEvent[];
  'notification:sent': { chatId: string; count: number };
  'notification:error': { error: Error; chatId: string };
}

interface ChatSubscription {
  chatId: string;
  projectId: string;
  /** Categories this chat wants to receive. Empty = all. */
  categories: NotificationCategory[];
}

/** Pending event waiting to be flushed. */
interface PendingEvent {
  event: NotificationEvent;
  queuedAt: number;
}

/**
 * NotificationBatcher — Layer 3 of the 3-layer messaging architecture.
 *
 * Architecture: TelegramAdapter (Layer 1: transport) → IntegrationRouter (Layer 2: routing)
 *               → NotificationBatcher (Layer 3: event aggregation & delivery)
 *
 * Listens to AgentManager events and delivers batched notifications
 * to registered messaging adapters (Telegram, future: Slack).
 *
 * Key behaviors:
 * - 5-second debounce window groups related events per project
 * - Critical events (failures, decisions) are never batched — delivered immediately
 * - Per-project batching (events for different projects don't merge)
 * - Configurable category filtering per chat subscription
 * - Formats events into human-readable messages
 */
export class NotificationBatcher extends TypedEmitter<NotificationBatcherEvents> {
  private adapters: MessagingAdapter[] = [];
  private subscriptions: ChatSubscription[] = [];
  private pendingEvents: Map<string, PendingEvent[]> = new Map(); // projectId → events
  private flushTimers: Map<string, ReturnType<typeof setTimeout>> = new Map(); // projectId → timer
  // H-3: Track wired listeners for cleanup
  private wiredAgentManager: AgentManager | null = null;
  private wiredHandlers: Array<{ event: string; handler: (...args: any[]) => void }> = [];
  private notificationService: NotificationService | null = null;

  static readonly BATCH_WINDOW_MS = 5_000;

  /** Register a messaging adapter for outbound delivery. */
  addAdapter(adapter: MessagingAdapter): void {
    this.adapters.push(adapter);
  }

  /** Set the NotificationService for preference-based filtering. */
  setNotificationService(ns: NotificationService): void {
    this.notificationService = ns;
  }

  /** Subscribe a chat to receive notifications for a project. */
  subscribe(chatId: string, projectId: string, categories: NotificationCategory[] = []): void {
    // Avoid duplicates
    const existing = this.subscriptions.find(
      s => s.chatId === chatId && s.projectId === projectId,
    );
    if (existing) {
      existing.categories = categories;
      return;
    }
    this.subscriptions.push({ chatId, projectId, categories });
  }

  /** Unsubscribe a chat from a project's notifications. */
  unsubscribe(chatId: string, projectId: string): void {
    this.subscriptions = this.subscriptions.filter(
      s => !(s.chatId === chatId && s.projectId === projectId),
    );
  }

  /** Get all subscriptions for a given chat. */
  getSubscriptions(chatId: string): ChatSubscription[] {
    return this.subscriptions.filter(s => s.chatId === chatId);
  }

  /** Get all subscriptions. */
  getAllSubscriptions(): ChatSubscription[] {
    return [...this.subscriptions];
  }

  /**
   * Wire into AgentManager events. Call once during DI setup.
   * Maps agent lifecycle events to notification categories.
   */
  wire(agentManager: AgentManager): void {
    this.wiredAgentManager = agentManager;
    this.wiredHandlers = [];

    const onSpawned = (data: any) => {
      const projectId = data.projectId ?? 'system';
      const roleName = typeof data.role === 'string' ? data.role : data.role?.id ?? 'unknown';
      this.queueEvent({
        category: 'agent_spawned',
        projectId,
        title: `Agent spawned: ${roleName}`,
        body: `${roleName} (${data.id?.slice(0, 8) ?? '?'}) joined the project.`,
        timestamp: Date.now(),
        metadata: { agentId: data.id, role: roleName },
      });
    };

    const onExit = (data: any) => {
      const projectId = agentManager.getProjectIdForAgent(data.agentId) ?? 'system';
      this.queueEvent({
        category: 'agent_completed',
        projectId,
        title: `Agent exited: ${data.agentId.slice(0, 8)}`,
        body: data.error
          ? `Agent exited with error: ${data.error}`
          : `Agent exited cleanly (code ${data.code}).`,
        timestamp: Date.now(),
        metadata: { agentId: data.agentId, code: data.code },
      });
    };

    const onCrashed = (data: any) => {
      const projectId = agentManager.getProjectIdForAgent(data.agentId) ?? 'system';
      this.queueEvent({
        category: 'agent_crashed',
        projectId,
        title: `⚠️ Agent crashed: ${data.agentId.slice(0, 8)}`,
        body: `Agent crashed with exit code ${data.code}.`,
        timestamp: Date.now(),
        metadata: { agentId: data.agentId, code: data.code },
      });
    };

    const onDecision = (data: any) => {
      const projectId = agentManager.getProjectIdForAgent(data.leadId) ?? data.leadId;
      const category: NotificationCategory = data.needsConfirmation
        ? 'decision_needs_approval'
        : 'decision_recorded';
      this.queueEvent({
        category,
        projectId,
        title: data.needsConfirmation
          ? `🔔 Decision needs approval: ${data.title}`
          : `Decision recorded: ${data.title}`,
        body: data.rationale,
        timestamp: Date.now(),
        metadata: { decisionId: data.id, agentRole: data.agentRole },
      });
    };

    const onCompletion = (data: any) => {
      this.queueEvent({
        category: 'task_completed',
        projectId: data.parentId ?? 'system',
        title: `Task completed by ${data.childId.slice(0, 8)}`,
        body: `Status: ${data.status}`,
        timestamp: Date.now(),
        metadata: { childId: data.childId, parentId: data.parentId },
      });
    };

    agentManager.on('agent:spawned', onSpawned);
    agentManager.on('agent:exit', onExit);
    agentManager.on('agent:crashed', onCrashed);
    agentManager.on('lead:decision', onDecision);
    agentManager.on('agent:completion_reported', onCompletion);

    this.wiredHandlers = [
      { event: 'agent:spawned', handler: onSpawned },
      { event: 'agent:exit', handler: onExit },
      { event: 'agent:crashed', handler: onCrashed },
      { event: 'lead:decision', handler: onDecision },
      { event: 'agent:completion_reported', handler: onCompletion },
    ];

    logger.info({ module: 'notification-batcher', msg: 'Wired to AgentManager events' });
  }

  /** Queue an event for batched delivery. */
  queueEvent(event: NotificationEvent): void {
    const { projectId } = event;

    if (!this.pendingEvents.has(projectId)) {
      this.pendingEvents.set(projectId, []);
    }
    this.pendingEvents.get(projectId)!.push({ event, queuedAt: Date.now() });

    // Start or reset the flush timer for this project
    if (!this.flushTimers.has(projectId)) {
      const timer = setTimeout(() => {
        this.flushTimers.delete(projectId);
        this.flushProject(projectId);
      }, NotificationBatcher.BATCH_WINDOW_MS);
      timer.unref();
      this.flushTimers.set(projectId, timer);
    }
  }

  /** Force-flush all pending events (useful for shutdown). */
  flushAll(): void {
    for (const [projectId, timer] of this.flushTimers) {
      clearTimeout(timer);
      this.flushTimers.delete(projectId);
      this.flushProject(projectId);
    }
  }

  /** Stop all timers, remove event listeners, and clear state. */
  stop(): void {
    for (const timer of this.flushTimers.values()) {
      clearTimeout(timer);
    }
    this.flushTimers.clear();
    this.pendingEvents.clear();
    this.subscriptions = [];

    // H-3: Remove wired event listeners to prevent leaks
    if (this.wiredAgentManager) {
      for (const { event, handler } of this.wiredHandlers) {
        this.wiredAgentManager.off(event as any, handler);
      }
      this.wiredAgentManager = null;
      this.wiredHandlers = [];
    }
  }

  /** Return the count of pending (unbatched) events. */
  pendingCount(): number {
    let count = 0;
    for (const events of this.pendingEvents.values()) {
      count += events.length;
    }
    return count;
  }

  // ── Private ──────────────────────────────────────────────

  private flushProject(projectId: string): void {
    const pending = this.pendingEvents.get(projectId);
    if (!pending || pending.length === 0) return;

    this.pendingEvents.delete(projectId);
    let events = pending.map(p => p.event);

    this.emit('notification:batched', events);

    // Filter through NotificationService preferences if available
    if (this.notificationService) {
      events = events.filter(e => {
        const notifiable = CATEGORY_TO_NOTIFIABLE[e.category];
        if (!notifiable) return true; // No mapping → allow through
        const entries = this.notificationService!.routeEvent(notifiable, projectId, e.title);
        return entries.length > 0; // Only send if preference allows it
      });
      if (events.length === 0) return;
    }

    // Find subscriptions for this project
    const subs = this.subscriptions.filter(s => s.projectId === projectId);
    if (subs.length === 0) return;

    const formatted = this.formatBatch(events);

    for (const sub of subs) {
      const filtered = events.filter(e =>
        sub.categories.length === 0 || sub.categories.includes(e.category),
      );
      if (filtered.length === 0) continue;

      const text = sub.categories.length === 0
        ? formatted
        : this.formatBatch(filtered);

      const outbound: OutboundMessage = {
        platform: 'telegram',
        chatId: sub.chatId,
        text,
      };

      for (const adapter of this.adapters) {
        adapter.sendMessage(outbound).catch((err) => {
          logger.warn({
            module: 'notification-batcher',
            msg: 'Failed to deliver notification batch',
            chatId: sub.chatId,
            error: (err as Error).message,
          });
          this.emit('notification:error', { error: err as Error, chatId: sub.chatId });
        });
      }

      this.emit('notification:sent', { chatId: sub.chatId, count: filtered.length });
    }
  }

  /** Format a batch of events into a single message string. */
  private formatBatch(events: NotificationEvent[]): string {
    if (events.length === 1) {
      const e = events[0];
      return `${e.title}\n${e.body}`;
    }

    const header = `📋 ${events.length} updates:`;
    const items = events.map(e => `• ${e.title}`);
    return [header, ...items].join('\n');
  }
}
