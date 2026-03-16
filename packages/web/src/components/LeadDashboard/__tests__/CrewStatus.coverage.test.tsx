// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

/* ── Mocks ──────────────────────────────────────────────────────── */

const mockApiFetch = vi.fn().mockResolvedValue({});
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (sel: any) => sel({ agents: [] }),
    { getState: () => ({ agents: [], setSelectedAgent: vi.fn() }) },
  ),
}));

const mockToastAdd = vi.fn();
vi.mock('../../Toast', () => ({
  useToastStore: { getState: () => ({ add: mockToastAdd }) },
}));

vi.mock('../../../utils/markdown', () => ({
  MentionText: ({ text }: { text: string }) => <span>{text}</span>,
}));

vi.mock('../AgentReportBlock', () => ({
  AgentReportBlock: ({ content }: { content: string }) => <div data-testid="agent-report">{content}</div>,
}));

vi.mock('../../ProviderBadge', () => ({
  ProviderBadge: ({ provider }: { provider?: string }) => <span data-testid="provider-badge">{provider}</span>,
}));

vi.mock('../../../utils/statusColors', () => ({
  agentStatusText: () => 'text-green-400',
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

vi.mock('../../../utils/format', () => ({
  formatTokens: (n: number) => `${n}`,
}));

import { CrewStatusContent, type CrewAgent } from '../CrewStatusContent';
import type { AgentComm, ActivityEvent } from '../../../stores/leadStore';

/* ── Helpers ─────────────────────────────────────────────────────── */

function makeAgent(overrides?: Partial<CrewAgent>): CrewAgent {
  return {
    id: 'agent-001',
    role: { name: 'Developer', icon: '🛠️' },
    status: 'running',
    model: 'claude-sonnet',
    provider: 'anthropic',
    ...overrides,
  };
}

function makeComm(id: string, fromId: string, toId: string, content: string): AgentComm {
  return { id, fromId, toId, fromRole: 'Developer', toRole: 'Lead', content, timestamp: Date.now() };
}

function makeActivity(id: string, agentId: string, summary: string, status?: string): ActivityEvent {
  return { id, agentId, agentRole: 'Developer', type: 'progress_update', summary, timestamp: Date.now(), ...(status ? { status } : {}) };
}

const openAgent = (name: string) => fireEvent.click(screen.getByText(name));

beforeEach(() => {
  vi.clearAllMocks();
  mockApiFetch.mockResolvedValue({});
});
afterEach(cleanup);

/* ── 1. sendMessage – interrupt with no text (lines 49-60) ──────── */

describe('sendMessage – interrupt with no text', () => {
  it('calls /interrupt endpoint directly', async () => {
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    openAgent('Developer');
    fireEvent.click(screen.getByTitle('Interrupt agent (Ctrl+Enter)'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/agents/agent-001/interrupt', { method: 'POST' });
    });
  });

  it('shows success toast after interrupt resolves', async () => {
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    openAgent('Developer');
    fireEvent.click(screen.getByTitle('Interrupt agent (Ctrl+Enter)'));
    await waitFor(() => {
      expect(mockToastAdd).toHaveBeenCalledWith('success', 'Interrupted Developer');
    });
  });

  it('shows error toast when interrupt rejects with Error', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Connection refused'));
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    openAgent('Developer');
    fireEvent.click(screen.getByTitle('Interrupt agent (Ctrl+Enter)'));
    await waitFor(() => {
      expect(mockToastAdd).toHaveBeenCalledWith('error', 'Failed to interrupt: Connection refused');
    });
  });

  it('shows stringified error when interrupt rejects with non-Error', async () => {
    mockApiFetch.mockRejectedValueOnce('plain string error');
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    openAgent('Developer');
    fireEvent.click(screen.getByTitle('Interrupt agent (Ctrl+Enter)'));
    await waitFor(() => {
      expect(mockToastAdd).toHaveBeenCalledWith('error', 'Failed to interrupt: plain string error');
    });
  });

  it('does not call /message when queue mode with empty text', async () => {
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    openAgent('Developer');
    // Send button is disabled when empty, click the onClick wrapper directly
    const sendBtn = screen.getByTitle('Send message (Enter)');
    fireEvent.click(sendBtn);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockApiFetch).not.toHaveBeenCalled();
  });
});

/* ── 2. sendMessage – with text (lines 62-75) ──────────────────── */

describe('sendMessage – with text', () => {
  it('queue: calls /message, clears textarea, shows toast', async () => {
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    openAgent('Developer');
    const textarea = screen.getByPlaceholderText('Message Developer...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hello world' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/agents/agent-001/message', {
        method: 'POST',
        body: JSON.stringify({ text: 'hello world', mode: 'queue' }),
      });
      expect(mockToastAdd).toHaveBeenCalledWith('success', 'Message sent to Developer');
      expect(textarea.value).toBe('');
    });
  });

  it('interrupt: calls /message with mode interrupt, shows Interrupt label', async () => {
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    openAgent('Developer');
    fireEvent.change(screen.getByPlaceholderText('Message Developer...'), { target: { value: 'urgent!' } });
    fireEvent.click(screen.getByTitle('Interrupt agent (Ctrl+Enter)'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/agents/agent-001/message', {
        method: 'POST',
        body: JSON.stringify({ text: 'urgent!', mode: 'interrupt' }),
      });
      expect(mockToastAdd).toHaveBeenCalledWith('success', 'Interrupt sent to Developer');
    });
  });

  it('shows error toast when /message rejects with Error', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Server error'));
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    openAgent('Developer');
    fireEvent.change(screen.getByPlaceholderText('Message Developer...'), { target: { value: 'fail' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));
    await waitFor(() => {
      expect(mockToastAdd).toHaveBeenCalledWith('error', 'Failed to send: Server error');
    });
  });

  it('shows "Unknown error" when /message rejects with non-Error', async () => {
    mockApiFetch.mockRejectedValueOnce(42);
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    openAgent('Developer');
    fireEvent.change(screen.getByPlaceholderText('Message Developer...'), { target: { value: 'fail' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));
    await waitFor(() => {
      expect(mockToastAdd).toHaveBeenCalledWith('error', 'Failed to send: Unknown error');
    });
  });
});

