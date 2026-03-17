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

describe('Tooltip – placement coverage', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows tooltip with bottom placement', () => {
    render(
      <Tooltip content="Bottom tip" placement="bottom" delay={0}>
        <span>Target</span>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('Target'));
    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByText('Bottom tip')).toBeInTheDocument();
  });

  it('shows tooltip with left placement', () => {
    render(
      <Tooltip content="Left tip" placement="left" delay={0}>
        <span>Target</span>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('Target'));
    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.getByText('Left tip')).toBeInTheDocument();
  });

  it('shows tooltip with right placement', () => {
    render(
      <Tooltip content="Right tip" placement="right" delay={0}>
        <span>Target</span>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('Target'));
    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.getByText('Right tip')).toBeInTheDocument();
  });

  it('shows tooltip on focus and hides on blur', () => {
    render(
      <Tooltip content="Focus tip" delay={0}>
        <span tabIndex={0}>Focusable</span>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByText('Focusable'));
    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.getByText('Focus tip')).toBeInTheDocument();

    fireEvent.blur(screen.getByText('Focusable'));
    expect(screen.queryByText('Focus tip')).toBeNull();
  });

  it('does not render tooltip when content is empty/null', () => {
    render(
      <Tooltip content={null as any} delay={0}>
        <span>Target</span>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('Target'));
    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
