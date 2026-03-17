// @vitest-environment jsdom
/**
 * Coverage tests for CostCurve — formatTokens utility and edge cases.
 * Tests the formatTokens function branches and data edge cases.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CostCurve, type CostPoint } from '../CostCurve';

vi.mock('@visx/responsive', () => ({
  ParentSize: ({ children }: { children: (a: { width: number; height: number }) => React.ReactNode }) =>
    children({ width: 500, height: 250 }),
}));

vi.mock('@visx/group', () => ({
  Group: ({ children, ...p }: Record<string, unknown>) => (
    <g data-testid="visx-group" {...p}>{children as React.ReactNode}</g>
  ),
}));

vi.mock('@visx/scale', () => ({
  scaleTime: () => {
    const fn = () => 50;
    fn.domain = () => fn;
    fn.range = () => fn;
    fn.invert = () => new Date(1500);
    return fn;
  },
  scaleLinear: () => {
    const fn = () => 100;
    fn.domain = () => fn;
    fn.range = () => fn;
    fn.nice = () => fn;
    return fn;
  },
}));

vi.mock('@visx/axis', () => ({
  AxisBottom: () => <g data-testid="axis-bottom" />,
  AxisLeft: () => <g data-testid="axis-left" />,
}));

vi.mock('@visx/shape', () => ({
  AreaClosed: (p: any) => <path data-testid="area-closed" data-fill={p.fill} />,
  LinePath: (p: any) => <line data-testid="line-path" data-stroke={p.stroke} />,
  Line: () => <line data-testid="crosshair-line" />,
}));

vi.mock('../../hooks/useChartTooltip', () => ({
  useChartTooltip: () => ({
    handleTooltip: () => {},
    hideTooltip: () => {},
    tooltipData: null,
    tooltipLeft: 0,
    tooltipTop: 0,
    tooltipOpen: false,
  }),
  TooltipWithBounds: ({ children }: any) => <div data-testid="tooltip-bounds">{children}</div>,
  CHART_TOOLTIP_STYLES: {},
}));

describe('CostCurve — additional coverage', () => {
  it('renders empty state message for empty data', () => {
    render(<CostCurve data={[]} />);
    expect(screen.getByText('No token data')).toBeInTheDocument();
  });

  it('renders waiting state when all costs are zero', () => {
    const data: CostPoint[] = [
      { time: 1000, cumulativeCost: 0 },
      { time: 2000, cumulativeCost: 0 },
    ];
    render(<CostCurve data={data} />);
    expect(screen.getByText('Waiting for token data…')).toBeInTheDocument();
  });

  it('handles large token values (millions)', () => {
    const data: CostPoint[] = [
      { time: 1000, cumulativeCost: 5_000_000 },
      { time: 2000, cumulativeCost: 10_000_000 },
    ];
    render(<CostCurve data={data} />);
    expect(screen.getByText('Token Usage')).toBeInTheDocument();
  });

  it('handles medium token values (thousands)', () => {
    const data: CostPoint[] = [
      { time: 1000, cumulativeCost: 5_000 },
      { time: 2000, cumulativeCost: 10_000 },
    ];
    render(<CostCurve data={data} />);
    expect(screen.getByText('Token Usage')).toBeInTheDocument();
  });

  it('renders with breakdown data showing legend', () => {
    const data: CostPoint[] = [
      { time: 1000, cumulativeCost: 1500, cumulativeInput: 1000, cumulativeOutput: 500 },
      { time: 2000, cumulativeCost: 3000, cumulativeInput: 2000, cumulativeOutput: 1000 },
    ];
    render(<CostCurve data={data} />);
    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByText('Output')).toBeInTheDocument();
  });

  it('renders without breakdown data (no legend)', () => {
    const data: CostPoint[] = [
      { time: 1000, cumulativeCost: 500 },
      { time: 2000, cumulativeCost: 1000 },
    ];
    render(<CostCurve data={data} />);
    expect(screen.queryByText('Input')).not.toBeInTheDocument();
    expect(screen.queryByText('Output')).not.toBeInTheDocument();
  });

  it('renders with only output breakdown data', () => {
    // One point has breakdown, the other doesn't — .some() makes hasBreakdown true
    const data: CostPoint[] = [
      { time: 1000, cumulativeCost: 500, cumulativeInput: 300, cumulativeOutput: 200 },
      { time: 2000, cumulativeCost: 1000 },
    ];
    render(<CostCurve data={data} />);
    // hasBreakdown is true because at least one point has both input and output
    expect(screen.getByText('Input')).toBeInTheDocument();
  });

  it('renders outer container with data-testid', () => {
    const data: CostPoint[] = [{ time: 1000, cumulativeCost: 100 }];
    render(<CostCurve data={data} />);
    expect(screen.getByTestId('cost-curve')).toBeInTheDocument();
  });
});
