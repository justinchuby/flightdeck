// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ChatMessages } from '../ChatMessages';
import type { AcpTextChunk, AgentInfo } from '../../../types';

// Mock react-virtuoso to avoid layout measurement issues in jsdom
vi.mock('react-virtuoso', () => {
  return {
    Virtuoso: React.forwardRef(({ data, itemContent, components }: any, ref: any) => {
      const Footer = components?.Footer;
      return (
        <div ref={ref} data-testid="virtuoso-container">
          {data?.map((item: any, index: number) => (
            <div key={index}>{itemContent(index, item)}</div>
          ))}
          {Footer && <Footer />}
        </div>
      );
    }),
  };
});

// Mock PromptNav to avoid complex rendering dependencies
vi.mock('../../PromptNav', () => ({
  PromptNav: () => null,
  hasUserMention: () => false,
}));

// Mock appStore
vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    vi.fn(() => null),
    { getState: () => ({ setSelectedAgent: vi.fn() }) },
  ),
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

describe('ChatMessages', () => {
  it('renders user and agent messages', () => {
    const messages: AcpTextChunk[] = [
      makeMessage({ sender: 'user', text: 'Hello agent' }),
      makeMessage({ sender: 'agent', text: 'Hello user' }),
    ];

    const { container } = render(
      <ChatMessages {...defaultProps} messages={messages} />,
    );

    expect(container.textContent).toContain('Hello agent');
    expect(container.textContent).toContain('Hello user');
  });

  it('filters out external (agent-to-lead) messages from the chat view', () => {
    const messages: AcpTextChunk[] = [
      makeMessage({ sender: 'user', text: 'Start working' }),
      makeMessage({ sender: 'external', text: '[Starting] Exploring the Settings page...', fromRole: 'Developer (abc12345)' }),
      makeMessage({ sender: 'agent', text: 'Working on it...' }),
      makeMessage({ sender: 'external', text: '[Done] All tasks complete.', fromRole: 'Architect (def67890)' }),
    ];

    const { container } = render(
      <ChatMessages {...defaultProps} messages={messages} />,
    );

    // User and agent messages should be visible
    expect(container.textContent).toContain('Start working');
    expect(container.textContent).toContain('Working on it...');

    // External messages should NOT be rendered
    expect(container.textContent).not.toContain('[Starting] Exploring the Settings page...');
    expect(container.textContent).not.toContain('[Done] All tasks complete.');
    expect(container.textContent).not.toContain('Developer (abc12345)');
    expect(container.textContent).not.toContain('Architect (def67890)');
  });

  it('renders system messages that are not filtered', () => {
    const messages: AcpTextChunk[] = [
      makeMessage({ sender: 'system', text: '🔄 Session started' }),
      makeMessage({ sender: 'agent', text: 'Ready to work' }),
    ];

    const { container } = render(
      <ChatMessages {...defaultProps} messages={messages} />,
    );

    expect(container.textContent).toContain('Session started');
    expect(container.textContent).toContain('Ready to work');
  });

  it('filters out external messages (DM notifications)', () => {
    const messages: AcpTextChunk[] = [
      makeMessage({ sender: 'external', text: '📤 [To Developer abc12345] Fix the bug' }),
      makeMessage({ sender: 'external', text: '📨 [From Developer abc12345] Done' }),
      makeMessage({ sender: 'external', text: '💬 Group message sent' }),
      makeMessage({ sender: 'external', text: '📢 Broadcast sent' }),
      makeMessage({ sender: 'agent', text: 'Working on fix' }),
    ];

    const { container } = render(
      <ChatMessages {...defaultProps} messages={messages} />,
    );

    // External messages (DM notifications) are filtered by sender type, not emoji prefix
    expect(container.textContent).not.toContain('Fix the bug');
    expect(container.textContent).not.toContain('Done');
    expect(container.textContent).not.toContain('Group message sent');
    expect(container.textContent).not.toContain('Broadcast sent');

    // Normal agent message should still appear
    expect(container.textContent).toContain('Working on fix');
  });

  it('does not render messages with empty text', () => {
    const messages: AcpTextChunk[] = [
      makeMessage({ sender: 'agent', text: '' }),
      makeMessage({ sender: 'agent', text: 'Visible' }),
    ];

    const { container } = render(
      <ChatMessages {...defaultProps} messages={messages} />,
    );

    expect(container.textContent).toContain('Visible');
  });
});
