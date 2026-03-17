// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PromptNav, hasUserMention } from '../PromptNav';
import type { AcpTextChunk } from '../../types';

function makeMessages(count: number, userIndices: number[]): AcpTextChunk[] {
  return Array.from({ length: count }, (_, i) => ({
    sender: userIndices.includes(i) ? 'user' : ('agent' as AcpTextChunk['sender']),
    text: `Message ${i}`,
    timestamp: Date.now(),
  }));
}

describe('PromptNav', () => {
  const containerRef = { current: document.createElement('div') };

  afterEach(() => cleanup());

  it('renders nothing when no user messages', () => {
    const msgs = makeMessages(5, []);
    const { container } = render(<PromptNav containerRef={containerRef} messages={msgs} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows total user prompt count', () => {
    const msgs = makeMessages(10, [0, 3, 7]);
    render(<PromptNav containerRef={containerRef} messages={msgs} />);
    expect(screen.getByText('·/3')).toBeTruthy();
  });

  it('wraps UP from first message to last', () => {
    const onJump = vi.fn();
    const msgs = makeMessages(10, [1, 4, 8]);
    render(<PromptNav containerRef={containerRef} messages={msgs} onJump={onJump} />);

    // Click Down to go to first (1/3)
    fireEvent.click(screen.getByTitle('Next prompt / @user mention'));
    expect(screen.getByText('1/3')).toBeTruthy();

    // Click Up — should wrap to last (3/3)
    fireEvent.click(screen.getByTitle('Previous prompt / @user mention'));
    expect(screen.getByText('3/3')).toBeTruthy();
  });

  it('wraps DOWN from last message to first', () => {
    const onJump = vi.fn();
    const msgs = makeMessages(10, [1, 4, 8]);
    render(<PromptNav containerRef={containerRef} messages={msgs} onJump={onJump} />);

    // Click Up from uninitialized — goes to last (3/3)
    fireEvent.click(screen.getByTitle('Previous prompt / @user mention'));
    expect(screen.getByText('3/3')).toBeTruthy();

    // Click Down — should wrap to first (1/3)
    fireEvent.click(screen.getByTitle('Next prompt / @user mention'));
    expect(screen.getByText('1/3')).toBeTruthy();

    // Verify Down called onJump with correct index
    expect(onJump).toHaveBeenLastCalledWith(1); // first user message at index 1
  });

  it('navigates through all prompts sequentially with wrap', () => {
    const onJump = vi.fn();
    const msgs = makeMessages(10, [2, 5, 9]);
    render(<PromptNav containerRef={containerRef} messages={msgs} onJump={onJump} />);

    const down = screen.getByTitle('Next prompt / @user mention');

    fireEvent.click(down); // 1/3
    expect(screen.getByText('1/3')).toBeTruthy();

    fireEvent.click(down); // 2/3
    expect(screen.getByText('2/3')).toBeTruthy();

    fireEvent.click(down); // 3/3
    expect(screen.getByText('3/3')).toBeTruthy();

    fireEvent.click(down); // wrap → 1/3
    expect(screen.getByText('1/3')).toBeTruthy();

    // onJump receives message index in filtered visible array: [2, 5, 9]
    expect(onJump).toHaveBeenNthCalledWith(1, 2);
    expect(onJump).toHaveBeenNthCalledWith(2, 5);
    expect(onJump).toHaveBeenNthCalledWith(3, 9);
    expect(onJump).toHaveBeenNthCalledWith(4, 2); // wrap back to first
  });

  it('uses original indices when useOriginalIndices is true', () => {
    const onJump = vi.fn();
    const msgs = makeMessages(10, [2, 5, 9]);
    render(<PromptNav containerRef={containerRef} messages={msgs} useOriginalIndices onJump={onJump} />);

    fireEvent.click(screen.getByTitle('Next prompt / @user mention'));
    expect(onJump).toHaveBeenCalledWith(2); // original index, not filtered
  });

  it('includes @user mentions in navigation', () => {
    const msgs: AcpTextChunk[] = [
      { sender: 'user', text: 'Hello', timestamp: Date.now() },
      { sender: 'agent', text: 'Some response', timestamp: Date.now() },
      { sender: 'agent', text: '@user here is the answer', timestamp: Date.now() },
    ];
    render(<PromptNav containerRef={containerRef} messages={msgs} />);
    expect(screen.getByText('·/2')).toBeTruthy(); // user msg + @user mention
  });
});

/**
 * Extra coverage for PromptNav — DOM querySelector fallback, hasUserMention export,
 * and system/queued message filtering.
 */

describe('hasUserMention', () => {
  it('returns true for text containing @user', () => {
    expect(hasUserMention('Hey @user check this')).toBe(true);
  });

  it('returns false for text without @user', () => {
    expect(hasUserMention('Hey check this')).toBe(false);
  });

  it('returns false for @username (not @user word boundary)', () => {
    expect(hasUserMention('@username')).toBe(false);
  });

  it('returns true for @user at end of string', () => {
    expect(hasUserMention('hello @user')).toBe(true);
  });
});

describe('PromptNav — DOM scrolling fallback', () => {
  afterEach(() => cleanup());

  it('scrolls to element via DOM querySelector when no onJump', () => {
    const container = document.createElement('div');
    const target = document.createElement('div');
    target.setAttribute('data-user-prompt', '0');
    target.scrollIntoView = vi.fn();
    container.appendChild(target);
    const containerRef = { current: container };

    const msgs: AcpTextChunk[] = [
      { sender: 'user', text: 'Hello', timestamp: Date.now() },
      { sender: 'agent', text: 'Reply', timestamp: Date.now() },
    ];

    render(<PromptNav containerRef={containerRef} messages={msgs} />);
    fireEvent.click(screen.getByTitle('Next prompt / @user mention'));
    expect(target.scrollIntoView).toHaveBeenCalled();
  });

  it('skips system messages and queued messages', () => {
    const containerRef = { current: document.createElement('div') };
    const msgs: AcpTextChunk[] = [
      { sender: 'system', text: 'System init', timestamp: Date.now() },
      { sender: 'user', text: 'Hello', timestamp: Date.now(), queued: true },
      { sender: 'user', text: 'Real message', timestamp: Date.now() },
      { sender: 'agent', text: '', timestamp: Date.now() }, // empty text
    ];

    render(<PromptNav containerRef={containerRef} messages={msgs} />);
    // Only 1 user message should be counted (the non-queued, non-system one)
    expect(screen.getByText('·/1')).toBeTruthy();
  });

  it('handles useOriginalIndices with system messages correctly', () => {
    const onJump = vi.fn();
    const msgs: AcpTextChunk[] = [
      { sender: 'system', text: 'Init', timestamp: Date.now() },
      { sender: 'user', text: 'Hello', timestamp: Date.now() },
      { sender: 'agent', text: '@user response', timestamp: Date.now() },
    ];

    render(
      <PromptNav containerRef={{ current: null }} messages={msgs} useOriginalIndices onJump={onJump} />,
    );
    // Should see 2 matches: user msg at index 1 and @user mention at index 2
    expect(screen.getByText('·/2')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Next prompt / @user mention'));
    expect(onJump).toHaveBeenCalledWith(1);
  });

  it('does nothing when container ref is null', () => {
    const msgs: AcpTextChunk[] = [
      { sender: 'user', text: 'Hello', timestamp: Date.now() },
    ];
    render(<PromptNav containerRef={{ current: null }} messages={msgs} />);
    // Should not throw when clicking nav
    fireEvent.click(screen.getByTitle('Next prompt / @user mention'));
    expect(screen.getByText('1/1')).toBeTruthy();
  });
});

describe('hasUserMention', () => {
  it('returns true when text contains @user', () => {
    expect(hasUserMention('Hey @user, check this')).toBe(true);
  });
  it('returns false when text does not contain @user', () => {
    expect(hasUserMention('Hello world')).toBe(false);
  });
  it('returns false for empty string', () => {
    expect(hasUserMention('')).toBe(false);
  });
  it('returns false for @username (partial match)', () => {
    // @user\b means word boundary, so @username should NOT match
    expect(hasUserMention('@username')).toBe(false);
  });
  it('returns true for @user at end of string', () => {
    expect(hasUserMention('check @user')).toBe(true);
  });
});

describe('PromptNav – DOM scroll fallback', () => {
  afterEach(cleanup);

  it('scrolls to DOM element and adds ring classes when onJump is not provided', () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const target = document.createElement('div');
    target.setAttribute('data-user-prompt', '0');
    target.scrollIntoView = vi.fn();
    container.appendChild(target);
    const containerRef = { current: container };

    const msgs: AcpTextChunk[] = [
      { sender: 'user', text: 'Hello', timestamp: Date.now() },
      { sender: 'agent', text: 'Response', timestamp: Date.now() },
    ];

    render(<PromptNav containerRef={containerRef} messages={msgs} />);

    // Click down to navigate to first user message
    fireEvent.click(screen.getByTitle('Next prompt / @user mention'));

    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(target.classList.contains('ring-2')).toBe(true);
    expect(target.classList.contains('ring-blue-400')).toBe(true);

    // After 1500ms, ring classes should be removed
    vi.advanceTimersByTime(1600);
    expect(target.classList.contains('ring-2')).toBe(false);

    vi.useRealTimers();
  });

  it('handles missing container gracefully', () => {
    const containerRef = { current: null };
    const msgs: AcpTextChunk[] = [
      { sender: 'user', text: 'Hello', timestamp: Date.now() },
    ];
    render(<PromptNav containerRef={containerRef} messages={msgs} />);
    // Should not crash when clicking navigate
    fireEvent.click(screen.getByTitle('Next prompt / @user mention'));
    expect(screen.getByText('1/1')).toBeTruthy();
  });

  it('handles missing target element gracefully', () => {
    const container = document.createElement('div');
    // No child elements with data-user-prompt
    const containerRef = { current: container };
    const msgs: AcpTextChunk[] = [
      { sender: 'user', text: 'Hello', timestamp: Date.now() },
    ];
    render(<PromptNav containerRef={containerRef} messages={msgs} />);
    fireEvent.click(screen.getByTitle('Next prompt / @user mention'));
    // Should not crash
    expect(screen.getByText('1/1')).toBeTruthy();
  });

  it('filters out system messages and queued messages', () => {
    const containerRef = { current: document.createElement('div') };
    const msgs: AcpTextChunk[] = [
      { sender: 'system', text: 'System init', timestamp: Date.now() },
      { sender: 'user', text: 'Hello', timestamp: Date.now() },
      { sender: 'agent', text: 'Reply', timestamp: Date.now(), queued: true },
      { sender: 'user', text: '', timestamp: Date.now() },
    ];
    render(<PromptNav containerRef={containerRef} messages={msgs} useOriginalIndices />);
    // Only 1 valid user message (system filtered, empty filtered, queued filtered)
    expect(screen.getByText('·/1')).toBeTruthy();
  });
});
