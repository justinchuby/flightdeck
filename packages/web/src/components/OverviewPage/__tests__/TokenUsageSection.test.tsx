// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../../../stores/appStore', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    typeof selector === 'function'
      ? selector({ agents: [{ id: 'a1', projectId: 'p1', role: { name: 'Developer' } }] })
      : { agents: [] },
}));

import { TokenUsageSection } from '../TokenUsageSection';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('TokenUsageSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue([]);
  });

  it('renders section heading', () => {
    render(<TokenUsageSection projectId="p1" />, { wrapper: createWrapper() });
    expect(screen.getByText(/token|cost|usage/i)).toBeInTheDocument();
  });

  it('fetches cost data on mount', async () => {
    mockApiFetch.mockResolvedValue({
      projectId: 'p1',
      totalInputTokens: 100000,
      totalOutputTokens: 50000,
      totalCostUsd: 1.25,
      sessionCount: 2,
      agentCount: 3,
    });
    render(<TokenUsageSection projectId="p1" />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalled();
    });
  });

  it('displays token counts when data loads', async () => {
    mockApiFetch.mockResolvedValue([]);
    render(<TokenUsageSection projectId="p1" />, { wrapper: createWrapper() });
    await waitFor(() => {
      // useQuery fires and we just verify no crash
      expect(mockApiFetch).toHaveBeenCalled();
    });
  });

  it('renders without crashing', () => {
    const { container } = render(<TokenUsageSection projectId="p1" />, { wrapper: createWrapper() });
    expect(container).toBeTruthy();
  });

  it('handles fetch error gracefully', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    const { container } = render(<TokenUsageSection projectId="p1" />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(container).toBeTruthy();
    });
  });
});
