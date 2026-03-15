// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrushTimeSelector, type BrushTimeSelectorProps } from '../BrushTimeSelector';

// Mock @visx/brush — its internals rely on DOM measurements unavailable in jsdom
vi.mock('@visx/brush', () => ({
  Brush: (props: any) => (
    <rect data-testid="visx-brush" width={props.width} height={props.height} />
  ),
}));

const now = new Date('2024-06-01T12:00:00Z');
const oneHourAgo = new Date('2024-06-01T11:00:00Z');
const thirtyMinAgo = new Date('2024-06-01T11:30:00Z');

function makeProps(overrides: Partial<BrushTimeSelectorProps> = {}): BrushTimeSelectorProps {
  return {
    fullRange: { start: oneHourAgo, end: now },
    visibleRange: { start: thirtyMinAgo, end: now },
    onRangeChange: vi.fn(),
    agents: [],
    width: 800,
    ...overrides,
  };
}

describe('BrushTimeSelector', () => {
  it('renders with region landmark and minimap label', () => {
    render(<BrushTimeSelector {...makeProps()} />);
    const region = screen.getByRole('region');
    expect(region).toHaveAttribute('aria-label', expect.stringContaining('Timeline range selector'));
    expect(region).toHaveAttribute('aria-roledescription', 'minimap');
  });

  it('renders an SVG with the specified width', () => {
    const { container } = render(<BrushTimeSelector {...makeProps({ width: 1000 })} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('width')).toBe('1000');
  });

  it('renders the visx Brush element', () => {
    render(<BrushTimeSelector {...makeProps()} />);
    expect(screen.getByTestId('visx-brush')).toBeInTheDocument();
  });

  it('renders mini lane rects for agents', () => {
    const agents = [
      {
        id: 'agent-1',
        shortId: 'a1',
        role: 'developer',
        createdAt: oneHourAgo.toISOString(),
        segments: [
          { status: 'running' as const, startAt: oneHourAgo.toISOString(), endAt: now.toISOString() },
        ],
      },
    ];
    const { container } = render(<BrushTimeSelector {...makeProps({ agents })} />);
    const rects = container.querySelectorAll('rect');
    // Background lane rect + agent segment rect + brush mock rect
    expect(rects.length).toBeGreaterThanOrEqual(2);
  });

  it('returns null when innerWidth is non-positive', () => {
    const { container } = render(<BrushTimeSelector {...makeProps({ width: 0 })} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('shows hint text when not zoomed (full range visible)', () => {
    // visibleRange === fullRange → not zoomed
    const props = makeProps({
      visibleRange: { start: oneHourAgo, end: now },
      fullRange: { start: oneHourAgo, end: now },
    });
    render(<BrushTimeSelector {...props} />);
    expect(screen.getByText(/Zoom in to pan minimap/)).toBeInTheDocument();
  });

  it('applies leftOffset to Group positioning', () => {
    const { container } = render(<BrushTimeSelector {...makeProps({ leftOffset: 120 })} />);
    const group = container.querySelector('g');
    expect(group).toBeTruthy();
    // top=8 (PADDING.top), left = 0 (PADDING.left) + 120 (leftOffset) = 120
    expect(group!.getAttribute('transform')).toContain('120');
  });
});
