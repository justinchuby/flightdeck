// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockApiFetch = vi.fn();
vi.mock('../useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import { useSessionReplay } from '../useSessionReplay';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useSessionReplay — playback reaches end (lines 119-125)', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('stops playing and sets currentTime = duration when playback reaches end', async () => {
    // Create keyframes with a known short duration (2 seconds)
    const start = new Date('2026-01-01T00:00:00.000Z');
    const end = new Date('2026-01-01T00:00:02.000Z');
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/keyframes')) {
        return Promise.resolve({
          keyframes: [
            { timestamp: start.toISOString(), label: 'Start', type: 'milestone' },
            { timestamp: end.toISOString(), label: 'End', type: 'milestone' },
          ],
        });
      }
      return Promise.resolve({
        timestamp: start.toISOString(),
        agents: [],
        pendingDecisions: 0,
        completedTasks: 0,
        totalTasks: 0,
      });
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useSessionReplay('lead-1'), { wrapper });

    // Wait for keyframes to load (using real timers)
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.duration).toBe(2000);
    await act(async () => {});

    // Now switch to fake timers for playback control
    vi.useFakeTimers();

    // Start playback
    act(() => {
      result.current.play();
    });
    expect(result.current.playing).toBe(true);

    // Default speed is 4, PLAYBACK_TICK_MS is 100
    // Each tick advances by 100 * 4 = 400ms of session time
    // After 5 ticks (500ms real) = 2000ms session time → hits duration
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(result.current.playing).toBe(false);
    expect(result.current.currentTime).toBe(2000);

    vi.useRealTimers();
  });
});
