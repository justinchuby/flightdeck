import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressTimeline, type TimelineDataPoint } from '../ProgressTimeline';

// ── Tests ───────────────────────────────────────────────────────────

describe('ProgressTimeline', () => {
  it('renders empty state when data is empty', () => {
    render(<ProgressTimeline data={[]} />);
    expect(screen.getByTestId('progress-timeline')).toBeInTheDocument();
    expect(screen.getByText('Waiting for session data...')).toBeInTheDocument();
  });

  it('renders heading and legend with data', () => {
    const data: TimelineDataPoint[] = [
      { time: Date.now() - 60_000, completed: 2, inProgress: 1, remaining: 5, agentCount: 3 },
      { time: Date.now(), completed: 4, inProgress: 2, remaining: 3, agentCount: 4 },
    ];

    render(<ProgressTimeline data={data} />);
    expect(screen.getByText('Progress Timeline')).toBeInTheDocument();

    // Legend items
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText(/in Progress/i)).toBeInTheDocument();
    expect(screen.getByText('remaining')).toBeInTheDocument();
    expect(screen.getByText('Agents')).toBeInTheDocument();
  });

  it('renders an SVG element with default dimensions', () => {
    const data: TimelineDataPoint[] = [
      { time: Date.now() - 120_000, completed: 1, inProgress: 0, remaining: 9, agentCount: 1 },
      { time: Date.now() - 60_000, completed: 3, inProgress: 2, remaining: 5, agentCount: 2 },
      { time: Date.now(), completed: 6, inProgress: 1, remaining: 3, agentCount: 3 },
    ];

    const { container } = render(<ProgressTimeline data={data} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '800');
    expect(svg).toHaveAttribute('height', '240');
  });

  it('respects custom width and height', () => {
    const data: TimelineDataPoint[] = [
      { time: Date.now() - 60_000, completed: 1, inProgress: 0, remaining: 2, agentCount: 1 },
      { time: Date.now(), completed: 2, inProgress: 1, remaining: 0, agentCount: 2 },
    ];

    const { container } = render(<ProgressTimeline data={data} width={600} height={300} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '600');
    expect(svg).toHaveAttribute('height', '300');
  });

  it('renders without crashing with a single data point', () => {
    const data: TimelineDataPoint[] = [
      { time: Date.now(), completed: 5, inProgress: 0, remaining: 0, agentCount: 2 },
    ];

    render(<ProgressTimeline data={data} />);
    expect(screen.getByText('Progress Timeline')).toBeInTheDocument();
  });

  it('renders area path elements for stacked chart', () => {
    const data: TimelineDataPoint[] = [
      { time: Date.now() - 60_000, completed: 2, inProgress: 3, remaining: 5, agentCount: 4 },
      { time: Date.now(), completed: 7, inProgress: 1, remaining: 2, agentCount: 3 },
    ];

    const { container } = render(<ProgressTimeline data={data} />);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBeGreaterThan(0);
  });
});
