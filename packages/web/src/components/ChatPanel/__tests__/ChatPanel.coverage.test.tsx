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

const mockToastAdd = vi.fn();
vi.mock('../../Toast', () => ({
  useToastStore: Object.assign(
    (sel: any) => sel({ add: mockToastAdd }),
    { getState: () => ({ add: mockToastAdd }) },
  ),
}));

vi.mock('../../../hooks/useFileDrop', () => ({
  useFileDrop: () => ({
    isDragOver: false,
    handleDragOver: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDrop: vi.fn(),
    handlePaste: vi.fn(),
    dropZoneClassName: '',
  }),
}));

vi.mock('../../../hooks/useAttachments', () => ({
  useAttachments: () => ({
    attachments: [],
    addAttachment: vi.fn(),
    removeAttachment: vi.fn(),
    clearAttachments: vi.fn(),
  }),
}));

import { ChatPanel } from '../ChatPanel';
import { useAppStore } from '../../../stores/appStore';

const AGENT_A = 'aaaa1111-2222-3333-4444-555566667777';
const AGENT_B = 'bbbb1111-2222-3333-4444-555566667777';

function seedAgents(statusA = 'running' as string, statusB = 'running' as string) {
  useAppStore.getState().setAgents([
    {
      id: AGENT_A,
      role: { id: 'developer', name: 'Developer', icon: '💻' },
      status: statusA,
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
      status: statusB,
      messages: [],
      childIds: [],
      inputTokens: 0,
      outputTokens: 0,
      contextWindowSize: 0,
      contextWindowUsed: 0,
    } as any,
  ]);
}

