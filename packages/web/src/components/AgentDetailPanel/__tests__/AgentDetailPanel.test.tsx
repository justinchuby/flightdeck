// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

// ── Mocks (must precede component imports) ────────────────────

const mockApiFetch = vi.fn().mockResolvedValue({});
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

let mockAgents: any[] = [];
const mockSetSelectedAgent = vi.fn();
vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (selector: any) => selector({ agents: mockAgents, setSelectedAgent: mockSetSelectedAgent }),
    { getState: () => ({ agents: mockAgents, setSelectedAgent: mockSetSelectedAgent }) },
  ),
}));

let mockLeadState: any = { selectedLeadId: null, projects: {} };
vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: Object.assign(
    (selector: any) => selector(mockLeadState),
    { getState: () => mockLeadState },
  ),
}));

const mockAddToast = vi.fn();
vi.mock('../../Toast', () => ({
  useToastStore: Object.assign(
    (selector: any) => selector({ add: mockAddToast }),
    { getState: () => ({ add: mockAddToast }) },
  ),
}));

vi.mock('../../ui/Tabs', () => ({
  Tabs: ({ tabs, activeTab, onTabChange }: any) => (
    <div data-testid="tabs">
      {tabs.map((t: any) => (
        <button
          key={t.id}
          data-testid={`tab-${t.id}`}
          aria-selected={activeTab === t.id}
          onClick={() => onTabChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../../AgentChatPanel', () => ({
  AgentChatPanel: ({ agentId, readOnly }: any) => (
    <div data-testid="agent-chat-panel" data-agent-id={agentId} data-readonly={String(readOnly)} />
  ),
}));

vi.mock('../../LeadDashboard/AgentReportBlock', () => ({
  AgentReportBlock: ({ content }: any) => (
    <div data-testid="agent-report-block">{content}</div>
  ),
}));

vi.mock('../../../hooks/useModels', () => ({
  useModels: () => ({
    models: ['gpt-4', 'claude-3'],
    defaults: {},
    modelsByProvider: {},
    modelName: (id: string) => id,
    loading: false,
    error: null,
  }),
  deriveModelName: (id: string) => id,
}));

vi.mock('../../../utils/statusColors', () => ({
  agentStatusText: () => 'text-blue-400',
}));

vi.mock('../../../utils/format', () => ({
  formatTokens: (v: any) => String(v ?? 0),
}));

vi.mock('../../../utils/formatRelativeTime', () => ({
  formatRelativeTime: () => '5 min ago',
}));

vi.mock('../../../utils/getRoleIcon', () => ({
  getRoleIcon: () => '🤖',
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

vi.mock('../../../utils/providerColors', () => ({
  getProviderColors: () => ({ bg: 'bg-blue-500/20', text: 'text-blue-400' }),
}));

vi.mock('../../../utils/markdown', () => ({
  MentionText: ({ text }: any) => <span>{text}</span>,
}));

vi.mock('../../ProvideFeedback', () => ({
  buildFeedbackUrl: () => 'https://github.com/test/issues/new',
}));

// ── Import component after mocks ──────────────────────────────
import { AgentDetailPanel } from '../AgentDetailPanel';

// ── Test data factories ───────────────────────────────────────

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'agent-123',
    role: { id: 'developer', name: 'Developer', icon: '👨‍💻', systemPrompt: '' },
    status: 'running',
    model: 'gpt-4',
    provider: 'copilot',
    backend: 'acp',
    sessionId: 'sess-abc',
    task: 'Implement feature X',
    outputPreview: 'Working on files...',
    exitError: null,
    exitCode: undefined,
    inputTokens: 5000,
    outputTokens: 3000,
    cacheReadTokens: 1000,
    cacheWriteTokens: 500,
    contextWindowSize: 200000,
    contextWindowUsed: 50000,
    modelResolution: null,
    parentId: undefined,
    childIds: [],
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

const mockProfile = {
  agentId: 'agent-123',
  role: 'developer',
  model: 'gpt-4',
  status: 'running',
  liveStatus: 'running',
  crewId: 'crew-1',
  projectId: 'proj-1',
  lastTaskSummary: 'Last task completed',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
  knowledgeCount: 5,
  live: {
    task: 'Current task',
    outputPreview: 'Output...',
    model: 'gpt-4',
    sessionId: 'sess-abc',
    provider: 'copilot',
    backend: 'acp',
    exitError: null,
  },
};

// ── Tests ─────────────────────────────────────────────────────

describe('AgentDetailPanel', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    mockAgents = [];
    mockLeadState = { selectedLeadId: null, projects: {} };
    onClose.mockClear();
    mockApiFetch.mockClear();
    mockAddToast.mockClear();
    mockSetSelectedAgent.mockClear();
  });

  afterEach(cleanup);

  // ── Render: null / loading ───────────────────────────────────

  it('renders null when agent not in store and no crewId', () => {
    mockAgents = [];
    const { container } = render(
      <AgentDetailPanel agentId="nonexistent" mode="modal" onClose={onClose} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders loading state when profileLoading and no agent/profile', async () => {
    mockAgents = [];
    let resolveProfile!: (v: any) => void;
    mockApiFetch.mockReturnValue(new Promise((r) => { resolveProfile = r; }));

    render(
      <AgentDetailPanel agentId="agent-123" crewId="crew-1" mode="inline" onClose={onClose} />,
    );

    expect(screen.getByText('Loading…')).toBeInTheDocument();

    // Cleanup: resolve pending promise to avoid warnings
    await act(async () => resolveProfile(mockProfile));
  });

  // ── Render: inline vs modal ──────────────────────────────────

  it('renders inline mode — has agent name, status, model in header', () => {
    mockAgents = [makeAgent()];
    const { container } = render(
      <AgentDetailPanel agentId="agent-123" mode="inline" onClose={onClose} />,
    );
    expect(container.querySelector('.fixed.inset-0')).not.toBeInTheDocument();
    expect(screen.getByText('Developer')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('gpt-4')).toBeInTheDocument();
  });

  it('renders modal mode — has overlay backdrop', () => {
    mockAgents = [makeAgent()];
    const { container } = render(
      <AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />,
    );
    const overlay = container.querySelector('.fixed.inset-0');
    expect(overlay).toBeInTheDocument();
  });

  it('modal closes on Escape key', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on Escape in inline mode', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId="agent-123" mode="inline" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('modal closes on backdrop click', () => {
    mockAgents = [makeAgent()];
    const { container } = render(
      <AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />,
    );
    const overlay = container.querySelector('.fixed.inset-0')!;
    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when clicking inside modal content', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    fireEvent.mouseDown(screen.getByText('Developer'));
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── Header / Status ──────────────────────────────────────────

  it('shows action buttons (Interrupt, Stop) when agent is alive', () => {
    mockAgents = [makeAgent({ status: 'running' })];
    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    expect(screen.getByTitle('Interrupt agent')).toBeInTheDocument();
    expect(screen.getByTitle('Stop agent')).toBeInTheDocument();
  });

  it('does NOT show action buttons when agent is terminated', () => {
    mockAgents = [makeAgent({ status: 'terminated' })];
    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    expect(screen.queryByTitle('Interrupt agent')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Stop agent')).not.toBeInTheDocument();
  });

  it('shows confirm-stop dialog when Stop clicked', () => {
    mockAgents = [makeAgent({ status: 'running' })];
    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    fireEvent.click(screen.getByTitle('Stop agent'));
    expect(screen.getByText(/Terminate this agent/)).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('renders provider badge and short agent id in header', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    expect(screen.getByText('copilot')).toBeInTheDocument();
    expect(screen.getByText('agent-12')).toBeInTheDocument();
  });

  it('renders copyable session ID', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    expect(screen.getByText('sess:sess-abc')).toBeInTheDocument();
  });

  // ── Tabs: Details ────────────────────────────────────────────

  it('shows Details tab by default with current task', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    expect(screen.getByText('Current Task')).toBeInTheDocument();
    expect(screen.getByText('Implement feature X')).toBeInTheDocument();
  });

  it('shows token usage section when tokens > 0', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    expect(screen.getByText('Token Usage')).toBeInTheDocument();
    expect(screen.getByText(/Input: 5000/)).toBeInTheDocument();
    expect(screen.getByText(/Output: 3000/)).toBeInTheDocument();
    expect(screen.getByText(/Cache Read: 1000/)).toBeInTheDocument();
    expect(screen.getByText(/Cache Write: 500/)).toBeInTheDocument();
  });

  it('shows context window progress bar', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    expect(screen.getByText('Context Window')).toBeInTheDocument();
    // 50000/200000 = 25%
    expect(screen.getByText('(25%)')).toBeInTheDocument();
  });

  it('shows exit error banner when agent failed', () => {
    mockAgents = [makeAgent({ status: 'failed', exitCode: 1, exitError: 'SIGTERM received' })];
    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    expect(screen.getByText('Agent Failed')).toBeInTheDocument();
    expect(screen.getByText('SIGTERM received')).toBeInTheDocument();
    expect(screen.getByText('Submit GitHub Issue')).toBeInTheDocument();
  });

  it('does not show error banner for running agents', () => {
    mockAgents = [makeAgent({ status: 'running' })];
    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    expect(screen.queryByText('Agent Failed')).not.toBeInTheDocument();
  });

  it('shows output preview on details tab', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    expect(screen.getByText('Latest Output')).toBeInTheDocument();
    expect(screen.getByText('Working on files...')).toBeInTheDocument();
  });

  it('shows "No activity yet" empty state when no content', () => {
    mockAgents = [makeAgent({
      task: null,
      outputPreview: null,
      exitError: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      contextWindowSize: 0,
    })];
    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    expect(screen.getByText('No activity yet for this agent')).toBeInTheDocument();
  });

  // ── Tabs: Chat ───────────────────────────────────────────────

  it('switches to Chat tab — renders AgentChatPanel', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('tab-chat'));
    const chatPanel = screen.getByTestId('agent-chat-panel');
    expect(chatPanel).toBeInTheDocument();
    expect(chatPanel).toHaveAttribute('data-agent-id', 'agent-123');
  });

  it('passes readOnly=false to AgentChatPanel when agent is alive', () => {
    mockAgents = [makeAgent({ status: 'running' })];
    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('tab-chat'));
    expect(screen.getByTestId('agent-chat-panel')).toHaveAttribute('data-readonly', 'false');
  });

  it('passes readOnly=true to AgentChatPanel when agent is not alive', () => {
    mockAgents = [makeAgent({ status: 'failed' })];
    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('tab-chat'));
    expect(screen.getByTestId('agent-chat-panel')).toHaveAttribute('data-readonly', 'true');
  });

  // ── Tabs: Settings ───────────────────────────────────────────

  it('switches to Settings tab — shows model select when alive', () => {
    mockAgents = [makeAgent({ status: 'running' })];
    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('tab-settings'));
    expect(screen.getByDisplayValue('gpt-4')).toBeInTheDocument();
  });

  it('Settings tab shows static model when not alive', () => {
    mockAgents = [makeAgent({ status: 'failed' })];
    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('tab-settings'));
    // No select dropdown
    expect(screen.queryByDisplayValue('gpt-4')).not.toBeInTheDocument();
    // Model text still displayed in static form (also in header)
    expect(screen.getAllByText('gpt-4').length).toBeGreaterThanOrEqual(1);
  });

  // ── Profile data ─────────────────────────────────────────────

  it('shows profile metadata (knowledge count, created date) when profile present', async () => {
    mockAgents = [makeAgent()];
    mockApiFetch.mockResolvedValueOnce({ ...mockProfile });

    await act(async () => {
      render(
        <AgentDetailPanel agentId="agent-123" crewId="crew-1" mode="inline" onClose={onClose} />,
      );
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/crews/crew-1/agents/agent-123/profile');
    expect(screen.getByText('5 entries')).toBeInTheDocument();
    expect(screen.getByText('proj-1')).toBeInTheDocument();
  });

  it('renders from profile data when no agent in store but crewId provided', async () => {
    mockAgents = [];
    mockApiFetch.mockResolvedValueOnce({ ...mockProfile });

    await act(async () => {
      render(
        <AgentDetailPanel agentId="agent-123" crewId="crew-1" mode="modal" onClose={onClose} />,
      );
    });

    // Profile-derived role name is rendered
    expect(screen.getByText('developer')).toBeInTheDocument();
    // Knowledge count from profile
    expect(screen.getByText('5 entries')).toBeInTheDocument();
  });

  // ── Communications & Activity ─────────────────────────────────

  it('shows communications when present in lead store', () => {
    mockAgents = [makeAgent()];
    mockLeadState = {
      selectedLeadId: 'lead-1',
      projects: {
        'lead-1': {
          comms: [
            {
              id: 'comm-1',
              fromId: 'agent-123',
              toId: 'agent-456',
              fromRole: 'Developer',
              toRole: 'Reviewer',
              content: 'PR is ready for review',
              timestamp: '2024-01-01T12:00:00Z',
            },
          ],
          activity: [],
        },
      },
    };

    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    expect(screen.getByText('Communications (1)')).toBeInTheDocument();
    expect(screen.getByText('PR is ready for review')).toBeInTheDocument();
  });

  it('shows activity events when present in lead store', () => {
    mockAgents = [makeAgent()];
    mockLeadState = {
      selectedLeadId: 'lead-1',
      projects: {
        'lead-1': {
          comms: [],
          activity: [
            {
              id: 'evt-1',
              agentId: 'agent-123',
              summary: 'Started implementing feature',
              timestamp: '2024-01-01T12:00:00Z',
              status: 'in_progress',
            },
          ],
        },
      },
    };

    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    expect(screen.getByText('Activity (1)')).toBeInTheDocument();
    expect(screen.getByText('Started implementing feature')).toBeInTheDocument();
  });

  // ── Close button ──────────────────────────────────────────────

  it('calls onClose when × button is clicked', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    fireEvent.click(screen.getByText('×'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── Model resolution display ──────────────────────────────────

  it('shows strikethrough requested model when translated', () => {
    mockAgents = [makeAgent({
      model: 'gemini-2.5-pro',
      modelResolution: {
        requested: 'gpt-4',
        resolved: 'gemini-2.5-pro',
        translated: true,
        reason: 'gpt-4 not available on gemini provider',
      },
    })];
    render(<AgentDetailPanel agentId="agent-123" mode="modal" onClose={onClose} />);
    expect(screen.getByText('gpt-4')).toHaveClass('line-through');
    expect(screen.getByText('gemini-2.5-pro')).toHaveClass('text-yellow-400');
  });
});
