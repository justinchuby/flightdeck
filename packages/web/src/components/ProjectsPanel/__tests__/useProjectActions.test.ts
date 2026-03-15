// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockAddToast = vi.fn();
vi.mock('../../Toast', () => ({
  useToastStore: Object.assign(
    (sel: (s: any) => any) => sel({ add: mockAddToast }),
    { getState: () => ({ add: mockAddToast }) },
  ),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

const mockAddProject = vi.fn();
const mockSelectLead = vi.fn();
const mockSetProjects = vi.fn();
vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: {
    getState: () => ({
      addProject: mockAddProject,
      selectLead: mockSelectLead,
      setProjects: mockSetProjects,
      projects: {},
    }),
  },
}));

vi.mock('../../../stores/appStore', () => ({
  useAppStore: {
    getState: () => ({
      agents: [],
      setAgents: vi.fn(),
    }),
  },
}));

import { useProjectActions } from '../useProjectActions';

describe('useProjectActions', () => {
  const mockFetchProjects = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue({});
  });

  it('returns action functions', () => {
    const { result } = renderHook(() => useProjectActions(mockFetchProjects, []));
    expect(result.current.handleStop).toBeTypeOf('function');
    expect(result.current.handleConfirmDelete).toBeTypeOf('function');
    expect(result.current.handleResume).toBeTypeOf('function');
  });

  it('handleStop calls API and shows toast', async () => {
    const { result } = renderHook(() => useProjectActions(mockFetchProjects, []));
    await act(async () => {
      await result.current.handleStop('proj-1');
    });
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/projects/proj-1/stop',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('handleConfirmDelete calls API', async () => {
    const { result } = renderHook(() => useProjectActions(mockFetchProjects, []));
    await act(async () => {
      await result.current.handleConfirmDelete('proj-1');
    });
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/projects/proj-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('handles stop error gracefully', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useProjectActions(mockFetchProjects, []));
    await act(async () => {
      await result.current.handleStop('proj-1');
    });
    expect(mockAddToast).toHaveBeenCalledWith('error', expect.any(String));
  });

  it('handleToggle toggles expandedId', () => {
    const { result } = renderHook(() => useProjectActions(mockFetchProjects, []));
    act(() => {
      result.current.handleToggle('proj-1');
    });
    expect(result.current.expandedId).toBe('proj-1');
    act(() => {
      result.current.handleToggle('proj-1');
    });
    expect(result.current.expandedId).toBeNull();
  });

  it('handleCancelDelete clears confirmingDeleteId', () => {
    const { result } = renderHook(() => useProjectActions(mockFetchProjects, []));
    act(() => {
      result.current.handleRequestDelete('proj-1');
    });
    expect(result.current.confirmingDeleteId).toBe('proj-1');
    act(() => {
      result.current.handleCancelDelete();
    });
    expect(result.current.confirmingDeleteId).toBeNull();
  });

  it('toggleSelect manages selected IDs', () => {
    const { result } = renderHook(() => useProjectActions(mockFetchProjects, []));
    act(() => {
      result.current.toggleSelect('proj-1');
    });
    expect(result.current.selectedIds.has('proj-1')).toBe(true);
    act(() => {
      result.current.toggleSelect('proj-1');
    });
    expect(result.current.selectedIds.has('proj-1')).toBe(false);
  });
});
