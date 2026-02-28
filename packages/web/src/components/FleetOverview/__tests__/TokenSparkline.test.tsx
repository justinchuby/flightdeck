/**
 * Unit tests for TokenSparkline.
 *
 * Covers: empty / single-point state, polyline rendering, red-zone
 * threshold line, dot at latest reading, and over-threshold colour.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TokenSparkline } from '../TokenSparkline';

// ── Tests ─────────────────────────────────────────────────────────────────

describe('TokenSparkline', () => {
  it('renders an SVG element', () => {
    const { container } = render(<TokenSparkline dataPoints={[10, 20, 30]} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('uses default width and height when not supplied', () => {
    const { container } = render(<TokenSparkline dataPoints={[1, 2, 3]} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('80');
    expect(svg.getAttribute('height')).toBe('24');
  });

  it('accepts custom width and height', () => {
    const { container } = render(
      <TokenSparkline dataPoints={[1, 2, 3]} width={120} height={32} />,
    );
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('120');
    expect(svg.getAttribute('height')).toBe('32');
  });

  it('renders a polyline when there are ≥ 2 data points', () => {
    const { container } = render(<TokenSparkline dataPoints={[0, 50, 100]} />);
    const polyline = container.querySelector('polyline');
    expect(polyline).not.toBeNull();
    const pts = polyline!.getAttribute('points');
    expect(pts).toBeTruthy();
    expect(pts!.split(' ').length).toBe(3);
  });

  it('renders a dashed placeholder line when < 2 data points', () => {
    const { container } = render(<TokenSparkline dataPoints={[42]} />);
    const polyline = container.querySelector('polyline');
    expect(polyline).toBeNull(); // no polyline in placeholder mode

    const line = container.querySelector('line');
    expect(line).not.toBeNull();
    expect(line!.getAttribute('stroke-dasharray')).toBeTruthy();
  });

  it('renders empty placeholder for zero-length data', () => {
    const { container } = render(<TokenSparkline dataPoints={[]} />);
    const polyline = container.querySelector('polyline');
    expect(polyline).toBeNull();
  });

  it('renders a red-zone threshold line', () => {
    const { container } = render(<TokenSparkline dataPoints={[10, 20, 30, 40, 50]} />);
    // The threshold is drawn as a dashed line with a red fill rect above it.
    const lines = container.querySelectorAll('line');
    const dashedLine = Array.from(lines).find(
      l => l.getAttribute('stroke-dasharray') !== null,
    );
    expect(dashedLine).not.toBeNull();

    const rects = container.querySelectorAll('rect');
    const redRect = Array.from(rects).find(r =>
      (r.getAttribute('fill') ?? '').includes('68,68'),
    );
    expect(redRect).not.toBeNull();
  });

  it('renders a dot at the last data point', () => {
    const { container } = render(<TokenSparkline dataPoints={[5, 10, 15]} />);
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(1);
  });

  it('changes line colour to red when last value is > 80 % of max', () => {
    // dataPoints=[0, 100]: last=100, max=100, ratio=1.0 > 0.8 → red.
    const { container } = render(
      <TokenSparkline dataPoints={[0, 100]} color="#58a6ff" />,
    );
    const polyline = container.querySelector('polyline')!;
    // Over threshold → stroke should be the red shade, not the supplied colour.
    expect(polyline.getAttribute('stroke')).not.toBe('#58a6ff');
    expect(polyline.getAttribute('stroke')).toContain('#f87171');
  });

  it('keeps the supplied colour when last value is ≤ 80 % of max', () => {
    // dataPoints=[0, 100, 60]: last=60, max=100, ratio=0.6 — not > 0.8 → use supplied colour.
    const { container } = render(
      <TokenSparkline dataPoints={[0, 100, 60]} color="#58a6ff" />,
    );
    const polyline = container.querySelector('polyline')!;
    expect(polyline.getAttribute('stroke')).toBe('#58a6ff');
  });

  it('normalises all-equal data points without crashing', () => {
    const { container } = render(<TokenSparkline dataPoints={[50, 50, 50]} />);
    const polyline = container.querySelector('polyline');
    // When max = 50 and all values are the same, polyline should still render.
    expect(polyline).not.toBeNull();
  });

  it('aria-label is present on the SVG', () => {
    const { container } = render(<TokenSparkline dataPoints={[10, 20]} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-label')).toBeTruthy();
  });
});
