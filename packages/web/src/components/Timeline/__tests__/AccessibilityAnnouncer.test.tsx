import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AccessibilityAnnouncer } from '../AccessibilityAnnouncer';
import type { AccessibilityAnnouncements } from '../useAccessibilityAnnouncements';

function createMockAnnouncements(): AccessibilityAnnouncements & { _listener: (() => void) | null } {
  let politeMessage = '';
  let assertiveMessage = '';
  let listener: (() => void) | null = null;

  return {
    _listener: listener,
    announcePolite: vi.fn((msg: string) => { politeMessage = msg; listener?.(); }),
    announceAssertive: vi.fn((msg: string) => { assertiveMessage = msg; listener?.(); }),
    announceNewEvents: vi.fn(),
    announceError: vi.fn(),
    announceConnectionChange: vi.fn(),
    getState: () => ({ politeMessage, assertiveMessage }),
    subscribe: (cb: () => void) => { listener = cb; return () => { listener = null; }; },
    clearTimers: vi.fn(),
  };
}

describe('AccessibilityAnnouncer', () => {
  it('renders two ARIA live regions', () => {
    const mock = createMockAnnouncements();
    render(<AccessibilityAnnouncer announcements={mock} />);
    expect(screen.getByTestId('a11y-announcer-polite')).toBeTruthy();
    expect(screen.getByTestId('a11y-announcer-assertive')).toBeTruthy();
  });

  it('has correct aria-live attributes', () => {
    const mock = createMockAnnouncements();
    render(<AccessibilityAnnouncer announcements={mock} />);
    expect(screen.getByTestId('a11y-announcer-polite').getAttribute('aria-live')).toBe('polite');
    expect(screen.getByTestId('a11y-announcer-assertive').getAttribute('aria-live')).toBe('assertive');
  });

  it('displays polite message after announcePolite', () => {
    const mock = createMockAnnouncements();
    render(<AccessibilityAnnouncer announcements={mock} />);

    act(() => { mock.announcePolite('New event occurred'); });

    expect(screen.getByTestId('a11y-announcer-polite').textContent).toBe('New event occurred');
  });

  it('displays assertive message after announceAssertive', () => {
    const mock = createMockAnnouncements();
    render(<AccessibilityAnnouncer announcements={mock} />);

    act(() => { mock.announceAssertive('Connection lost'); });

    expect(screen.getByTestId('a11y-announcer-assertive').textContent).toBe('Connection lost');
  });

  it('calls clearTimers on unmount', () => {
    const mock = createMockAnnouncements();
    const { unmount } = render(<AccessibilityAnnouncer announcements={mock} />);
    unmount();
    expect(mock.clearTimers).toHaveBeenCalledOnce();
  });
});
