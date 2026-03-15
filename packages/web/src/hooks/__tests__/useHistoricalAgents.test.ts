import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { deriveAgentsFromKeyframes, useHistoricalAgents } from '../useHistoricalAgents';
import type { ReplayKeyframe } from '../useSessionReplay';

vi.mock('../useApi', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '../useApi';
const mockApiFetch = apiFetch as ReturnType<typeof vi.fn>;

function kf(type: ReplayKeyframe['type'], label: string, ts = '2024-01-01T00:00:00Z', agentId?: string): ReplayKeyframe {
  return { type, label, timestamp: ts, ...(agentId ? { agentId } : {}) };
}

describe('deriveAgentsFromKeyframes', () => {
  it('returns empty array for no keyframes', () => {
    expect(deriveAgentsFromKeyframes([])).toEqual([]);
  });

  it('creates agents from spawn events', () => {
    const agents = deriveAgentsFromKeyframes([
      kf('spawn', 'Spawned Developer: working on feature', undefined, 'a1'),
      kf('spawn', 'Spawned Architect: designing system', undefined, 'a2'),
    ]);
    expect(agents).toHaveLength(2);
    expect(agents[0].role.name).toBe('Developer');
    expect(agents[1].role.name).toBe('Architect');
    expect(agents[0].status).toBe('idle'); // not exited
  });

  it('marks exited agents as terminated', () => {
    const agents = deriveAgentsFromKeyframes([
      kf('spawn', 'Spawned Developer: task A', undefined, 'a1'),
      kf('spawn', 'Spawned QA Tester: testing', undefined, 'a2'),
      kf('agent_exit', 'Terminated Developer (abc123)'),
    ]);
    expect(agents).toHaveLength(2);
    expect(agents[0].role.name).toBe('Developer');
    expect(agents[0].status).toBe('terminated');
    expect(agents[1].role.name).toBe('QA Tester');
    expect(agents[1].status).toBe('idle'); // still alive
  });

  it('ignores non-spawn/exit keyframes', () => {
    const agents = deriveAgentsFromKeyframes([
      kf('delegation', 'Delegated task to Developer'),
      kf('spawn', 'Spawned Lead: managing', undefined, 'a1'),
      kf('milestone', 'Phase 1 complete'),
      kf('task', 'Task finished'),
    ]);
    expect(agents).toHaveLength(1);
    expect(agents[0].role.name).toBe('Lead');
  });

  it('assigns known role icons', () => {
    const agents = deriveAgentsFromKeyframes([
      kf('spawn', 'Spawned Developer: code', undefined, 'a1'),
      kf('spawn', 'Spawned Architect: design', undefined, 'a2'),
      kf('spawn', 'Spawned Unknown Role: mystery', undefined, 'a3'),
    ]);
    expect(agents[0].role.icon).toBe('👨‍💻');
    expect(agents[1].role.icon).toBe('🏗');
    expect(agents[2].role.icon).toBe('🤖'); // fallback
  });

  it('handles multiple exits of same role', () => {
    const agents = deriveAgentsFromKeyframes([
      kf('spawn', 'Spawned Developer: task A', undefined, 'a1'),
      kf('spawn', 'Spawned Developer: task B', undefined, 'a2'),
      kf('agent_exit', 'Terminated Developer (aaa)'),
    ]);
    expect(agents).toHaveLength(2);
    // First Developer gets marked terminated, second stays idle
    expect(agents[0].status).toBe('terminated');
    expect(agents[1].status).toBe('idle');
  });

  it('uses real agentId from keyframe when available', () => {
    const agents = deriveAgentsFromKeyframes([
      kf('spawn', 'Spawned Developer: code', undefined, 'abc-123-real'),
      kf('spawn', 'Spawned Architect: design', undefined, 'def-456-real'),
    ]);
    expect(agents[0].id).toBe('abc-123-real');
    expect(agents[1].id).toBe('def-456-real');
  });

  it('skips spawn events without agentId', () => {
    const agents = deriveAgentsFromKeyframes([
      kf('spawn', 'Spawned Developer: code', undefined, 'abc-123'),
      kf('spawn', 'Spawned Architect: design'), // no agentId — skipped
    ]);
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('abc-123');
  });
});

describe('useHistoricalAgents hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue([]);
  });

  it('returns empty agents and skips fetch when liveAgentCount > 0', async () => {
    const { result } = renderHook(() => useHistoricalAgents(5));
    await act(async () => {});
    expect(result.current.agents).toEqual([]);
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('fetches /agents when liveAgentCount=0 and no projectId', async () => {
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

  it('normalizes raw API agents with all defaults', async () => {
    mockApiFetch.mockResolvedValueOnce([{ id: 'a1' }]);

    const { result } = renderHook(() => useHistoricalAgents(0));
    await act(async () => {});

    const agent = result.current.agents[0];
    expect(agent.id).toBe('a1');
    expect(agent.status).toBe('completed');
    expect(agent.role.id).toBe('agent');
    expect(agent.role.name).toBe('Agent');
    expect(agent.role.color).toBe('#6b7280');
    expect(agent.role.builtIn).toBe(false);
    expect(agent.model).toBe('');
    expect(agent.inputTokens).toBe(0);
    expect(agent.outputTokens).toBe(0);
    expect(agent.messages).toEqual([]);
    expect(agent.childIds).toEqual([]);
    expect(agent.contextWindowSize).toBe(0);
    expect(agent.contextWindowUsed).toBe(0);
    expect(agent.outputPreview).toBe('');
  });

  it('normalizes agent with no id to unknown', async () => {
    mockApiFetch.mockResolvedValueOnce([{}]);

    const { result } = renderHook(() => useHistoricalAgents(0));
    await act(async () => {});

    expect(result.current.agents[0].id).toBe('unknown');
  });

  it('normalizes agent with full data', async () => {
    mockApiFetch.mockResolvedValueOnce([
      {
        id: 'a1',
        status: 'running',
        role: { id: 'dev', name: 'Developer', icon: '🔧' },
        model: 'claude-3',
        inputTokens: 100,
        outputTokens: 50,
        createdAt: '2024-06-01T00:00:00Z',
        contextWindowSize: 128000,
        contextWindowUsed: 5000,
        outputPreview: 'Hello world',
      },
    ]);

    const { result } = renderHook(() => useHistoricalAgents(0));
    await act(async () => {});

    const agent = result.current.agents[0];
    expect(agent.status).toBe('running');
    expect(agent.role.icon).toBe('🔧');
    expect(agent.model).toBe('claude-3');
    expect(agent.inputTokens).toBe(100);
    expect(agent.outputTokens).toBe(50);
    expect(agent.createdAt).toBe('2024-06-01T00:00:00Z');
    expect(agent.contextWindowSize).toBe(128000);
    expect(agent.contextWindowUsed).toBe(5000);
    expect(agent.outputPreview).toBe('Hello world');
  });

  it('falls back to keyframes when /agents returns empty array', async () => {
    mockApiFetch.mockResolvedValueOnce([]);
    mockApiFetch.mockResolvedValueOnce([{ id: 'proj-1', status: 'active' }]);
    mockApiFetch.mockResolvedValueOnce({
      keyframes: [
        { type: 'spawn', label: 'Spawned Developer: write code', agentId: 'a1', timestamp: '2024-01-01T00:00:00Z' },
      ],
    });

    const { result } = renderHook(() => useHistoricalAgents(0));
    await act(async () => {});

    expect(result.current.agents).toHaveLength(1);
    expect(result.current.agents[0].id).toBe('a1');
  });

  it('falls back to keyframes when /agents returns non-array', async () => {
    mockApiFetch.mockResolvedValueOnce('not an array');
    mockApiFetch.mockResolvedValueOnce([{ id: 'proj-1', status: 'active' }]);
    mockApiFetch.mockResolvedValueOnce({ keyframes: [] });

    const { result } = renderHook(() => useHistoricalAgents(0));
    await act(async () => {});

    expect(result.current.agents).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('falls back to keyframes when /agents fetch fails', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('failed'));
    mockApiFetch.mockResolvedValueOnce([{ id: 'proj-1', status: 'active' }]);
    mockApiFetch.mockResolvedValueOnce({
      keyframes: [
        { type: 'spawn', label: 'Spawned QA: test', agentId: 'a2', timestamp: '2024-01-01T00:00:00Z' },
      ],
    });

    const { result } = renderHook(() => useHistoricalAgents(0));
    await act(async () => {});

    expect(result.current.agents).toHaveLength(1);
  });

  it('uses projectId to skip /agents and fetch keyframes directly', async () => {
    mockApiFetch.mockResolvedValueOnce({
      keyframes: [
        { type: 'spawn', label: 'Spawned Dev: task', agentId: 'a1', timestamp: '2024-01-01T00:00:00Z' },
      ],
    });

    const { result } = renderHook(() => useHistoricalAgents(0, 'my-proj'));
    await act(async () => {});

    expect(mockApiFetch).toHaveBeenCalledWith('/replay/my-proj/keyframes');
    expect(result.current.agents).toHaveLength(1);
  });

  it('handles missing keyframes property in response', async () => {
    mockApiFetch.mockResolvedValueOnce({});

    const { result } = renderHook(() => useHistoricalAgents(0, 'proj-1'));
    await act(async () => {});

    expect(result.current.agents).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('handles keyframes fetch failure gracefully', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('fail'));

    const { result } = renderHook(() => useHistoricalAgents(0, 'proj-1'));
    await act(async () => {});

    expect(result.current.agents).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('returns loading=false when no projects found', async () => {
    mockApiFetch.mockResolvedValueOnce([]);
    mockApiFetch.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useHistoricalAgents(0));
    await act(async () => {});

    expect(result.current.agents).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('filters archived projects in getFirstProjectId', async () => {
    mockApiFetch.mockResolvedValueOnce([]);
    mockApiFetch.mockResolvedValueOnce([
      { id: 'proj-archived', status: 'archived' },
      { id: 'proj-active', status: 'active' },
    ]);
    mockApiFetch.mockResolvedValueOnce({
      keyframes: [
        { type: 'spawn', label: 'Spawned Dev: code', agentId: 'a1', timestamp: '2024-01-01T00:00:00Z' },
      ],
    });

    const { result } = renderHook(() => useHistoricalAgents(0));
    await act(async () => {});

    expect(mockApiFetch).toHaveBeenCalledWith('/replay/proj-active/keyframes');
    expect(result.current.agents).toHaveLength(1);
  });

  it('handles all projects being archived', async () => {
    mockApiFetch.mockResolvedValueOnce([]);
    mockApiFetch.mockResolvedValueOnce([
      { id: 'p1', status: 'archived' },
      { id: 'p2', status: 'archived' },
    ]);

    const { result } = renderHook(() => useHistoricalAgents(0));
    await act(async () => {});

    expect(result.current.agents).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('handles getFirstProjectId fetch failure', async () => {
    mockApiFetch.mockResolvedValueOnce([]);
    mockApiFetch.mockRejectedValueOnce(new Error('projects fail'));

    const { result } = renderHook(() => useHistoricalAgents(0));
    await act(async () => {});

    expect(result.current.agents).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('handles getFirstProjectId returning non-array', async () => {
    mockApiFetch.mockResolvedValueOnce([]);
    mockApiFetch.mockResolvedValueOnce('not an array');

    const { result } = renderHook(() => useHistoricalAgents(0));
    await act(async () => {});

    expect(result.current.agents).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('sets loading=true while fetching then false when done', async () => {
    let resolveAgents!: (v: unknown) => void;
    mockApiFetch.mockImplementation(
      () => new Promise((resolve) => { resolveAgents = resolve; }),
    );

    const { result } = renderHook(() => useHistoricalAgents(0));
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveAgents([{ id: 'a1', status: 'idle', role: { id: 'dev', name: 'Dev' } }]);
    });

    expect(result.current.loading).toBe(false);
  });

  it('does not update state after unmount (cancellation)', async () => {
    let resolveAgents!: (v: unknown[]) => void;
    mockApiFetch.mockImplementation(
      () => new Promise((resolve) => { resolveAgents = resolve; }),
    );

    const { unmount } = renderHook(() => useHistoricalAgents(0));
    unmount();

    resolveAgents([{ id: 'a1', status: 'idle', role: { id: 'dev' } }]);
    await act(async () => {});
  });

  it('sets loading=false on catch-all error', async () => {
    mockApiFetch.mockRejectedValue(new Error('total failure'));

    const { result } = renderHook(() => useHistoricalAgents(0));
    await act(async () => {});

    expect(result.current.loading).toBe(false);
  });
});
