import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { AnalyticsOverview } from '../types';

// ── Mocks ────────────────────────────────────────────────────────────

const mockApiFetch = vi.fn();

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

// Stub child components to isolate AnalyticsPage logic
vi.mock('../TimeWindowSelector', () => ({
  TimeWindowSelector: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select data-testid="time-window" value={value} onChange={e => onChange(e.target.value)}>
      <option value="7d">7d</option>
      <option value="30d">30d</option>
      <option value="90d">90d</option>
      <option value="all">all</option>
    </select>
  ),
}));

vi.mock('../SessionOverviewCard', () => ({
  SessionOverviewCard: () => <div data-testid="overview-card" />,
}));

vi.mock('../CostTrendChart', () => ({
  CostTrendChart: () => <div data-testid="cost-chart" />,
}));

vi.mock('../InsightsPanel', () => ({
  InsightsPanel: () => <div data-testid="insights-panel" />,
}));

vi.mock('../SessionHistoryTable', () => ({
  SessionHistoryTable: () => <div data-testid="history-table" />,
}));

vi.mock('../SessionComparisonView', () => ({
  SessionComparisonView: () => <div data-testid="comparison-view" />,
}));

vi.mock('../../ui/EmptyState', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));

import { AnalyticsPage } from '../AnalyticsPage';

const MOCK_OVERVIEW: AnalyticsOverview = {
  totalSessions: 3,
  totalInputTokens: 50000,
  totalOutputTokens: 20000,
  sessions: [
    {
      leadId: 'lead-1',
      projectId: 'proj-1',
      status: 'completed',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      agentCount: 2,
      taskCount: 5,
      totalInputTokens: 20000,
      totalOutputTokens: 8000,
    },
    {
      leadId: 'lead-2',
      projectId: 'proj-1',
      status: 'completed',
      startedAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      endedAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      agentCount: 3,
      taskCount: 8,
      totalInputTokens: 15000,
      totalOutputTokens: 6000,
    },
    {
      leadId: 'lead-3',
      projectId: 'proj-2',
      status: 'completed',
      startedAt: new Date(Date.now() - 60 * 86_400_000).toISOString(),
      endedAt: new Date(Date.now() - 60 * 86_400_000).toISOString(),
      agentCount: 1,
      taskCount: 3,
      totalInputTokens: 15000,
      totalOutputTokens: 6000,
    },
  ],
  roleContributions: [],
};

describe('AnalyticsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state while fetching', () => {
    // Never resolve the fetch
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    render(<AnalyticsPage />);
    expect(screen.getByText('Loading analytics...')).toBeInTheDocument();
  });

  it('shows empty state when no sessions', async () => {
    mockApiFetch.mockResolvedValue({
      totalSessions: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      sessions: [],
      roleContributions: [],
    });
    render(<AnalyticsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('analytics-empty')).toBeInTheDocument();
    });
    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
  });

  it('renders analytics page with data', async () => {
    mockApiFetch.mockResolvedValue(MOCK_OVERVIEW);
    render(<AnalyticsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('analytics-page')).toBeInTheDocument();
    });
    expect(screen.getByText('📊 Analytics')).toBeInTheDocument();
    expect(screen.getByTestId('overview-card')).toBeInTheDocument();
    expect(screen.getByTestId('cost-chart')).toBeInTheDocument();
    expect(screen.getByTestId('insights-panel')).toBeInTheDocument();
    expect(screen.getByTestId('history-table')).toBeInTheDocument();
  });

  it('falls back to empty state when initial fetch fails', async () => {
    // When fetch fails on initial load with no prior data, the empty state guard
    // (!loading && totalSessions === 0) triggers before the error can display.
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    render(<AnalyticsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('analytics-empty')).toBeInTheDocument();
    });
  });

  it('calls apiFetch with /analytics on mount', async () => {
    mockApiFetch.mockResolvedValue(MOCK_OVERVIEW);
    render(<AnalyticsPage />);
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/analytics');
    });
  });
});
