import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimelineSSE, mergeCommEvent } from '../useTimelineSSE';
import type { TimelineData } from '../useTimelineData';

// ── Mock EventSource ──────────────────────────────────────────────────

type EventSourceListener = (event: MessageEvent) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  url: string;
  readyState = MockEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  private listeners = new Map<string, EventSourceListener[]>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventSourceListener) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  removeEventListener(type: string, listener: EventSourceListener) {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(type, existing.filter(l => l !== listener));
  }

  close() {
    this.readyState = MockEventSource.CLOSED;
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockEventSource.OPEN;
    this.onopen?.();
  }

  simulateEvent(type: string, data: any, lastEventId?: string) {
    const event = new MessageEvent(type, {
      data: JSON.stringify(data),
      lastEventId: lastEventId ?? '',
    });
    const listeners = this.listeners.get(type) ?? [];
    for (const listener of listeners) {
      listener(event);
    }
  }

  simulateError() {
    this.readyState = MockEventSource.CLOSED;
    this.onerror?.();
  }
}

// ── Test fixtures ─────────────────────────────────────────────────────

const BASE_TIME = new Date('2026-03-01T10:00:00Z').getTime();
function ts(offsetSec: number): string {
  return new Date(BASE_TIME + offsetSec * 1000).toISOString();
}

