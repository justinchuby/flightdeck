import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { apiFetch } from '../useApi';
import { usePredictions, usePredictionAccuracy, usePredictionConfig } from '../usePredictions';

vi.mock('../useApi', () => ({
  apiFetch: vi.fn(),
}));

const mockApiFetch = apiFetch as ReturnType<typeof vi.fn>;

const fakePrediction = (id: string) => ({
  id,
  type: 'agent_stall' as const,
  severity: 'warning' as const,
  confidence: 75,
  title: `Prediction ${id}`,
  detail: 'Some detail',
  timeHorizon: 10,
  dataPoints: 5,
  actions: [],
  createdAt: '2025-01-01T00:00:00Z',
  expiresAt: '2025-01-02T00:00:00Z',
});

describe('usePredictions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockApiFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in loading state', async () => {
    mockApiFetch.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => usePredictions());
    expect(result.current.loading).toBe(true);
    expect(result.current.predictions).toEqual([]);
  });

  it('fetches predictions on mount', async () => {
    const data = [fakePrediction('p1')];
    mockApiFetch.mockResolvedValue(data);

    const { result } = renderHook(() => usePredictions());

    // Flush the resolved promise
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.predictions).toEqual(data);
    expect(mockApiFetch).toHaveBeenCalledWith('/predictions');
  });

  it('sets loading to false after fetch error', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => usePredictions());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.predictions).toEqual([]);
  });

  it('polls at the specified interval', async () => {
    mockApiFetch.mockResolvedValue([]);

    renderHook(() => usePredictions(5000));

    // Initial fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    // Advance past one interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(2);

    // Another interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(3);
  });

  it('dismiss removes prediction and calls API', async () => {
    const data = [fakePrediction('p1'), fakePrediction('p2')];
    mockApiFetch.mockResolvedValue(data);

    const { result } = renderHook(() => usePredictions());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.predictions).toHaveLength(2);

    // Mock dismiss endpoint
    mockApiFetch.mockResolvedValue({});

    await act(async () => {
      await result.current.dismiss('p1');
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/predictions/p1/dismiss', { method: 'POST' });
    expect(result.current.predictions).toHaveLength(1);
    expect(result.current.predictions[0].id).toBe('p2');
  });

  it('handles non-array response gracefully', async () => {
    mockApiFetch.mockResolvedValue('not an array');

    const { result } = renderHook(() => usePredictions());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.predictions).toEqual([]);
  });

  it('cleans up interval on unmount', async () => {
    mockApiFetch.mockResolvedValue([]);

    const { unmount } = renderHook(() => usePredictions(5000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    unmount();

    // Advancing timers after unmount should not trigger more fetches
    const callCount = mockApiFetch.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(callCount);
  });

  it('refetch re-fetches predictions on demand', async () => {
    const data = [fakePrediction('p1')];
    mockApiFetch.mockResolvedValue(data);

    const { result } = renderHook(() => usePredictions());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.predictions).toEqual(data);

    const newData = [fakePrediction('p2'), fakePrediction('p3')];
    mockApiFetch.mockResolvedValue(newData);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.predictions).toEqual(newData);
  });

  it('dismiss silently handles API errors without removing prediction', async () => {
    mockApiFetch.mockResolvedValue([fakePrediction('p1')]);

    const { result } = renderHook(() => usePredictions());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.predictions).toHaveLength(1);

    mockApiFetch.mockRejectedValue(new Error('dismiss failed'));

    await act(async () => {
      await result.current.dismiss('p1');
    });

    // Prediction still present since dismiss API call failed
    expect(result.current.predictions).toHaveLength(1);
    expect(result.current.predictions[0].id).toBe('p1');
  });
});

// ── usePredictionAccuracy ────────────────────────────────────────────────

describe('usePredictionAccuracy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockApiFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null initially', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => usePredictionAccuracy());
    expect(result.current).toBeNull();
  });

  it('fetches accuracy data on mount', async () => {
    const accuracy = { total: 50, correct: 40, avoided: 5, wrong: 5, accuracy: 0.8 };
    mockApiFetch.mockResolvedValueOnce(accuracy);

    const { result } = renderHook(() => usePredictionAccuracy());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/predictions/accuracy');
    expect(result.current).toEqual(accuracy);
  });

  it('returns null on fetch error', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => usePredictionAccuracy());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current).toBeNull();
  });
});

// ── usePredictionConfig ──────────────────────────────────────────────────

describe('usePredictionConfig', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockApiFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const sampleConfig = {
    enabled: true,
    refreshIntervalMs: 30000,
    minConfidence: 60,
    minDataPoints: 3,
    enabledTypes: {},
  };

  it('returns null config initially', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => usePredictionConfig());
    expect(result.current.config).toBeNull();
    expect(typeof result.current.saveConfig).toBe('function');
  });

  it('fetches config on mount', async () => {
    mockApiFetch.mockResolvedValueOnce(sampleConfig);

    const { result } = renderHook(() => usePredictionConfig());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/predictions/config');
    expect(result.current.config).toEqual(sampleConfig);
  });

  it('returns null config on fetch error', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('fail'));

    const { result } = renderHook(() => usePredictionConfig());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.config).toBeNull();
  });

  it('saveConfig sends PUT and updates state', async () => {
    mockApiFetch.mockResolvedValueOnce(sampleConfig);

    const { result } = renderHook(() => usePredictionConfig());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const updated = { ...sampleConfig, enabled: false };
    mockApiFetch.mockResolvedValueOnce(updated);

    await act(async () => {
      await result.current.saveConfig({ enabled: false });
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/predictions/config', {
      method: 'PUT',
      body: JSON.stringify({ enabled: false }),
    });
    expect(result.current.config).toEqual(updated);
  });

  it('saveConfig silently handles errors without changing config', async () => {
    mockApiFetch.mockResolvedValueOnce(sampleConfig);

    const { result } = renderHook(() => usePredictionConfig());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    mockApiFetch.mockRejectedValueOnce(new Error('Server error'));

    await act(async () => {
      await result.current.saveConfig({ minConfidence: 90 });
    });

    // Config remains unchanged
    expect(result.current.config).toEqual(sampleConfig);
  });
});
