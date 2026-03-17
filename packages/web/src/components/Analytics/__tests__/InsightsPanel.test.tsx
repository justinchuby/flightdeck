// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AnalyticsInsight } from '../types';

vi.mock('../InsightCard', () => ({
  InsightCard: ({ insight }: { insight: AnalyticsInsight }) => (
    <div data-testid="insight-card">{insight.title}</div>
  ),
}));

import { InsightsPanel } from '../InsightsPanel';

function makeInsight(title: string): AnalyticsInsight {
  return { type: 'perf', title, description: `${title} desc`, severity: 'info' };
}

describe('InsightsPanel', () => {
  it('shows empty state when insights array is empty', () => {
    render(<InsightsPanel insights={[]} />);
    expect(screen.getByTestId('insights-panel')).toBeTruthy();
    expect(screen.getByText(/complete more sessions/i)).toBeTruthy();
    expect(screen.queryAllByTestId('insight-card')).toHaveLength(0);
  });

  it('renders up to 3 insights without a show-more button', () => {
    const insights = [makeInsight('A'), makeInsight('B'), makeInsight('C')];
    render(<InsightsPanel insights={insights} />);
    expect(screen.getAllByTestId('insight-card')).toHaveLength(3);
    expect(screen.queryByText(/show.*more/i)).toBeNull();
  });

  it('shows first 3 of 5 insights with toggle button', () => {
    const insights = Array.from({ length: 5 }, (_, i) => makeInsight(`I${i}`));
    render(<InsightsPanel insights={insights} />);

    expect(screen.getAllByTestId('insight-card')).toHaveLength(3);
    const btn = screen.getByText('Show 2 more');
    expect(btn).toBeTruthy();

    // expand
    fireEvent.click(btn);
    expect(screen.getAllByTestId('insight-card')).toHaveLength(5);
    expect(screen.getByText('Show less')).toBeTruthy();

    // collapse
    fireEvent.click(screen.getByText('Show less'));
    expect(screen.getAllByTestId('insight-card')).toHaveLength(3);
    expect(screen.getByText('Show 2 more')).toBeTruthy();
  });
});
