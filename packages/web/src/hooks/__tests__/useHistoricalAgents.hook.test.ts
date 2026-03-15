import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../useApi', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../useApi';
import { useHistoricalAgents } from '../useHistoricalAgents';

const mockApiFetch = apiFetch as ReturnType<typeof vi.fn>;

describe('useHistoricalAgents hook', () => {
  beforeEach(() => { vi.clearAllMocks(); mockApiFetch.mockResolvedValue([]); });

  it('returns empty agents when liveAgentCount > 0', async () => {
    const { result } = renderHook(() => useHistoricalAgents(5));
    await act(async () => {});
    expect(result.current.agents).toEqual([]);
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('fetches /agents when liveAgentCount=0', async () => {
    mockApiFetch.mockResolvedValueOnce([
      { id: 'a1', status: 'running', role: { id: 'dev', name: 'Developer' }, model: 'gpt-4' },
    ]);
    const { result } = renderHook(() => useHistoricalAgents(0));
    await act(async () => {});
    expect(mockApiFetch).toHaveBeenCalledWith('/agents');
    expect(result.current.agents).toHaveLength(1);
    expect(result.current.agents[0].id).toBe('a1');
    expect(result.current.loading).toBe(false);
  });

  it('normalizes raw API agents', async () => {
    mockApiFetch.mockResolvedValueOnce([
      { id: 'a1', status: 'running', role: { id: 'dev', name: 'Developer' } },
    ]);
    const { result } = renderHook(() => useHistoricalAgents(0));
    await act(async () => {});
    const agent = result.current.agents[0];
    expect(agent.model).toBe('');
    expect(agent.inputTokens).toBe(0);
    expect(agent.messages).toEqual([]);
  });

  it('falls back to keyframes when /agents returns empty', async () => {
    mockApiFetch.mockResolvedValueOnce([]);
    mockApiFetch.mockResolvedValueOnce([{ id: 'proj-1', status: 'active' }]);
    mockApiFetch.mockResolvedValueOnce({
      keyframes: [{ type: 'spawn', label: 'Spawned Developer: test', agentId: 'a1', timestamp: '2024-01-01T00:00:00Z' }],
    });
    const { result } = renderHook(() => useHistoricalAgents(0));
    await act(async () => {});
    expect(result.current.agents).toHaveLength(1);
  });

  it('falls back to keyframes when /agents fails', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Not found'));
    mockApiFetch.mockResolvedValueOnce([{ id: 'proj-1', status: 'active' }]);
    mockApiFetch.mockResolvedValueOnce({
      keyframes: [{ type: 'spawn', label: 'Spawned QA: run', agentId: 'a2', timestamp: '2024-01-01T00:00:00Z' }],
    });
    const { result } = renderHook(() => useHistoricalAgents(0));
    await act(async () => {});
    expect(result.current.agents).toHaveLength(1);
  });

  it('uses provided projectId for keyframes', async () => {
    mockApiFetch.mockResolvedValueOnce({
      keyframes: [{ type: 'spawn', label: 'Spawned Dev: task', agentId: 'a1', timestamp: '2024-01-01T00:00:00Z' }],
    });
    const { result } = renderHook(() => useHistoricalAgents(0, 'my-proj'));
    await act(async () => {});
    expect(mockApiFetch).toHaveBeenCalledWith('/replay/my-proj/keyframes');
    expect(result.current.agents).toHaveLength(1);
  });

  it('handles no projects gracefully', async () => {
    mockApiFetch.mockResolvedValueOnce([]);
    mockApiFetch.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useHistoricalAgents(0));
    await act(async () => {});
    expect(result.current.agents).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('sets loading=false after errors', async () => {
    mockApiFetch.mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() => useHistoricalAgents(0));
    await act(async () => {});
    expect(result.current.loading).toBe(false);
  });

  it('cancels stale fetches on unmount', async () => {
    let resolveAgents: (v: unknown[]) => void;
    mockApiFetch.mockImplementation(() => new Promise((resolve) => { resolveAgents = resolve; }));
    const { unmount } = renderHook(() => useHistoricalAgents(0));
    unmount();
    resolveAgents!([{ id: 'a1', status: 'idle', role: { id: 'dev' } }]);
    await act(async () => {});
  });
});
