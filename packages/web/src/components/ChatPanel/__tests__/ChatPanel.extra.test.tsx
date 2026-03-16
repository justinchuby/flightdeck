// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockApiFetch = vi.fn().mockResolvedValue({ ok: true });
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  getAuthToken: () => null,
}));

vi.mock('../AcpOutput', () => ({
  AcpOutput: ({ agentId }: { agentId: string }) => <div data-testid="acp-output">{agentId}</div>,
}));

vi.mock('../../../stores/settingsStore', () => ({
  useSettingsStore: (sel: (s: Record<string, unknown>) => unknown) =>
    typeof sel === 'function'
      ? sel({ theme: 'dark' })
      : { theme: 'dark' },
}));

import { ChatPanel } from '../ChatPanel';
import { useAppStore } from '../../../stores/appStore';

const AGENT_ID = 'agent-test-123';

describe('ChatPanel extra coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.getState().setAgents([
      {
        id: AGENT_ID,
        role: { id: 'developer', name: 'Developer', icon: '\ud83d\udcbb' },
        status: 'running',
        messages: [],
        childIds: [],
        createdAt: new Date().toISOString(),
        outputPreview: '',
        model: 'gpt-4',
        projectId: 'p1',
      } as any,
    ]);
  });

  it('renders AcpOutput for the agent', () => {
    render(<ChatPanel agentId={AGENT_ID} />);
    expect(screen.getByTestId('acp-output')).toBeInTheDocument();
  });

  it('renders message input area', () => {
    render(<ChatPanel agentId={AGENT_ID} />);
    const textarea = screen.getByPlaceholderText(/message/i);
    expect(textarea).toBeInTheDocument();
  });

  it('handles empty message send', () => {
    render(<ChatPanel agentId={AGENT_ID} />);
    const textarea = screen.getByPlaceholderText(/message/i);
    fireEvent.keyDown(textarea, { key: 'Enter' });
    // Should not call API with empty message
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('sends message on Enter', () => {
    render(<ChatPanel agentId={AGENT_ID} />);
    const textarea = screen.getByPlaceholderText(/message/i);
    fireEvent.change(textarea, { target: { value: 'test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.stringContaining(AGENT_ID),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('clears input after sending', () => {
    render(<ChatPanel agentId={AGENT_ID} />);
    const textarea = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    // After send, input should be cleared
    expect(textarea.value).toBe('');
  });

  it('renders with idle agent', () => {
    useAppStore.getState().setAgents([
      {
        id: AGENT_ID,
        role: { id: 'developer', name: 'Developer', icon: '\ud83d\udcbb' },
        status: 'idle',
        messages: [],
        childIds: [],
        createdAt: new Date().toISOString(),
        outputPreview: '',
        model: 'gpt-4',
        projectId: 'p1',
      } as any,
    ]);
    const { container } = render(<ChatPanel agentId={AGENT_ID} />);
    expect(container).toBeTruthy();
  });
});
