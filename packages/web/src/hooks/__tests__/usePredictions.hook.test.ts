import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../useApi', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../useApi';
import { usePredictionAccuracy, usePredictionConfig } from '../usePredictions';

const mockApiFetch = apiFetch as ReturnType<typeof vi.fn>;

describe('usePredictionAccuracy', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns null initially', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => usePredictionAccuracy());
    expect(result.current).toBeNull();
  });

  it('fetches /predictions/accuracy on mount', async () => {
    const accuracy = { total: 100, correct: 80, avoided: 10, wrong: 10, accuracy: 0.8 };
    mockApiFetch.mockResolvedValueOnce(accuracy);
    const { result } = renderHook(() => usePredictionAccuracy());
    await act(async () => {});
    expect(mockApiFetch).toHaveBeenCalledWith('/predictions/accuracy');
    expect(result.current).toEqual(accuracy);
  });

  it('returns null on fetch error', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => usePredictionAccuracy());
    await act(async () => {});
    expect(result.current).toBeNull();
  });
});

describe('usePredictionConfig', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns null config initially', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => usePredictionConfig());
    expect(result.current.config).toBeNull();
  });

  it('fetches /predictions/config on mount', async () => {
    const config = { enabled: true, refreshIntervalMs: 30000, minConfidence: 60, minDataPoints: 3, enabledTypes: {} };
    mockApiFetch.mockResolvedValueOnce(config);
    const { result } = renderHook(() => usePredictionConfig());
    await act(async () => {});
    expect(result.current.config).toEqual(config);
  });

  it('returns null on fetch error', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => usePredictionConfig());
    await act(async () => {});
    expect(result.current.config).toBeNull();
  });

  it('saveConfig sends PUT with updates', async () => {
    const config = { enabled: true, refreshIntervalMs: 30000, minConfidence: 60, minDataPoints: 3, enabledTypes: {} };
    const updated = { ...config, enabled: false };
    mockApiFetch.mockResolvedValueOnce(config);
    const { result } = renderHook(() => usePredictionConfig());
    await act(async () => {});
    mockApiFetch.mockResolvedValueOnce(updated);
    await act(async () => { await result.current.saveConfig({ enabled: false }); });
    expect(mockApiFetch).toHaveBeenCalledWith('/predictions/config', {
      method: 'PUT', body: JSON.stringify({ enabled: false }),
    });
    expect(result.current.config).toEqual(updated);
  });

  it('saveConfig silently handles errors', async () => {
    const config = { enabled: true, refreshIntervalMs: 30000, minConfidence: 60, minDataPoints: 3, enabledTypes: {} };
    mockApiFetch.mockResolvedValueOnce(config);
    const { result } = renderHook(() => usePredictionConfig());
    await act(async () => {});
    mockApiFetch.mockRejectedValueOnce(new Error('Server error'));
    await act(async () => { await result.current.saveConfig({ enabled: false }); });
    expect(result.current.config).toEqual(config);
  });
});
