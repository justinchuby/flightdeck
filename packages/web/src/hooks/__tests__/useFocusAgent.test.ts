import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('../useApi', () => ({
  apiFetch: vi.fn(),
}));

import { useFocusAgent, useDiffSummary, type FocusAgentData } from '../useFocusAgent';
import { apiFetch } from '../useApi';

const mockApiFetch = vi.mocked(apiFetch);

const MOCK_FOCUS_DATA: FocusAgentData = {
  agent: {
    id: 'agent-abc',
    role: 'developer',
    status: 'running',
    model: 'test-model',
    provider: 'test',
    createdAt: '2024-01-01T00:00:00Z',
  } as FocusAgentData['agent'],
  recentOutput: 'Working on task...',
  activities: [
    { id: 'a1', action: 'status_change', agentId: 'agent-abc', details: 'Running', timestamp: '2024-01-01T00:00:00Z' },
  ],
  decisions: [],
  fileLocks: [
    { filePath: 'src/index.ts', agentId: 'agent-abc', lockedAt: '2024-01-01T00:00:00Z' },
  ],
  diff: null,
};

describe('useFocusAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null data when agentId is null', () => {
    const { result } = renderHook(() => useFocusAgent(null));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('fetches agent focus data on mount', async () => {
    mockApiFetch.mockResolvedValueOnce(MOCK_FOCUS_DATA);

    const { result } = renderHook(() => useFocusAgent('agent-abc', { pollInterval: 600_000 }));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApiFetch).toHaveBeenCalledWith('/agents/agent-abc/focus');
    expect(result.current.data).toEqual(MOCK_FOCUS_DATA);
    expect(result.current.error).toBeNull();
  });

  it('handles fetch error', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Agent not found'));

    const { result } = renderHook(() => useFocusAgent('agent-bad', { pollInterval: 600_000 }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Agent not found');
    expect(result.current.data).toBeNull();
  });

  it('handles non-Error rejection', async () => {
    mockApiFetch.mockRejectedValueOnce('string error');

    const { result } = renderHook(() => useFocusAgent('agent-abc', { pollInterval: 600_000 }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('string error');
  });

  it('resets data when agentId changes to null', async () => {
    mockApiFetch.mockResolvedValueOnce(MOCK_FOCUS_DATA);

    const { result, rerender } = renderHook(
      ({ id }) => useFocusAgent(id, { pollInterval: 600_000 }),
      { initialProps: { id: 'agent-abc' as string | null } },
    );

    await waitFor(() => expect(result.current.data).not.toBeNull());

    rerender({ id: null });
    expect(result.current.data).toBeNull();
  });

  it('provides refresh function for manual refetch', async () => {
    mockApiFetch.mockResolvedValue(MOCK_FOCUS_DATA);

    const { result } = renderHook(() => useFocusAgent('agent-abc', { pollInterval: 600_000 }));

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));

    act(() => { result.current.refresh(); });
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));
  });

  it('discards stale responses when agentId changes', async () => {
    let resolveFirst!: (v: FocusAgentData) => void;
    const firstPromise = new Promise<FocusAgentData>(r => { resolveFirst = r; });
    mockApiFetch.mockReturnValueOnce(firstPromise as Promise<unknown>);

    const secondData = { ...MOCK_FOCUS_DATA, recentOutput: 'Second agent' };
    mockApiFetch.mockResolvedValueOnce(secondData);

    const { result, rerender } = renderHook(
      ({ id }) => useFocusAgent(id, { pollInterval: 600_000 }),
      { initialProps: { id: 'agent-1' } },
    );

    // Switch agent before first resolves
    rerender({ id: 'agent-2' });
    await waitFor(() => expect(result.current.data?.recentOutput).toBe('Second agent'));

    // Now resolve the stale first request — should be discarded
    resolveFirst(MOCK_FOCUS_DATA);
    await new Promise(r => setTimeout(r, 50));
    // Still shows second agent's data
    expect(result.current.data?.recentOutput).toBe('Second agent');
  });
});

describe('useDiffSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null summary when agentId is null', () => {
    const { result } = renderHook(() => useDiffSummary(null));
    expect(result.current.summary).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('fetches diff summary from correct endpoint', async () => {
    const summary = { filesChanged: 3, additions: 50, deletions: 20 };
    mockApiFetch.mockResolvedValueOnce(summary);

    const { result } = renderHook(() => useDiffSummary('agent-abc', { pollInterval: 600_000 }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApiFetch).toHaveBeenCalledWith('/agents/agent-abc/diff/summary');
    expect(result.current.summary).toEqual(summary);
  });

  it('handles fetch error silently', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Not found'));

    const { result } = renderHook(() => useDiffSummary('agent-abc', { pollInterval: 600_000 }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.summary).toBeNull();
  });

  it('resets summary when agentId changes to null', async () => {
    mockApiFetch.mockResolvedValueOnce({ filesChanged: 1, additions: 10, deletions: 5 });

    const { result, rerender } = renderHook(
      ({ id }) => useDiffSummary(id, { pollInterval: 600_000 }),
      { initialProps: { id: 'agent-abc' as string | null } },
    );

    await waitFor(() => expect(result.current.summary).not.toBeNull());

    rerender({ id: null });
    expect(result.current.summary).toBeNull();
  });
});
