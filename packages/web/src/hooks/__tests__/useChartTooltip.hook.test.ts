import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockShowTooltip = vi.fn();
const mockHideTooltip = vi.fn();

vi.mock('@visx/tooltip', () => ({
  useTooltip: vi.fn(() => ({
    showTooltip: mockShowTooltip,
    hideTooltip: mockHideTooltip,
    tooltipData: undefined,
    tooltipLeft: undefined,
    tooltipTop: undefined,
    tooltipOpen: false,
  })),
  defaultStyles: { background: 'white', padding: 10 },
}));

const mockLocalPoint = vi.fn();
vi.mock('@visx/event', () => ({
  localPoint: (...args: unknown[]) => mockLocalPoint(...args),
}));

import { useChartTooltip, CHART_TOOLTIP_STYLES, type TimeSeriesPoint } from '../useChartTooltip';

describe('useChartTooltip', () => {
  const data: TimeSeriesPoint[] = [
    { time: 1000 }, { time: 2000 }, { time: 3000 }, { time: 4000 },
  ];

  const xScale = Object.assign(
    (d: Date) => d.getTime() / 10,
    { invert: (x: number) => new Date(x * 10) },
  );

  beforeEach(() => { vi.clearAllMocks(); });

  it('returns tooltip state and handlers', () => {
    const { result } = renderHook(() => useChartTooltip({ data, xScale, marginLeft: 50 }));
    expect(result.current.handleTooltip).toBeTypeOf('function');
    expect(result.current.hideTooltip).toBeTypeOf('function');
    expect(result.current.tooltipOpen).toBe(false);
  });

  it('handleTooltip finds nearest point via bisection', () => {
    mockLocalPoint.mockReturnValue({ x: 250, y: 30 });
    const { result } = renderHook(() => useChartTooltip({ data, xScale, marginLeft: 50 }));
    act(() => { result.current.handleTooltip({} as React.MouseEvent<SVGRectElement>); });
    expect(mockShowTooltip).toHaveBeenCalledWith(
      expect.objectContaining({ tooltipData: { time: 2000 } }),
    );
  });

  it('early-returns when localPoint returns null', () => {
    mockLocalPoint.mockReturnValue(null);
    const { result } = renderHook(() => useChartTooltip({ data, xScale, marginLeft: 50 }));
    act(() => { result.current.handleTooltip({} as React.MouseEvent<SVGRectElement>); });
    expect(mockShowTooltip).not.toHaveBeenCalled();
  });

  it('early-returns when data is empty', () => {
    mockLocalPoint.mockReturnValue({ x: 100, y: 30 });
    const { result } = renderHook(() => useChartTooltip({ data: [], xScale, marginLeft: 50 }));
    act(() => { result.current.handleTooltip({} as React.MouseEvent<SVGRectElement>); });
    expect(mockShowTooltip).not.toHaveBeenCalled();
  });

  it('clamps idx to data bounds', () => {
    mockLocalPoint.mockReturnValue({ x: 50050, y: 30 });
    const { result } = renderHook(() => useChartTooltip({ data, xScale, marginLeft: 50 }));
    act(() => { result.current.handleTooltip({} as React.MouseEvent<SVGRectElement>); });
    expect(mockShowTooltip).toHaveBeenCalledWith(
      expect.objectContaining({ tooltipData: { time: 4000 } }),
    );
  });

  it('picks closest point (left)', () => {
    mockLocalPoint.mockReturnValue({ x: 280, y: 30 });
    const { result } = renderHook(() => useChartTooltip({ data, xScale, marginLeft: 50 }));
    act(() => { result.current.handleTooltip({} as React.MouseEvent<SVGRectElement>); });
    expect(mockShowTooltip).toHaveBeenCalledWith(
      expect.objectContaining({ tooltipData: { time: 2000 } }),
    );
  });

  it('picks closest point (right)', () => {
    mockLocalPoint.mockReturnValue({ x: 320, y: 30 });
    const { result } = renderHook(() => useChartTooltip({ data, xScale, marginLeft: 50 }));
    act(() => { result.current.handleTooltip({} as React.MouseEvent<SVGRectElement>); });
    expect(mockShowTooltip).toHaveBeenCalledWith(
      expect.objectContaining({ tooltipData: { time: 3000 } }),
    );
  });

  it('CHART_TOOLTIP_STYLES has expected keys', () => {
    expect(CHART_TOOLTIP_STYLES).toHaveProperty('background');
    expect(CHART_TOOLTIP_STYLES).toHaveProperty('color');
    expect(CHART_TOOLTIP_STYLES).toHaveProperty('fontSize');
  });
});
