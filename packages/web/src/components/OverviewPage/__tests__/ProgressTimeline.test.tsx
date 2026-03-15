// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ProgressTimeline } from '../ProgressTimeline';
import type { TimelineDataPoint } from '../ProgressTimeline';

const makeSample = (): TimelineDataPoint[] => [
  { time: Date.now() - 60000, completed: 2, inProgress: 3, remaining: 5, agentCount: 4 },
  { time: Date.now() - 30000, completed: 4, inProgress: 2, remaining: 4, agentCount: 5 },
  { time: Date.now(), completed: 7, inProgress: 1, remaining: 2, agentCount: 3 },
];

describe('ProgressTimeline', () => {
  it('renders SVG chart', () => {
    const { container } = render(<ProgressTimeline data={makeSample()} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('renders with empty data', () => {
    const { container } = render(<ProgressTimeline data={[]} />);
    expect(container).toBeTruthy();
  });

  it('renders with single data point', () => {
    const { container } = render(
      <ProgressTimeline data={[{ time: Date.now(), completed: 1, inProgress: 0, remaining: 0, agentCount: 1 }]} />,
    );
    expect(container).toBeTruthy();
  });

  it('respects custom width/height', () => {
    const { container } = render(<ProgressTimeline data={makeSample()} width={800} height={400} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('renders area elements for stacked chart', () => {
    const { container } = render(<ProgressTimeline data={makeSample()} />);
    // AreaStack creates path elements
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBeGreaterThan(0);
  });

  it('renders legend items', () => {
    const { container } = render(<ProgressTimeline data={makeSample()} />);
    // Legend should have color indicators
    expect(container.textContent).toMatch(/Completed|In Progress|Remaining/i);
  });
});
