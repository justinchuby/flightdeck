// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../../../hooks/useChartTooltip', () => ({
  useChartTooltip: () => ({
    tooltipData: null,
    tooltipLeft: 0,
    tooltipTop: 0,
    handleMouseMove: vi.fn(),
    handleMouseLeave: vi.fn(),
    showTooltip: false,
  }),
  TooltipWithBounds: ({ children }: { children: React.ReactNode }) => <div data-testid="tooltip">{children}</div>,
  CHART_TOOLTIP_STYLES: {},
}));

vi.mock('@visx/responsive', () => ({
  ParentSize: ({ children }: { children: (p: { width: number; height: number }) => React.ReactNode }) =>
    children({ width: 600, height: 300 }),
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
    const fn = (v: any) => 0;
    fn.range = () => fn;
    fn.domain = () => fn;
    fn.nice = () => fn;
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

describe('CumulativeFlow', () => {
  it('renders without crashing', () => {
    const { container } = render(<CumulativeFlow data={makeData()} />);
    expect(container).toBeTruthy();
  });

  it('renders with empty data', () => {
    const { container } = render(<CumulativeFlow data={[]} />);
    expect(container).toBeTruthy();
  });

  it('renders with single data point', () => {
    const { container } = render(<CumulativeFlow data={makeData(1)} />);
    expect(container).toBeTruthy();
  });

  it('renders with many data points', () => {
    const { container } = render(<CumulativeFlow data={makeData(50)} />);
    expect(container).toBeTruthy();
  });

  it('shows legend labels', () => {
    const { container } = render(<CumulativeFlow data={makeData()} />);
    const text = container.textContent || '';
    expect(text).toMatch(/Created|Active|Done/i);
  });
});
