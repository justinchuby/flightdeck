import { describe, it, expect } from 'vitest';

/**
 * Unit test for BrushTimeSelector's leftOffset alignment logic.
 *
 * The minimap brush area must align with the main chart area,
 * which is offset by LABEL_WIDTH (180px). We test the core
 * width/offset calculations without rendering the component
 * (avoids jsdom dependency).
 */
describe('BrushTimeSelector — leftOffset alignment', () => {
  // These mirror the constants in BrushTimeSelector.tsx
  const PADDING = { top: 8, bottom: 4, left: 0, right: 0 };

  function computeLayout(width: number, leftOffset: number) {
    const effectiveLeft = PADDING.left + leftOffset;
    const innerWidth = width - effectiveLeft - PADDING.right;
    return { effectiveLeft, innerWidth };
  }

  it('without leftOffset, brush spans full width', () => {
    const { effectiveLeft, innerWidth } = computeLayout(1000, 0);
    expect(effectiveLeft).toBe(0);
    expect(innerWidth).toBe(1000);
  });

  it('with leftOffset=180, brush area aligns with chart (containerWidth - 180)', () => {
    const LABEL_WIDTH = 180;
    const containerWidth = 1000;
    const { effectiveLeft, innerWidth } = computeLayout(containerWidth, LABEL_WIDTH);
    expect(effectiveLeft).toBe(180);
    expect(innerWidth).toBe(containerWidth - LABEL_WIDTH);
  });

  it('innerWidth matches main chart chartWidth formula', () => {
    const LABEL_WIDTH = 180;
    const containerWidth = 1200;
    const chartWidth = Math.max(containerWidth - LABEL_WIDTH, 400);
    const { innerWidth } = computeLayout(containerWidth, LABEL_WIDTH);
    expect(innerWidth).toBe(chartWidth);
  });

  it('returns non-positive innerWidth for very small containers', () => {
    const { innerWidth } = computeLayout(100, 180);
    expect(innerWidth).toBeLessThanOrEqual(0);
  });
});

describe('BrushTimeSelector — dimming overlay logic', () => {
  const PADDING = { top: 8, bottom: 4, left: 0, right: 0 };

  function computeDimming(
    fullStart: number, fullEnd: number,
    visStart: number, visEnd: number,
    width: number, leftOffset: number,
  ) {
    const effectiveLeft = PADDING.left + leftOffset;
    const innerWidth = width - effectiveLeft - PADDING.right;
    // Mirrors xScale: maps [fullStart, fullEnd] → [0, innerWidth]
    const scale = (t: number) => ((t - fullStart) / (fullEnd - fullStart)) * innerWidth;
    const brushX0 = Math.max(0, scale(visStart));
    const brushX1 = Math.min(innerWidth, scale(visEnd));
    const isZoomed = brushX1 - brushX0 < innerWidth - 2;
    return { brushX0, brushX1, isZoomed, innerWidth };
  }

  it('no dimming when visible range equals full range', () => {
    const { isZoomed } = computeDimming(0, 1000, 0, 1000, 800, 180);
    expect(isZoomed).toBe(false);
  });

  it('shows dimming when zoomed in', () => {
    const { isZoomed, brushX0, brushX1, innerWidth } = computeDimming(0, 1000, 200, 600, 800, 180);
    expect(isZoomed).toBe(true);
    expect(brushX0).toBeGreaterThan(0);
    expect(brushX1).toBeLessThan(innerWidth);
  });

  it('dimming covers correct proportions', () => {
    // Viewing middle 50% of the range
    const { brushX0, brushX1, innerWidth } = computeDimming(0, 1000, 250, 750, 800, 180);
    const leftDim = brushX0;
    const rightDim = innerWidth - brushX1;
    // Each side should be ~25% of innerWidth
    expect(leftDim / innerWidth).toBeCloseTo(0.25, 1);
    expect(rightDim / innerWidth).toBeCloseTo(0.25, 1);
  });
});