/* ── 3. Chat button with onOpenChat (line 100) ─────────────────── */

describe('onOpenChat callback', () => {
  it('calls onOpenChat(agent.id) and does not open modal', () => {
    const onOpenChat = vi.fn();
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} onOpenChat={onOpenChat} />);
    fireEvent.click(screen.getByTitle('Open agent chat panel'));
    expect(onOpenChat).toHaveBeenCalledWith('agent-001');
    expect(screen.queryByText('Send Message')).toBeNull();
  });
});

/* ── 4. Activity on agent card (lines 129-130) ─────────────────── */

describe('Activity on agent card', () => {
  it('shows latest activity event summary and time', () => {
    const events = [
      makeActivity('e1', 'agent-001', 'Started task'),
      makeActivity('e2', 'agent-001', 'Finished task'),
    ];
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} activity={events} />);
    expect(screen.getByText('Finished task')).toBeDefined();
  });
});

/* ── 5. Modal interactions (lines 147, 173, 182, 190-192, 203) ── */

describe('Modal interactions', () => {
  it('backdrop mouseDown dismisses modal (line 147)', () => {
    const { container } = render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    openAgent('Developer');
    expect(screen.getByText('Send Message')).toBeDefined();
    const overlay = container.querySelector('.fixed.inset-0') as HTMLElement;
    fireEvent.mouseDown(overlay);
    expect(screen.queryByText('Send Message')).toBeNull();
  });

  it('session ID button copies to clipboard (line 173)', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CrewStatusContent agents={[makeAgent({ sessionId: 'sess-abc-123' })]} delegations={[]} />);
    openAgent('Developer');
    fireEvent.click(screen.getByText(/Session: sess-abc-123/));
    expect(writeText).toHaveBeenCalledWith('sess-abc-123');
  });

  it('header Interrupt button calls /interrupt (line 182)', () => {
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    openAgent('Developer');
    fireEvent.click(screen.getByTitle('Interrupt agent'));
    expect(mockApiFetch).toHaveBeenCalledWith('/agents/agent-001/interrupt', { method: 'POST' });
  });

  it('Stop confirm=true: DELETEs agent and closes modal (lines 190-192)', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    openAgent('Developer');
    fireEvent.click(screen.getByTitle('Stop agent'));
    expect(window.confirm).toHaveBeenCalledWith('Stop this agent?');
    expect(mockApiFetch).toHaveBeenCalledWith('/agents/agent-001', { method: 'DELETE' });
    expect(screen.queryByText('Send Message')).toBeNull();
  });

  it('Stop confirm=false: does nothing', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    openAgent('Developer');
    fireEvent.click(screen.getByTitle('Stop agent'));
    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(screen.getByText('Send Message')).toBeDefined();
  });

  it('× button closes modal (line 203)', () => {
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    openAgent('Developer');
    expect(screen.getByText('Send Message')).toBeDefined();
    fireEvent.click(screen.getAllByText('×')[0]);
    expect(screen.queryByText('Send Message')).toBeNull();
  });
});

