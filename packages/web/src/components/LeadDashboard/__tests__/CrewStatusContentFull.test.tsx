// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

/* ── Mocks ─────────────────────────────────────────────────────── */

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../Toast', () => ({
  useToastStore: { getState: () => ({ add: vi.fn() }) },
}));

const storeState = { agents: [] as any[], setSelectedAgent: vi.fn() };
vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (sel: (s: any) => any) => sel(storeState),
    { getState: () => storeState },
  ),
}));

vi.mock('../../../utils/markdown', () => ({
  MentionText: ({ text }: { text: string }) => <span>{text}</span>,
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

vi.mock('../AgentReportBlock', () => ({
  AgentReportBlock: ({ content }: { content: string }) => <div data-testid="report-block">{content}</div>,
}));

vi.mock('../../ProviderBadge', () => ({
  ProviderBadge: ({ provider }: { provider?: string }) => <span data-testid="provider-badge">{provider}</span>,
}));

import { CrewStatusContent, type CrewAgent } from '../CrewStatusContent';
import { apiFetch } from '../../../hooks/useApi';
import type { Delegation } from '../../../types';
import type { AgentComm, ActivityEvent } from '../../../stores/leadStore';

const mockApiFetch = vi.mocked(apiFetch);

/* ── Helpers ────────────────────────────────────────────────────── */

const agent = (id: string, name: string, status = 'running', extra: Partial<CrewAgent> = {}): CrewAgent => ({
  id,
  role: { name, icon: '🤖' },
  status,
  model: 'claude-sonnet-4',
  provider: 'anthropic',
  ...extra,
});

const delegation = (id: string, agentId: string, task: string, status = 'active'): Delegation =>
  ({ id, toAgentId: agentId, task, status, toRole: 'dev' } as unknown as Delegation);

const comm = (id: string, fromId: string, toId: string, content: string): AgentComm => ({
  id,
  fromId,
  toId,
  fromRole: 'Developer',
  toRole: 'Lead',
  content,
  timestamp: Date.now(),
});

const activityEvent = (id: string, agentId: string, summary: string, status?: string): ActivityEvent => ({
  id,
  agentId,
  agentRole: 'Developer',
  type: 'progress_update',
  summary,
  timestamp: Date.now(),
  ...(status ? { status } : {}),
});

/** Click an agent card to open its detail modal */
const openAgent = (name: string) => fireEvent.click(screen.getByText(name));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

/* ── Tests ──────────────────────────────────────────────────────── */

describe('CrewStatusContentFull – Agent detail modal', () => {
  it('shows agent name in the modal header when agent is clicked', () => {
    render(<CrewStatusContent agents={[agent('a1', 'Architect')]} delegations={[]} />);
    openAgent('Architect');
    // The name appears in both the card and the modal header — at least 2
    expect(screen.getAllByText('Architect').length).toBeGreaterThanOrEqual(2);
  });

  it('displays shortAgentId in the modal header', () => {
    render(<CrewStatusContent agents={[agent('abcdefgh-1234', 'Tester')]} delegations={[]} />);
    openAgent('Tester');
    // shortAgentId mock slices first 8 chars → appears in card + modal
    expect(screen.getAllByText('abcdefgh').length).toBeGreaterThanOrEqual(2);
  });

  it('shows provider badge and model in modal header', () => {
    render(
      <CrewStatusContent
        agents={[agent('a1', 'Dev', 'running', { provider: 'openai', model: 'gpt-4o' })]}
        delegations={[]}
      />,
    );
    openAgent('Dev');
    expect(screen.getAllByText('gpt-4o').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTestId('provider-badge').length).toBeGreaterThanOrEqual(2);
  });

  it('renders session ID button when sessionId is set', () => {
    render(
      <CrewStatusContent
        agents={[agent('a1', 'Dev', 'running', { sessionId: 'sess-xyz-123' })]}
        delegations={[]}
      />,
    );
    openAgent('Dev');
    expect(screen.getByText(/Session: sess-xyz-123/)).toBeDefined();
  });

  it('close button (×) dismisses the modal', () => {
    render(<CrewStatusContent agents={[agent('a1', 'Worker')]} delegations={[]} />);
    openAgent('Worker');
    expect(screen.getByText('Send Message')).toBeDefined();
    const closeButtons = screen.getAllByText('×');
    fireEvent.click(closeButtons[0]);
    expect(screen.queryByText('Send Message')).toBeNull();
  });

  it('backdrop click (onMouseDown where target === currentTarget) dismisses modal', () => {
    const { container } = render(<CrewStatusContent agents={[agent('a1', 'Worker')]} delegations={[]} />);
    openAgent('Worker');
    expect(screen.getByText('Send Message')).toBeDefined();
    // The overlay is the fixed backdrop div wrapping the modal.
    // fireEvent.mouseDown directly on the overlay makes target === currentTarget in React.
    const overlay = container.querySelector('.fixed.inset-0') as HTMLElement;
    fireEvent.mouseDown(overlay);
    expect(screen.queryByText('Send Message')).toBeNull();
  });

  it('shows Interrupt and Stop buttons when agent status is running', () => {
    render(<CrewStatusContent agents={[agent('a1', 'Dev', 'running')]} delegations={[]} />);
    openAgent('Dev');
    const buttons = screen.getAllByRole('button');
    const interruptBtns = buttons.filter((b) => b.textContent?.includes('Interrupt'));
    const stopBtns = buttons.filter((b) => b.textContent?.includes('Stop'));
    expect(interruptBtns.length).toBeGreaterThanOrEqual(2);
    expect(stopBtns.length).toBeGreaterThanOrEqual(1);
  });

  it('shows Interrupt and Stop buttons when agent status is idle', () => {
    render(<CrewStatusContent agents={[agent('a1', 'Dev', 'idle')]} delegations={[]} />);
    openAgent('Dev');
    const buttons = screen.getAllByRole('button');
    const stopBtns = buttons.filter((b) => b.textContent?.includes('Stop'));
    expect(stopBtns.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT show Interrupt/Stop header buttons when agent status is completed', () => {
    render(<CrewStatusContent agents={[agent('a1', 'Dev', 'completed')]} delegations={[]} />);
    openAgent('Dev');
    const buttons = screen.getAllByRole('button');
    const stopBtns = buttons.filter((b) => b.textContent?.includes('Stop'));
    expect(stopBtns.length).toBe(0);
  });

  it('header Interrupt button calls apiFetch with POST to /agents/{id}/interrupt', async () => {
    render(<CrewStatusContent agents={[agent('a1', 'Dev', 'running')]} delegations={[]} />);
    openAgent('Dev');
    const btn = screen.getByTitle('Interrupt agent');
    fireEvent.click(btn);
    expect(mockApiFetch).toHaveBeenCalledWith('/agents/a1/interrupt', { method: 'POST' });
  });
});

describe('CrewStatusContentFull – Message sending', () => {
  it('Enter key sends queue message via apiFetch', async () => {
    render(<CrewStatusContent agents={[agent('a1', 'Dev')]} delegations={[]} />);
    openAgent('Dev');
    const textarea = screen.getByPlaceholderText('Message Dev...');
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/agents/a1/message', {
        method: 'POST',
        body: JSON.stringify({ text: 'hello', mode: 'queue' }),
      });
    });
  });

  it('Ctrl+Enter sends interrupt mode message', async () => {
    render(<CrewStatusContent agents={[agent('a1', 'Dev')]} delegations={[]} />);
    openAgent('Dev');
    const textarea = screen.getByPlaceholderText('Message Dev...');
    fireEvent.change(textarea, { target: { value: 'urgent!' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/agents/a1/message', {
        method: 'POST',
        body: JSON.stringify({ text: 'urgent!', mode: 'interrupt' }),
      });
    });
  });

  it('clicking Send button calls sendMessage(queue)', async () => {
    render(<CrewStatusContent agents={[agent('a1', 'Dev')]} delegations={[]} />);
    openAgent('Dev');
    const textarea = screen.getByPlaceholderText('Message Dev...');
    fireEvent.change(textarea, { target: { value: 'test msg' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/agents/a1/message', {
        method: 'POST',
        body: JSON.stringify({ text: 'test msg', mode: 'queue' }),
      });
    });
  });

  it('clicking Interrupt button calls sendMessage(interrupt)', async () => {
    render(<CrewStatusContent agents={[agent('a1', 'Dev')]} delegations={[]} />);
    openAgent('Dev');
    const textarea = screen.getByPlaceholderText('Message Dev...');
    fireEvent.change(textarea, { target: { value: 'stop now' } });
    fireEvent.click(screen.getByTitle('Interrupt agent (Ctrl+Enter)'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/agents/a1/message', {
        method: 'POST',
        body: JSON.stringify({ text: 'stop now', mode: 'interrupt' }),
      });
    });
  });

  it('empty message + interrupt button calls interrupt API directly (not message API)', async () => {
    render(<CrewStatusContent agents={[agent('a1', 'Dev')]} delegations={[]} />);
    openAgent('Dev');
    fireEvent.click(screen.getByTitle('Interrupt agent (Ctrl+Enter)'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/agents/a1/interrupt', { method: 'POST' });
    });
    const messageCalls = mockApiFetch.mock.calls.filter((c) => (c[0] as string).includes('/message'));
    expect(messageCalls.length).toBe(0);
  });

  it('empty message + Ctrl+Enter calls interrupt API directly', async () => {
    render(<CrewStatusContent agents={[agent('a1', 'Dev')]} delegations={[]} />);
    openAgent('Dev');
    const textarea = screen.getByPlaceholderText('Message Dev...');
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/agents/a1/interrupt', { method: 'POST' });
    });
  });

  it('Send button is disabled when textarea is empty', () => {
    render(<CrewStatusContent agents={[agent('a1', 'Dev')]} delegations={[]} />);
    openAgent('Dev');
    const sendBtn = screen.getByTitle('Send message (Enter)') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it('clears textarea after successful send', async () => {
    render(<CrewStatusContent agents={[agent('a1', 'Dev')]} delegations={[]} />);
    openAgent('Dev');
    const textarea = screen.getByPlaceholderText('Message Dev...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));
    await waitFor(() => expect(textarea.value).toBe(''));
  });
});

describe('CrewStatusContentFull – Context window', () => {
  it('renders context window bar when contextWindowSize > 0', () => {
    render(
      <CrewStatusContent
        agents={[agent('a1', 'Dev', 'running', { contextWindowSize: 100000, contextWindowUsed: 40000 })]}
        delegations={[]}
      />,
    );
    openAgent('Dev');
    expect(screen.getByText('Context Window')).toBeDefined();
    expect(screen.getByText(/40000/)).toBeDefined();
    expect(screen.getByText(/100000/)).toBeDefined();
    expect(screen.getByText('(40%)')).toBeDefined();
  });

  it('does not render context window when contextWindowSize is 0', () => {
    render(
      <CrewStatusContent
        agents={[agent('a1', 'Dev', 'running', { contextWindowSize: 0 })]}
        delegations={[]}
      />,
    );
    openAgent('Dev');
    expect(screen.queryByText('Context Window')).toBeNull();
  });

  it('does not render context window when contextWindowSize is undefined', () => {
    render(
      <CrewStatusContent
        agents={[agent('a1', 'Dev', 'running')]}
        delegations={[]}
      />,
    );
    openAgent('Dev');
    expect(screen.queryByText('Context Window')).toBeNull();
  });
});

describe('CrewStatusContentFull – Output preview', () => {
  it('renders output preview when outputPreview is set', () => {
    render(
      <CrewStatusContent
        agents={[agent('a1', 'Dev', 'running', { outputPreview: 'Build succeeded with 0 warnings' })]}
        delegations={[]}
      />,
    );
    openAgent('Dev');
    expect(screen.getByText('Latest Output')).toBeDefined();
    expect(screen.getByText('Build succeeded with 0 warnings')).toBeDefined();
  });

  it('does not render output preview when outputPreview is not set', () => {
    render(<CrewStatusContent agents={[agent('a1', 'Dev')]} delegations={[]} />);
    openAgent('Dev');
    expect(screen.queryByText('Latest Output')).toBeNull();
  });
});

describe('CrewStatusContentFull – Activity display', () => {
  it('renders activity section when there are activity events for selected agent', () => {
    const events = [
      activityEvent('e1', 'a1', 'Started working on auth module', 'in_progress'),
      activityEvent('e2', 'a1', 'Completed auth module', 'completed'),
    ];
    render(
      <CrewStatusContent
        agents={[agent('a1', 'Dev')]}
        delegations={[]}
        activity={events}
      />,
    );
    openAgent('Dev');
    expect(screen.getByText(/Activity \(2\)/)).toBeDefined();
    expect(screen.getAllByText('Started working on auth module').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Completed auth module').length).toBeGreaterThanOrEqual(1);
  });

  it('does not render activity for a different agent', () => {
    const events = [activityEvent('e1', 'other-agent', 'Unrelated work')];
    render(
      <CrewStatusContent
        agents={[agent('a1', 'Dev')]}
        delegations={[]}
        activity={events}
      />,
    );
    openAgent('Dev');
    expect(screen.queryByText(/Activity \(/)).toBeNull();
  });
});

describe('CrewStatusContentFull – Empty activity state', () => {
  it('shows "No activity yet" when no delegation, output, comms, or activity', () => {
    render(<CrewStatusContent agents={[agent('a1', 'Dev')]} delegations={[]} />);
    openAgent('Dev');
    expect(screen.getByText('No activity yet for this agent')).toBeDefined();
  });

  it('does not show "No activity yet" when a delegation exists', () => {
    render(
      <CrewStatusContent
        agents={[agent('a1', 'Dev')]}
        delegations={[delegation('d1', 'a1', 'Fix bugs')]}
      />,
    );
    openAgent('Dev');
    expect(screen.queryByText('No activity yet for this agent')).toBeNull();
  });

  it('does not show "No activity yet" when outputPreview exists', () => {
    render(
      <CrewStatusContent
        agents={[agent('a1', 'Dev', 'running', { outputPreview: 'some output' })]}
        delegations={[]}
      />,
    );
    openAgent('Dev');
    expect(screen.queryByText('No activity yet for this agent')).toBeNull();
  });

  it('does not show "No activity yet" when agent has comms', () => {
    render(
      <CrewStatusContent
        agents={[agent('a1', 'Dev')]}
        delegations={[]}
        comms={[comm('c1', 'a1', 'lead', 'Hello')]}
      />,
    );
    openAgent('Dev');
    expect(screen.queryByText('No activity yet for this agent')).toBeNull();
  });

  it('does not show "No activity yet" when agent has activity events', () => {
    render(
      <CrewStatusContent
        agents={[agent('a1', 'Dev')]}
        delegations={[]}
        activity={[activityEvent('e1', 'a1', 'Did something')]}
      />,
    );
    openAgent('Dev');
    expect(screen.queryByText('No activity yet for this agent')).toBeNull();
  });
});

describe('CrewStatusContentFull – Communication detail popup', () => {
  it('clicking a comm opens detail popup with comm content', () => {
    const comms = [comm('c1', 'a1', 'lead', 'Here is my progress report')];
    render(
      <CrewStatusContent
        agents={[agent('a1', 'Dev')]}
        delegations={[]}
        comms={comms}
      />,
    );
    openAgent('Dev');
    fireEvent.click(screen.getByText('Here is my progress report'));
    // Popup should show fromRole → toRole header
    expect(screen.getByLabelText('Close communication detail')).toBeDefined();
  });

  it('comm detail popup close button dismisses it', () => {
    const comms = [comm('c1', 'a1', 'lead', 'Some comm content')];
    render(
      <CrewStatusContent
        agents={[agent('a1', 'Dev')]}
        delegations={[]}
        comms={comms}
      />,
    );
    openAgent('Dev');
    fireEvent.click(screen.getByText('Some comm content'));
    const closeBtn = screen.getByLabelText('Close communication detail');
    fireEvent.click(closeBtn);
    expect(screen.queryByLabelText('Close communication detail')).toBeNull();
  });

  it('comm detail popup backdrop click dismisses it', () => {
    const comms = [comm('c1', 'a1', 'lead', 'Backdrop test content')];
    const { container } = render(
      <CrewStatusContent
        agents={[agent('a1', 'Dev')]}
        delegations={[]}
        comms={comms}
      />,
    );
    openAgent('Dev');
    fireEvent.click(screen.getByText('Backdrop test content'));
    expect(screen.getByLabelText('Close communication detail')).toBeDefined();
    // The comm popup overlay is the second fixed overlay (first is the agent modal)
    const overlays = container.querySelectorAll('.fixed.inset-0');
    const commOverlay = overlays[overlays.length - 1] as HTMLElement;
    fireEvent.mouseDown(commOverlay);
    expect(screen.queryByLabelText('Close communication detail')).toBeNull();
  });

  it('renders AgentReportBlock for [Agent Report] content', () => {
    const comms = [comm('c1', 'a1', 'lead', '[Agent Report] All tasks done')];
    render(
      <CrewStatusContent
        agents={[agent('a1', 'Dev')]}
        delegations={[]}
        comms={comms}
      />,
    );
    openAgent('Dev');
    fireEvent.click(screen.getByText(/\[Agent Report\]/));
    expect(screen.getByTestId('report-block')).toBeDefined();
    expect(screen.getByTestId('report-block').textContent).toBe('[Agent Report] All tasks done');
  });

  it('renders AgentReportBlock for [Agent ACK] content', () => {
    const comms = [comm('c1', 'a1', 'lead', '[Agent ACK] Acknowledged task')];
    render(
      <CrewStatusContent
        agents={[agent('a1', 'Dev')]}
        delegations={[]}
        comms={comms}
      />,
    );
    openAgent('Dev');
    fireEvent.click(screen.getByText(/\[Agent ACK\]/));
    expect(screen.getByTestId('report-block')).toBeDefined();
  });

  it('renders plain text (via MentionText) for normal comm content', () => {
    const comms = [comm('c1', 'a1', 'lead', 'Just a regular message')];
    render(
      <CrewStatusContent
        agents={[agent('a1', 'Dev')]}
        delegations={[]}
        comms={comms}
      />,
    );
    openAgent('Dev');
    fireEvent.click(screen.getByText('Just a regular message'));
    expect(screen.queryByTestId('report-block')).toBeNull();
  });
});

describe('CrewStatusContentFull – Model/provider in agent card', () => {
  it('shows model and provider in card when no delegation', () => {
    render(
      <CrewStatusContent
        agents={[agent('a1', 'Dev', 'running', { model: 'gpt-4o', provider: 'openai' })]}
        delegations={[]}
      />,
    );
    expect(screen.getByText('gpt-4o')).toBeDefined();
    expect(screen.getByTestId('provider-badge')).toBeDefined();
  });

  it('shows model in delegation row when delegation exists', () => {
    render(
      <CrewStatusContent
        agents={[agent('a1', 'Dev', 'running', { model: 'gpt-4o', provider: 'openai' })]}
        delegations={[delegation('d1', 'a1', 'Do stuff')]}
      />,
    );
    expect(screen.getByText('gpt-4o')).toBeDefined();
  });

  it('does not show model row when agent has no model and no provider and no delegation', () => {
    const a: CrewAgent = { id: 'a1', role: { name: 'Dev', icon: '🤖' }, status: 'running' };
    render(<CrewStatusContent agents={[a]} delegations={[]} />);
    const allText = document.body.textContent || '';
    expect(allText).not.toMatch(/gpt|claude|model/i);
  });
});

describe('CrewStatusContentFull – Card-level activity summary', () => {
  it('shows latest activity summary on the agent card', () => {
    const events = [
      activityEvent('e1', 'a1', 'Working on tests'),
      activityEvent('e2', 'a1', 'Tests passing now'),
    ];
    render(
      <CrewStatusContent
        agents={[agent('a1', 'Dev')]}
        delegations={[]}
        activity={events}
      />,
    );
    expect(screen.getByText('Tests passing now')).toBeDefined();
  });
});
