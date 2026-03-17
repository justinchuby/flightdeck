// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../hooks/useChartTooltip', () => ({
  useChartTooltip: () => ({
    tooltipData: null,
    tooltipLeft: 0,
    tooltipTop: 0,
    handleTooltip: vi.fn(),
    hideTooltip: vi.fn(),
    tooltipOpen: false,
  }),
  TooltipWithBounds: ({ children }: { children: React.ReactNode }) => <div data-testid="tooltip">{children}</div>,
  CHART_TOOLTIP_STYLES: {},
}));

vi.mock('@visx/responsive', () => ({
  ParentSize: ({ children }: { children: (p: { width: number; height: number }) => React.ReactNode }) =>
    children({ width: 600, height: 250 }),
}));
vi.mock('@visx/shape', () => ({
  AreaClosed: () => <path data-testid="area-closed" />,
  LinePath: () => <path data-testid="line-path" />,
  Line: () => <line data-testid="line" />,
}));
vi.mock('@visx/group', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <g>{children}</g>,
}));
vi.mock('@visx/scale', () => ({
  scaleLinear: () => {
    const fn = (v: number) => v;
    fn.range = () => fn;
    fn.domain = () => fn;
    fn.nice = () => fn;
    return fn;
  },
  scaleTime: () => {
    const fn = () => 0;
    fn.range = () => fn;
    fn.domain = () => fn;
    fn.nice = () => fn;
    fn.invert = () => new Date(0);
    return fn;
  },
}));
vi.mock('@visx/axis', () => ({
  AxisBottom: () => <g data-testid="axis-bottom" />,
  AxisLeft: () => <g data-testid="axis-left" />,
}));
vi.mock('@visx/curve', () => ({
  curveMonotoneX: vi.fn(),
}));

import { CumulativeFlow, type FlowPoint } from '../TaskBurndown';

const makeData = (n = 5): FlowPoint[] =>
  Array.from({ length: n }, (_, i) => ({
    time: Date.now() - (n - i) * 60000,
    created: i * 3,
    inProgress: Math.min(i * 2, 5),
    completed: Math.max(0, i - 1),
  }));

describe('CumulativeFlow — extra coverage', () => {
  it('shows "No task data" for empty array', () => {
    render(<CumulativeFlow data={[]} />);
    expect(screen.getByText('No task data')).toBeInTheDocument();
  });

  it('renders the cumulative-flow test id', () => {
    render(<CumulativeFlow data={makeData()} />);
    expect(screen.getByTestId('cumulative-flow')).toBeInTheDocument();
  });

  it('renders Task Flow title', () => {
    render(<CumulativeFlow data={makeData()} />);
    expect(screen.getByText('Task Flow')).toBeInTheDocument();
  });

  it('renders legend with Created, Active, Done labels', () => {
    render(<CumulativeFlow data={makeData()} />);
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('renders axes when data is present', () => {
    render(<CumulativeFlow data={makeData()} />);
    expect(screen.getByTestId('axis-bottom')).toBeInTheDocument();
    expect(screen.getByTestId('axis-left')).toBeInTheDocument();
  });

  it('renders area and line paths for data', () => {
    const { container } = render(<CumulativeFlow data={makeData()} />);
    // 1 AreaClosed for created background + 3 LinePaths for series
    expect(container.querySelectorAll('[data-testid="area-closed"]').length).toBe(1);
    expect(container.querySelectorAll('[data-testid="line-path"]').length).toBe(3);
  });

  it('renders mouse event overlay rect', () => {
    const { container } = render(<CumulativeFlow data={makeData()} />);
    const rect = container.querySelector('rect[fill="transparent"]');
    expect(rect).toBeTruthy();
  });

  it('handles data with 2 points', () => {
    const data: FlowPoint[] = [
      { time: 1000, created: 1, inProgress: 0, completed: 0 },
      { time: 2000, created: 2, inProgress: 1, completed: 0 },
    ];
    const { container } = render(<CumulativeFlow data={data} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
