// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CrewRoster } from '../CrewRoster';

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
      <CrewRoster />
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

describe('CrewRoster', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockApiFetch.mockImplementation(() => new Promise(() => {}));
    renderPanel();
    expect(screen.getByText(/loading crew roster/i)).toBeInTheDocument();
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
      expect(screen.getByText(/No agents in this crew/i)).toBeInTheDocument();
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

    // Click Settings tab
    fireEvent.click(screen.getByText('Settings'));
    await waitFor(() => {
      expect(screen.getByText('Autopilot:')).toBeInTheDocument();
    });
  });

  // ── Action Buttons ───────────────────────────────────────

  it('shows action buttons for live agents', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('aa11bb22')).toBeInTheDocument();
    });

    // Click the running agent card
    fireEvent.click(screen.getByText('aa11bb22'));
    await waitFor(() => {
      expect(screen.getByText('Message')).toBeInTheDocument();
      expect(screen.getByText('Interrupt')).toBeInTheDocument();
      expect(screen.getByText('Stop')).toBeInTheDocument();
    });
  });

  it('does not show action buttons for terminated agents', async () => {
    setupMocks({
      profile: {
        ...profileData,
        status: 'terminated',
        liveStatus: null,
        live: null,
      },
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('aa11bb22')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('aa11bb22'));
    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeInTheDocument();
    });
    expect(screen.queryByText('Interrupt')).not.toBeInTheDocument();
    expect(screen.queryByText('Stop')).not.toBeInTheDocument();
  });

  it('sends interrupt when Interrupt button clicked', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('aa11bb22')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('aa11bb22'));
    await waitFor(() => {
      expect(screen.getByText('Interrupt')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Interrupt'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/agents/${profileData.agentId}/interrupt`,
        { method: 'POST' },
      );
    });
  });

  it('shows confirmation before stopping agent', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('aa11bb22')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('aa11bb22'));
    await waitFor(() => {
      expect(screen.getByText('Stop')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Stop'));
    await waitFor(() => {
      expect(screen.getByText(/are you sure you want to terminate/i)).toBeInTheDocument();
      expect(screen.getByText('Confirm Stop')).toBeInTheDocument();
    });
  });

  it('terminates agent on confirm', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('aa11bb22')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('aa11bb22'));
    await waitFor(() => {
      expect(screen.getByText('Stop')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Stop'));
    await waitFor(() => {
      expect(screen.getByText('Confirm Stop')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Confirm Stop'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/agents/${profileData.agentId}/terminate`,
        { method: 'POST' },
      );
    });
  });

  it('cancels stop confirmation', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('aa11bb22')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('aa11bb22'));
    await waitFor(() => {
      expect(screen.getByText('Stop')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Stop'));
    await waitFor(() => {
      expect(screen.getByText('Confirm Stop')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => {
      expect(screen.queryByText('Confirm Stop')).not.toBeInTheDocument();
    });
  });

  it('shows message input and sends message', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('aa11bb22')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('aa11bb22'));
    await waitFor(() => {
      expect(screen.getByText('Message')).toBeInTheDocument();
    });

    // Open message input
    fireEvent.click(screen.getByText('Message'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/type a message/i)).toBeInTheDocument();
    });

    // Type and send
    const input = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(input, { target: { value: 'Hello agent' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/agents/${profileData.agentId}/message`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: 'Hello agent' }),
        }),
      );
    });
  });

  it('shows role emoji in profile panel header', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('aa11bb22')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('aa11bb22'));
    await waitFor(() => {
      // Architect emoji from getRoleIcon
      expect(screen.getByText('\u{1F3D7}')).toBeInTheDocument();
    });
  });
});
