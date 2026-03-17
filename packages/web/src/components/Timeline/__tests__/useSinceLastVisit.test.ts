import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSinceLastVisit } from '../useSinceLastVisit';

// ── localStorage mock (jsdom doesn't support it for opaque origins) ──

let store: Record<string, string> = {};

const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { store = {}; }),
  get length() { return Object.keys(store).length; },
  key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
};

beforeEach(() => {
  store = {};
  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────

describe('useSinceLastVisit', () => {
  it('returns 0 new events on first visit (no stored ID)', () => {
    const { result } = renderHook(() =>
      useSinceLastVisit(['e1', 'e2', 'e3'], 'session-1'),
    );

    expect(result.current.newEventCount).toBe(0);
    expect(result.current.lastSeenMarkerPosition).toBe(-1);
  });

  it('returns correct new event count when last-seen ID exists', () => {
    store['timeline-last-seen-event-session-1'] = 'e2';

    const { result } = renderHook(() =>
      useSinceLastVisit(['e1', 'e2', 'e3', 'e4', 'e5'], 'session-1'),
    );

    expect(result.current.newEventCount).toBe(3); // e3, e4, e5
    expect(result.current.lastSeenMarkerPosition).toBe(1); // index of e2
  });

  it('returns 0 new events when last-seen is the latest event', () => {
    store['timeline-last-seen-event-session-1'] = 'e5';

    const { result } = renderHook(() =>
      useSinceLastVisit(['e1', 'e2', 'e3', 'e4', 'e5'], 'session-1'),
    );

    expect(result.current.newEventCount).toBe(0);
    expect(result.current.lastSeenMarkerPosition).toBe(4);
  });

  it('gracefully falls back when last-seen ID references pruned event', () => {
    store['timeline-last-seen-event-session-1'] = 'pruned-event';

    const { result } = renderHook(() =>
      useSinceLastVisit(['e1', 'e2', 'e3'], 'session-1'),
    );

    // Treat as first visit — no "new" badge
    expect(result.current.newEventCount).toBe(0);
    expect(result.current.lastSeenMarkerPosition).toBe(-1);
  });

  it('markAsSeen persists the latest event ID to localStorage', () => {
    const { result } = renderHook(() =>
      useSinceLastVisit(['e1', 'e2', 'e3'], 'session-1'),
    );

    act(() => {
      result.current.markAsSeen();
    });

    expect(store['timeline-last-seen-event-session-1']).toBe('e3');
  });

  it('persists on visibilitychange to hidden', () => {
    renderHook(() =>
      useSinceLastVisit(['e1', 'e2', 'e3'], 'session-1'),
    );

    // Simulate tab going to background
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(store['timeline-last-seen-event-session-1']).toBe('e3');
  });

  it('persists on beforeunload', () => {
    renderHook(() =>
      useSinceLastVisit(['e1', 'e2', 'e3'], 'session-1'),
    );

    act(() => { window.dispatchEvent(new Event('beforeunload')); });

    expect(store['timeline-last-seen-event-session-1']).toBe('e3');
  });

  it('handles empty event list', () => {
    const { result } = renderHook(() =>
      useSinceLastVisit([], 'session-1'),
    );

    expect(result.current.newEventCount).toBe(0);
    expect(result.current.lastSeenMarkerPosition).toBe(-1);
  });

  it('uses different storage keys for different sessions', () => {
    store['timeline-last-seen-event-session-a'] = 'e1';

    const { result: resultA } = renderHook(() =>
      useSinceLastVisit(['e1', 'e2', 'e3'], 'session-a'),
    );

    const { result: resultB } = renderHook(() =>
      useSinceLastVisit(['e1', 'e2', 'e3'], 'session-b'),
    );

    expect(resultA.current.newEventCount).toBe(2); // e2, e3
    expect(resultB.current.newEventCount).toBe(0); // first visit
  });

  it('markAsSeen updates the count to 0 after calling', () => {
    store['timeline-last-seen-event-session-1'] = 'e1';

    const { result } = renderHook(() =>
      useSinceLastVisit(['e1', 'e2', 'e3'], 'session-1'),
    );

    expect(result.current.newEventCount).toBe(2);

    act(() => {
      result.current.markAsSeen();
    });

    expect(result.current.newEventCount).toBe(0);
  });
});
