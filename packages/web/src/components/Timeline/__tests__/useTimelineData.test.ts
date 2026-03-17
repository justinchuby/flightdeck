// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { TimelineData } from '../useTimelineData';

// ── Mocks ─────────────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

// Mock SSE hook — we control its return values
let mockSSEReturn: {
  data: TimelineData | null;
  loading: boolean;
  error: string | null;
  connectionHealth: string;
  sseUnavailable: boolean;
  reconnect: () => void;
};

vi.mock('../useTimelineSSE', () => ({
  useTimelineSSE: () => mockSSEReturn,
}));

import { useTimelineData, getLocksForAgent } from '../useTimelineData';

const SAMPLE_DATA: TimelineData = {
  agents: [{ id: 'a1', shortId: 'a1', role: 'dev', createdAt: '2024-01-01T00:00:00Z', segments: [] }],
  communications: [],
  locks: [
    { agentId: 'a1', filePath: 'src/foo.ts', acquiredAt: '2024-01-01T00:00:00Z' },
    { agentId: 'a2', filePath: 'src/bar.ts', acquiredAt: '2024-01-01T00:01:00Z' },
  ],
  timeRange: { start: '2024-01-01T00:00:00Z', end: '2024-01-01T01:00:00Z' },
};

// ── Tests ─────────────────────────────────────────────────────────

describe('getLocksForAgent', () => {
  it('filters locks by agent ID', () => {
    const result = getLocksForAgent(SAMPLE_DATA.locks, 'a1');
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('src/foo.ts');
  });

  it('returns empty array for unknown agent', () => {
    expect(getLocksForAgent(SAMPLE_DATA.locks, 'unknown')).toHaveLength(0);
  });

  it('returns empty for empty locks array', () => {
    expect(getLocksForAgent([], 'a1')).toHaveLength(0);
  });
});

describe('useTimelineData', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    mockSSEReturn = {
      data: null,
      loading: false,
      error: null,
      connectionHealth: 'connected',
      sseUnavailable: false,
      reconnect: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns SSE data when SSE is available', () => {
    mockSSEReturn.data = SAMPLE_DATA;
    mockSSEReturn.loading = false;

    const { result } = renderHook(() => useTimelineData('lead-1'));
    expect(result.current.data).toBe(SAMPLE_DATA);
    expect(result.current.loading).toBe(false);
    expect(result.current.connectionHealth).toBe('connected');
  });

  it('returns null data when no lead ID', () => {
    const { result } = renderHook(() => useTimelineData(null));
    expect(result.current.data).toBeNull();
  });

  it('passes through SSE loading state', () => {
    mockSSEReturn.loading = true;
    const { result } = renderHook(() => useTimelineData('lead-1'));
    expect(result.current.loading).toBe(true);
  });

  it('passes through SSE error', () => {
    mockSSEReturn.error = 'SSE connection failed';
    const { result } = renderHook(() => useTimelineData('lead-1'));
    expect(result.current.error).toBe('SSE connection failed');
  });

  it('falls back to polling when SSE is unavailable', async () => {
    mockSSEReturn.sseUnavailable = true;
    mockApiFetch.mockResolvedValue(SAMPLE_DATA);

    const { result } = renderHook(() => useTimelineData('lead-1'));

    await waitFor(() => {
      expect(result.current.data).toEqual(SAMPLE_DATA);
    });
    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.stringContaining('/coordination/timeline?leadId=lead-1'),
    );
  });

  it('polling refetches on interval', async () => {
    mockSSEReturn.sseUnavailable = true;
    mockApiFetch.mockResolvedValue(SAMPLE_DATA);

    renderHook(() => useTimelineData('lead-1'));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledTimes(1);
    });

    // Advance past poll interval
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    await waitFor(() => {
      expect(mockApiFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows degraded health when polling has error', async () => {
    mockSSEReturn.sseUnavailable = true;
    mockApiFetch.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useTimelineData('lead-1'));

    await waitFor(() => {
      expect(result.current.error).toBe('Network error');
    });
    expect(result.current.connectionHealth).toBe('degraded');
  });

  it('shows connecting health when polling has no data yet', () => {
    mockSSEReturn.sseUnavailable = true;
    mockApiFetch.mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useTimelineData('lead-1'));
    expect(result.current.connectionHealth).toBe('connecting');
  });

  it('shows connected health when polling succeeds', async () => {
    mockSSEReturn.sseUnavailable = true;
    mockApiFetch.mockResolvedValue(SAMPLE_DATA);

    const { result } = renderHook(() => useTimelineData('lead-1'));

    await waitFor(() => {
      expect(result.current.connectionHealth).toBe('connected');
    });
  });

  it('preserves last known good data during transitions', async () => {
    // Start with SSE data
    mockSSEReturn.data = SAMPLE_DATA;
    const { result, rerender } = renderHook(() => useTimelineData('lead-1'));

    expect(result.current.data).toBe(SAMPLE_DATA);

    // SSE goes unavailable and data becomes null
    mockSSEReturn.data = null;
    mockSSEReturn.sseUnavailable = true;
    mockApiFetch.mockReturnValue(new Promise(() => {})); // polling not resolved yet

    rerender();

    // Should still have last known good data
    expect(result.current.data).toEqual(SAMPLE_DATA);
  });

  it('refetch calls SSE reconnect when SSE is available', () => {
    mockSSEReturn.data = SAMPLE_DATA;
    const { result } = renderHook(() => useTimelineData('lead-1'));

    act(() => {
      result.current.refetch();
    });

    expect(mockSSEReturn.reconnect).toHaveBeenCalled();
  });

  it('polling shows generic error for non-Error throws', async () => {
    mockSSEReturn.sseUnavailable = true;
    mockApiFetch.mockRejectedValue('string error');

    const { result } = renderHook(() => useTimelineData('lead-1'));

    await waitFor(() => {
      expect(result.current.error).toBe('Failed to fetch timeline');
    });
  });

  it('falls back to SSE error when polling has no error', () => {
    mockSSEReturn.sseUnavailable = true;
    mockSSEReturn.error = 'SSE error';
    mockApiFetch.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useTimelineData('lead-1'));
    // polling.error is null, so falls back to sse.error
    expect(result.current.error).toBe('SSE error');
  });
});
