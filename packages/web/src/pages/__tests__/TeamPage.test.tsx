// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TeamPage } from '../TeamPage';

// ── Mocks ─────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

vi.mock('../../components/Toast', () => ({
  useToastStore: () => vi.fn(),
}));

vi.mock('../../components/AgentLifecycle', () => ({
  AgentLifecycle: ({ agentId, onClose }: any) => (
    <div data-testid="agent-lifecycle-modal">
      <span>Lifecycle: {agentId.slice(0, 8)}</span>
      <button onClick={onClose}>Close Modal</button>
    </div>
  ),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <TeamPage />
    </MemoryRouter>,
  );
}

// ── Fixtures ──────────────────────────────────────────────

const teamsData = {
  teams: [
    { teamId: 'default', agentCount: 3, roles: ['architect', 'developer', 'reviewer'] },
  ],
};

const rosterAgents = [
  {
    agentId: 'aa11bb22-cc33-dd44-ee55-ff6677889900',
    role: 'architect',
    model: 'claude-sonnet-4-6',
    status: 'busy',
    liveStatus: 'running',
    teamId: 'default',
    projectId: 'proj-1',
    lastTaskSummary: 'Designing auth module',
    createdAt: '2026-03-01T10:00:00Z',
    updatedAt: '2026-03-07T14:00:00Z',
  },
  {
    agentId: 'bb22cc33-dd44-ee55-ff66-778899001122',
    role: 'developer',
    model: 'claude-sonnet-4-6',
    status: 'idle',
    liveStatus: null,
    teamId: 'default',
    projectId: 'proj-1',
    lastTaskSummary: null,
    createdAt: '2026-03-02T10:00:00Z',
    updatedAt: '2026-03-06T14:00:00Z',
  },
  {
    agentId: 'cc33dd44-ee55-ff66-7788-990011223344',
    role: 'reviewer',
    model: 'claude-opus-4.6',
    status: 'terminated',
    liveStatus: null,
    teamId: 'default',
    projectId: null,
    lastTaskSummary: 'Final code review',
    createdAt: '2026-03-01T08:00:00Z',
    updatedAt: '2026-03-05T12:00:00Z',
  },
];

const healthData = {
  teamId: 'default',
  totalAgents: 3,
  statusCounts: { busy: 1, idle: 1, terminated: 1, retired: 0 },
  massFailurePaused: false,
  agents: [
    { agentId: 'aa11bb22-cc33-dd44-ee55-ff6677889900', role: 'architect', model: 'claude-sonnet-4-6', status: 'busy', uptimeMs: 540_000_000, lastTaskSummary: 'Designing auth module' },
    { agentId: 'bb22cc33-dd44-ee55-ff66-778899001122', role: 'developer', model: 'claude-sonnet-4-6', status: 'idle', uptimeMs: 450_000_000 },
    { agentId: 'cc33dd44-ee55-ff66-7788-990011223344', role: 'reviewer', model: 'claude-opus-4.6', status: 'terminated', uptimeMs: 550_000_000, clonedFromId: 'original-123' },
  ],
};

const serverStatus = {
  running: true,
  connected: true,
  state: 'connected',
  agentCount: 2,
  latencyMs: 12,
  pendingRequests: 0,
  trackedAgents: 2,
};

const profileData = {
  agentId: 'aa11bb22-cc33-dd44-ee55-ff6677889900',
  role: 'architect',
  model: 'claude-sonnet-4-6',
  status: 'busy',
  liveStatus: 'running',
  teamId: 'default',
  projectId: 'proj-1',
  lastTaskSummary: 'Designing auth module',
  createdAt: '2026-03-01T10:00:00Z',
  updatedAt: '2026-03-07T14:00:00Z',
  knowledgeCount: 12,
  live: {
    task: 'Security architecture',
    outputPreview: 'Working on JWT...',
    autopilot: true,
    model: 'claude-sonnet-4-6',
  },
};

function setupMocks(overrides: Partial<{
  teams: any;
  agents: any;
  health: any;
  server: any;
  profile: any;
}> = {}) {
  mockApiFetch.mockImplementation((path: string) => {
    if (path === '/teams') return Promise.resolve(overrides.teams ?? teamsData);
    if (path.includes('/profile')) return Promise.resolve(overrides.profile ?? profileData);
    if (path.includes('/health')) return Promise.resolve(overrides.health ?? healthData);
    if (path === '/agent-server/status') return Promise.resolve(overrides.server ?? serverStatus);
    if (path.includes('/agents')) return Promise.resolve(overrides.agents ?? rosterAgents);
    return Promise.resolve({});
  });
}

// ── Tests ─────────────────────────────────────────────────

describe('TeamPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows loading state initially', () => {
    mockApiFetch.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/loading team/i)).toBeInTheDocument();
  });

  it('shows error state on API failure', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/teams') return Promise.resolve(teamsData);
      if (path.includes('/agents')) return Promise.reject(new Error('Network error'));
      return Promise.reject(new Error('fail'));
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });

  it('renders overview cards with status counts', async () => {
    setupMocks();
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('card-total')).toBeInTheDocument();
    });
    expect(screen.getByTestId('card-active')).toBeInTheDocument();
    expect(screen.getByTestId('card-idle')).toBeInTheDocument();
    expect(screen.getByTestId('card-retired')).toBeInTheDocument();
  });

  it('renders server status card', async () => {
    setupMocks();
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('card-server')).toBeInTheDocument();
    });
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByText('2 agents')).toBeInTheDocument();
    expect(screen.getByText('12ms')).toBeInTheDocument();
  });

  it('renders agent cards with roles and IDs', async () => {
    setupMocks();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('architect')).toBeInTheDocument();
    });
    expect(screen.getByText('developer')).toBeInTheDocument();
    expect(screen.getByText('reviewer')).toBeInTheDocument();
    expect(screen.getByText('aa11bb22')).toBeInTheDocument();
  });

  it('shows status badges on agent cards', async () => {
    setupMocks();
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('Running').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Idle').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Terminated').length).toBeGreaterThan(0);
  });

  it('shows clone indicator from health data', async () => {
    setupMocks();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('🧬')).toBeInTheDocument();
    });
  });

  it('shows mass failure alert when triggered', async () => {
    setupMocks({ health: { ...healthData, massFailurePaused: true } });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('mass-failure-alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/mass failure detected/i)).toBeInTheDocument();
  });

  it('does not show mass failure alert when not triggered', async () => {
    setupMocks();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('architect')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('mass-failure-alert')).not.toBeInTheDocument();
  });

  it('filters agents by search', async () => {
    setupMocks();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('architect')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/search agents/i), { target: { value: 'developer' } });
    expect(screen.queryByText('architect')).not.toBeInTheDocument();
    expect(screen.getByText('developer')).toBeInTheDocument();
  });

  it('shows empty state for no search results', async () => {
    setupMocks();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('architect')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/search agents/i), { target: { value: 'nonexistent' } });
    expect(screen.getByText(/no agents match your search/i)).toBeInTheDocument();
  });

  it('shows empty state when no agents', async () => {
    setupMocks({ agents: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no agents in this team/i)).toBeInTheDocument();
    });
  });

  it('filters by status tabs', async () => {
    setupMocks();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('architect')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('idle'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('status=idle'));
    });
  });

  it('opens profile panel on agent card click', async () => {
    setupMocks();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('aa11bb22')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('aa11bb22'));
    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeInTheDocument();
    });
    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.getByText('Knowledge')).toBeInTheDocument();
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('shows profile overview data', async () => {
    setupMocks();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('aa11bb22')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('aa11bb22'));
    await waitFor(() => {
      expect(screen.getByText('12 entries')).toBeInTheDocument();
    });
    expect(screen.getByText('Live Session')).toBeInTheDocument();
    expect(screen.getByText('Security architecture')).toBeInTheDocument();
  });

  it('closes profile panel', async () => {
    setupMocks();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('aa11bb22')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('aa11bb22'));
    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeInTheDocument();
    });

    const closeButtons = screen.getAllByRole('button');
    const closeBtn = closeButtons.find(b => b.querySelector('.lucide-x'));
    if (closeBtn) fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText('12 entries')).not.toBeInTheDocument();
    });
  });

  it('opens lifecycle modal on Manage click', async () => {
    setupMocks();
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('manage-aa11bb22')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('manage-aa11bb22'));
    await waitFor(() => {
      expect(screen.getByTestId('agent-lifecycle-modal')).toBeInTheDocument();
    });
    expect(screen.getByText('Lifecycle: aa11bb22')).toBeInTheDocument();
  });

  it('closes lifecycle modal', async () => {
    setupMocks();
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('manage-aa11bb22')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('manage-aa11bb22'));
    await waitFor(() => {
      expect(screen.getByTestId('agent-lifecycle-modal')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Close Modal'));
    await waitFor(() => {
      expect(screen.queryByTestId('agent-lifecycle-modal')).not.toBeInTheDocument();
    });
  });

  it('shows stop server confirmation', async () => {
    setupMocks();
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('stop-server-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('stop-server-btn'));
    expect(screen.getByText(/stop agent server/i)).toBeInTheDocument();
    expect(screen.getByTestId('confirm-stop-btn')).toBeInTheDocument();
  });

  it('stops server on confirm', async () => {
    setupMocks();
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('stop-server-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('stop-server-btn'));
    fireEvent.click(screen.getByTestId('confirm-stop-btn'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/agent-server/stop', { method: 'POST' });
    });
  });

  it('switches profile tabs', async () => {
    setupMocks();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('aa11bb22')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('aa11bb22'));
    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Knowledge'));
    await waitFor(() => {
      expect(screen.getByText(/12 knowledge entries/i)).toBeInTheDocument();
    });
  });

  it('refreshes on WS team events', async () => {
    setupMocks();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('architect')).toBeInTheDocument();
    });

    const callCount = mockApiFetch.mock.calls.length;
    act(() => {
      window.dispatchEvent(new MessageEvent('ws-message', {
        data: JSON.stringify({ type: 'team:agent_retired' }),
      }));
    });
    await waitFor(() => {
      expect(mockApiFetch.mock.calls.length).toBeGreaterThan(callCount);
    });
  });

  it('hides stop button when server not running', async () => {
    setupMocks({ server: { ...serverStatus, running: false, state: 'disconnected', connected: false } });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Stopped')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('stop-server-btn')).not.toBeInTheDocument();
  });
});
