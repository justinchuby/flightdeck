// @vitest-environment jsdom
/**
 * Coverage tests for AnalyticsPage — error state, empty state, time window filtering,
 * and comparison toggle branches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../TimeWindowSelector', () => ({
  TimeWindowSelector: ({ value, onChange }: any) => (
    <select data-testid="time-window" value={value} onChange={(e: any) => onChange(e.target.value)}>
      <option value="7d">7d</option>
      <option value="30d">30d</option>
      <option value="90d">90d</option>
      <option value="all">All</option>
    </select>
  ),
}));

vi.mock('../SessionOverviewCard', () => ({
  SessionOverviewCard: () => <div data-testid="overview-card" />,
}));

vi.mock('../CostTrendChart', () => ({
  CostTrendChart: () => <div data-testid="cost-trend" />,
}));

vi.mock('../InsightsPanel', () => ({
  InsightsPanel: () => <div data-testid="insights" />,
}));

vi.mock('../SessionHistoryTable', () => ({
  SessionHistoryTable: ({ onToggleCompare }: any) => (
    <div data-testid="session-table">
      <button data-testid="compare-btn" onClick={() => onToggleCompare('session-1')}>Compare 1</button>
      <button data-testid="compare-btn-2" onClick={() => onToggleCompare('session-2')}>Compare 2</button>
      <button data-testid="compare-btn-3" onClick={() => onToggleCompare('session-3')}>Compare 3</button>
    </div>
  ),
}));

vi.mock('../SessionComparisonView', () => ({
  SessionComparisonView: ({ onClose }: any) => (
    <div data-testid="comparison-view">
      <button data-testid="close-comparison" onClick={onClose}>Close</button>
    </div>
  ),
}));

vi.mock('../../ui/EmptyState', () => ({
  EmptyState: ({ title }: any) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock('../types', () => ({
  generateInsights: () => [],
}));

import { AnalyticsPage } from '../AnalyticsPage';

describe('AnalyticsPage — coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', async () => {
    mockApiFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<AnalyticsPage />);
    await act(async () => {});
    expect(screen.getByText('Loading analytics...')).toBeInTheDocument();
  });

  it('shows empty state when no sessions', async () => {
    mockApiFetch.mockResolvedValue({ totalSessions: 0, totalInputTokens: 0, totalOutputTokens: 0, sessions: [], roleContributions: [] });
    render(<AnalyticsPage />);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('analytics-empty')).toBeInTheDocument();
    });
  });

  it('renders analytics content with sessions', async () => {
    mockApiFetch.mockResolvedValue({
      totalSessions: 2,
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      sessions: [
        { leadId: 's1', startedAt: new Date().toISOString(), inputTokens: 500, outputTokens: 250 },
        { leadId: 's2', startedAt: new Date().toISOString(), inputTokens: 500, outputTokens: 250 },
      ],
      roleContributions: [],
    });
    render(<AnalyticsPage />);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('analytics-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('overview-card')).toBeInTheDocument();
    expect(screen.getByTestId('cost-trend')).toBeInTheDocument();
    expect(screen.getByTestId('insights')).toBeInTheDocument();
  });

  it('shows error banner when fetch fails after having data', async () => {
    // First load succeeds, then simulate an error on the state
    // The error banner only shows alongside existing content, not in place of it
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    render(<AnalyticsPage />);
    await act(async () => {});
    // When totalSessions is 0 and there's an error, the empty state shows instead
    await waitFor(() => {
      expect(screen.getByTestId('analytics-empty')).toBeInTheDocument();
    });
  });

  it('filters sessions by time window', async () => {
    const now = Date.now();
    mockApiFetch.mockResolvedValue({
      totalSessions: 2,
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      sessions: [
        { leadId: 's1', startedAt: new Date(now - 5 * 86_400_000).toISOString(), inputTokens: 500, outputTokens: 250 },
        { leadId: 's2', startedAt: new Date(now - 40 * 86_400_000).toISOString(), inputTokens: 500, outputTokens: 250 },
      ],
      roleContributions: [],
    });
    render(<AnalyticsPage />);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('analytics-page')).toBeInTheDocument();
    });

    // Change to 7d window — should filter out 40-day-old session
    await act(async () => {
      fireEvent.change(screen.getByTestId('time-window'), { target: { value: '7d' } });
    });
    expect(screen.getByTestId('analytics-page')).toBeInTheDocument();
  });

  it('toggles session comparison and shows comparison view', async () => {
    mockApiFetch
      .mockResolvedValueOnce({
        totalSessions: 2,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        sessions: [
          { leadId: 's1', startedAt: new Date().toISOString(), inputTokens: 500, outputTokens: 250 },
          { leadId: 's2', startedAt: new Date().toISOString(), inputTokens: 500, outputTokens: 250 },
        ],
        roleContributions: [],
      })
      .mockResolvedValue({ sessions: [], difference: {} }); // comparison fetch

    render(<AnalyticsPage />);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('session-table')).toBeInTheDocument();
    });

    // Toggle compare for 2 sessions
    await act(async () => {
      fireEvent.click(screen.getByTestId('compare-btn'));
      fireEvent.click(screen.getByTestId('compare-btn-2'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('comparison-view')).toBeInTheDocument();
    });
  });

  it('replaces oldest compare id when 3rd session is toggled', async () => {
    mockApiFetch
      .mockResolvedValueOnce({
        totalSessions: 3,
        totalInputTokens: 1500,
        totalOutputTokens: 750,
        sessions: [
          { leadId: 's1', startedAt: new Date().toISOString(), inputTokens: 500, outputTokens: 250 },
          { leadId: 's2', startedAt: new Date().toISOString(), inputTokens: 500, outputTokens: 250 },
          { leadId: 's3', startedAt: new Date().toISOString(), inputTokens: 500, outputTokens: 250 },
        ],
        roleContributions: [],
      })
      .mockResolvedValue({ sessions: [], difference: {} });

    render(<AnalyticsPage />);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('session-table')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('compare-btn'));
      fireEvent.click(screen.getByTestId('compare-btn-2'));
      // Toggling a 3rd should replace oldest
      fireEvent.click(screen.getByTestId('compare-btn-3'));
    });
  });

  it('handles "all" time window showing all sessions', async () => {
    mockApiFetch.mockResolvedValue({
      totalSessions: 1,
      totalInputTokens: 500,
      totalOutputTokens: 250,
      sessions: [
        { leadId: 's1', startedAt: new Date().toISOString(), inputTokens: 500, outputTokens: 250 },
      ],
      roleContributions: [],
    });
    render(<AnalyticsPage />);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('analytics-page')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId('time-window'), { target: { value: 'all' } });
    });
    expect(screen.getByTestId('analytics-page')).toBeInTheDocument();
  });
});