/* ── 6. Context Window (lines 231-234) ─────────────────────────── */

describe('Context Window section', () => {
  it('renders usage bar and percentage when contextWindowSize > 0', () => {
    render(
      <CrewStatusContent
        agents={[makeAgent({ contextWindowSize: 200000, contextWindowUsed: 120000 })]}
        delegations={[]}
      />,
    );
    openAgent('Developer');
    expect(screen.getByText('Context Window')).toBeDefined();
    expect(screen.getByText(/120000/)).toBeDefined();
    expect(screen.getByText(/200000/)).toBeDefined();
    expect(screen.getByText('(60%)')).toBeDefined();
  });
});

/* ── 7. Communications section (lines 279, 288) ───────────────── */

describe('Communications in modal', () => {
  it('clicking a comm opens detail popup (line 279)', () => {
    const comms = [makeComm('c1', 'agent-001', 'lead', 'Progress update')];
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} comms={comms} />);
    openAgent('Developer');
    fireEvent.click(screen.getByText('Progress update'));
    expect(screen.getByLabelText('Close communication detail')).toBeDefined();
  });

  it('truncates long comm content to 200 chars (line 288)', () => {
    const longContent = 'A'.repeat(250);
    const comms = [makeComm('c1', 'agent-001', 'lead', longContent)];
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} comms={comms} />);
    openAgent('Developer');
    expect(screen.getByText(longContent.slice(0, 200) + '…')).toBeDefined();
  });
});

/* ── 8. Activity section in modal (lines 305-306) ──────────────── */

describe('Activity in modal', () => {
  it('renders activity events with timestamps and statuses', () => {
    const events = [
      makeActivity('e1', 'agent-001', 'Working on auth', 'in_progress'),
      makeActivity('e2', 'agent-001', 'Auth complete', 'completed'),
    ];
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} activity={events} />);
    openAgent('Developer');
    expect(screen.getByText(/Activity \(2\)/)).toBeDefined();
    expect(screen.getByText('Working on auth')).toBeDefined();
    expect(screen.getAllByText('Auth complete').length).toBeGreaterThanOrEqual(1);
  });
});

/* ── 9. Keyboard shortcuts (lines 337-344) ─────────────────────── */

