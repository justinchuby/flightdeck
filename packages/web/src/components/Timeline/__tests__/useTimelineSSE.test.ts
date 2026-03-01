import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTimelineSSE } from '../useTimelineSSE';
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
});
