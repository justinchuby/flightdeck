import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEffectiveProjectId } from '../useEffectiveProjectId';

// Mock stores
const mockAgents: any[] = [];
let mockSelectedLeadId: string | null = null;
const mockProjects: any[] = [];

vi.mock('../../stores/appStore', () => ({
  useAppStore: (sel: any) => sel({ agents: mockAgents }),
}));
vi.mock('../../stores/leadStore', () => ({
  useLeadStore: (sel: any) => sel({ selectedLeadId: mockSelectedLeadId }),
}));
vi.mock('../useProjects', () => ({
  useProjects: () => ({ projects: mockProjects, loading: false }),
}));

describe('useEffectiveProjectId', () => {
  beforeEach(() => {
    mockAgents.length = 0;
    mockSelectedLeadId = null;
    mockProjects.length = 0;
  });

  it('returns null when no agents or projects', () => {
    const { result } = renderHook(() => useEffectiveProjectId());
    expect(result.current).toBeNull();
  });

  it('returns projectId from selected lead agent', () => {
    mockSelectedLeadId = 'lead-abc';
    mockAgents.push({ id: 'lead-abc', projectId: 'proj-123', role: { id: 'lead' } });
    const { result } = renderHook(() => useEffectiveProjectId());
    expect(result.current).toBe('proj-123');
  });

  it('returns first project ID when no agents but projects exist', () => {
    mockProjects.push({ id: 'proj-456', name: 'My Project' });
    const { result } = renderHook(() => useEffectiveProjectId());
    expect(result.current).toBe('proj-456');
  });

  it('returns selectedLeadId when it IS a valid project ID and agent is gone', () => {
    mockSelectedLeadId = 'proj-789';
    mockProjects.push({ id: 'proj-789', name: 'Test Project' });
    const { result } = renderHook(() => useEffectiveProjectId());
    expect(result.current).toBe('proj-789');
  });

  it('falls through to first project when selectedLeadId is stale agent ID', () => {
    mockSelectedLeadId = 'lead-gone';
    mockProjects.push({ id: 'proj-001', name: 'Fallback Project' });
    const { result } = renderHook(() => useEffectiveProjectId());
    expect(result.current).toBe('proj-001');
  });

  it('caches last valid project ID through agent cleanup', () => {
    // Start with agent present
    mockSelectedLeadId = 'lead-abc';
    mockAgents.push({ id: 'lead-abc', projectId: 'proj-123', role: { id: 'lead' } });
    const { result, rerender } = renderHook(() => useEffectiveProjectId());
    expect(result.current).toBe('proj-123');

    // Agent removed (session stopped), no projects in list
    mockAgents.length = 0;
    rerender();
    // Should return cached value, not null
    expect(result.current).toBe('proj-123');
  });

  it('returns running lead projectId when no selected lead', () => {
    mockAgents.push({ id: 'lead-xyz', projectId: 'proj-running', role: { id: 'lead' }, status: 'running' });
    const { result } = renderHook(() => useEffectiveProjectId());
    expect(result.current).toBe('proj-running');
  });
});
