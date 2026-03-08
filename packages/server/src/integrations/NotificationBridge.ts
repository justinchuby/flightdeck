// packages/server/src/integrations/NotificationBridge.ts
// Subscribes to AgentManager events and batches them into notifications
// for delivery to messaging adapters. Uses a 5-second debounce window
// to group related events and prevent rate-limit issues.

import { TypedEmitter } from '../utils/TypedEmitter.js';
import { logger } from '../utils/logger.js';
import type { AgentManager, AgentManagerEvents } from '../agents/AgentManager.js';
import type { NotificationEvent, NotificationCategory, MessagingAdapter, OutboundMessage } from './types.js';

interface NotificationBridgeEvents {
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
 * NotificationBridge listens to AgentManager events and forwards
 * batched notifications to registered messaging adapters.
 *
 * Key behaviors:
 * - 5-second debounce window groups related events
 * - Per-project batching (events for different projects don't merge)
 * - Configurable category filtering per chat subscription
 * - Formats events into human-readable messages
 */
export class NotificationBridge extends TypedEmitter<NotificationBridgeEvents> {
  private adapters: MessagingAdapter[] = [];
  private subscriptions: ChatSubscription[] = [];
  private pendingEvents: Map<string, PendingEvent[]> = new Map(); // projectId → events
  private flushTimers: Map<string, ReturnType<typeof setTimeout>> = new Map(); // projectId → timer

  static readonly BATCH_WINDOW_MS = 5_000;

  /** Register a messaging adapter for outbound delivery. */
  addAdapter(adapter: MessagingAdapter): void {
    this.adapters.push(adapter);
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
    agentManager.on('agent:spawned', (data) => {
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
    });

    agentManager.on('agent:exit', (data) => {
      // Agent may already be removed — try to get projectId
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
    });

    agentManager.on('agent:crashed', (data) => {
      const projectId = agentManager.getProjectIdForAgent(data.agentId) ?? 'system';
      this.queueEvent({
        category: 'agent_crashed',
        projectId,
        title: `⚠️ Agent crashed: ${data.agentId.slice(0, 8)}`,
        body: `Agent crashed with exit code ${data.code}.`,
        timestamp: Date.now(),
        metadata: { agentId: data.agentId, code: data.code },
      });
    });

    agentManager.on('lead:decision', (data) => {
      // leadId is the lead agent's ID, not the project ID — resolve it
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
    });

    agentManager.on('agent:completion_reported', (data) => {
      this.queueEvent({
        category: 'task_completed',
        projectId: data.parentId ?? 'system',
        title: `Task completed by ${data.childId.slice(0, 8)}`,
        body: `Status: ${data.status}`,
        timestamp: Date.now(),
        metadata: { childId: data.childId, parentId: data.parentId },
      });
    });

    logger.info({ module: 'notification-bridge', msg: 'Wired to AgentManager events' });
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
      }, NotificationBridge.BATCH_WINDOW_MS);
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

  /** Stop all timers and clear state. */
  stop(): void {
    for (const timer of this.flushTimers.values()) {
      clearTimeout(timer);
    }
    this.flushTimers.clear();
    this.pendingEvents.clear();
    this.subscriptions = [];
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
    const events = pending.map(p => p.event);

    this.emit('notification:batched', events);

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
            module: 'notification-bridge',
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