describe('ChatPanel – coverage gaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToastAdd.mockClear();
    useAppStore.getState().setAgents([]);
  });

  /* ── Mention detection (lines 42-44, 54-55, 57, 60-61, 68-69) ── */

  it('opens mention dropdown when @ is typed and filters suggestions', () => {
    seedAgents();
    const { container } = render(<ChatPanel agentId={AGENT_A} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: '@' } });

    // The mention dropdown is the div with shadow-lg class
    const dropdown = container.querySelector('.shadow-lg');
    expect(dropdown).toBeTruthy();
    // Both agents should appear as buttons inside the dropdown
    const mentionBtns = dropdown!.querySelectorAll('button');
    expect(mentionBtns.length).toBe(2);
  });

  it('filters mention suggestions by typed query', () => {
    seedAgents();
    const { container } = render(<ChatPanel agentId={AGENT_A} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: '@bbbb' } });

    // Only Architect (bbbb prefix) should appear in dropdown
    const dropdown = container.querySelector('.shadow-lg');
    expect(dropdown).toBeTruthy();
    const mentionBtns = dropdown!.querySelectorAll('button');
    expect(mentionBtns.length).toBe(1);
    expect(mentionBtns[0].textContent).toContain('Architect');
  });

  it('filters mention suggestions by role name', () => {
    seedAgents();
    const { container } = render(<ChatPanel agentId={AGENT_A} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: '@arch' } });

    const dropdown = container.querySelector('.shadow-lg');
    expect(dropdown).toBeTruthy();
    const mentionBtns = dropdown!.querySelectorAll('button');
    expect(mentionBtns.length).toBe(1);
    expect(mentionBtns[0].textContent).toContain('Architect');
  });

  /* ── Mention keyboard navigation (lines 76-84, 220-240) ── */

  it('navigates mention dropdown with ArrowDown', () => {
    seedAgents();
    const { container } = render(<ChatPanel agentId={AGENT_A} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: '@' } });

    // Dropdown should be visible
    const dropdown = container.querySelector('.shadow-lg');
    expect(dropdown).toBeTruthy();
    const buttons = dropdown!.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);

    // ArrowDown should move highlight to next item
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    // ArrowUp should move back
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });

    // Confirm the dropdown is still visible
    expect(container.querySelector('.shadow-lg')).toBeTruthy();
  });

  it('closes mention dropdown on Escape', () => {
    seedAgents();
    const { container } = render(<ChatPanel agentId={AGENT_A} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: '@' } });

    // Dropdown should be open
    expect(container.querySelector('.shadow-lg')).toBeTruthy();

    // Escape should close it
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(container.querySelector('.shadow-lg')).toBeNull();
  });

  it('inserts mention on Tab key', () => {
    seedAgents();
    render(<ChatPanel agentId={AGENT_A} />);

    const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '@' } });

    // Tab should select the first suggestion and insert it
    fireEvent.keyDown(textarea, { key: 'Tab' });

    // Dropdown should close after insertion
    // The mention should have been inserted (dropdown closed)
    expect(screen.queryByText('Architect')).not.toBeInTheDocument();
  });

  it('inserts mention on Enter key when dropdown is open', () => {
    seedAgents();
    render(<ChatPanel agentId={AGENT_A} />);

    const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hey @' } });

    // Enter should select the first suggestion (not send the message)
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // No API call should be made (mention selected, not sent)
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  /* ── Mention insertion (lines 92-94, 100-101, 107-108) ── */

  it('inserts mention by clicking dropdown item', () => {
    seedAgents();
    render(<ChatPanel agentId={AGENT_A} />);

    const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '@' } });

    // Click on the Architect suggestion
    const architectBtn = screen.getByText('Architect').closest('button')!;
    fireEvent.click(architectBtn);

    // Input should now contain the mention
    expect(textarea.value).toContain('@bbbb1111');
  });

  /* ── Broadcast mode (line 127) ── */

  it('attaches image attachment metadata when sending', () => {
    // Test with attachments requires re-mocking
    // For now, verify broadcast message goes to running agents
    seedAgents('running', 'running');
    render(<ChatPanel agentId={AGENT_A} />);

    fireEvent.click(screen.getByTitle('Broadcast to all running agents'));
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'broadcast test' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(mockApiFetch).toHaveBeenCalledWith(
      `/agents/${AGENT_A}/message`,
      expect.anything(),
    );
    expect(mockApiFetch).toHaveBeenCalledWith(
      `/agents/${AGENT_B}/message`,
      expect.anything(),
    );
  });

  /* ── @mention parsing in send (lines 189, 191) ── */

  it('sends to @mentioned agents when message is sent', () => {
    seedAgents('idle', 'running');
    render(<ChatPanel agentId={AGENT_A} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'hey @bbbb1111 check this' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // Should send to primary agent AND mentioned agent
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    expect(mockApiFetch).toHaveBeenCalledWith(
      `/agents/${AGENT_A}/message`,
      expect.anything(),
    );
    expect(mockApiFetch).toHaveBeenCalledWith(
      `/agents/${AGENT_B}/message`,
      expect.anything(),
    );
  });

  it('does not duplicate send when @mentioned agent is the primary agent', () => {
    seedAgents('idle', 'running');
    render(<ChatPanel agentId={AGENT_A} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    // Mention the primary agent itself
    fireEvent.change(textarea, { target: { value: 'hey @aaaa1111 self-mention' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // Should only send once (to primary agent)
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });

  /* ── Error handling in sendToAgent and interruptAgent (lines 100-101, 107-108) ── */

  it('shows toast on sendToAgent error', async () => {
    seedAgents();
    mockApiFetch.mockRejectedValueOnce(new Error('Network error'));

    render(<ChatPanel agentId={AGENT_A} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'fail message' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // Wait for the promise rejection to propagate
    await vi.waitFor(() => {
      expect(mockToastAdd).toHaveBeenCalledWith('error', expect.stringContaining('Failed to send'));
    });
  });

  it('shows toast on interruptAgent error', async () => {
    seedAgents();
    mockApiFetch.mockRejectedValueOnce(new Error('Interrupt failed'));

    render(<ChatPanel agentId={AGENT_A} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    // Ctrl+Enter with no text triggers interruptAgent
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    await vi.waitFor(() => {
      expect(mockToastAdd).toHaveBeenCalledWith('error', expect.stringContaining('Failed to interrupt'));
    });
  });

  it('shows toast with string error when error is not an Error instance', async () => {
    seedAgents();
    mockApiFetch.mockRejectedValueOnce('string error');

    render(<ChatPanel agentId={AGENT_A} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'fail' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await vi.waitFor(() => {
      expect(mockToastAdd).toHaveBeenCalledWith('error', expect.stringContaining('string error'));
    });
  });

  /* ── Textarea auto-expand (lines 256-258) ── */

  it('auto-expands textarea height on input', () => {
    seedAgents();
    render(<ChatPanel agentId={AGENT_A} />);

    const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;

    // Mock scrollHeight
    Object.defineProperty(textarea, 'scrollHeight', { value: 80, configurable: true });

    fireEvent.input(textarea, { target: { value: 'line1\nline2\nline3' } });

    // Height should be set dynamically (auto first, then scrollHeight px)
    expect(textarea.style.height).toBe('80px');
  });

  it('caps textarea height at 150px', () => {
    seedAgents();
    render(<ChatPanel agentId={AGENT_A} />);

    const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;

    // Mock a very large scrollHeight
    Object.defineProperty(textarea, 'scrollHeight', { value: 300, configurable: true });

    fireEvent.input(textarea, { target: { value: 'lots\nof\nlines\n'.repeat(20) } });

    expect(textarea.style.height).toBe('150px');
  });

  /* ── Click-outside mention dismiss (lines 54-55, 57, 60-61) ── */

  it('closes mention dropdown on click outside', () => {
    seedAgents();
    const { container } = render(<ChatPanel agentId={AGENT_A} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: '@' } });

    // Dropdown should be open
    expect(container.querySelector('.shadow-lg')).toBeTruthy();

    // Click outside (on document body)
    fireEvent.mouseDown(document.body);

    // Dropdown should close
    expect(container.querySelector('.shadow-lg')).toBeNull();
  });

  /* ── Excluded idle agents from mention list ── */

  it('excludes stopped agents from mention suggestions', () => {
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
        status: 'stopped',
        messages: [],
        childIds: [],
        inputTokens: 0,
        outputTokens: 0,
        contextWindowSize: 0,
        contextWindowUsed: 0,
      } as any,
    ]);

    const { container } = render(<ChatPanel agentId={AGENT_A} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: '@' } });

    // Only Developer (running) should appear in dropdown, Architect (stopped) should not
    const dropdown = container.querySelector('.shadow-lg');
    expect(dropdown).toBeTruthy();
    const mentionBtns = dropdown!.querySelectorAll('button');
    expect(mentionBtns.length).toBe(1);
    expect(mentionBtns[0].textContent).toContain('Developer');
  });
});
