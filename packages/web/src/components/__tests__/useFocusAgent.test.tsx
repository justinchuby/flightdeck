import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFocusAgent, useDiffSummary } from '../../hooks/useFocusAgent';

// Mock apiFetch
const mockApiFetch = vi.fn();
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

describe('useFocusAgent', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('returns null data when agentId is null', () => {
    const { result } = renderHook(() => useFocusAgent(null));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('fetches agent data on mount', async () => {
    const mockData = {
      agent: { id: 'abc', role: { name: 'Dev' }, status: 'running' },
      recentOutput: 'hello',
      activities: [],
      decisions: [],
      fileLocks: [],
      diff: null,
    };
    mockApiFetch.mockResolvedValue(mockData);

    const { result } = renderHook(() => useFocusAgent('abc', { pollInterval: 600_000 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(mockData);
    expect(mockApiFetch).toHaveBeenCalledWith('/agents/abc/focus');
  });

  it('sets error on fetch failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useFocusAgent('abc', { pollInterval: 600_000 }));
    await waitFor(() => expect(result.current.error).toBe('Network error'));
    expect(result.current.data).toBeNull();
  });

  it('clears data when agentId changes to null', async () => {
    const mockData = { agent: { id: 'abc' }, recentOutput: '', activities: [], decisions: [], fileLocks: [], diff: null };
    mockApiFetch.mockResolvedValue(mockData);

    const { result, rerender } = renderHook(
      ({ id }) => useFocusAgent(id, { pollInterval: 600_000 }),
      { initialProps: { id: 'abc' as string | null } },
    );
    await waitFor(() => expect(result.current.data).toBeTruthy());

    rerender({ id: null });
    expect(result.current.data).toBeNull();
  });
});

describe('useDiffSummary', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('returns null when agentId is null', () => {
    const { result } = renderHook(() => useDiffSummary(null));
    expect(result.current.summary).toBeNull();
  });

  it('fetches summary on mount', async () => {
    mockApiFetch.mockResolvedValue({ filesChanged: 3, additions: 10, deletions: 5 });

    const { result } = renderHook(() => useDiffSummary('abc', { pollInterval: 600_000 }));
    await waitFor(() => expect(result.current.summary).toEqual({ filesChanged: 3, additions: 10, deletions: 5 }));
    expect(mockApiFetch).toHaveBeenCalledWith('/agents/abc/diff/summary');
  });

  it('silently ignores fetch errors', async () => {
    mockApiFetch.mockRejectedValue(new Error('fail'));

    const { result } = renderHook(() => useDiffSummary('abc', { pollInterval: 600_000 }));
    // Should not throw — summary stays null
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.summary).toBeNull();
  });
});
