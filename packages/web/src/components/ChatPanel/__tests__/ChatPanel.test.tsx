// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatPanel } from '../ChatPanel';
import { useAppStore } from '../../../stores/appStore';
import { useMessageStore } from '../../../stores/messageStore';

// Mock apiFetch
const mockApiFetch = vi.fn().mockResolvedValue({ ok: true });
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
  getAuthToken: () => null,
}));

// Mock AcpOutput to avoid complex rendering
vi.mock('../AcpOutput', () => ({
  AcpOutput: () => <div data-testid="acp-output" />,
}));

const AGENT_ID = 'aaaa1111-2222-3333-4444-555566667777';

function seedAgent(status = 'idle') {
  useAppStore.getState().setAgents([
    {
      id: AGENT_ID,
      role: { id: 'developer', name: 'Developer', icon: '💻' },
      status,
      messages: [],
      childIds: [],
      inputTokens: 0,
      outputTokens: 0,
      contextWindowSize: 0,
      contextWindowUsed: 0,
    } as any,
  ]);
  useMessageStore.getState().ensureChannel(AGENT_ID);
}

describe('ChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.getState().setAgents([]);
    useMessageStore.getState().reset();
  });

  it('sends message via REST API (not WebSocket)', () => {
    seedAgent();
    render(<ChatPanel agentId={AGENT_ID} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'hello agent' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // Should call REST API
    expect(mockApiFetch).toHaveBeenCalledWith(
      `/agents/${AGENT_ID}/message`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'hello agent', mode: 'queue' }),
      }),
    );
  });

  it('uses interrupt mode on Ctrl+Enter with text', () => {
    seedAgent('running');
    render(<ChatPanel agentId={AGENT_ID} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'urgent fix' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(mockApiFetch).toHaveBeenCalledWith(
      `/agents/${AGENT_ID}/message`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'urgent fix', mode: 'interrupt' }),
      }),
    );
  });

  it('calls interruptAgent on Ctrl+Enter with no text', () => {
    seedAgent('running');
    render(<ChatPanel agentId={AGENT_ID} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    // No text → should call interrupt endpoint, not send message
    expect(mockApiFetch).toHaveBeenCalledWith(
      `/agents/${AGENT_ID}/interrupt`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('marks message as queued when agent is busy and mode is queue', () => {
    seedAgent('running');
    render(<ChatPanel agentId={AGENT_ID} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'test' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    const msgs = useMessageStore.getState().channels[AGENT_ID]?.messages ?? [];
    const lastMsg = msgs[msgs.length - 1];
    expect(lastMsg?.queued).toBe(true);
  });

  it('does NOT mark message as queued when agent is busy and mode is interrupt', () => {
    seedAgent('running');
    render(<ChatPanel agentId={AGENT_ID} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'urgent' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    const msgs = useMessageStore.getState().channels[AGENT_ID]?.messages ?? [];
    const lastMsg = msgs[msgs.length - 1];
    expect(lastMsg?.queued).toBeFalsy();
  });

  it('inserts a separator before user message when interrupting a busy agent', () => {
    // Seed agent with an existing agent message so separator is needed
    useAppStore.getState().setAgents([
      {
        id: AGENT_ID,
        role: { id: 'developer', name: 'Developer', icon: '💻' },
        status: 'running',
        messages: [{ type: 'text', text: 'previous response', sender: 'agent', timestamp: 1000 }],
        childIds: [],
        inputTokens: 0,
        outputTokens: 0,
        contextWindowSize: 0,
        contextWindowUsed: 0,
      } as any,
    ]);
    useMessageStore.getState().ensureChannel(AGENT_ID);
    useMessageStore.getState().setMessages(AGENT_ID, [{ type: 'text', text: 'previous response', sender: 'agent', timestamp: 1000 }] as any);
    render(<ChatPanel agentId={AGENT_ID} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'urgent fix' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    const msgs = useMessageStore.getState().channels[AGENT_ID]?.messages ?? [];
    // Should have: [agent msg, separator, user msg]
    expect(msgs).toHaveLength(3);
    expect(msgs[0].sender).toBe('agent');
    expect(msgs[1].text).toBe('---');
    expect(msgs[1].sender).toBe('system');
    expect(msgs[2].sender).toBe('user');
    expect(msgs[2].text).toBe('urgent fix');
  });

  it('does NOT insert separator when interrupting if last message is not from agent', () => {
    // Seed agent with a user message as last
    useAppStore.getState().setAgents([
      {
        id: AGENT_ID,
        role: { id: 'developer', name: 'Developer', icon: '💻' },
        status: 'running',
        messages: [{ type: 'text', text: 'user question', sender: 'user', timestamp: 1000 }],
        childIds: [],
        inputTokens: 0,
        outputTokens: 0,
        contextWindowSize: 0,
        contextWindowUsed: 0,
      } as any,
    ]);
    useMessageStore.getState().ensureChannel(AGENT_ID);
    useMessageStore.getState().setMessages(AGENT_ID, [{ type: 'text', text: 'user question', sender: 'user', timestamp: 1000 }] as any);
    render(<ChatPanel agentId={AGENT_ID} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'interrupt' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    const msgs = useMessageStore.getState().channels[AGENT_ID]?.messages ?? [];
    // Should have: [user msg, user msg] — no separator needed
    expect(msgs).toHaveLength(2);
    expect(msgs[0].sender).toBe('user');
    expect(msgs[1].sender).toBe('user');
  });

  it('sends to @mentioned agents via REST API', () => {
    const OTHER_ID = 'bbbb2222-3333-4444-5555-666677778888';
    useAppStore.getState().setAgents([
      {
        id: AGENT_ID,
        role: { id: 'developer', name: 'Developer', icon: '💻' },
        status: 'idle',
        messages: [],
        childIds: [],
        inputTokens: 0,
        outputTokens: 0,
        contextWindowSize: 0,
        contextWindowUsed: 0,
      } as any,
      {
        id: OTHER_ID,
        role: { id: 'architect', name: 'Architect', icon: '🏗️' },
        status: 'running',
        messages: [],
        childIds: [],
        inputTokens: 0,
        outputTokens: 0,
        contextWindowSize: 0,
        contextWindowUsed: 0,
      } as any,
    ]);

    render(<ChatPanel agentId={AGENT_ID} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'hey @bbbb2222 check this' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // Should send to primary agent and @mentioned agent
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    expect(mockApiFetch).toHaveBeenCalledWith(
      `/agents/${AGENT_ID}/message`,
      expect.anything(),
    );
    expect(mockApiFetch).toHaveBeenCalledWith(
      `/agents/${OTHER_ID}/message`,
      expect.anything(),
    );
  });
});
