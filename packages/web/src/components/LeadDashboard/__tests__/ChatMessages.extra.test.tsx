// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatMessages } from '../ChatMessages';
import type { AcpTextChunk, AgentInfo } from '../../../types';

// Mock react-virtuoso
vi.mock('react-virtuoso', () => {
  return {
    Virtuoso: React.forwardRef(({ data, itemContent, components }: any, ref: any) => {
      const Footer = components?.Footer;
      return (
        <div ref={ref} data-testid="virtuoso-container">
          {data?.map((item: any, index: number) => (
            <div key={index} data-testid={`chat-item-${index}`}>
              {itemContent(index, item)}
            </div>
          ))}
          {Footer && <Footer />}
        </div>
      );
    }),
  };
});

// Mock ChatRenderers
vi.mock('../ChatRenderers', () => ({
  CollapsibleReasoningBlock: ({ text, timestamp }: { text: string; timestamp: string }) => (
    <div data-testid="reasoning-block">
      <span>Thinking: {text}</span>
      {timestamp && <span>{timestamp}</span>}
    </div>
  ),
  CollapsibleSystemBlock: ({ text }: { text: string }) => (
    <div data-testid="system-long-block">
      <span>System (long): {text.slice(0, 50)}</span>
    </div>
  ),
  RichContentBlock: ({ msg }: { msg: any }) => (
    <div data-testid="rich-content-block">{msg.contentType}: {msg.text}</div>
  ),
  AgentTextBlock: ({ text }: { text: string }) => (
    <div data-testid="agent-text-block">{text}</div>
  ),
}));

vi.mock('../../PromptNav', () => ({
  PromptNav: () => null,
  hasUserMention: () => false,
}));

vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    vi.fn(() => null),
    { getState: () => ({ setSelectedAgent: vi.fn() }) },
  ),
}));

vi.mock('../../../utils/commandParser', () => ({
  hasUnclosedCommandBlock: () => false,
}));

const defaultProps = {
  agents: [] as AgentInfo[],
  isActive: false,
  chatContainerRef: { current: null },
  messagesEndRef: { current: null },
  catchUpSummary: null,
  onDismissCatchUp: vi.fn(),
  onScrollToBottom: vi.fn(),
};

