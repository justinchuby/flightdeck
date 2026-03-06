// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PromptNav } from '../PromptNav';
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