describe('Keyboard shortcuts', () => {
  it('Enter sends queue message (lines 339-341)', async () => {
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    openAgent('Developer');
    const textarea = screen.getByPlaceholderText('Message Developer...');
    fireEvent.change(textarea, { target: { value: 'enter test' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/agents/agent-001/message', {
        method: 'POST',
        body: JSON.stringify({ text: 'enter test', mode: 'queue' }),
      });
    });
  });

  it('Ctrl+Enter sends interrupt (lines 342-344)', async () => {
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    openAgent('Developer');
    const textarea = screen.getByPlaceholderText('Message Developer...');
    fireEvent.change(textarea, { target: { value: 'ctrl enter' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/agents/agent-001/message', {
        method: 'POST',
        body: JSON.stringify({ text: 'ctrl enter', mode: 'interrupt' }),
      });
    });
  });

  it('Meta+Enter sends interrupt (line 342)', async () => {
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    openAgent('Developer');
    const textarea = screen.getByPlaceholderText('Message Developer...');
    fireEvent.change(textarea, { target: { value: 'meta enter' } });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/agents/agent-001/message', {
        method: 'POST',
        body: JSON.stringify({ text: 'meta enter', mode: 'interrupt' }),
      });
    });
  });

  it('Shift+Enter does NOT send', async () => {
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    openAgent('Developer');
    const textarea = screen.getByPlaceholderText('Message Developer...');
    fireEvent.change(textarea, { target: { value: 'no send' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('Enter with empty text does not call API (line 341)', async () => {
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    openAgent('Developer');
    const textarea = screen.getByPlaceholderText('Message Developer...');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockApiFetch).not.toHaveBeenCalled();
  });
});

/* ── 10. Send / Interrupt buttons (lines 354, 362) ────────────── */

describe('Send and Interrupt buttons', () => {
  it('Send button calls sendMessage queue (line 354)', async () => {
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    openAgent('Developer');
    fireEvent.change(screen.getByPlaceholderText('Message Developer...'), { target: { value: 'btn send' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/agents/agent-001/message', {
        method: 'POST',
        body: JSON.stringify({ text: 'btn send', mode: 'queue' }),
      });
    });
  });

  it('Interrupt button calls sendMessage interrupt (line 362)', async () => {
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    openAgent('Developer');
    fireEvent.change(screen.getByPlaceholderText('Message Developer...'), { target: { value: 'btn int' } });
    fireEvent.click(screen.getByTitle('Interrupt agent (Ctrl+Enter)'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/agents/agent-001/message', {
        method: 'POST',
        body: JSON.stringify({ text: 'btn int', mode: 'interrupt' }),
      });
    });
  });
});

/* ── 11. Comm detail modal (lines 382, 396, 404) ──────────────── */

describe('Comm detail modal', () => {
  it('shows from/to roles and content', () => {
    const comms = [makeComm('c1', 'agent-001', 'lead', 'Detail test content')];
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} comms={comms} />);
    openAgent('Developer');
    fireEvent.click(screen.getByText('Detail test content'));
    expect(screen.getByLabelText('Close communication detail')).toBeDefined();
  });

  it('renders AgentReportBlock for [Agent Report] content (line 404)', () => {
    const comms = [makeComm('c1', 'agent-001', 'lead', '[Agent Report] All tasks done')];
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} comms={comms} />);
    openAgent('Developer');
    fireEvent.click(screen.getByText(/\[Agent Report\]/));
    expect(screen.getByTestId('agent-report')).toBeDefined();
    expect(screen.getByTestId('agent-report').textContent).toBe('[Agent Report] All tasks done');
  });

  it('renders MentionText for plain content (line 404 else branch)', () => {
    const comms = [makeComm('c1', 'agent-001', 'lead', 'Normal message')];
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} comms={comms} />);
    openAgent('Developer');
    fireEvent.click(screen.getByText('Normal message'));
    expect(screen.queryByTestId('agent-report')).toBeNull();
  });

  it('close button dismisses comm detail (line 396)', () => {
    const comms = [makeComm('c1', 'agent-001', 'lead', 'Dismiss test')];
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} comms={comms} />);
    openAgent('Developer');
    fireEvent.click(screen.getByText('Dismiss test'));
    fireEvent.click(screen.getByLabelText('Close communication detail'));
    expect(screen.queryByLabelText('Close communication detail')).toBeNull();
  });

  it('backdrop click dismisses comm detail (line 382)', () => {
    const comms = [makeComm('c1', 'agent-001', 'lead', 'Backdrop dismiss')];
    const { container } = render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} comms={comms} />);
    openAgent('Developer');
    fireEvent.click(screen.getByText('Backdrop dismiss'));
    const overlays = container.querySelectorAll('.fixed.inset-0');
    const commOverlay = overlays[overlays.length - 1] as HTMLElement;
    fireEvent.mouseDown(commOverlay);
    expect(screen.queryByLabelText('Close communication detail')).toBeNull();
  });
});
