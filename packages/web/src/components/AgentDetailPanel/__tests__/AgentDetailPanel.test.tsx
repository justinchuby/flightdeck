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
vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (selector: any) => selector({ agents: mockAgents }),
    { getState: () => ({ agents: mockAgents }) },
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
        <button key={t.id} data-testid={`tab-${t.id}`} aria-selected={activeTab === t.id} onClick={() => onTabChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../../AgentChatPanel', () => ({
  AgentChatPanel: ({ agentId, readOnly }: any) => (
    <div data-testid="agent-chat-panel" data-agent-id={agentId} data-readonly={readOnly} />
  ),
}));

vi.mock('../../../constants/models', () => ({
  AVAILABLE_MODELS: ['claude-sonnet-4-5', 'gpt-5.1'],
}));

vi.mock('../../../hooks/useModels', () => ({
  useModels: () => ({
    models: ['claude-sonnet-4-5', 'gpt-5.1'],
    defaults: {},
    modelsByProvider: {},
    modelName: (id: string) => id,
    loading: false,
    error: null,
  }),
  deriveModelName: (id: string) => id,
}));

vi.mock('../../../utils/getRoleIcon', () => ({
  getRoleIcon: () => '🤖',
}));

vi.mock('../../../utils/formatRelativeTime', () => ({
  formatRelativeTime: () => '5m ago',
}));

// ── Import component after mocks ──────────────────────────────
import { AgentDetailPanel } from '../AgentDetailPanel';

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    role: { id: 'developer', name: 'Developer', icon: '👨‍💻' },
    status: 'running',
    task: 'Build the feature',
    childIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    outputPreview: 'Processing files...',
    model: 'claude-sonnet-4-5',
    provider: 'copilot',
    sessionId: 'sess-abcd-1234',
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 200,
    cacheWriteTokens: 100,
    contextWindowSize: 200000,
    contextWindowUsed: 50000,
    ...overrides,
  };
}

