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
    defaultOptions: { queries: { retry: true } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useLeadPolling — retry callbacks (lines 28-29, 46-47, 82-83)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not retry progress query on 404 errors (lines 28-29)', async () => {
    const error404 = new Error('Request failed: 404 Not Found');
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/progress')) return Promise.reject(error404);
      return Promise.resolve([]);
    });

    const wrapper = createWrapper();
    renderHook(() => useLeadPolling('lead-1', true, null), { wrapper });

    await waitFor(() => {
      const progressCalls = mockApiFetch.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes('/progress')
      );
      expect(progressCalls.length).toBeGreaterThanOrEqual(1);
    });

    // Wait a bit to confirm no retries happen for 404
    await new Promise(r => setTimeout(r, 100));
    const progressCalls = mockApiFetch.mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes('/progress')
    );
    // Should only have been called once (no retry on 404)
    expect(progressCalls.length).toBe(1);
  });

  it('does not retry decisions query on 404 errors (lines 46-47)', async () => {
    const error404 = new Error('Request failed: 404 Not Found');
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/decisions')) return Promise.reject(error404);
      return Promise.resolve({});
    });

    const wrapper = createWrapper();
    renderHook(() => useLeadPolling('lead-1', true, null), { wrapper });

    await waitFor(() => {
      const decisionCalls = mockApiFetch.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes('/decisions')
      );
      expect(decisionCalls.length).toBeGreaterThanOrEqual(1);
    });

    await new Promise(r => setTimeout(r, 100));
    const decisionCalls = mockApiFetch.mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes('/decisions')
    );
    expect(decisionCalls.length).toBe(1);
  });

  it('does not retry DAG query on 404 errors (lines 82-83)', async () => {
    const error404 = new Error('Request failed: 404 Not Found');
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/dag')) return Promise.reject(error404);
      return Promise.resolve({});
    });

    const wrapper = createWrapper();
    renderHook(() => useLeadPolling('lead-1', true, null), { wrapper });

    await waitFor(() => {
      const dagCalls = mockApiFetch.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes('/dag')
      );
      expect(dagCalls.length).toBeGreaterThanOrEqual(1);
    });

    await new Promise(r => setTimeout(r, 100));
    const dagCalls = mockApiFetch.mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes('/dag')
    );
    expect(dagCalls.length).toBe(1);
  });
});
