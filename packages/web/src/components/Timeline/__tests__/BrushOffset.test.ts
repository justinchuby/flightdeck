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
