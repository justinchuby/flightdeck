import { describe, it, expect, beforeEach } from 'vitest';
import { EventBuffer } from '../daemon/EventBuffer.js';
import type { DaemonEvent } from '../daemon/DaemonProtocol.js';

function makeEvent(overrides: Partial<DaemonEvent> = {}): DaemonEvent {
  return {
    eventId: EventBuffer.generateEventId(),
    timestamp: new Date().toISOString(),
    type: 'agent:status',
    agentId: 'agent-1',
    data: { status: 'running' },
    ...overrides,
  };
}

describe('EventBuffer', () => {
  let buffer: EventBuffer;

  beforeEach(() => {
    buffer = new EventBuffer();
  });

  // ── Buffering state ─────────────────────────────────────────

  it('starts not buffering', () => {
    expect(buffer.isBuffering).toBe(false);
  });

  it('can be toggled between buffering and not', () => {
    buffer.startBuffering();
    expect(buffer.isBuffering).toBe(true);
    buffer.stopBuffering();
    expect(buffer.isBuffering).toBe(false);
  });

  it('discards events when not buffering', () => {
    const stored = buffer.push(makeEvent());
    expect(stored).toBe(false);
    expect(buffer.totalCount).toBe(0);
  });

  it('stores events when buffering', () => {
    buffer.startBuffering();
    const stored = buffer.push(makeEvent());
    expect(stored).toBe(true);
    expect(buffer.totalCount).toBe(1);
  });

  // ── Per-agent buffering ─────────────────────────────────────

  it('tracks events per agent', () => {
    buffer.startBuffering();
    buffer.push(makeEvent({ agentId: 'agent-1' }));
    buffer.push(makeEvent({ agentId: 'agent-1' }));
    buffer.push(makeEvent({ agentId: 'agent-2' }));

    expect(buffer.countForAgent('agent-1')).toBe(2);
    expect(buffer.countForAgent('agent-2')).toBe(1);
    expect(buffer.totalCount).toBe(3);
  });

  it('drains events for a specific agent', () => {
    buffer.startBuffering();
    buffer.push(makeEvent({ agentId: 'agent-1', data: { n: 1 } }));
    buffer.push(makeEvent({ agentId: 'agent-2', data: { n: 2 } }));
    buffer.push(makeEvent({ agentId: 'agent-1', data: { n: 3 } }));

    const events = buffer.drain('agent-1');
    expect(events).toHaveLength(2);
    expect(events[0].data.n).toBe(1);
    expect(events[1].data.n).toBe(3);

    // agent-1 events removed, agent-2 still there
    expect(buffer.countForAgent('agent-1')).toBe(0);
    expect(buffer.countForAgent('agent-2')).toBe(1);
    expect(buffer.totalCount).toBe(1);
  });

  it('drains all events when no agent specified', () => {
    buffer.startBuffering();
    buffer.push(makeEvent({ agentId: 'agent-1' }));
    buffer.push(makeEvent({ agentId: 'agent-2' }));

    const events = buffer.drain();
    expect(events).toHaveLength(2);
    expect(buffer.totalCount).toBe(0);
  });

  // ── Per-agent overflow ──────────────────────────────────────

  it('enforces per-agent limit (FIFO)', () => {
    buffer = new EventBuffer({ maxEventsPerAgent: 3 });
    buffer.startBuffering();

    for (let i = 0; i < 5; i++) {
      buffer.push(makeEvent({ agentId: 'agent-1', data: { n: i } }));
    }

    expect(buffer.countForAgent('agent-1')).toBe(3);
    const events = buffer.drain('agent-1');
    expect(events[0].data.n).toBe(2); // oldest 2 dropped
    expect(events[1].data.n).toBe(3);
    expect(events[2].data.n).toBe(4);
  });

  // ── Global overflow ─────────────────────────────────────────

  it('enforces global limit (FIFO)', () => {
    buffer = new EventBuffer({ maxTotalEvents: 5 });
    buffer.startBuffering();

    for (let i = 0; i < 8; i++) {
      buffer.push(makeEvent({ agentId: `agent-${i % 3}`, data: { n: i } }));
    }

    expect(buffer.totalCount).toBe(5);
  });

  // ── Age-based filtering ─────────────────────────────────────

  it('filters out stale events on drain', () => {
    buffer = new EventBuffer({ maxEventAgeMs: 1000 });
    buffer.startBuffering();

    const oldEvent = makeEvent({
      agentId: 'agent-1',
      timestamp: new Date(Date.now() - 5000).toISOString(),
    });
    const newEvent = makeEvent({ agentId: 'agent-1' });

    buffer.push(oldEvent);
    buffer.push(newEvent);

    const events = buffer.drain('agent-1');
    expect(events).toHaveLength(1);
    expect(events[0].eventId).toBe(newEvent.eventId);
  });

  // ── lastSeenEventId filtering ─────────────────────────────

  it('replays only events after lastSeenEventId', () => {
    buffer.startBuffering();
    const e1 = makeEvent({ agentId: 'agent-1', data: { n: 1 } });
    const e2 = makeEvent({ agentId: 'agent-1', data: { n: 2 } });
    const e3 = makeEvent({ agentId: 'agent-1', data: { n: 3 } });

    buffer.push(e1);
    buffer.push(e2);
    buffer.push(e3);

    const events = buffer.drain('agent-1', e1.eventId);
    expect(events).toHaveLength(2);
    expect(events[0].eventId).toBe(e2.eventId);
    expect(events[1].eventId).toBe(e3.eventId);
  });

  it('returns all events if lastSeenEventId not found', () => {
    buffer.startBuffering();
    buffer.push(makeEvent({ agentId: 'agent-1' }));
    buffer.push(makeEvent({ agentId: 'agent-1' }));

    const events = buffer.drain('agent-1', 'nonexistent-id');
    expect(events).toHaveLength(2);
  });

  // ── Clear ───────────────────────────────────────────────────

  it('clears all events', () => {
    buffer.startBuffering();
    buffer.push(makeEvent({ agentId: 'agent-1' }));
    buffer.push(makeEvent({ agentId: 'agent-2' }));

    buffer.clear();
    expect(buffer.totalCount).toBe(0);
    expect(buffer.countForAgent('agent-1')).toBe(0);
  });

  // ── Event creation helpers ────────────────────────────────

  it('generates unique event IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(EventBuffer.generateEventId());
    }
    expect(ids.size).toBe(100);
  });

  it('creates events with auto-generated fields', () => {
    const event = EventBuffer.createEvent('agent:spawned', { pid: 1234 }, 'agent-1');
    expect(event.eventId).toMatch(/^evt-/);
    expect(event.timestamp).toBeTruthy();
    expect(event.type).toBe('agent:spawned');
    expect(event.agentId).toBe('agent-1');
    expect(event.data.pid).toBe(1234);
  });

  it('creates events without agentId', () => {
    const event = EventBuffer.createEvent('daemon:shutting_down', { persist: true });
    expect(event.agentId).toBeUndefined();
  });

  // ── Edge cases ──────────────────────────────────────────────

  it('handles events without agentId', () => {
    buffer.startBuffering();
    const event = makeEvent({ agentId: undefined });
    buffer.push(event);
    expect(buffer.totalCount).toBe(1);

    const events = buffer.drain();
    expect(events).toHaveLength(1);
  });

  it('returns empty array for unknown agent', () => {
    const events = buffer.drain('nonexistent');
    expect(events).toHaveLength(0);
  });
});
