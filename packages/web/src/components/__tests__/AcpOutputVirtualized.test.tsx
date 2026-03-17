// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock react-virtuoso to avoid layout measurement issues in jsdom
vi.mock('react-virtuoso', () => {
  const React = require('react');
  return {
    Virtuoso: React.forwardRef(({ data, itemContent, components }: any, ref: any) => {
      const Header = components?.Header;
      const Footer = components?.Footer;
      React.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() }));
      return React.createElement('div', { 'data-testid': 'virtuoso' },
        Header && React.createElement(Header),
        ...(data || []).map((item: any, index: number) =>
          React.createElement('div', { key: index }, itemContent(index, item))
        ),
        Footer && React.createElement(Footer),
      );
    }),
  };
});

// Use vi.hoisted so the mock state is available when vi.mock factory runs
const { mockState } = vi.hoisted(() => {
  const mockState: Record<string, any> = {
    agents: [{
      id: 'test-agent',
      role: 'Developer',
      status: 'running',
      plan: [],
      messages: [
        { type: 'text', text: 'Hello from agent', sender: 'agent', timestamp: Date.now() - 5000 },
        { type: 'text', text: 'User says hi', sender: 'user', timestamp: Date.now() - 3000 },
        { type: 'text', text: 'Agent responds', sender: 'agent', timestamp: Date.now() - 1000 },
      ],
    }],
    setSelectedAgent: () => {},
    updateAgent: () => {},
  };
  return { mockState };
});

vi.mock('../../stores/appStore', () => {
  const fn: any = (selector: any) => selector(mockState);
  fn.getState = () => mockState;
  return { useAppStore: fn };
});

vi.mock('../../stores/leadStore', () => ({
  useLeadStore: vi.fn(() => []),
}));

vi.mock('../../utils/markdown', () => ({
  InlineMarkdownWithMentions: ({ text }: any) => text,
  MentionText: ({ text }: any) => text,
}));

vi.mock('../PromptNav', () => ({
  PromptNav: () => null,
  hasUserMention: () => false,
}));

import { AcpOutput } from '../ChatPanel/AcpOutput';
import { useMessageStore } from '../../stores/messageStore';

const defaultMessages = [
  { type: 'text' as const, text: 'Hello from agent', sender: 'agent' as const, timestamp: Date.now() - 5000 },
  { type: 'text' as const, text: 'User says hi', sender: 'user' as const, timestamp: Date.now() - 3000 },
  { type: 'text' as const, text: 'Agent responds', sender: 'agent' as const, timestamp: Date.now() - 1000 },
];

describe('AcpOutput (Virtualized)', () => {
  beforeEach(() => {
    useMessageStore.getState().reset();
    // Populate messageStore with default messages (matches mockState.agents)
    useMessageStore.getState().ensureChannel('test-agent');
    useMessageStore.getState().setMessages('test-agent', defaultMessages);

    global.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }));
  });

  it('renders with Virtuoso container', async () => {
    render(<AcpOutput agentId="test-agent" />);
    await waitFor(() => {
      expect(screen.getByTestId('virtuoso')).toBeInTheDocument();
    });
  });

  it('renders agent messages through virtualized list', async () => {
    render(<AcpOutput agentId="test-agent" />);
    await waitFor(() => {
      expect(screen.getByText('Hello from agent')).toBeInTheDocument();
      expect(screen.getByText('Agent responds')).toBeInTheDocument();
    });
  });

  it('renders user messages', async () => {
    render(<AcpOutput agentId="test-agent" />);
    await waitFor(() => {
      expect(screen.getByText('User says hi')).toBeInTheDocument();
    });
  });

  it('renders empty state when agent not found', () => {
    const origAgents = mockState.agents;
    mockState.agents = [];
    useMessageStore.getState().ensureChannel('nonexistent');
    const { container } = render(<AcpOutput agentId="nonexistent" />);
    expect(container).toBeDefined();
    mockState.agents = origAgents;
  });

  it('does not show pinned banner when user message is latest (pending response)', async () => {
    const origAgents = mockState.agents;
    const pinnedMessages = [
      { type: 'text', text: 'Agent message', sender: 'agent', timestamp: Date.now() - 3000 },
      { type: 'text', text: 'Latest user msg', sender: 'user', timestamp: Date.now() - 1000 },
    ];
    mockState.agents = [{
      id: 'test-agent',
      role: 'Developer',
      status: 'running',
      plan: [],
      messages: pinnedMessages,
    }];
    useMessageStore.getState().ensureChannel('test-agent');
    useMessageStore.getState().setMessages('test-agent', pinnedMessages as any);
    render(<AcpOutput agentId="test-agent" />);
    await waitFor(() => {
      expect(screen.getByText('Latest user msg')).toBeInTheDocument();
    });
    // Banner should NOT show — user message is the latest (agent hasn't responded yet)
    expect(screen.queryByText('Latest User Message')).not.toBeInTheDocument();
    mockState.agents = origAgents;
  });

  it('does not show pinned banner when at bottom', async () => {
    // Default atBottom state is true, so banner should be hidden even with buried user msg
    render(<AcpOutput agentId="test-agent" />);
    await waitFor(() => {
      expect(screen.getByText('User says hi')).toBeInTheDocument();
    });
    // Banner should not show because atBottom starts as true
    expect(screen.queryByText('Latest User Message')).not.toBeInTheDocument();
  });
});
