// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ── Mocks (must be before component imports) ──────────────────

const mockApiFetch = vi.fn().mockResolvedValue({});
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

let mockAgents: any[] = [];
vi.mock('../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (selector: any) =>
      selector({
        agents: mockAgents,
      }),
    {
      getState: () => ({
        agents: mockAgents,
      }),
    },
  ),
}));

const mockAddToast = vi.fn();
vi.mock('../../components/Toast', () => ({
  useToastStore: Object.assign(
    (selector: any) => selector({ add: mockAddToast }),
    { getState: () => ({ add: mockAddToast }) },
  ),
}));

// ── Import component after mocks ──────────────────────────────
import { AgentDetailModal } from '../AgentDetailModal';

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    role: { id: 'developer', name: 'Developer', icon: '👨‍💻' },
    status: 'running',
    task: 'Build the feature',
    childIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    outputPreview: '',
    model: 'claude-sonnet-4',
    provider: 'copilot',
    sessionId: 'sess-1234-5678',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...overrides,
  };
}

describe('AgentDetailModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    mockAgents = [];
    onClose.mockReset();
    mockApiFetch.mockReset().mockResolvedValue({});
  });

  afterEach(cleanup);

  it('renders nothing when agent not found', () => {
    mockAgents = [];
    const { container } = render(
      <AgentDetailModal agentId="nonexistent" onClose={onClose} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders agent header with role name and status', () => {
    mockAgents = [makeAgent()];
    render(<AgentDetailModal agentId={mockAgents[0].id} onClose={onClose} />);
    expect(screen.getByText('Developer')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('does NOT show error banner for running agent', () => {
    mockAgents = [makeAgent({ status: 'running' })];
    render(<AgentDetailModal agentId={mockAgents[0].id} onClose={onClose} />);
    expect(screen.queryByText('Agent Failed')).not.toBeInTheDocument();
  });

  it('shows error banner when agent status is failed', () => {
    mockAgents = [
      makeAgent({
        status: 'failed',
        exitError: 'Process exited with SIGTERM',
        exitCode: 1,
      }),
    ];
    render(<AgentDetailModal agentId={mockAgents[0].id} onClose={onClose} />);

    expect(screen.getByText('Agent Failed')).toBeInTheDocument();
    expect(screen.getByText('Process exited with SIGTERM')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument(); // exit code
    expect(screen.getByText('Submit GitHub Issue')).toBeInTheDocument();
  });

  it('shows error banner when agent status is terminated with exitError', () => {
    mockAgents = [
      makeAgent({
        status: 'terminated',
        exitError: 'Agent was killed',
        exitCode: -1,
      }),
    ];
    render(<AgentDetailModal agentId={mockAgents[0].id} onClose={onClose} />);

    expect(screen.getByText('Agent Failed')).toBeInTheDocument();
    expect(screen.getByText('Agent was killed')).toBeInTheDocument();
  });

  it('shows provider and model in error banner metadata', () => {
    mockAgents = [
      makeAgent({
        status: 'failed',
        exitError: 'error',
        exitCode: 2,
        provider: 'gemini',
        model: 'gemini-2.5-pro',
      }),
    ];
    render(<AgentDetailModal agentId={mockAgents[0].id} onClose={onClose} />);

    // Provider and model appear in the banner metadata
    const banner = screen.getByText('Agent Failed').closest('div')!.parentElement!;
    expect(banner.textContent).toContain('gemini');
    expect(banner.textContent).toContain('gemini-2.5-pro');
  });

  it('Submit GitHub Issue button opens new window with pre-filled URL', () => {
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    mockAgents = [
      makeAgent({
        status: 'failed',
        exitError: 'spawn ENOENT',
        exitCode: 127,
        provider: 'copilot',
        model: 'claude-sonnet-4',
        sessionId: 'sess-abcd-1234',
      }),
    ];
    render(<AgentDetailModal agentId={mockAgents[0].id} onClose={onClose} />);

    fireEvent.click(screen.getByText('Submit GitHub Issue'));

    expect(windowOpenSpy).toHaveBeenCalledTimes(1);
    const url = windowOpenSpy.mock.calls[0][0] as string;
    expect(url).toContain('github.com/justinchuby/flightdeck/issues/new');
    expect(url).toContain('Agent+failure');
    expect(url).toContain('exit+code');
    expect(url).toContain('copilot');
    expect(url).toContain('spawn+ENOENT');

    windowOpenSpy.mockRestore();
  });

  it('does not show error banner for completed agents', () => {
    mockAgents = [makeAgent({ status: 'completed' })];
    render(<AgentDetailModal agentId={mockAgents[0].id} onClose={onClose} />);
    expect(screen.queryByText('Agent Failed')).not.toBeInTheDocument();
  });

  it('shows inline exit error for non-failed status with exitError', () => {
    // Edge case: exitError set but status not failed (shouldn't happen normally)
    mockAgents = [makeAgent({ status: 'running', exitError: 'some error' })];
    render(<AgentDetailModal agentId={mockAgents[0].id} onClose={onClose} />);

    // Should show inline error section, not banner
    expect(screen.queryByText('Agent Failed')).not.toBeInTheDocument();
    expect(screen.getByText('Exit Error')).toBeInTheDocument();
    expect(screen.getByText('some error')).toBeInTheDocument();
  });

  it('shows error banner without exitError when only exitCode is present', () => {
    mockAgents = [makeAgent({ status: 'failed', exitCode: 1 })];
    render(<AgentDetailModal agentId={mockAgents[0].id} onClose={onClose} />);

    expect(screen.getByText('Agent Failed')).toBeInTheDocument();
    expect(screen.getByText('Submit GitHub Issue')).toBeInTheDocument();
  });

  it('shows requested vs resolved model when model was translated', () => {
    mockAgents = [
      makeAgent({
        status: 'running',
        model: 'gemini-2.5-pro',
        requestedModel: 'claude-opus-4.6',
        resolvedModel: 'gemini-2.5-pro',
        modelTranslated: true,
        modelResolutionReason: 'claude-opus-4.6 → gemini-2.5-pro (gemini equivalent)',
        provider: 'gemini',
      }),
    ];
    render(<AgentDetailModal agentId={mockAgents[0].id} onClose={onClose} />);

    expect(screen.getByText('claude-opus-4.6')).toBeInTheDocument();
    expect(screen.getByText('gemini-2.5-pro')).toBeInTheDocument();
    // The arrow separator
    expect(screen.getByText(/→/)).toBeInTheDocument();
  });

  it('shows plain model when no translation occurred', () => {
    mockAgents = [
      makeAgent({
        status: 'running',
        model: 'claude-sonnet-4',
        modelTranslated: false,
      }),
    ];
    render(<AgentDetailModal agentId={mockAgents[0].id} onClose={onClose} />);

    expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument();
    // No arrow separator
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });
});
