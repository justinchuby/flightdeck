import { logger } from '../../utils/logger.js';
import type { ActivityEntry, ActionType } from '../activity/ActivityLedger.js';

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

export interface EventPipelineOptions {
  /** Called whenever an event is dropped due to queue overflow */
  onEventDropped?: (droppedEvent: PipelineEvent) => void;
}

export class EventPipeline {
  private handlers: EventHandler[] = [];
  private processing = false;
  private queue: PipelineEvent[] = [];
  private seenEventIds = new Set<string>();
  private _dropCount = 0;
  private onEventDropped?: (droppedEvent: PipelineEvent) => void;

  constructor(options?: EventPipelineOptions) {
    this.onEventDropped = options?.onEventDropped;
  }

  /** Number of events dropped due to queue overflow */
  get dropCount(): number {
    return this._dropCount;
  }

  register(handler: EventHandler): void {
    this.handlers.push(handler);
    logger.info({ module: 'coordination', msg: 'Handler registered', handlerName: handler.name, events: handler.eventTypes === '*' ? 'all events' : handler.eventTypes.join(', ') });
  }

  /** Enqueue an event from ActivityLedger. Processes async without blocking the caller. */
  emit(entry: ActivityEntry): void {
    // ULID dedup guard: skip events already seen (e.g. SSE reconnect replay)
    const eventKey = `${entry.agentId}:${entry.actionType}:${entry.timestamp}`;
    if (entry.id !== 0 && this.seenEventIds.has(eventKey)) {
      return;
    }
    this.seenEventIds.add(eventKey);

    // Cap dedup set to prevent unbounded memory growth
    if (this.seenEventIds.size > MAX_QUEUE_SIZE * 2) {
      const iter = this.seenEventIds.values();
      for (let i = 0; i < MAX_QUEUE_SIZE; i++) {
        this.seenEventIds.delete(iter.next().value as string);
      }
    }

    if (this.queue.length >= MAX_QUEUE_SIZE) {
      const dropped: PipelineEvent = { entry: this.queue.shift()!.entry, meta: {} };
      this._dropCount++;
      logger.warn({ module: 'coordination', msg: 'Queue full, dropping oldest event', queueSize: MAX_QUEUE_SIZE, totalDrops: this._dropCount });
      this.onEventDropped?.(dropped);
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
          logger.warn({ module: 'coordination', msg: 'Handler failed', handlerName: handler.name, actionType: event.entry.actionType, error: (err as Error).message });
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
  connectToLedger(ledger: import('../activity/ActivityLedger.js').ActivityLedger): void {
    ledger.on('activity', (entry: ActivityEntry) => this.emit(entry));
    logger.info({ module: 'coordination', msg: 'Connected to ActivityLedger', handlerCount: this.handlers.length });
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
    logger.info({ module: 'coordination', msg: 'Task completed', agentRole: agent, agentId: entry.agentId, task });
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
      logger.info({ module: 'coordination', msg: 'Commit detected', agentRole: entry.agentRole, agentId: entry.agentId });
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
    logger.info({ module: 'coordination', msg: 'New delegation', fromRole: entry.agentRole, toRole: to, toAgentId: entry.details.toAgentId, summary: entry.summary });
  },
};
