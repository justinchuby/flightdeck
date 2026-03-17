// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockApiFetch = vi.fn().mockResolvedValue({ ok: true });
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  getAuthToken: () => null,
}));

vi.mock('../AcpOutput', () => ({
  AcpOutput: () => <div data-testid="acp-output" />,
}));

vi.mock('../../Toast', () => ({
  useToastStore: Object.assign(
    (sel: any) => sel({ add: vi.fn() }),
    { getState: () => ({ add: vi.fn() }) },
  ),
}));

import { ChatPanel } from '../ChatPanel';
import { useAppStore } from '../../../stores/appStore';

const AGENT_A = 'aaaa1111-2222-3333-4444-555566667777';
const AGENT_B = 'bbbb1111-2222-3333-4444-555566667777';
const AGENT_C = 'cccc1111-2222-3333-4444-555566667777';

function seedAgents() {
  useAppStore.getState().setAgents([
    {
      id: AGENT_A,
      role: { id: 'developer', name: 'Developer', icon: '💻' },
      status: 'running',
      messages: [],
      childIds: [],
      inputTokens: 0,
      outputTokens: 0,
      contextWindowSize: 0,
      contextWindowUsed: 0,
    } as any,
    {
      id: AGENT_B,
      role: { id: 'architect', name: 'Architect', icon: '🏗️' },
      status: 'running',
      messages: [],
      childIds: [],
      inputTokens: 0,
      outputTokens: 0,
      contextWindowSize: 0,
      contextWindowUsed: 0,
    } as any,
    {
      id: AGENT_C,
      role: { id: 'reviewer', name: 'Reviewer', icon: '🔍' },
      status: 'idle',
      messages: [],
      childIds: [],
      inputTokens: 0,
      outputTokens: 0,
      contextWindowSize: 0,
      contextWindowUsed: 0,
    } as any,
  ]);
}

describe('ChatPanel – broadcast & UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.getState().setAgents([]);
  });

  it('toggles broadcast mode and shows broadcast indicator', () => {
    seedAgents();
    render(<ChatPanel agentId={AGENT_A} />);

    const broadcastBtn = screen.getByTitle('Broadcast to all running agents');
    expect(screen.queryByText(/Broadcasting to/)).not.toBeInTheDocument();

    fireEvent.click(broadcastBtn);
    expect(screen.getByText(/Broadcasting to 2 agents/)).toBeInTheDocument();

    fireEvent.click(broadcastBtn);
    expect(screen.queryByText(/Broadcasting to/)).not.toBeInTheDocument();
  });

  it('broadcasts message to all running agents', () => {
    seedAgents();
    render(<ChatPanel agentId={AGENT_A} />);

    // Enable broadcast
    fireEvent.click(screen.getByTitle('Broadcast to all running agents'));

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'broadcast msg' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // Should send to both running agents (A and B), not idle agent C
    expect(mockApiFetch).toHaveBeenCalledWith(
      `/agents/${AGENT_A}/message`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mockApiFetch).toHaveBeenCalledWith(
      `/agents/${AGENT_B}/message`,
      expect.objectContaining({ method: 'POST' }),
    );
    // Should NOT send to idle agent C
    expect(mockApiFetch).not.toHaveBeenCalledWith(
      `/agents/${AGENT_C}/message`,
      expect.anything(),
    );
  });

  it('toggles expand/collapse mode', () => {
    seedAgents();
    const { container } = render(<ChatPanel agentId={AGENT_A} />);

    // Initially not expanded
    expect(container.querySelector('.fixed')).not.toBeInTheDocument();

    // The expand button - should have Maximize2 icon initially
    const headerButtons = container.querySelectorAll('.h-10 button');
    const expandBtn = headerButtons[0]; // first button in header is expand

    fireEvent.click(expandBtn);

    // After clicking, should have the 'fixed' class
    expect(container.querySelector('.fixed')).toBeInTheDocument();

    // Click again to collapse
    fireEvent.click(expandBtn);
    expect(container.querySelector('.fixed')).not.toBeInTheDocument();
  });

  it('calls setSelectedAgent(null) when close button is clicked', () => {
    seedAgents();
    // Set a selected agent first
    useAppStore.getState().setSelectedAgent(AGENT_A);
    expect(useAppStore.getState().selectedAgentId).toBe(AGENT_A);

    render(<ChatPanel agentId={AGENT_A} />);

    // The close button is the X button in the header
    const headerDiv = screen.getByText('Developer').closest('.h-10');
    const buttons = headerDiv?.querySelectorAll('button');
    const closeBtn = buttons?.[buttons.length - 1]; // last button is close

    if (closeBtn) {
      fireEvent.click(closeBtn);
      expect(useAppStore.getState().selectedAgentId).toBeNull();
    }
  });

  it('renders agent role icon and name in header', () => {
    seedAgents();
    render(<ChatPanel agentId={AGENT_A} />);

    expect(screen.getByText('Developer')).toBeInTheDocument();
    expect(screen.getByText('💻')).toBeInTheDocument();
  });

  it('renders short agent ID in header', () => {
    seedAgents();
    render(<ChatPanel agentId={AGENT_A} />);

    // shortAgentId returns first 8 chars
    expect(screen.getByText('aaaa1111')).toBeInTheDocument();
  });

  it('sends interrupt via zap button when text is present', () => {
    seedAgents();
    render(<ChatPanel agentId={AGENT_A} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'urgent text' } });

    const zapBtn = screen.getByTitle('Interrupt agent (Ctrl+Enter)');
    fireEvent.click(zapBtn);

    expect(mockApiFetch).toHaveBeenCalledWith(
      `/agents/${AGENT_A}/message`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'urgent text', mode: 'interrupt' }),
      }),
    );
  });

  it('sends bare interrupt via zap button when no text', () => {
    seedAgents();
    render(<ChatPanel agentId={AGENT_A} />);

    const zapBtn = screen.getByTitle('Interrupt agent (Ctrl+Enter)');
    fireEvent.click(zapBtn);

    expect(mockApiFetch).toHaveBeenCalledWith(
      `/agents/${AGENT_A}/interrupt`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('Shift+Enter does not send message (newline)', () => {
    seedAgents();
    render(<ChatPanel agentId={AGENT_A} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'line1' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('Meta+Enter also sends interrupt (macOS Cmd+Enter)', () => {
    seedAgents();
    render(<ChatPanel agentId={AGENT_A} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'mac interrupt' } });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

    expect(mockApiFetch).toHaveBeenCalledWith(
      `/agents/${AGENT_A}/message`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'mac interrupt', mode: 'interrupt' }),
      }),
    );
  });

  it('renders send button that sends on click', () => {
    seedAgents();
    render(<ChatPanel agentId={AGENT_A} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'click send' } });

    // The send button has a Send icon — find it by the last button in the input area
    const inputArea = textarea.closest('.flex.gap-2');
    const buttons = inputArea?.querySelectorAll('button');
    const sendBtn = buttons?.[buttons!.length - 1]; // last is send

    if (sendBtn) {
      fireEvent.click(sendBtn);
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/agents/${AGENT_A}/message`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ text: 'click send', mode: 'queue' }),
        }),
      );
    }
  });
});
