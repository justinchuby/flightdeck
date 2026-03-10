import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { PageTransition } from '../PageTransition';

describe('PageTransition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('renders children with data-testid', () => {
    render(
      <PageTransition transitionKey="tab-a">
        <div>Content A</div>
      </PageTransition>,
    );
    expect(screen.getByTestId('page-transition')).toBeTruthy();
    expect(screen.getByText('Content A')).toBeTruthy();
  });

  it('applies fade animation when key changes', () => {
    // Mock matchMedia to NOT prefer reduced motion
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });

    const { rerender } = render(
      <PageTransition transitionKey="tab-a">
        <div>Content A</div>
      </PageTransition>,
    );

    const el = screen.getByTestId('page-transition');

    // Change key → should trigger animation
    rerender(
      <PageTransition transitionKey="tab-b">
        <div>Content B</div>
      </PageTransition>,
    );

    // During animation, opacity should be set
    expect(el.style.transition).toContain('opacity');
  });

  it('skips animation when prefers-reduced-motion is set', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });

    const { rerender } = render(
      <PageTransition transitionKey="tab-a">
        <div>A</div>
      </PageTransition>,
    );

    const el = screen.getByTestId('page-transition');

    rerender(
      <PageTransition transitionKey="tab-b">
        <div>B</div>
      </PageTransition>,
    );

    // Should NOT have animation styles
    expect(el.style.transition).toBe('');
  });

  it('cleans up inline styles after animation completes', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });

    const { rerender } = render(
      <PageTransition transitionKey="tab-a" duration={100}>
        <div>A</div>
      </PageTransition>,
    );

    rerender(
      <PageTransition transitionKey="tab-b" duration={100}>
        <div>B</div>
      </PageTransition>,
    );

    const el = screen.getByTestId('page-transition');

    // After duration + buffer, inline styles should be cleared
    act(() => { vi.advanceTimersByTime(120); });
    expect(el.style.transition).toBe('');
    expect(el.style.opacity).toBe('');
    expect(el.style.transform).toBe('');
  });

  it('does not animate on initial render', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });

    render(
      <PageTransition transitionKey="tab-a">
        <div>A</div>
      </PageTransition>,
    );

    const el = screen.getByTestId('page-transition');
    expect(el.style.opacity).toBe('');
  });
});
