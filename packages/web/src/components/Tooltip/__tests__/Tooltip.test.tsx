// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Tooltip } from '../Tooltip';

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children', () => {
    render(
      <Tooltip content="Tooltip text">
        <span>Hover me</span>
      </Tooltip>,
    );
    expect(screen.getByText('Hover me')).toBeInTheDocument();
  });

  it('shows tooltip on mouse enter after delay', async () => {
    render(
      <Tooltip content="Help text" delay={200}>
        <span>Target</span>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('Target'));
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByText('Help text')).toBeInTheDocument();
  });

  it('hides tooltip on mouse leave', () => {
    render(
      <Tooltip content="Tip" delay={0}>
        <span>Target</span>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('Target'));
    act(() => {
      vi.advanceTimersByTime(50);
    });
    fireEvent.mouseLeave(screen.getByText('Target'));
    // Tooltip should be hidden
    expect(screen.queryByText('Tip')).toBeNull();
  });

  it('does not show tooltip before delay', () => {
    render(
      <Tooltip content="Delayed" delay={500}>
        <span>Target</span>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('Target'));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByText('Delayed')).toBeNull();
  });

  it('renders with different placements', () => {
    for (const placement of ['top', 'bottom', 'left', 'right'] as const) {
      const { unmount } = render(
        <Tooltip content={`Tip ${placement}`} placement={placement}>
          <span>{placement}</span>
        </Tooltip>,
      );
      expect(screen.getByText(placement)).toBeInTheDocument();
      unmount();
    }
  });
});
