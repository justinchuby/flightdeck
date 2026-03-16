// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

// ── Mocks (must be before component imports) ──────────────────

const mockApiFetch = vi.fn().mockResolvedValue({ messages: [] });
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

let mockAgents: any[] = [];
const mockUpdateAgent = vi.fn();
vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (selector: any) =>
      selector({
        agents: mockAgents,
        updateAgent: mockUpdateAgent,
      }),
    {
      getState: () => ({
        agents: mockAgents,
        updateAgent: mockUpdateAgent,
      }),
    },
  ),
}));

const mockAddToast = vi.fn();
vi.mock('../../../components/Toast', () => ({
  useToastStore: Object.assign(
    (selector: any) => selector({ add: mockAddToast }),
    { getState: () => ({ add: mockAddToast }) },
  ),
}));

vi.mock('../../../utils/markdown', () => ({
  MarkdownContent: ({ text }: { text: string }) => <div data-testid="markdown">{text}</div>,
  AgentIdBadge: ({ id }: { id: string }) => <span data-testid="agent-badge">{id.slice(0, 8)}</span>,
}));

vi.mock('../../../utils/formatRelativeTime', () => ({
  formatRelativeTime: () => '2m ago',
}));

// ── Import AFTER mocks ───────────────────────────────────────

import { AgentChatPanel } from '../AgentChatPanel';

// ── Helpers ──────────────────────────────────────────────────

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'agent-abc123',
    role: { id: 'developer', name: 'Developer' },
    status: 'running' as const,
    messages: [],
    ...overrides,
  };
}

