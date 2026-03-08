// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TeamRoster } from '../TeamRoster';

// ── Mocks ─────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

vi.mock('../../Toast', () => ({
  useToastStore: () => vi.fn(),
}));

function renderPanel() {
  return render(
    <MemoryRouter>
      <TeamRoster />
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
  profile: any;
}> = {}) {
  mockApiFetch.mockImplementation((path: string) => {
    if (path === '/teams') return Promise.resolve(overrides.teams ?? teamsData);
    if (path.includes('/profile')) return Promise.resolve(overrides.profile ?? profileData);
    if (path.includes('/agents')) return Promise.resolve(overrides.agents ?? rosterAgents);
    return Promise.resolve({});
  });
}

// ── Tests ─────────────────────────────────────────────────

describe('TeamRoster', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockApiFetch.mockImplementation(() => new Promise(() => {}));
    renderPanel();
    expect(screen.getByText(/loading team roster/i)).toBeInTheDocument();
  });

  it('shows error state on API failure', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/teams') return Promise.resolve(teamsData);
      return Promise.reject(new Error('Network error'));
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });

  it('renders roster with agent cards', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('architect')).toBeInTheDocument();
    });
    expect(screen.getByText('developer')).toBeInTheDocument();
    expect(screen.getByText('reviewer')).toBeInTheDocument();
  });

  it('shows agent IDs in short form', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('aa11bb22')).toBeInTheDocument();
    });
  });

  it('shows status badges', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getAllByText('Running').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Idle')).toBeInTheDocument();
    expect(screen.getByText('Terminated')).toBeInTheDocument();
  });

  it('shows last task summary', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Designing auth module')).toBeInTheDocument();
    });
  });

  it('filters agents by search', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('architect')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search agents/i);
    fireEvent.change(searchInput, { target: { value: 'developer' } });
    expect(screen.queryByText('architect')).not.toBeInTheDocument();
    expect(screen.getByText('developer')).toBeInTheDocument();
  });

  it('filters by status tabs', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('architect')).toBeInTheDocument();
    });

    // Click idle filter — triggers new API call
    fireEvent.click(screen.getByText('idle'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('status=idle'));
    });
  });

  it('opens profile panel on agent click', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('architect')).toBeInTheDocument();
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
    renderPanel();
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

  it('closes profile panel on X click', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('aa11bb22')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('aa11bb22'));
    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeInTheDocument();
    });

    // Find the close button (X icon button)
    const closeButtons = screen.getAllByRole('button');
    const closeBtn = closeButtons.find(b => b.querySelector('.lucide-x'));
    if (closeBtn) fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText('12 entries')).not.toBeInTheDocument();
    });
  });

  it('shows empty state when no agents', async () => {
    setupMocks({ agents: [] });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/no agents in this team/i)).toBeInTheDocument();
    });
  });

  it('shows search empty state', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('architect')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/search agents/i), { target: { value: 'nonexistent' } });
    expect(screen.getByText(/no agents match your search/i)).toBeInTheDocument();
  });

  it('switches profile tabs', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('aa11bb22')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('aa11bb22'));
    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeInTheDocument();
    });

    // Click Knowledge tab
    fireEvent.click(screen.getByText('Knowledge'));
    await waitFor(() => {
      expect(screen.getByText(/12 knowledge entries/i)).toBeInTheDocument();
    });
  });
});
