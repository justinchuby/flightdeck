// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AnalyticsOverview, SessionSummary } from '../Analytics/types';
import { generateInsights } from '../Analytics/types';

// ── Mock visx (requires DOM measurements) ──────────────────────────

vi.mock('@visx/responsive', () => ({
  useParentSize: () => ({ parentRef: { current: null }, width: 400, height: 200 }),
}));

vi.mock('@visx/group', () => ({
  Group: ({ children, ...props }: any) => <g {...props}>{children}</g>,
}));

vi.mock('@visx/scale', () => ({
  scaleLinear: ({ domain, range }: any) => {
    const fn = (v: number) => ((v - domain[0]) / (domain[1] - domain[0])) * (range[1] - range[0]) + range[0];
    fn.ticks = (n: number) => Array.from({ length: n }, (_, i) => domain[0] + (domain[1] - domain[0]) * (i / (n - 1)));
    return fn;
  },
  scalePoint: ({ domain, range }: any) => {
    const fn = (v: string) => {
      const i = domain.indexOf(v);
      return i >= 0 ? range[0] + (range[1] - range[0]) * (i / Math.max(domain.length - 1, 1)) : 0;
    };
    return fn;
  },
  scaleBand: ({ domain, range }: any) => {
    const fn = (v: string) => {
      const i = domain.indexOf(v);
      const step = (range[1] - range[0]) / domain.length;
      return range[0] + step * i;
    };
    fn.bandwidth = () => 20;
    return fn;
  },
}));

vi.mock('@visx/shape', () => ({
  LinePath: () => <path data-testid="visx-line" />,
  AreaClosed: () => <path data-testid="visx-area" />,
  Bar: ({ children, ...props }: any) => <rect data-testid="visx-bar" {...props}>{children}</rect>,
}));

vi.mock('@visx/axis', () => ({
  AxisBottom: () => <g data-testid="visx-axis-bottom" />,
  AxisLeft: () => <g data-testid="visx-axis-left" />,
}));

vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({
    totalSessions: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    sessions: [],
    roleContributions: [],
  }),
}));

import { AnalyticsPage } from '../Analytics';
import { TimeWindowSelector } from '../Analytics/TimeWindowSelector';
import { SessionOverviewCard } from '../Analytics/SessionOverviewCard';
import { InsightCard } from '../Analytics/InsightCard';

// ── Test Data ──────────────────────────────────────────────────────

const makeSession = (leadId: string, cost: number, tasks: number): SessionSummary => ({
  leadId,
  projectId: 'proj-1',
  status: 'completed',
  startedAt: new Date(Date.now() - 3_600_000).toISOString(),
  endedAt: new Date().toISOString(),
  agentCount: 4,
  taskCount: tasks,
  totalInputTokens: 100_000,
  totalOutputTokens: 20_000,
});

const makeOverview = (sessions: SessionSummary[]): AnalyticsOverview => {
  return {
    totalSessions: sessions.length,
    totalInputTokens: sessions.reduce((s, x) => s + x.totalInputTokens, 0),
    totalOutputTokens: sessions.reduce((s, x) => s + x.totalOutputTokens, 0),
    sessions,
    roleContributions: [
      { role: 'Developer', taskCount: 20, tokenUsage: 500_000 },
      { role: 'Reviewer', taskCount: 10, tokenUsage: 200_000 },
    ],
  };
};

// ── Tests ──────────────────────────────────────────────────────────

describe('Cross-Session Analytics', () => {
  describe('AnalyticsPage', () => {
    it('renders empty state when no data', async () => {
      render(
        <MemoryRouter>
          <AnalyticsPage />
        </MemoryRouter>,
      );
      // Wait for loading to complete
      const empty = await screen.findByTestId('analytics-empty');
      expect(empty).toBeInTheDocument();
    });
  });

  describe('TimeWindowSelector', () => {
    it('renders all time window options', () => {
      const onChange = vi.fn();
      render(<TimeWindowSelector value="30d" onChange={onChange} />);
      const select = screen.getByTestId('time-window-selector');
      expect(select).toBeInTheDocument();
      fireEvent.change(select, { target: { value: '7d' } });
      expect(onChange).toHaveBeenCalledWith('7d');
    });
  });

  describe('SessionOverviewCard', () => {
    it('renders session stats', () => {
      const overview = makeOverview([
        makeSession('s1', 10, 5),
        makeSession('s2', 15, 8),
      ]);
      render(<SessionOverviewCard overview={overview} />);
      expect(screen.getByText('2')).toBeInTheDocument(); // total sessions
      expect(screen.getByText('240k')).toBeInTheDocument(); // total tokens (2 sessions × 120k each)
    });
  });

  describe('InsightCard', () => {
    it('renders insight with action', () => {
      render(
        <InsightCard
          insight={{
            type: 'cost',
            severity: 'suggestion',
            title: 'Sessions cheaper',
            description: 'Cost down 15%',
            actionable: { label: 'Apply', action: 'update' },
          }}
        />,
      );
      expect(screen.getByText('Sessions cheaper')).toBeInTheDocument();
      expect(screen.getByText('Cost down 15%')).toBeInTheDocument();
      expect(screen.getByText('Apply')).toBeInTheDocument();
    });
  });

  describe('generateInsights', () => {
    it('returns empty for < 2 sessions', () => {
      const overview = makeOverview([makeSession('s1', 10, 5)]);
      expect(generateInsights(overview)).toEqual([]);
    });

    it('generates efficiency insight for many tasks', () => {
      const sessions = Array.from({ length: 5 }, (_, i) =>
        makeSession(`s${i}`, 10, 12),
      );
      const overview = makeOverview(sessions);
      const insights = generateInsights(overview);
      expect(insights.length).toBeGreaterThan(0);
      expect(insights.some((i) => i.type === 'efficiency')).toBe(true);
    });

    it('detects role imbalance', () => {
      const overview = makeOverview([
        makeSession('s1', 10, 5),
        makeSession('s2', 10, 5),
      ]);
      // Override role contributions with heavy imbalance
      overview.roleContributions = [
        { role: 'Developer', taskCount: 80, tokenUsage: 500_000 },
        { role: 'QA', taskCount: 10, tokenUsage: 100_000 },
      ];
      const insights = generateInsights(overview);
      expect(insights.some((i) => i.type === 'role')).toBe(true);
    });
  });
});