function makeMessage(overrides: Record<string, any> = {}) {
  return {
    type: 'text' as const,
    text: 'Hello world',
    sender: 'agent' as const,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('AgentChatPanel', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockResolvedValue({ messages: [] });
    mockUpdateAgent.mockReset();
    mockAddToast.mockReset();
    mockAgents = [];
  });

  afterEach(() => {
    cleanup();
  });

  it('renders empty state when no messages exist', async () => {
    mockAgents = [makeAgent()];
    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });
    await waitFor(() => {
      expect(screen.getByText('No messages yet')).toBeInTheDocument();
    });
  });

  it('renders messages from store for live agents', async () => {
    mockAgents = [makeAgent({
      messages: [
        makeMessage({ text: 'Agent says hello', sender: 'agent' }),
        makeMessage({ text: 'User says hi', sender: 'user' }),
      ],
    })];
    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });
    expect(screen.getByText('Agent says hello')).toBeInTheDocument();
    expect(screen.getByText('User says hi')).toBeInTheDocument();
  });

  it('fetches messages from API when store is empty', async () => {
    mockAgents = [makeAgent({ messages: [] })];
    mockApiFetch.mockResolvedValueOnce({
      messages: [
        { content: 'Fetched message', sender: 'agent', timestamp: '2026-01-01T00:00:00Z' },
      ],
    });

    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/agents/agent-abc123/messages?limit=200');
    });
    await waitFor(() => {
      expect(screen.getByText('Fetched message')).toBeInTheDocument();
    });
  });

  it('populates store after API fetch', async () => {
    mockAgents = [makeAgent({ messages: [] })];
    mockApiFetch.mockResolvedValueOnce({
      messages: [
        { content: 'From API', sender: 'agent', timestamp: '2026-01-01T00:00:00Z' },
      ],
    });

    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });

    await waitFor(() => {
      expect(mockUpdateAgent).toHaveBeenCalledWith('agent-abc123', {
        messages: expect.arrayContaining([
          expect.objectContaining({ text: 'From API', sender: 'agent' }),
        ]),
      });
    });
  });

  it('shows loading state during API fetch', async () => {
    mockAgents = [makeAgent({ messages: [] })];
    // Never-resolving promise to keep loading state
    mockApiFetch.mockReturnValue(new Promise(() => {}));

    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });
    expect(screen.getByText('Loading messages…')).toBeInTheDocument();
  });

  it('shows error when API fetch fails', async () => {
    mockAgents = [makeAgent({ messages: [] })];
    mockApiFetch.mockRejectedValueOnce(new Error('Connection refused'));

    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });

    await waitFor(() => {
      expect(screen.getByText('Connection refused')).toBeInTheDocument();
    });
  });

  it('shows input box for active agents', async () => {
    mockAgents = [makeAgent({ status: 'running' })];
    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });
    expect(screen.getByTestId('agent-chat-input')).toBeInTheDocument();
    expect(screen.getByTestId('agent-chat-send')).toBeInTheDocument();
  });

  it('hides input box when readOnly is true', async () => {
    mockAgents = [makeAgent({ status: 'running' })];
    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" readOnly />); });
    expect(screen.queryByTestId('agent-chat-input')).not.toBeInTheDocument();
    expect(screen.getByText('Read-only — agent is no longer active')).toBeInTheDocument();
  });

  it('shows inactive message for terminated agents', async () => {
    mockAgents = [makeAgent({ status: 'terminated' })];
    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });
    expect(screen.queryByTestId('agent-chat-input')).not.toBeInTheDocument();
    expect(screen.getByText(/Agent is terminated/)).toBeInTheDocument();
  });

  it('sends message via API on Enter', async () => {
    mockAgents = [makeAgent({ status: 'idle', messages: [] })];
    mockApiFetch.mockResolvedValue({ messages: [] });

    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });

    const input = screen.getByTestId('agent-chat-input');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Hello agent' } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/agents/agent-abc123/message', {
        method: 'POST',
        body: JSON.stringify({ text: 'Hello agent', mode: 'queue' }),
      });
    });
  });

  it('adds optimistic user message to store on send', async () => {
    mockAgents = [makeAgent({ status: 'idle', messages: [] })];
    mockApiFetch.mockResolvedValue({ messages: [] });

    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });

    const input = screen.getByTestId('agent-chat-input');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Test message' } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(mockUpdateAgent).toHaveBeenCalledWith('agent-abc123', {
      messages: expect.arrayContaining([
        expect.objectContaining({ text: 'Test message', sender: 'user' }),
      ]),
    });
  });

  it('marks user message as queued when agent is busy', async () => {
    mockAgents = [makeAgent({ status: 'running', messages: [] })];
    mockApiFetch.mockResolvedValue({ messages: [] });

    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });

    const input = screen.getByTestId('agent-chat-input');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Queued msg' } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(mockUpdateAgent).toHaveBeenCalledWith('agent-abc123', {
      messages: expect.arrayContaining([
        expect.objectContaining({ text: 'Queued msg', queued: true }),
      ]),
    });
  });

  it('disables send button when input is empty', async () => {
    mockAgents = [makeAgent({ status: 'running' })];
    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });
    expect(screen.getByTestId('agent-chat-send')).toBeDisabled();
  });

  it('clears input after sending', async () => {
    mockAgents = [makeAgent({ status: 'idle', messages: [] })];
    mockApiFetch.mockResolvedValue({ messages: [] });

    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });

    const input = screen.getByTestId('agent-chat-input') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Will be cleared' } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(input.value).toBe('');
  });

  it('shows toast on send failure', async () => {
    mockAgents = [makeAgent({ status: 'idle', messages: [] })];
    // First call is the history fetch, second is the send
    mockApiFetch
      .mockResolvedValueOnce({ messages: [] })
      .mockRejectedValueOnce(new Error('Network error'));

    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });

    const input = screen.getByTestId('agent-chat-input');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Fail msg' } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('error', 'Network error');
    });
  });

  it('filters out empty and outgoing DM messages', async () => {
    mockAgents = [makeAgent({
      messages: [
        makeMessage({ text: 'Visible message' }),
        makeMessage({ text: '   ' }),
        makeMessage({ text: '📤 [To dev] message', sender: 'system' }),
        makeMessage({ text: 'Also visible' }),
      ],
    })];

    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });
    expect(screen.getByText('Visible message')).toBeInTheDocument();
    expect(screen.getByText('Also visible')).toBeInTheDocument();
    expect(screen.queryByText('📤 [To dev] message')).not.toBeInTheDocument();
  });

  it('renders system messages as compact labels', async () => {
    mockAgents = [makeAgent({
      messages: [
        makeMessage({ text: '[System] Agent spawned', sender: 'system' }),
      ],
    })];

    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });
    expect(screen.getByText('[System] Agent spawned')).toBeInTheDocument();
  });

  it('renders thinking messages with italic styling', async () => {
    mockAgents = [makeAgent({
      messages: [
        makeMessage({ text: 'Analyzing the codebase...', sender: 'thinking' }),
      ],
    })];

    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });
    expect(screen.getByText(/Analyzing the codebase/)).toBeInTheDocument();
  });

  it('renders separator for system "---" messages', async () => {
    mockAgents = [makeAgent({
      messages: [
        makeMessage({ text: 'Before separator' }),
        makeMessage({ text: '---', sender: 'system' }),
        makeMessage({ text: 'After separator' }),
      ],
    })];

    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });
    expect(screen.getByText('Before separator')).toBeInTheDocument();
    expect(screen.getByText('After separator')).toBeInTheDocument();
  });

  it('does not fetch if store already has messages', async () => {
    mockAgents = [makeAgent({
      messages: [makeMessage({ text: 'Already loaded' })],
    })];

    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });
    // Should not call messages endpoint (only called for empty stores)
    expect(mockApiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/agents/agent-abc123/messages'),
    );
  });

  it('does not allow Shift+Enter to send', async () => {
    mockAgents = [makeAgent({ status: 'idle', messages: [] })];
    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });

    const input = screen.getByTestId('agent-chat-input');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Do not send' } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    });

    // Should NOT have called the send endpoint
    expect(mockApiFetch).not.toHaveBeenCalledWith(
      '/agents/agent-abc123/message',
      expect.anything(),
    );
  });

  it('shows input for idle agents', async () => {
    mockAgents = [makeAgent({ status: 'idle' })];
    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });
    expect(screen.getByTestId('agent-chat-input')).toBeInTheDocument();
  });

  it('hides input for completed agents', async () => {
    mockAgents = [makeAgent({ status: 'completed' })];
    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });
    expect(screen.queryByTestId('agent-chat-input')).not.toBeInTheDocument();
  });
});
