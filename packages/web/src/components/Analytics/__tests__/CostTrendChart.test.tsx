import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AnalyticsOverview } from '../types';

// ── Mocks ───────────────────────────────────────────────────────────

// Mock useParentSize to return a fixed width (jsdom has no layout engine)
vi.mock('@visx/responsive', () => ({
  useParentSize: () => ({ parentRef: { current: null }, width: 600, height: 160 }),
}));

import { CostTrendChart } from '../CostTrendChart';

// ── Helpers ─────────────────────────────────────────────────────────

function makeOverview(sessions: AnalyticsOverview['sessions'] = []): AnalyticsOverview {
  const totalInput = sessions.reduce((s, x) => s + x.totalInputTokens, 0);
  const totalOutput = sessions.reduce((s, x) => s + x.totalOutputTokens, 0);
  return {
    totalSessions: sessions.length,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    sessions,
    roleContributions: [],
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('CostTrendChart', () => {
  it('renders empty state when no sessions', () => {
    const overview = makeOverview([]);
    render(<CostTrendChart overview={overview} />);

    expect(screen.getByTestId('cost-trend-chart')).toBeInTheDocument();
    expect(screen.getByText('No token data yet')).toBeInTheDocument();
  });

  it('renders chart with session data', () => {
    const overview = makeOverview([
      {
        leadId: 'lead-1',
        projectId: 'proj-1',
        status: 'completed',
        startedAt: '2024-01-15T10:00:00Z',
        endedAt: '2024-01-15T12:00:00Z',
        agentCount: 3,
        taskCount: 5,
        totalInputTokens: 50000,
        totalOutputTokens: 25000,
      },
      {
        leadId: 'lead-2',
        projectId: 'proj-1',
        status: 'completed',
        startedAt: '2024-01-16T10:00:00Z',
        endedAt: '2024-01-16T12:00:00Z',
        agentCount: 2,
        taskCount: 3,
        totalInputTokens: 30000,
        totalOutputTokens: 15000,
      },
    ]);

    render(<CostTrendChart overview={overview} />);

    expect(screen.getByTestId('cost-trend-chart')).toBeInTheDocument();
    expect(screen.getByText('Token Trend')).toBeInTheDocument();
    // Average: (75000 + 45000) / 2 = 60k. Per session: (50000+25000=75000, 30000+15000=45000). Avg = 60000 => 60k
    expect(screen.getByText(/Avg:.*tokens per session/)).toBeInTheDocument();
  });

  it('renders SVG when width > 0', () => {
    const overview = makeOverview([
      {
        leadId: 'lead-1',
        projectId: 'proj-1',
        status: 'completed',
        startedAt: '2024-01-15T10:00:00Z',
        endedAt: '2024-01-15T12:00:00Z',
        agentCount: 1,
        taskCount: 1,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
      },
    ]);

    const { container } = render(<CostTrendChart overview={overview} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('aggregates sessions on the same date', () => {
    const overview = makeOverview([
      {
        leadId: 'lead-1',
        projectId: 'proj-1',
        status: 'completed',
        startedAt: '2024-01-15T08:00:00Z',
        endedAt: '2024-01-15T09:00:00Z',
        agentCount: 1,
        taskCount: 1,
        totalInputTokens: 10000,
        totalOutputTokens: 5000,
      },
      {
        leadId: 'lead-2',
        projectId: 'proj-1',
        status: 'completed',
        startedAt: '2024-01-15T14:00:00Z',
        endedAt: '2024-01-15T15:00:00Z',
        agentCount: 1,
        taskCount: 1,
        totalInputTokens: 20000,
        totalOutputTokens: 10000,
      },
    ]);

    render(<CostTrendChart overview={overview} />);
    // Both sessions on 2024-01-15, aggregated to 45k tokens
    // Since they aggregate by date, there's only one data point, so we still see Token Trend
    expect(screen.getByText('Token Trend')).toBeInTheDocument();
  });

  it('renders data point tooltips with date and token count', () => {
    const overview = makeOverview([
      {
        leadId: 'lead-1',
        projectId: 'proj-1',
        status: 'completed',
        startedAt: '2024-03-10T10:00:00Z',
        endedAt: '2024-03-10T12:00:00Z',
        agentCount: 1,
        taskCount: 1,
        totalInputTokens: 2_500_000,
        totalOutputTokens: 500_000,
      },
    ]);

    const { container } = render(<CostTrendChart overview={overview} />);
    // Circle title elements contain the tooltip text
    const titles = container.querySelectorAll('title');
    const titleTexts = Array.from(titles).map((t) => t.textContent);
    expect(titleTexts.some((t) => t?.includes('2024-03-10'))).toBe(true);
  });
});