function makeMessage(overrides: Partial<AcpTextChunk> = {}): AcpTextChunk {
  return {
    type: 'text',
    text: 'test message',
    sender: 'agent',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('ChatMessages – extra coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /* ── Message merging ──────────────────────────────────────────── */

  it('merges consecutive agent text messages into one block', () => {
    const messages: AcpTextChunk[] = [
      makeMessage({ sender: 'agent', text: 'Part 1 ' }),
      makeMessage({ sender: 'agent', text: 'Part 2 ' }),
      makeMessage({ sender: 'agent', text: 'Part 3' }),
    ];

    const { container } = render(
      <ChatMessages {...defaultProps} messages={messages} />,
    );

    // All three parts should be merged into a single block
    const textBlocks = container.querySelectorAll('[data-testid="agent-text-block"]');
    expect(textBlocks.length).toBe(1);
    expect(textBlocks[0].textContent).toContain('Part 1');
    expect(textBlocks[0].textContent).toContain('Part 2');
    expect(textBlocks[0].textContent).toContain('Part 3');
  });

  it('does not merge agent messages across user messages', () => {
    const messages: AcpTextChunk[] = [
      makeMessage({ sender: 'agent', text: 'Before user' }),
      makeMessage({ sender: 'user', text: 'User says something' }),
      makeMessage({ sender: 'agent', text: 'After user' }),
    ];

    const { container } = render(
      <ChatMessages {...defaultProps} messages={messages} />,
    );

    const textBlocks = container.querySelectorAll('[data-testid="agent-text-block"]');
    expect(textBlocks.length).toBe(2);
    expect(textBlocks[0].textContent).toContain('Before user');
    expect(textBlocks[1].textContent).toContain('After user');
  });

  /* ── Thinking messages ────────────────────────────────────────── */

  it('renders thinking messages as collapsible reasoning blocks', () => {
    const messages: AcpTextChunk[] = [
      makeMessage({ sender: 'thinking', text: 'Let me analyze this problem...' }),
    ];

    render(<ChatMessages {...defaultProps} messages={messages} />);

    expect(screen.getByTestId('reasoning-block')).toBeInTheDocument();
    expect(screen.getByText(/Let me analyze this problem/)).toBeInTheDocument();
  });

  /* ── System long messages ─────────────────────────────────────── */

  it('renders long system messages (>200 chars) as collapsible blocks', () => {
    const longText = '🔄 ' + 'A'.repeat(250);
    const messages: AcpTextChunk[] = [
      makeMessage({ sender: 'system', text: longText }),
    ];

    render(<ChatMessages {...defaultProps} messages={messages} />);

    expect(screen.getByTestId('system-long-block')).toBeInTheDocument();
  });

  it('renders short system messages inline (not collapsible)', () => {
    const messages: AcpTextChunk[] = [
      makeMessage({ sender: 'system', text: '🔄 Session started' }),
    ];

    const { container } = render(
      <ChatMessages {...defaultProps} messages={messages} />,
    );

    // Short system messages should NOT be in a system-long-block
    expect(screen.queryByTestId('system-long-block')).not.toBeInTheDocument();
    expect(container.textContent).toContain('Session started');
  });

  /* ── Rich content messages ────────────────────────────────────── */

  it('renders agent messages with non-text contentType as rich blocks', () => {
    const messages: AcpTextChunk[] = [
      makeMessage({
        sender: 'agent',
        text: '{"tool": "bash", "result": "ok"}',
        contentType: 'tool_result',
      }),
    ];

    render(<ChatMessages {...defaultProps} messages={messages} />);

    expect(screen.getByTestId('rich-content-block')).toBeInTheDocument();
    expect(screen.getByText(/tool_result/)).toBeInTheDocument();
  });

  /* ── Working indicator ────────────────────────────────────────── */

  it('shows "Working..." indicator when active and last message is from user', () => {
    const messages: AcpTextChunk[] = [
      makeMessage({ sender: 'user', text: 'Do something' }),
    ];

    render(
      <ChatMessages {...defaultProps} messages={messages} isActive={true} />,
    );

    expect(screen.getByText('Working...')).toBeInTheDocument();
  });

  it('does NOT show "Working..." when last message is from agent', () => {
    const messages: AcpTextChunk[] = [
      makeMessage({ sender: 'user', text: 'Do something' }),
      makeMessage({ sender: 'agent', text: 'Done!' }),
    ];

    render(
      <ChatMessages {...defaultProps} messages={messages} isActive={true} />,
    );

    expect(screen.queryByText('Working...')).not.toBeInTheDocument();
  });

  it('does NOT show "Working..." when not active', () => {
    const messages: AcpTextChunk[] = [
      makeMessage({ sender: 'user', text: 'Do something' }),
    ];

    render(
      <ChatMessages {...defaultProps} messages={messages} isActive={false} />,
    );

    expect(screen.queryByText('Working...')).not.toBeInTheDocument();
  });

  it('does NOT show "Working..." when last user message is queued', () => {
    const messages: AcpTextChunk[] = [
      makeMessage({ sender: 'user', text: 'Queued msg', queued: true }),
    ];

    render(
      <ChatMessages {...defaultProps} messages={messages} isActive={true} />,
    );

    // buildChatItems filters out queued messages, so no items rendered
    // (and no working indicator because filtered list is empty)
    expect(screen.queryByText('Working...')).not.toBeInTheDocument();
  });

  /* ── Catch-up summary ─────────────────────────────────────────── */

  it('renders catch-up summary overlay when provided', () => {
    const catchUp = {
      tasksCompleted: 3,
      pendingDecisions: 1,
      newMessages: 5,
      newReports: 2,
    };

    render(
      <ChatMessages
        {...defaultProps}
        catchUpSummary={catchUp}
        messages={[makeMessage({ sender: 'agent', text: 'hi' })]}
      />,
    );

    expect(screen.getByText('While you were away')).toBeInTheDocument();
    expect(screen.getByText('3 tasks completed')).toBeInTheDocument();
    expect(screen.getByText(/1 decision pending/)).toBeInTheDocument();
    expect(screen.getByText('5 new messages')).toBeInTheDocument();
    expect(screen.getByText('2 reports')).toBeInTheDocument();
  });

  it('dismiss button calls onDismissCatchUp', () => {
    const onDismiss = vi.fn();
    const catchUp = {
      tasksCompleted: 1,
      pendingDecisions: 0,
      newMessages: 0,
      newReports: 0,
    };

    render(
      <ChatMessages
        {...defaultProps}
        catchUpSummary={catchUp}
        onDismissCatchUp={onDismiss}
        messages={[makeMessage({ sender: 'agent', text: 'hi' })]}
      />,
    );

    fireEvent.click(screen.getByText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('"Show All" button calls onDismissCatchUp and onScrollToBottom', () => {
    const onDismiss = vi.fn();
    const onScroll = vi.fn();
    const catchUp = {
      tasksCompleted: 1,
      pendingDecisions: 0,
      newMessages: 0,
      newReports: 0,
    };

    render(
      <ChatMessages
        {...defaultProps}
        catchUpSummary={catchUp}
        onDismissCatchUp={onDismiss}
        onScrollToBottom={onScroll}
        messages={[makeMessage({ sender: 'agent', text: 'hi' })]}
      />,
    );

    fireEvent.click(screen.getByText('Show All'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onScroll).toHaveBeenCalledTimes(1);
  });

  it('catch-up overlay dismisses on Escape key', () => {
    const onDismiss = vi.fn();
    const catchUp = {
      tasksCompleted: 1,
      pendingDecisions: 0,
      newMessages: 0,
      newReports: 0,
    };

    render(
      <ChatMessages
        {...defaultProps}
        catchUpSummary={catchUp}
        onDismissCatchUp={onDismiss}
        messages={[makeMessage({ sender: 'agent', text: 'hi' })]}
      />,
    );

    const overlay = screen.getByRole('status');
    fireEvent.keyDown(overlay, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('catch-up overlay dismisses on Enter key', () => {
    const onDismiss = vi.fn();
    const catchUp = {
      tasksCompleted: 0,
      pendingDecisions: 2,
      newMessages: 0,
      newReports: 0,
    };

    render(
      <ChatMessages
        {...defaultProps}
        catchUpSummary={catchUp}
        onDismissCatchUp={onDismiss}
        messages={[makeMessage({ sender: 'agent', text: 'hi' })]}
      />,
    );

    const overlay = screen.getByRole('status');
    fireEvent.keyDown(overlay, { key: 'Enter' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  /* ── No catch-up overlay when null ────────────────────────────── */

  it('does NOT render catch-up overlay when catchUpSummary is null', () => {
    render(
      <ChatMessages
        {...defaultProps}
        catchUpSummary={null}
        messages={[makeMessage({ sender: 'agent', text: 'hi' })]}
      />,
    );

    expect(screen.queryByText('While you were away')).not.toBeInTheDocument();
  });

  /* ── Catch-up with zero counts hides those items ──────────────── */

  it('only shows non-zero catch-up items', () => {
    const catchUp = {
      tasksCompleted: 0,
      pendingDecisions: 3,
      newMessages: 0,
      newReports: 0,
    };

    render(
      <ChatMessages
        {...defaultProps}
        catchUpSummary={catchUp}
        messages={[makeMessage({ sender: 'agent', text: 'hi' })]}
      />,
    );

    expect(screen.getByText('While you were away')).toBeInTheDocument();
    expect(screen.getByText(/3 decisions pending/)).toBeInTheDocument();
    // Zero items should not appear
    expect(screen.queryByText(/task/)).not.toBeInTheDocument();
    expect(screen.queryByText(/message/)).not.toBeInTheDocument();
    expect(screen.queryByText(/report/)).not.toBeInTheDocument();
  });

  /* ── User message with attachments ────────────────────────────── */

  it('renders user message with image attachment thumbnail', () => {
    const messages: AcpTextChunk[] = [
      makeMessage({
        sender: 'user',
        text: 'Check this image',
        attachments: [
          { name: 'screenshot.png', thumbnailDataUrl: 'data:image/png;base64,abc123' },
        ],
      }),
    ];

    const { container } = render(
      <ChatMessages {...defaultProps} messages={messages} />,
    );

    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('alt')).toBe('screenshot.png');
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,abc123');
  });

  it('renders user message with non-image attachment as name badge', () => {
    const messages: AcpTextChunk[] = [
      makeMessage({
        sender: 'user',
        text: 'Check this file',
        attachments: [
          { name: 'data.csv' },
        ],
      }),
    ];

    const { container } = render(
      <ChatMessages {...defaultProps} messages={messages} />,
    );

    expect(container.textContent).toContain('data.csv');
  });

  /* ── Filtered system messages ─────────────────────────────────── */

  it('filters external messages by sender type, not emoji prefix', () => {
    const messages: AcpTextChunk[] = [
      makeMessage({ sender: 'external', text: '📤 Sent to agent' }),
      makeMessage({ sender: 'external', text: '📨 Received from agent' }),
      makeMessage({ sender: 'system', text: '🔄 Restarting' }),
    ];

    const { container } = render(
      <ChatMessages {...defaultProps} messages={messages} />,
    );

    // External messages filtered by sender type — all system messages shown
    expect(container.textContent).toContain('Restarting');
    expect(container.textContent).not.toContain('Sent to agent');
    expect(container.textContent).not.toContain('Received from agent');
  });

  /* ── Queued messages filtered ─────────────────────────────────── */

  it('filters out queued messages from display', () => {
    const messages: AcpTextChunk[] = [
      makeMessage({ sender: 'user', text: 'Visible' }),
      makeMessage({ sender: 'user', text: 'Queued and hidden', queued: true }),
    ];

    const { container } = render(
      <ChatMessages {...defaultProps} messages={messages} />,
    );

    expect(container.textContent).toContain('Visible');
    expect(container.textContent).not.toContain('Queued and hidden');
  });

  /* ── Empty messages array ─────────────────────────────────────── */

  it('renders empty container when no messages', () => {
    render(
      <ChatMessages {...defaultProps} messages={[]} />,
    );

    const virtuoso = screen.getByTestId('virtuoso-container');
    // Should have no chat items
    expect(virtuoso.children.length).toBeLessThanOrEqual(1); // just footer
  });

  /* ── Singular vs plural in catch-up ───────────────────────────── */

  it('uses singular form for catch-up counts of 1', () => {
    const catchUp = {
      tasksCompleted: 1,
      pendingDecisions: 1,
      newMessages: 1,
      newReports: 1,
    };

    render(
      <ChatMessages
        {...defaultProps}
        catchUpSummary={catchUp}
        messages={[makeMessage({ sender: 'agent', text: 'hi' })]}
      />,
    );

    expect(screen.getByText('1 task completed')).toBeInTheDocument();
    expect(screen.getByText(/1 decision pending/)).toBeInTheDocument();
    expect(screen.getByText('1 new message')).toBeInTheDocument();
    expect(screen.getByText('1 report')).toBeInTheDocument();
  });
});
