import { logger } from '../utils/logger.js';
import type { ActivityEntry, ActionType } from './ActivityLedger.js';

// ── Types ─────────────────────────────────────────────────────────

export interface PipelineEvent {
  entry: ActivityEntry;
  /** Context bag for handlers to pass data downstream */
  meta: Record<string, unknown>;
}

export interface EventHandler {
  /** Which action types this handler reacts to ('*' = all) */
  eventTypes: ActionType[] | '*';
  /** Descriptive name for logging */
  name: string;
  /** Handler function — errors are caught and logged, never propagate */
  handle: (event: PipelineEvent) => Promise<void> | void;
}

// ── Pipeline ──────────────────────────────────────────────────────

const MAX_QUEUE_SIZE = 10_000;

export class EventPipeline {
  private handlers: EventHandler[] = [];
  private processing = false;
  private queue: PipelineEvent[] = [];

  register(handler: EventHandler): void {
    this.handlers.push(handler);
    logger.info('pipeline', `Registered handler: ${handler.name} for ${
      handler.eventTypes === '*' ? 'all events' : handler.eventTypes.join(', ')
    }`);
  }

  /** Enqueue an event from ActivityLedger. Processes async without blocking the caller. */
  emit(entry: ActivityEntry): void {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      this.queue.shift();
      logger.warn('pipeline', `Queue full (${MAX_QUEUE_SIZE}) — dropping oldest event`);
    }
    this.queue.push({ entry, meta: {} });
    if (!this.processing) {
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    this.processing = true;
    while (this.queue.length > 0) {
      const event = this.queue.shift()!;
      const matching = this.handlers.filter(h =>
        h.eventTypes === '*' || h.eventTypes.includes(event.entry.actionType),
      );
      for (const handler of matching) {
        try {
          await handler.handle(event);
        } catch (err) {
          logger.warn('pipeline', `Handler "${handler.name}" failed for ${event.entry.actionType}: ${(err as Error).message}`);
        }
      }
    }
    this.processing = false;
  }

  getHandlers(): { name: string; eventTypes: string }[] {
    return this.handlers.map(h => ({
      name: h.name,
      eventTypes: h.eventTypes === '*' ? '*' : h.eventTypes.join(', '),
    }));
  }

  /** Subscribe to an ActivityLedger's 'activity' events */
  connectToLedger(ledger: import('./ActivityLedger.js').ActivityLedger): void {
    ledger.on('activity', (entry: ActivityEntry) => this.emit(entry));
    logger.info('pipeline', `Connected to ActivityLedger with ${this.handlers.length} handler(s)`);
  }
}

// ── Built-in handlers ─────────────────────────────────────────────

/** Logs task completion summaries for lead visibility */
export const taskCompletedHandler: EventHandler = {
  eventTypes: ['task_completed'],
  name: 'task-completed-summary',
  handle: (event) => {
    const { entry } = event;
    const agent = entry.details.agentRole || entry.agentRole;
    const task = entry.details.task || entry.summary;
    logger.info('pipeline', `✅ Task completed by ${agent} (${entry.agentId.slice(0, 8)}): ${task.slice(0, 120)}`);
  },
};

/** Logs commit events and flags that tests should be queued */
export const commitQualityGateHandler: EventHandler = {
  eventTypes: ['file_edit'],
  name: 'commit-quality-gate',
  handle: (event) => {
    const { entry, meta } = event;
    if (entry.details.type === 'commit' || entry.summary.includes('commit')) {
      meta.shouldRunTests = true;
      logger.info('pipeline', `📋 Commit detected from ${entry.agentRole} (${entry.agentId.slice(0, 8)}) — tests should be queued`);
    }
  },
};

/** Logs delegation events for coordination awareness */
export const delegationTracker: EventHandler = {
  eventTypes: ['delegated'],
  name: 'delegation-tracker',
  handle: (event) => {
    const { entry } = event;
    const to = entry.details.toRole || 'unknown';
    const toId = (entry.details.toAgentId || '').slice(0, 8);
    logger.info('pipeline', `📨 New delegation: ${entry.agentRole} → ${to} (${toId}): ${entry.summary.slice(0, 100)}`);
  },
};
