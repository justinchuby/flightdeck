/**
 * Unit tests for CostCurve — token usage chart with input/output breakdown.
 *
 * Covers: empty state, zero-data state, single total line (legacy),
 * stacked input/output areas, legend rendering.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CostCurve, type CostPoint } from '../CostCurve';

// visx components use SVG features not fully available in jsdom.
// Mock them to inspect props passed and test rendering logic.
vi.mock('@visx/responsive', () => ({
  ParentSize: ({ children }: { children: (args: { width: number; height: number }) => React.ReactNode }) =>
    children({ width: 400, height: 250 }),
}));
vi.mock('@visx/group', () => ({
  Group: ({ children, ...props }: Record<string, unknown>) => (
    <g data-testid="visx-group" {...props}>{children as React.ReactNode}</g>
  ),
}));
vi.mock('@visx/scale', () => ({
  scaleTime: () => {
    const fn = () => 0;
    fn.domain = () => fn;
    fn.range = () => fn;
    fn.invert = () => new Date(0);
    return fn;
  },
  scaleLinear: () => {
    const fn = () => 0;
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
vi.mock('@visx/shape', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    AreaClosed: (props: Record<string, unknown>) => (
      <path data-testid="area-closed" data-fill={props.fill as string} data-fill-opacity={String(props.fillOpacity)} />
    ),
    LinePath: (props: Record<string, unknown>) => (
      <line data-testid="line-path" data-stroke={props.stroke as string} data-stroke-width={String(props.strokeWidth)} />
    ),
    Line: () => <line data-testid="crosshair-line" />,
  };
});
vi.mock('../../hooks/useChartTooltip', () => ({
  useChartTooltip: () => ({
    handleTooltip: () => {},
    hideTooltip: () => {},
    tooltipData: null,
    tooltipLeft: 0,
    tooltipTop: 0,
    tooltipOpen: false,
  }),
  TooltipWithBounds: () => null,
  CHART_TOOLTIP_STYLES: {},
}));

describe('CostCurve', () => {
  it('renders empty state when data is empty', () => {
    render(<CostCurve data={[]} />);
    expect(screen.getByText('No token data')).toBeInTheDocument();
  });

  it('renders waiting state when all values are zero', () => {
    const data: CostPoint[] = [
      { time: 1000, cumulativeCost: 0 },
      { time: 2000, cumulativeCost: 0 },
    ];
    render(<CostCurve data={data} />);
    expect(screen.getByText('Waiting for token data…')).toBeInTheDocument();
  });

  it('renders single area + line when no breakdown data is provided', () => {
    const data: CostPoint[] = [
      { time: 1000, cumulativeCost: 500 },
      { time: 2000, cumulativeCost: 1000 },
    ];
    const { container } = render(<CostCurve data={data} />);

    // Should have exactly 1 area and 1 line (legacy mode)
    const areas = container.querySelectorAll('[data-testid="area-closed"]');
    const lines = container.querySelectorAll('[data-testid="line-path"]');
    expect(areas).toHaveLength(1);
    expect(lines).toHaveLength(1);

    // No legend should be shown
    expect(screen.queryByText('Input')).not.toBeInTheDocument();
    expect(screen.queryByText('Output')).not.toBeInTheDocument();
  });

  it('renders stacked areas with legend when breakdown data is provided', () => {
    const data: CostPoint[] = [
      { time: 1000, cumulativeCost: 1500, cumulativeInput: 1000, cumulativeOutput: 500 },
      { time: 2000, cumulativeCost: 3000, cumulativeInput: 2000, cumulativeOutput: 1000 },
    ];
    const { container } = render(<CostCurve data={data} />);

    // Should have 2 areas (output full area + input area) and 2 lines
    const areas = container.querySelectorAll('[data-testid="area-closed"]');
    const lines = container.querySelectorAll('[data-testid="line-path"]');
    expect(areas).toHaveLength(2);
    expect(lines).toHaveLength(2);

    // Legend should be shown
    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByText('Output')).toBeInTheDocument();
  });

  it('uses correct colors for input and output areas', () => {
    const data: CostPoint[] = [
      { time: 1000, cumulativeCost: 1500, cumulativeInput: 1000, cumulativeOutput: 500 },
      { time: 2000, cumulativeCost: 3000, cumulativeInput: 2000, cumulativeOutput: 1000 },
    ];
    const { container } = render(<CostCurve data={data} />);

    const areas = container.querySelectorAll('[data-testid="area-closed"]');
    // First area = input, second = output
    expect(areas[0].getAttribute('data-fill')).toBe('#60a5fa');
    expect(areas[1].getAttribute('data-fill')).toBe('rgb(var(--chart-success))');
  });

  it('renders title "Token Usage"', () => {
    const data: CostPoint[] = [
      { time: 1000, cumulativeCost: 500 },
    ];
    render(<CostCurve data={data} />);
    expect(screen.getByText('Token Usage')).toBeInTheDocument();
  });
});