describe('AgentDetailPanel', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    mockAgents = [];
    onClose.mockClear();
    mockApiFetch.mockClear();
    mockAddToast.mockClear();
  });

  afterEach(cleanup);

  // ── Rendering modes ──────────────────────────────────────────

  it('renders as modal with overlay backdrop', () => {
    mockAgents = [makeAgent()];
    const { container } = render(
      <AgentDetailPanel agentId={mockAgents[0].id} mode="modal" onClose={onClose} />,
    );
    // Modal has fixed overlay
    const overlay = container.querySelector('.fixed.inset-0');
    expect(overlay).toBeInTheDocument();
  });

  it('renders as inline without overlay', () => {
    mockAgents = [makeAgent()];
    const { container } = render(
      <AgentDetailPanel agentId={mockAgents[0].id} mode="inline" onClose={onClose} />,
    );
    // No fixed overlay
    const overlay = container.querySelector('.fixed.inset-0');
    expect(overlay).not.toBeInTheDocument();
  });

  it('returns null when agent not found and no teamId', () => {
    mockAgents = [];
    const { container } = render(
      <AgentDetailPanel agentId="nonexistent" mode="modal" onClose={onClose} />,
    );
    expect(container.innerHTML).toBe('');
  });

  // ── Header content ──────────────────────────────────────────

  it('renders agent header with role name and status', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId={mockAgents[0].id} mode="modal" onClose={onClose} />);
    expect(screen.getByText('Developer')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('renders provider and model badges', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId={mockAgents[0].id} mode="modal" onClose={onClose} />);
    expect(screen.getByText('copilot')).toBeInTheDocument();
    expect(screen.getByText('claude-sonnet-4-5')).toBeInTheDocument();
  });

  it('renders copyable session ID', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId={mockAgents[0].id} mode="modal" onClose={onClose} />);
    expect(screen.getByText('sess:sess-abcd-1234')).toBeInTheDocument();
  });

  it('shows interrupt and stop buttons for alive agents', () => {
    mockAgents = [makeAgent({ status: 'running' })];
    render(<AgentDetailPanel agentId={mockAgents[0].id} mode="modal" onClose={onClose} />);
    expect(screen.getByTitle('Interrupt agent')).toBeInTheDocument();
    expect(screen.getByTitle('Stop agent')).toBeInTheDocument();
  });

  it('hides action buttons for failed agents', () => {
    mockAgents = [makeAgent({ status: 'failed' })];
    render(<AgentDetailPanel agentId={mockAgents[0].id} mode="modal" onClose={onClose} />);
    expect(screen.queryByTitle('Interrupt agent')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Stop agent')).not.toBeInTheDocument();
  });

  // ── Tabs ─────────────────────────────────────────────────────

  it('renders Details, Chat, and Settings tabs', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId={mockAgents[0].id} mode="modal" onClose={onClose} />);
    expect(screen.getByTestId('tab-details')).toBeInTheDocument();
    expect(screen.getByTestId('tab-chat')).toBeInTheDocument();
    expect(screen.getByTestId('tab-settings')).toBeInTheDocument();
  });

  it('defaults to Details tab showing task and tokens', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId={mockAgents[0].id} mode="modal" onClose={onClose} />);
    expect(screen.getByText('Current Task')).toBeInTheDocument();
    expect(screen.getByText('Build the feature')).toBeInTheDocument();
    expect(screen.getByText('Token Usage')).toBeInTheDocument();
  });

  it('shows context window progress bar', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId={mockAgents[0].id} mode="modal" onClose={onClose} />);
    expect(screen.getByText('Context Window')).toBeInTheDocument();
    expect(screen.getByText('(25%)')).toBeInTheDocument();
  });

  it('shows output preview', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId={mockAgents[0].id} mode="modal" onClose={onClose} />);
    expect(screen.getByText('Latest Output')).toBeInTheDocument();
    expect(screen.getByText('Processing files...')).toBeInTheDocument();
  });

  it('switches to Chat tab with AgentChatPanel', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId={mockAgents[0].id} mode="modal" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('tab-chat'));
    expect(screen.getByTestId('agent-chat-panel')).toBeInTheDocument();
  });

  it('switches to Settings tab with model select', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId={mockAgents[0].id} mode="modal" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('tab-settings'));
    // Model dropdown should be present for alive agent
    expect(screen.getByDisplayValue('claude-sonnet-4-5')).toBeInTheDocument();
  });

  // ── Error states ─────────────────────────────────────────────

  it('shows error banner for failed agents', () => {
    mockAgents = [makeAgent({ status: 'failed', exitCode: 1, exitError: 'SIGTERM' })];
    render(<AgentDetailPanel agentId={mockAgents[0].id} mode="modal" onClose={onClose} />);
    expect(screen.getByText('Agent Failed')).toBeInTheDocument();
    expect(screen.getByText('SIGTERM')).toBeInTheDocument();
    expect(screen.getByText('Submit GitHub Issue')).toBeInTheDocument();
  });

  it('does not show error banner for running agents', () => {
    mockAgents = [makeAgent({ status: 'running' })];
    render(<AgentDetailPanel agentId={mockAgents[0].id} mode="modal" onClose={onClose} />);
    expect(screen.queryByText('Agent Failed')).not.toBeInTheDocument();
  });

  // ── Modal backdrop close ──────────────────────────────────

  it('calls onClose when clicking modal backdrop', () => {
    mockAgents = [makeAgent()];
    const { container } = render(
      <AgentDetailPanel agentId={mockAgents[0].id} mode="modal" onClose={onClose} />,
    );
    const overlay = container.querySelector('.fixed.inset-0')!;
    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when clicking inside modal content', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId={mockAgents[0].id} mode="modal" onClose={onClose} />);
    fireEvent.mouseDown(screen.getByText('Developer'));
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── Close button ──────────────────────────────────────────

  it('calls onClose when × button is clicked', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId={mockAgents[0].id} mode="modal" onClose={onClose} />);
    fireEvent.click(screen.getByText('×'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape key is pressed in modal mode', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId={mockAgents[0].id} mode="modal" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on Escape in inline mode', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId={mockAgents[0].id} mode="inline" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── Stop confirmation ─────────────────────────────────────

  it('shows stop confirmation dialog', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailPanel agentId={mockAgents[0].id} mode="modal" onClose={onClose} />);
    fireEvent.click(screen.getByTitle('Stop agent'));
    expect(screen.getByText(/Terminate this agent/)).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  // ── Model fallback display ─────────────────────────────────

  it('shows strikethrough requested model and yellow resolved model when translated', () => {
    mockAgents = [makeAgent({
      model: 'gemini-2.5-pro',
      modelResolution: {
        requested: 'claude-sonnet-4-5',
        resolved: 'gemini-2.5-pro',
        translated: true,
        reason: 'claude-sonnet-4 not available on gemini provider',
      },
    })];
    render(<AgentDetailPanel agentId={mockAgents[0].id} mode="modal" onClose={onClose} />);
    expect(screen.getByText('claude-sonnet-4-5')).toHaveClass('line-through');
    expect(screen.getByText('gemini-2.5-pro')).toHaveClass('text-yellow-400');
  });

  it('shows plain model when no translation occurred', () => {
    mockAgents = [makeAgent({ modelResolution: undefined })];
    render(<AgentDetailPanel agentId={mockAgents[0].id} mode="modal" onClose={onClose} />);
    expect(screen.getByText('claude-sonnet-4-5')).not.toHaveClass('line-through');
  });

  // ── Empty state ───────────────────────────────────────────

  it('shows empty state when agent has no activity', () => {
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
    render(<AgentDetailPanel agentId={mockAgents[0].id} mode="modal" onClose={onClose} />);
    expect(screen.getByText('No activity yet for this agent')).toBeInTheDocument();
  });

  // ── Profile data (teamId present) ─────────────────────────

  it('fetches profile when teamId is provided', async () => {
    mockAgents = [makeAgent()];
    mockApiFetch.mockResolvedValueOnce({
      agentId: mockAgents[0].id,
      role: 'Developer',
      model: 'claude-sonnet-4-5',
      status: 'running',
      liveStatus: 'running',
      teamId: 'team-1',
      projectId: 'proj-abc',
      lastTaskSummary: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      knowledgeCount: 5,
      live: null,
    });

    await act(async () => {
      render(
        <AgentDetailPanel agentId={mockAgents[0].id} teamId="team-1" mode="inline" onClose={onClose} />,
      );
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/teams/team-1/agents/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/profile');
    // Profile data should be rendered
    expect(screen.getByText('proj-abc')).toBeInTheDocument();
    expect(screen.getByText('5 entries')).toBeInTheDocument();
  });
});
