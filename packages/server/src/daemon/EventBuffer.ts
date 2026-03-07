/**
 * Bounded event buffer for the daemon.
 *
 * Buffers agent events while the server is disconnected. On reconnect,
 * events are replayed in order. The buffer is bounded per-agent with
 * configurable limits on count and age.
 *
 * Design: packages/docs/design/hot-reload-agent-preservation.md
 *   - Max 100 events per agent, or 30 seconds' worth, whichever is smaller
 *   - FIFO overflow (oldest dropped)
 *   - Start buffering on server disconnect, drain on reconnect
 */
import { randomBytes } from 'node:crypto';
import type { DaemonEvent, DaemonEventType } from './DaemonProtocol.js';

export interface EventBufferOptions {
  /** Maximum events per agent (default: 100) */
  maxEventsPerAgent: number;
  /** Maximum total events across all agents (default: 10000) */
  maxTotalEvents: number;
  /** Maximum age in ms before events are considered stale (default: 30000) */
  maxEventAgeMs: number;
}

const DEFAULT_OPTIONS: EventBufferOptions = {
  maxEventsPerAgent: 100,
  maxTotalEvents: 10000,
  maxEventAgeMs: 30_000,
};

export class EventBuffer {
  private buffers = new Map<string, DaemonEvent[]>();
  private globalBuffer: DaemonEvent[] = [];
  private buffering = false;
  private readonly options: EventBufferOptions;

  constructor(options: Partial<EventBufferOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** Start buffering events (called when server disconnects). */
  startBuffering(): void {
    this.buffering = true;
  }

  /** Stop buffering (called when server reconnects). Does NOT drain. */
  stopBuffering(): void {
    this.buffering = false;
  }

  /** Whether the buffer is currently accumulating events. */
  get isBuffering(): boolean {
    return this.buffering;
  }

  /**
   * Push an event into the buffer. Only stores if buffering is active.
   * Returns true if the event was stored, false if discarded or not buffering.
   */
  push(event: DaemonEvent): boolean {
    if (!this.buffering) return false;

    const agentId = event.agentId ?? '__global__';

    // Per-agent buffer
    if (!this.buffers.has(agentId)) {
      this.buffers.set(agentId, []);
    }
    const agentBuf = this.buffers.get(agentId)!;

    // Enforce per-agent limit (FIFO — drop oldest)
    if (agentBuf.length >= this.options.maxEventsPerAgent) {
      agentBuf.shift();
    }

    agentBuf.push(event);

    // Global buffer tracking
    this.globalBuffer.push(event);

    // Enforce global limit (FIFO — drop oldest across all agents)
    while (this.globalBuffer.length > this.options.maxTotalEvents) {
      const dropped = this.globalBuffer.shift()!;
      const dAgentId = dropped.agentId ?? '__global__';
      const dBuf = this.buffers.get(dAgentId);
      if (dBuf) {
        const idx = dBuf.indexOf(dropped);
        if (idx !== -1) dBuf.splice(idx, 1);
      }
    }

    return true;
  }

  /**
   * Drain all buffered events for an agent, optionally filtering by lastSeenEventId.
   * Returns events in chronological order. Removes them from the buffer.
   */
  drain(agentId?: string, lastSeenEventId?: string): DaemonEvent[] {
    const now = Date.now();
    let events: DaemonEvent[];

    if (agentId) {
      events = this.buffers.get(agentId) ?? [];
      this.buffers.delete(agentId);
    } else {
      // Drain all events
      events = this.globalBuffer.slice();
      this.buffers.clear();
      this.globalBuffer = [];
    }

    // Remove drained events from global buffer
    if (agentId) {
      this.globalBuffer = this.globalBuffer.filter(e => (e.agentId ?? '__global__') !== agentId);
    }

    // Filter by age
    const cutoff = now - this.options.maxEventAgeMs;
    events = events.filter(e => new Date(e.timestamp).getTime() >= cutoff);

    // Filter by lastSeenEventId (replay only events after this ID)
    if (lastSeenEventId) {
      const idx = events.findIndex(e => e.eventId === lastSeenEventId);
      if (idx !== -1) {
        events = events.slice(idx + 1);
      }
      // If not found, return all events (client is too far behind)
    }

    return events;
  }

  /** Get total number of buffered events. */
  get totalCount(): number {
    return this.globalBuffer.length;
  }

  /** Get number of buffered events for a specific agent. */
  countForAgent(agentId: string): number {
    return this.buffers.get(agentId)?.length ?? 0;
  }

  /** Clear all buffered events. */
  clear(): void {
    this.buffers.clear();
    this.globalBuffer = [];
  }

  /** Generate a unique event ID. */
  static generateEventId(): string {
    return `evt-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  }

  /** Create a DaemonEvent with auto-generated ID and timestamp. */
  static createEvent(
    type: DaemonEventType,
    data: Record<string, unknown>,
    agentId?: string,
  ): DaemonEvent {
    return {
      eventId: EventBuffer.generateEventId(),
      timestamp: new Date().toISOString(),
      type,
      agentId,
      data,
    };
  }
}
