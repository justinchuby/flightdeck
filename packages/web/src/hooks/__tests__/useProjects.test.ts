import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Mock apiFetch before importing the hook
vi.mock('../useApi', () => ({
  apiFetch: vi.fn(),
}));

import { useProjects } from '../useProjects';
import { apiFetch } from '../useApi';

const mockApiFetch = vi.mocked(apiFetch);

describe('useProjects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts in loading state', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useProjects());
    expect(result.current.loading).toBe(true);
    expect(result.current.projects).toEqual([]);
  });

  it('fetches projects from /projects endpoint', async () => {
    const projects = [
      { id: 'p1', name: 'Project 1', status: 'active' },
      { id: 'p2', name: 'Project 2', status: 'active' },
    ];
    mockApiFetch.mockResolvedValueOnce(projects);

    const { result } = renderHook(() => useProjects());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApiFetch).toHaveBeenCalledWith('/projects');
    expect(result.current.projects).toHaveLength(2);
  });

  it('filters out archived projects', async () => {
    const projects = [
      { id: 'p1', name: 'Active', status: 'active' },
      { id: 'p2', name: 'Archived', status: 'archived' },
      { id: 'p3', name: 'Running', status: 'running' },
    ];
    mockApiFetch.mockResolvedValueOnce(projects);

    const { result } = renderHook(() => useProjects());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.projects).toHaveLength(2);
    expect(result.current.projects.map(p => p.id)).toEqual(['p1', 'p3']);
  });

  it('handles empty response', async () => {
    mockApiFetch.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useProjects());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.projects).toEqual([]);
  });

  it('handles fetch error gracefully', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useProjects());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.projects).toEqual([]);
  });

  it('handles non-array response', async () => {
    mockApiFetch.mockResolvedValueOnce({ error: 'not found' });

    const { result } = renderHook(() => useProjects());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.projects).toEqual([]);
  });
});