function makeTimelineData(overrides?: Partial<TimelineData>): TimelineData {
  return {
    agents: [{
      id: 'agent-1',
      shortId: 'agent-1',
      role: 'developer',
      createdAt: ts(0),
      segments: [{ status: 'running', startAt: ts(0) }],
    }],
    communications: [],
    locks: [],
    timeRange: { start: ts(0), end: ts(300) },
    ...overrides,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────

describe('useTimelineSSE', () => {
  it('starts in connecting state', () => {
    const { result } = renderHook(() => useTimelineSSE('lead-1'));
    expect(result.current.connectionHealth).toBe('connecting');
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
  });

  it('does not connect when leadId is null', () => {
    renderHook(() => useTimelineSSE(null));
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('creates EventSource with correct URL', () => {
    renderHook(() => useTimelineSSE('lead-1'));
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toContain('leadId=lead-1');
    expect(MockEventSource.instances[0].url).toContain('/api/coordination/timeline/stream');
  });

  it('transitions to connected on init event', async () => {
    const { result } = renderHook(() => useTimelineSSE('lead-1'));
    const es = MockEventSource.instances[0];

    const timelineData = makeTimelineData();

    act(() => {
      es.simulateOpen();
      es.simulateEvent('init', timelineData, 'evt-1');
    });

    expect(result.current.connectionHealth).toBe('connected');
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual(timelineData);
    expect(result.current.error).toBeNull();
  });

  it('merges activity events incrementally', async () => {
    const { result } = renderHook(() => useTimelineSSE('lead-1'));
    const es = MockEventSource.instances[0];

    act(() => {
      es.simulateOpen();
      es.simulateEvent('init', makeTimelineData(), 'evt-1');
    });

    // Send a communication event
    act(() => {
      es.simulateEvent('activity', {
        entry: {
          id: 1,
          agentId: 'agent-1',
          agentRole: 'developer',
          actionType: 'message_sent',
          summary: 'Hello world',
          details: { toAgentId: 'agent-2' },
          timestamp: ts(100),
        },
      }, 'evt-2');
    });

    expect(result.current.data!.communications).toHaveLength(1);
    expect(result.current.data!.communications[0].summary).toBe('Hello world');
  });

  it('merges lock events', async () => {
    const { result } = renderHook(() => useTimelineSSE('lead-1'));
    const es = MockEventSource.instances[0];

    act(() => {
      es.simulateOpen();
      es.simulateEvent('init', makeTimelineData(), 'evt-1');
    });

    // Lock acquired
    act(() => {
      es.simulateEvent('lock', {
        type: 'acquired',
        agentId: 'agent-1',
        filePath: 'src/index.ts',
        timestamp: ts(50),
      }, 'evt-2');
    });

    expect(result.current.data!.locks).toHaveLength(1);
    expect(result.current.data!.locks[0].filePath).toBe('src/index.ts');
    expect(result.current.data!.locks[0].releasedAt).toBeUndefined();

    // Lock released
    act(() => {
      es.simulateEvent('lock', {
        type: 'released',
        agentId: 'agent-1',
        filePath: 'src/index.ts',
        timestamp: ts(100),
      }, 'evt-3');
    });

    expect(result.current.data!.locks[0].releasedAt).toBe(ts(100));
  });

  it('deduplicates events by ID', async () => {
    const { result } = renderHook(() => useTimelineSSE('lead-1'));
    const es = MockEventSource.instances[0];

    act(() => {
      es.simulateOpen();
      es.simulateEvent('init', makeTimelineData(), 'evt-1');
    });

    const activityEntry = {
      entry: {
        id: 1,
        agentId: 'agent-1',
        agentRole: 'developer',
        actionType: 'delegated',
        summary: 'Delegate task',
        details: { childId: 'agent-2' },
        timestamp: ts(100),
      },
    };

    // Send same event twice with same ID
    act(() => {
      es.simulateEvent('activity', activityEntry, 'evt-2');
    });
    act(() => {
      es.simulateEvent('activity', activityEntry, 'evt-2');
    });

    // Should only appear once
    expect(result.current.data!.communications).toHaveLength(1);
  });

  it('marks sseUnavailable after max consecutive failures', async () => {
    const { result } = renderHook(() => useTimelineSSE('lead-1'));

    // Simulate 3 consecutive failures
    for (let i = 0; i < 3; i++) {
      const es = MockEventSource.instances[MockEventSource.instances.length - 1];
      act(() => {
        es.simulateError();
      });
      if (i < 2) {
        // After error, wait for reconnect timer
        act(() => {
          vi.advanceTimersByTime(30_000);
        });
      }
    }

    expect(result.current.sseUnavailable).toBe(true);
    expect(result.current.connectionHealth).toBe('offline');
  });

  it('handles reconnect event with full data refresh', async () => {
    const { result } = renderHook(() => useTimelineSSE('lead-1'));
    const es = MockEventSource.instances[0];

    const refreshedData = makeTimelineData({
      agents: [
        { id: 'agent-1', shortId: 'agent-1', role: 'developer', createdAt: ts(0), segments: [] },
        { id: 'agent-2', shortId: 'agent-2', role: 'architect', createdAt: ts(50), segments: [] },
      ],
    });

    act(() => {
      es.simulateOpen();
      es.simulateEvent('reconnect', refreshedData, 'evt-reconnect');
    });

    expect(result.current.data!.agents).toHaveLength(2);
    expect(result.current.connectionHealth).toBe('connected');
  });

  it('cleans up EventSource on unmount', () => {
    const { unmount } = renderHook(() => useTimelineSSE('lead-1'));
    const es = MockEventSource.instances[0];

    unmount();
    expect(es.readyState).toBe(MockEventSource.CLOSED);
  });

  it('reconnect clears data and creates new connection', async () => {
    const { result } = renderHook(() => useTimelineSSE('lead-1'));
    const es1 = MockEventSource.instances[0];

    // Establish initial connection with data
    act(() => {
      es1.simulateOpen();
      es1.simulateEvent('init', makeTimelineData(), 'evt-1');
    });
    expect(result.current.data).not.toBeNull();
    expect(result.current.connectionHealth).toBe('connected');

    // Call reconnect
    act(() => {
      result.current.reconnect();
    });

    // Old connection should be closed
    expect(es1.readyState).toBe(MockEventSource.CLOSED);
    // Data should be cleared
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
    expect(result.current.connectionHealth).toBe('connecting');
    // New connection should be created
    expect(MockEventSource.instances.length).toBe(2);
  });

  it('updates time range when new events arrive', async () => {
    const { result } = renderHook(() => useTimelineSSE('lead-1'));
    const es = MockEventSource.instances[0];

    act(() => {
      es.simulateOpen();
      es.simulateEvent('init', makeTimelineData(), 'evt-1');
    });

    const laterTimestamp = ts(600);
    act(() => {
      es.simulateEvent('activity', {
        entry: {
          id: 2,
          agentId: 'agent-1',
          agentRole: 'developer',
          actionType: 'status_change',
          summary: 'Status: completed',
          details: {},
          timestamp: laterTimestamp,
        },
      }, 'evt-3');
    });

    expect(result.current.data!.timeRange.end).toBe(laterTimestamp);
  });

  it('adds new agents from status_change events', async () => {
    const { result } = renderHook(() => useTimelineSSE('lead-1'));
    const es = MockEventSource.instances[0];

    act(() => {
      es.simulateOpen();
      es.simulateEvent('init', makeTimelineData(), 'evt-1');
    });

    // New agent appears via status_change
    act(() => {
      es.simulateEvent('activity', {
        entry: {
          id: 3,
          agentId: 'agent-new',
          agentRole: 'architect',
          actionType: 'status_change',
          summary: 'Status: running',
          details: {},
          timestamp: ts(200),
        },
      }, 'evt-4');
    });

    expect(result.current.data!.agents).toHaveLength(2);
    const newAgent = result.current.data!.agents.find(a => a.id === 'agent-new');
    expect(newAgent).toBeDefined();
    expect(newAgent!.role).toBe('architect');
    expect(newAgent!.segments).toHaveLength(1);
    expect(newAgent!.segments[0].status).toBe('running');
  });

  // ── Tab visibility (P2-2) ───────────────────────────────────────────

  it('does not count background errors against failure budget', () => {
    const { result } = renderHook(() => useTimelineSSE('lead-1'));

    // Go to background
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Simulate 3 errors while hidden
    for (let i = 0; i < 3; i++) {
      const es = MockEventSource.instances[MockEventSource.instances.length - 1];
      act(() => { es.simulateError(); });
      act(() => { vi.advanceTimersByTime(30_000); });
    }

    // Should NOT have fallen back to polling
    expect(result.current.sseUnavailable).toBe(false);

    // Restore visibility
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
  });

  it('resets error budget and reconnects on tab return', () => {
    const { result } = renderHook(() => useTimelineSSE('lead-1'));
    const initialEs = MockEventSource.instances[0];

    // Accumulate 2 errors (one short of max)
    act(() => { initialEs.simulateError(); });
    act(() => { vi.advanceTimersByTime(30_000); });
    act(() => {
      MockEventSource.instances[MockEventSource.instances.length - 1].simulateError();
    });
    act(() => { vi.advanceTimersByTime(30_000); });

    const instanceCountBefore = MockEventSource.instances.length;

    // Go to background then return
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Close the current EventSource to simulate background disconnect
    const currentEs = MockEventSource.instances[MockEventSource.instances.length - 1];
    currentEs.readyState = MockEventSource.CLOSED;

    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Should have created a new EventSource (reconnected)
    expect(MockEventSource.instances.length).toBeGreaterThan(instanceCountBefore);
    // Should NOT be in offline state
    expect(result.current.sseUnavailable).toBe(false);
  });

  it('pauses reconnect timer when tab goes to background', () => {
    const { result } = renderHook(() => useTimelineSSE('lead-1'));
    const es = MockEventSource.instances[0];

    // Trigger error to schedule a reconnect timer
    act(() => { es.simulateError(); });

    const instanceCountAfterError = MockEventSource.instances.length;

    // Go to background — should clear the pending reconnect timer
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Advance past the reconnect delay — timer should have been cleared
    act(() => { vi.advanceTimersByTime(60_000); });

    // No new EventSource should have been created by the paused timer
    expect(MockEventSource.instances.length).toBe(instanceCountAfterError);

    // Return to foreground — should reconnect
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(MockEventSource.instances.length).toBeGreaterThan(instanceCountAfterError);
    expect(result.current.sseUnavailable).toBe(false);
  });

  // ── Stale timer cleanup (P1-1) ─────────────────────────────────────

  it('clears stale reconnect timer before scheduling new one', () => {
    renderHook(() => useTimelineSSE('lead-1'));
    const es = MockEventSource.instances[0];

    // First error schedules a reconnect timer
    act(() => { es.simulateError(); });

    // Before the timer fires, trigger another error on same EventSource
    // (e.g., browser fires multiple error events)
    act(() => { es.simulateError(); });

    // Advance timers — should only see one reconnect attempt, not two
    const instancesBefore = MockEventSource.instances.length;
    act(() => { vi.advanceTimersByTime(30_000); });

    // At most 1 new EventSource from the single surviving timer
    expect(MockEventSource.instances.length - instancesBefore).toBeLessThanOrEqual(1);
  });

  // ── Real-time comm:update events (P2-7) ─────────────────────────

  it('merges comm:update events into communications', () => {
    const { result } = renderHook(() => useTimelineSSE('lead-1'));
    const es = MockEventSource.instances[0];

    act(() => {
      es.simulateOpen();
      es.simulateEvent('init', makeTimelineData(), 'evt-1');
    });

    act(() => {
      es.simulateEvent('comm:update', {
        comm: {
          type: 'delegation',
          fromAgentId: 'agent-1',
          toAgentId: 'agent-2',
          summary: 'Delegated task',
          timestamp: ts(100),
        },
      }, 'evt-comm-1');
    });

    expect(result.current.data!.communications).toHaveLength(1);
    expect(result.current.data!.communications[0]).toEqual({
      type: 'delegation',
      fromAgentId: 'agent-1',
      toAgentId: 'agent-2',
      summary: 'Delegated task',
      timestamp: ts(100),
    });
  });

  it('merges comm:update for group messages (null toAgentId)', () => {
    const { result } = renderHook(() => useTimelineSSE('lead-1'));
    const es = MockEventSource.instances[0];

    act(() => {
      es.simulateOpen();
      es.simulateEvent('init', makeTimelineData(), 'evt-1');
    });

    act(() => {
      es.simulateEvent('comm:update', {
        comm: {
          type: 'group_message',
          fromAgentId: 'agent-1',
          toAgentId: null,
          groupName: 'design-team',
          summary: 'Group update',
          timestamp: ts(200),
        },
      }, 'evt-comm-2');
    });

    expect(result.current.data!.communications).toHaveLength(1);
    const comm = result.current.data!.communications[0];
    expect(comm.type).toBe('group_message');
    expect(comm.groupName).toBe('design-team');
  });

  it('updates timeRange when comm:update has later timestamp', () => {
    const { result } = renderHook(() => useTimelineSSE('lead-1'));
    const es = MockEventSource.instances[0];

    act(() => {
      es.simulateOpen();
      es.simulateEvent('init', makeTimelineData(), 'evt-1');
    });

    const laterTimestamp = ts(999);
    act(() => {
      es.simulateEvent('comm:update', {
        comm: {
          type: 'message',
          fromAgentId: 'agent-1',
          toAgentId: 'agent-2',
          summary: 'Late message',
          timestamp: laterTimestamp,
        },
      }, 'evt-comm-3');
    });

    expect(result.current.data!.timeRange.end).toBe(laterTimestamp);
  });

  it('deduplicates comm:update events by event ID', () => {
    const { result } = renderHook(() => useTimelineSSE('lead-1'));
    const es = MockEventSource.instances[0];

    act(() => {
      es.simulateOpen();
      es.simulateEvent('init', makeTimelineData(), 'evt-1');
    });

    const commData = {
      comm: {
        type: 'message',
        fromAgentId: 'agent-1',
        toAgentId: 'agent-2',
        summary: 'Hello',
        timestamp: ts(100),
      },
    };

    // Send same comm event twice with same ID
    act(() => { es.simulateEvent('comm:update', commData, 'evt-dup'); });
    act(() => { es.simulateEvent('comm:update', commData, 'evt-dup'); });

    expect(result.current.data!.communications).toHaveLength(1);
  });

  it('accumulates multiple comm:update events', () => {
    const { result } = renderHook(() => useTimelineSSE('lead-1'));
    const es = MockEventSource.instances[0];

    act(() => {
      es.simulateOpen();
      es.simulateEvent('init', makeTimelineData(), 'evt-1');
    });

    act(() => {
      es.simulateEvent('comm:update', {
        comm: { type: 'delegation', fromAgentId: 'a', toAgentId: 'b', summary: 'del', timestamp: ts(10) },
      }, 'c1');
    });
    act(() => {
      es.simulateEvent('comm:update', {
        comm: { type: 'message', fromAgentId: 'b', toAgentId: 'a', summary: 'msg', timestamp: ts(20) },
      }, 'c2');
    });
    act(() => {
      es.simulateEvent('comm:update', {
        comm: { type: 'broadcast', fromAgentId: 'a', toAgentId: 'all', summary: 'bcast', timestamp: ts(30) },
      }, 'c3');
    });

    expect(result.current.data!.communications).toHaveLength(3);
    expect(result.current.data!.communications.map(c => c.type)).toEqual([
      'delegation', 'message', 'broadcast',
    ]);
  });
});

// ── mergeCommEvent unit tests ──────────────────────────────────────

describe('mergeCommEvent', () => {
  it('appends communication to existing data', () => {
    const prev = makeTimelineData({ communications: [] });
    const comm = {
      type: 'message',
      fromAgentId: 'a1',
      toAgentId: 'a2',
      summary: 'Hello',
      timestamp: ts(50),
    };

    const result = mergeCommEvent(prev, comm);
    expect(result.communications).toHaveLength(1);
    expect(result.communications[0].fromAgentId).toBe('a1');
    expect(result.communications[0].toAgentId).toBe('a2');
  });

  it('preserves existing communications', () => {
    const existing = {
      type: 'delegation' as const,
      fromAgentId: 'x',
      toAgentId: 'y',
      summary: 'Old',
      timestamp: ts(10),
    };
    const prev = makeTimelineData({ communications: [existing] });
    const comm = {
      type: 'message',
      fromAgentId: 'a1',
      toAgentId: 'a2',
      summary: 'New',
      timestamp: ts(50),
    };

    const result = mergeCommEvent(prev, comm);
    expect(result.communications).toHaveLength(2);
    expect(result.communications[0].summary).toBe('Old');
    expect(result.communications[1].summary).toBe('New');
  });

  it('extends timeRange.end when comm timestamp is later', () => {
    const prev = makeTimelineData();
    const comm = {
      type: 'message',
      fromAgentId: 'a1',
      toAgentId: 'a2',
      summary: 'test',
      timestamp: ts(9999),
    };

    const result = mergeCommEvent(prev, comm);
    expect(result.timeRange.end).toBe(ts(9999));
    expect(result.timeRange.start).toBe(prev.timeRange.start);
  });

  it('does not shrink timeRange.end for earlier timestamp', () => {
    const prev = makeTimelineData();
    const comm = {
      type: 'message',
      fromAgentId: 'a1',
      toAgentId: 'a2',
      summary: 'early',
      timestamp: ts(1),
    };

    const result = mergeCommEvent(prev, comm);
    expect(result.timeRange.end).toBe(prev.timeRange.end);
  });

  it('handles null toAgentId for group messages', () => {
    const prev = makeTimelineData();
    const comm = {
      type: 'group_message',
      fromAgentId: 'a1',
      toAgentId: null,
      groupName: 'devs',
      summary: 'group msg',
      timestamp: ts(50),
    };

    const result = mergeCommEvent(prev, comm);
    expect(result.communications[0].toAgentId).toBeUndefined();
    expect(result.communications[0].groupName).toBe('devs');
  });

  it('caps communications at 500 entries (sliding window)', () => {
    const prev = makeTimelineData();
    // Pre-fill with 500 entries
    for (let i = 0; i < 500; i++) {
      prev.communications.push({
        type: 'message' as const,
        fromAgentId: 'a1',
        toAgentId: 'a2',
        summary: `msg-${i}`,
        timestamp: ts(i),
      });
    }
    expect(prev.communications.length).toBe(500);

    const comm = {
      type: 'message',
      fromAgentId: 'a1',
      toAgentId: 'a2',
      summary: 'newest',
      timestamp: ts(600),
    };

    const result = mergeCommEvent(prev, comm);
    expect(result.communications.length).toBe(500);
    // Oldest entry dropped, newest appended
    expect(result.communications[0].summary).toBe('msg-1');
    expect(result.communications[499].summary).toBe('newest');
  });
});
