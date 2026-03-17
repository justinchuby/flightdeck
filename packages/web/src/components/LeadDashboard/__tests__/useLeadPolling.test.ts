// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockSetProgress = vi.fn();
const mockSetDecisions = vi.fn();
const mockSetGroups = vi.fn();
const mockSetDagStatus = vi.fn();
vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: {
    getState: () => ({
      setProgress: mockSetProgress,
      setDecisions: mockSetDecisions,
      setGroups: mockSetGroups,
      setDagStatus: mockSetDagStatus,
    }),
  },
}));

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import { useLeadPolling } from '../useLeadPolling';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useLeadPolling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue({});
  });

  it('does not fetch when disabled', () => {
    renderHook(() => useLeadPolling(null, false, null), {
      wrapper: createWrapper(),
    });
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('fetches progress for active lead', async () => {
    mockApiFetch.mockResolvedValue({ crewSize: 3 });
    renderHook(() => useLeadPolling('lead-1', true, null), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/lead/lead-1/progress',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it('fetches decisions for active lead', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/decisions')) return Promise.resolve([{ id: 'd1' }]);
      return Promise.resolve({});
    });
    renderHook(() => useLeadPolling('lead-1', true, null), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/lead/lead-1/decisions',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it('updates store with progress data', async () => {
    const progressData = { crewSize: 5, active: 2, completed: 3 };
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/progress')) return Promise.resolve(progressData);
      return Promise.resolve([]);
    });
    renderHook(() => useLeadPolling('lead-1', true, null), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(mockSetProgress).toHaveBeenCalledWith('lead-1', progressData);
    });
  });

  it('updates store with decisions', async () => {
    const decisions = [{ id: 'd1', status: 'pending' }];
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/decisions')) return Promise.resolve(decisions);
      return Promise.resolve({});
    });
    renderHook(() => useLeadPolling('lead-1', true, null), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(mockSetDecisions).toHaveBeenCalledWith('lead-1', decisions);
    });
  });

  it('fetches DAG status', async () => {
    const dagData = { tasks: [{ id: 't1' }], fileLockMap: {}, summary: {} };
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/dag')) return Promise.resolve(dagData);
      return Promise.resolve({});
    });
    renderHook(() => useLeadPolling('lead-1', true, null), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(mockSetDagStatus).toHaveBeenCalledWith('lead-1', dagData);
    });
  });

  it('copies DAG to historical project', async () => {
    const dagData = { tasks: [{ id: 't1' }], fileLockMap: {}, summary: {} };
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/dag')) return Promise.resolve(dagData);
      return Promise.resolve({});
    });
    renderHook(() => useLeadPolling('lead-1', true, 'proj-1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(mockSetDagStatus).toHaveBeenCalledWith('proj-1', dagData);
    });
  });
});
