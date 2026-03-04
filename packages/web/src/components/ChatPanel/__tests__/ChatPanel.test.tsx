import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatPanel } from '../ChatPanel';
import { useAppStore } from '../../../stores/appStore';

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

function makeWs() {
  return {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    sendInput: vi.fn(),
    resizeAgent: vi.fn(),
    send: vi.fn(),
  };
}

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
}

describe('ChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.getState().setAgents([]);
  });

  it('sends message via REST API (not WebSocket)', () => {
    seedAgent();
    const ws = makeWs();
    render(<ChatPanel agentId={AGENT_ID} ws={ws} />);

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

    // Should NOT use WebSocket sendInput
    expect(ws.sendInput).not.toHaveBeenCalled();
  });

  it('uses interrupt mode on Ctrl+Enter with text', () => {
    seedAgent('running');
    const ws = makeWs();
    render(<ChatPanel agentId={AGENT_ID} ws={ws} />);

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
    const ws = makeWs();
    render(<ChatPanel agentId={AGENT_ID} ws={ws} />);

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
    const ws = makeWs();
    render(<ChatPanel agentId={AGENT_ID} ws={ws} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'test' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    const agent = useAppStore.getState().agents.find((a) => a.id === AGENT_ID);
    const lastMsg = agent?.messages?.[agent.messages.length - 1];
    expect(lastMsg?.queued).toBe(true);
  });

  it('does NOT mark message as queued when agent is busy and mode is interrupt', () => {
    seedAgent('running');
    const ws = makeWs();
    render(<ChatPanel agentId={AGENT_ID} ws={ws} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'urgent' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    const agent = useAppStore.getState().agents.find((a) => a.id === AGENT_ID);
    const lastMsg = agent?.messages?.[agent.messages.length - 1];
    expect(lastMsg?.queued).toBeFalsy();
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

    const ws = makeWs();
    render(<ChatPanel agentId={AGENT_ID} ws={ws} />);

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
    expect(ws.sendInput).not.toHaveBeenCalled();
  });
});
