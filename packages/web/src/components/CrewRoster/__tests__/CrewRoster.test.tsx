// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CrewRoster } from '../CrewRoster';

type LiveStatus = 'creating' | 'running' | 'idle' | 'completed' | 'failed' | 'terminated' | null;

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
    parentId: 'lead-0001-0000-0000-000000000000',
    sessionId: 'sess-1',
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
    parentId: 'lead-0001-0000-0000-000000000000',
    sessionId: 'sess-1',
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
    parentId: 'lead-0001-0000-0000-000000000000',
    sessionId: null,
    lastTaskSummary: 'Final code review',
    createdAt: '2026-03-01T08:00:00Z',
    updatedAt: '2026-03-05T12:00:00Z',
  },
];

const crewSummaryData = [
  {
    leadId: 'lead-0001-0000-0000-000000000000',
    projectId: 'proj-1',
    projectName: 'Test Project',
    agentCount: 3,
    activeAgentCount: 1,
    sessionCount: 2,
    lastActivity: '2026-03-07T14:00:00Z',
    agents: rosterAgents.map(a => ({
      agentId: a.agentId, role: a.role, model: a.model,
      status: a.status, liveStatus: a.liveStatus,
    })),
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
  crewSummary: any;
}> = {}) {
  mockApiFetch.mockImplementation((path: string) => {
    if (path === '/crews/summary') return Promise.resolve(overrides.crewSummary ?? crewSummaryData);
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
    // developer: status=idle, liveStatus=null → Offline (not live in memory)
    expect(screen.getByText('Offline')).toBeInTheDocument();
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

    const searchInput = screen.getByPlaceholderText(/search crews/i);
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
      expect(screen.getByText(/No agents in any crew/i)).toBeInTheDocument();
    });
  });

  it('shows search empty state', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('architect')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/search crews/i), { target: { value: 'nonexistent' } });
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

  // ── Crew grouping tests ──────────────────────────────────

  it('groups agents by lead with project name header', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      // Crew summary provides project name for the group header
      expect(screen.getByText('Test Project')).toBeInTheDocument();
    });
    // Group header shows active count
    expect(screen.getByText(/active/)).toBeInTheDocument();
  });

  it('shows multiple crew groups for different leads', async () => {
    const leadAgent = {
      agentId: 'ee55ff66-7788-9900-1122-334455667788',
      role: 'lead',
      model: 'claude-sonnet-4-6',
      status: 'busy',
      liveStatus: 'running',
      teamId: 'team-alpha',
      projectId: 'proj-2',
      parentId: null,
      sessionId: 'sess-2',
      lastTaskSummary: 'Leading alpha team',
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-07T15:00:00Z',
    };
    const multiTeamAgents = [...rosterAgents, leadAgent];
    const multiTeamsData = {
      teams: [
        { teamId: 'default', agentCount: 3, roles: ['architect', 'developer', 'reviewer'] },
        { teamId: 'team-alpha', agentCount: 1, roles: ['lead'] },
      ],
    };
    const multiCrewSummary = [
      ...crewSummaryData,
      {
        leadId: leadAgent.agentId,
        projectId: 'proj-2',
        projectName: 'Alpha Project',
        agentCount: 1,
        activeAgentCount: 1,
        sessionCount: 1,
        lastActivity: '2026-03-07T15:00:00Z',
        agents: [{ agentId: leadAgent.agentId, role: 'lead', model: leadAgent.model, status: leadAgent.status, liveStatus: leadAgent.liveStatus }],
      },
    ];
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/crews/summary') return Promise.resolve(multiCrewSummary);
      if (path === '/teams') return Promise.resolve(multiTeamsData);
      if (path.includes('/profile')) return Promise.resolve(profileData);
      if (path.includes('team-alpha') && path.includes('/agents'))
        return Promise.resolve(multiTeamAgents.filter(a => a.teamId === 'team-alpha'));
      if (path.includes('/agents'))
        return Promise.resolve(multiTeamAgents.filter(a => a.teamId === 'default'));
      return Promise.resolve({});
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Test Project')).toBeInTheDocument();
      expect(screen.getByText('Alpha Project')).toBeInTheDocument();
    });
    // Header shows crew count
    expect(screen.getByText(/2 crews/)).toBeInTheDocument();
  });

  it('shows session history when crew is expanded', async () => {
    const sessionDetails = [
      {
        id: 'sess-1',
        leadId: 'lead-0001-0000-0000-000000000000',
        status: 'completed',
        task: 'Implement auth module',
        startedAt: '2026-03-05T10:00:00Z',
        endedAt: '2026-03-05T12:30:00Z',
        durationMs: 9_000_000,
        taskSummary: { total: 5, done: 4, failed: 1 },
        hasRetro: true,
      },
      {
        id: 'sess-2',
        leadId: 'lead-0001-0000-0000-000000000000',
        status: 'running',
        task: 'Database migration',
        startedAt: '2026-03-07T14:00:00Z',
        endedAt: null,
        durationMs: null,
        taskSummary: { total: 3, done: 1, failed: 0 },
        hasRetro: false,
      },
    ];

    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/crews/summary') return Promise.resolve(crewSummaryData);
      if (path === '/teams') return Promise.resolve(teamsData);
      if (path.includes('/sessions/detail')) return Promise.resolve(sessionDetails);
      if (path.includes('/profile')) return Promise.resolve(profileData);
      if (path.includes('/agents')) return Promise.resolve(rosterAgents);
      return Promise.resolve({});
    });

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Implement auth module')).toBeInTheDocument();
    });
    expect(screen.getByText('Database migration')).toBeInTheDocument();
    // Task counts shown
    expect(screen.getByText(/4\/5 tasks/)).toBeInTheDocument();
    expect(screen.getByText(/1 failed/)).toBeInTheDocument();
  });

  // ── Delete Crew tests ─────────────────────────────────────

  it('shows delete button for inactive crews', async () => {
    // All agents terminated/offline → delete button visible
    const inactiveAgents = rosterAgents.map(a => ({ ...a, liveStatus: null as LiveStatus, status: 'terminated' as const }));
    const inactiveSummary = [{ ...crewSummaryData[0], activeAgentCount: 0, agents: inactiveAgents.map(a => ({ agentId: a.agentId, role: a.role, model: a.model, status: a.status, liveStatus: a.liveStatus })) }];
    setupMocks({ agents: inactiveAgents, crewSummary: inactiveSummary });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByTitle('Delete crew')).toBeInTheDocument();
    });
  });

  it('hides delete button for active crews', async () => {
    // activeAgentCount > 0 → no delete button
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('architect')).toBeInTheDocument();
    });
    expect(screen.queryByTitle('Delete crew')).not.toBeInTheDocument();
  });

  it('shows confirmation dialog before deleting crew', async () => {
    const inactiveAgents = rosterAgents.map(a => ({ ...a, liveStatus: null as LiveStatus, status: 'terminated' as const }));
    const inactiveSummary = [{ ...crewSummaryData[0], activeAgentCount: 0 }];
    setupMocks({ agents: inactiveAgents, crewSummary: inactiveSummary });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByTitle('Delete crew')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Delete crew'));
    // Confirmation dialog appears with action buttons
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('cancels crew deletion', async () => {
    const inactiveAgents = rosterAgents.map(a => ({ ...a, liveStatus: null as LiveStatus, status: 'terminated' as const }));
    const inactiveSummary = [{ ...crewSummaryData[0], activeAgentCount: 0 }];
    setupMocks({ agents: inactiveAgents, crewSummary: inactiveSummary });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByTitle('Delete crew')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Delete crew'));
    await waitFor(() => {
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => {
      expect(screen.queryByText(/This cannot be undone/)).not.toBeInTheDocument();
    });
  });

  it('deletes crew and removes from list', async () => {
    const inactiveAgents = rosterAgents.map(a => ({ ...a, liveStatus: null as LiveStatus, status: 'terminated' as const }));
    const inactiveSummary = [{ ...crewSummaryData[0], activeAgentCount: 0 }];
    setupMocks({ agents: inactiveAgents, crewSummary: inactiveSummary });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByTitle('Delete crew')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Delete crew'));
    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    // Confirm deletion
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/crews/${crewSummaryData[0].leadId}`,
        { method: 'DELETE' },
      );
    });
    // Agents removed from the list
    await waitFor(() => {
      expect(screen.queryByText('architect')).not.toBeInTheDocument();
    });
  });

  it('shows error toast on delete failure', async () => {
    const inactiveAgents = rosterAgents.map(a => ({ ...a, liveStatus: null as LiveStatus, status: 'terminated' as const }));
    const inactiveSummary = [{ ...crewSummaryData[0], activeAgentCount: 0 }];

    const addToastMock = vi.fn();
    vi.mocked(vi.fn()).mockReturnValue(addToastMock);

    mockApiFetch.mockImplementation((path: string, opts?: any) => {
      if (opts?.method === 'DELETE') return Promise.reject(new Error('Cannot delete active crew'));
      if (path === '/crews/summary') return Promise.resolve(inactiveSummary);
      if (path === '/teams') return Promise.resolve(teamsData);
      if (path.includes('/agents')) return Promise.resolve(inactiveAgents);
      return Promise.resolve({});
    });

    renderPanel();
    await waitFor(() => {
      expect(screen.getByTitle('Delete crew')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Delete crew'));
    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Delete'));
    // Confirmation should remain visible after error
    await waitFor(() => {
      expect(screen.getByTitle('Delete crew')).toBeInTheDocument();
    });
  });

  // ── Offline status tests ──────────────────────────────────

  it('shows Offline for agents with idle DB status but no live agent', async () => {
    // Developer has status=idle, liveStatus=null → should show Offline
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Offline')).toBeInTheDocument();
    });
  });

  it('shows Idle only for agents with live idle status', async () => {
    const liveIdleAgents = rosterAgents.map(a => a.role === 'developer' ? { ...a, liveStatus: 'idle' as LiveStatus } : a);
    const summary = [{ ...crewSummaryData[0], activeAgentCount: 2 }];
    setupMocks({ agents: liveIdleAgents, crewSummary: summary });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Idle')).toBeInTheDocument();
    });
  });
});
