// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { RosterAgent, CrewSummary } from '../UnifiedCrewPage';

// ── Mutable mock state ────────────────────────────────────

let mockProjectId: string | null = null;
const mockAddToast = vi.fn();
const mockApiFetch = vi.fn();

// ── Mocks ─────────────────────────────────────────────────

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../../../contexts/ProjectContext', () => ({
  useOptionalProjectId: () => mockProjectId,
}));

vi.mock('../../Toast', () => ({
  useToastStore: (sel: (s: { add: typeof mockAddToast }) => unknown) =>
    sel({ add: mockAddToast }),
}));

vi.mock('../../AgentDetailPanel', () => ({
  AgentDetailPanel: ({ agentId, onClose }: { agentId: string; onClose: () => void }) => (
    <div data-testid="agent-detail-panel" data-agent-id={agentId}>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

vi.mock('../../ui/StatusBadge', () => ({
  StatusBadge: ({ label }: { label: string }) => <span data-testid="status-badge">{label}</span>,
  agentStatusProps: (status: string) => ({ variant: 'info' as const, label: status }),
}));

vi.mock('../../../utils/getRoleIcon', () => ({
  getRoleIcon: () => '🤖',
}));

vi.mock('../../../utils/statusColors', () => ({
  sessionStatusDot: () => 'bg-green-400',
}));

vi.mock('../../../utils/formatRelativeTime', () => ({
  formatRelativeTime: () => '5m ago',
}));

vi.mock('../../../utils/format', () => ({
  formatTokens: (n: number | null) => (n != null ? `${n}` : '0'),
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

// ── Import after mocks ────────────────────────────────────

import { UnifiedCrewPage } from '../UnifiedCrewPage';

// ── Factories / helpers ───────────────────────────────────

function makeAgent(overrides: Partial<RosterAgent> = {}): RosterAgent {
  return {
    agentId: 'agent-1',
    role: 'developer',
    model: 'gpt-4',
    status: 'running',
    liveStatus: 'running',
    teamId: 'lead-1',
    projectId: null,
    parentId: 'lead-1',
    sessionId: null,
    lastTaskSummary: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    provider: null,
    inputTokens: null,
    outputTokens: null,
    contextWindowSize: null,
    contextWindowUsed: null,
    task: null,
    outputPreview: null,
    ...overrides,
  };
}

function makeSummary(overrides: Partial<CrewSummary> = {}): CrewSummary {
  return {
    leadId: 'lead-1',
    projectId: null,
    projectName: null,
    agentCount: 1,
    activeAgentCount: 1,
    sessionCount: 0,
    lastActivity: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

/**
 * Configure mockApiFetch to respond to the three endpoints the component calls.
 * - /crews/summary → summaries
 * - /crews         → { crews: [{ crewId, agentCount, roles }] }
 * - /crews/:id/agents → filtered agents for that crew
 */
function setupApiMocks(
  agents: RosterAgent[],
  summaries: CrewSummary[] = [],
) {
  const crewIds = [...new Set(agents.map(a => a.teamId))];
  mockApiFetch.mockImplementation((path: string) => {
    if (path.includes('/crews/summary')) return Promise.resolve(summaries);
    if (path.match(/\/crews\/[^/]+\/agents/)) {
      const crewId = path.split('/crews/')[1].split('/agents')[0];
      return Promise.resolve(agents.filter(a => a.teamId === crewId));
    }
    if (path.includes('/crews'))
      return Promise.resolve({
        crews: crewIds.map(c => ({ crewId: c, agentCount: 1, roles: [] })),
      });
    return Promise.resolve({});
  });
}

function renderPage(props: Record<string, unknown> = {}) {
  return render(<UnifiedCrewPage scope="global" {...props} />);
}

// ── Tests ─────────────────────────────────────────────────

describe('UnifiedCrewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectId = null;
    // Default: empty API responses
    setupApiMocks([]);
  });

  // ─── Loading / Error / Empty ────────────────────────────

  it('shows loading spinner initially', () => {
    // Never resolve the API call so we stay in loading state
    mockApiFetch.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/Loading crew roster/)).toBeInTheDocument();
  });

  it('shows error message when API fails', async () => {
    // Promise.allSettled won't throw, so we need /crews to succeed with a crew
    // and then ALL /crews/:id/agents calls must fail → triggers the error path
    mockApiFetch.mockImplementation((path: string) => {
      if (path.includes('/crews/summary')) return Promise.resolve([]);
      if (path.match(/\/crews\/[^/]+\/agents/))
        return Promise.reject(new Error('Network error'));
      if (path.includes('/crews'))
        return Promise.resolve({ crews: [{ crewId: 'c1', agentCount: 1, roles: [] }] });
      return Promise.resolve({});
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('shows "No active agents" empty state in global scope', async () => {
    setupApiMocks([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No active agents')).toBeInTheDocument();
    });
    expect(
      screen.getByText('All agents are idle or terminated.'),
    ).toBeInTheDocument();
  });

  it('shows "No agents yet" empty state in project scope', async () => {
    mockProjectId = 'proj-123';
    setupApiMocks([]);
    renderPage({ scope: 'project' });
    await waitFor(() => {
      expect(screen.getByText('No agents yet')).toBeInTheDocument();
    });
    expect(
      screen.getByText('Start a session to spawn your first crew.'),
    ).toBeInTheDocument();
  });

  // ─── Rendering agents ──────────────────────────────────

  it('renders agents grouped by crew after loading', async () => {
    const lead = makeAgent({
      agentId: 'lead-1',
      role: 'lead',
      teamId: 'lead-1',
      parentId: null,
      liveStatus: 'running',
    });
    const worker = makeAgent({
      agentId: 'worker-1',
      role: 'developer',
      teamId: 'lead-1',
      parentId: 'lead-1',
      liveStatus: 'running',
    });
    setupApiMocks([lead, worker]);
    renderPage();

    await waitFor(() => {
      // Both agents should appear: the lead row and the worker row
      expect(screen.getByText('lead')).toBeInTheDocument();
      expect(screen.getByText('developer')).toBeInTheDocument();
    });
  });

  it('renders agent role and model info', async () => {
    const agent = makeAgent({
      agentId: 'agent-abc',
      role: 'tester',
      model: 'claude-sonnet',
      liveStatus: 'running',
    });
    setupApiMocks([agent]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('tester')).toBeInTheDocument();
      expect(screen.getByText('claude-sonnet')).toBeInTheDocument();
    });
  });

  it('renders crew group header with agent count', async () => {
    const agents = [
      makeAgent({ agentId: 'lead-1', role: 'lead', teamId: 'lead-1', parentId: null, liveStatus: 'running' }),
      makeAgent({ agentId: 'w-1', role: 'developer', teamId: 'lead-1', parentId: 'lead-1', liveStatus: 'running' }),
      makeAgent({ agentId: 'w-2', role: 'tester', teamId: 'lead-1', parentId: 'lead-1', liveStatus: 'idle' }),
    ];
    const summaries = [makeSummary({ leadId: 'lead-1', activeAgentCount: 3, agentCount: 3, projectName: 'MyProject' })];
    setupApiMocks(agents, summaries);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('MyProject')).toBeInTheDocument();
      // Shows "3/3 active"
      expect(screen.getByText('3/3 active')).toBeInTheDocument();
    });
  });

  // ─── Search ─────────────────────────────────────────────

  it('search filters agents by role name', async () => {
    mockProjectId = 'proj-1';
    const agents = [
      makeAgent({ agentId: 'a1', role: 'developer', teamId: 'lead-1', parentId: 'lead-1' }),
      makeAgent({ agentId: 'a2', role: 'designer', teamId: 'lead-1', parentId: 'lead-1' }),
    ];
    setupApiMocks(agents);
    renderPage({ scope: 'project' });

    await waitFor(() => {
      expect(screen.getByText('developer')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('Search agents...');
    fireEvent.change(input, { target: { value: 'designer' } });

    await waitFor(() => {
      expect(screen.queryByText('developer')).not.toBeInTheDocument();
      expect(screen.getByText('designer')).toBeInTheDocument();
    });
  });

  it('search filters agents by agent ID', async () => {
    mockProjectId = 'proj-1';
    const agents = [
      makeAgent({ agentId: 'alpha-001', role: 'dev', teamId: 'lead-1', parentId: 'lead-1' }),
      makeAgent({ agentId: 'beta-002', role: 'tester', teamId: 'lead-1', parentId: 'lead-1' }),
    ];
    setupApiMocks(agents);
    renderPage({ scope: 'project' });

    await waitFor(() => {
      expect(screen.getByText('dev')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('Search agents...');
    fireEvent.change(input, { target: { value: 'beta-002' } });

    await waitFor(() => {
      expect(screen.queryByText('dev')).not.toBeInTheDocument();
      expect(screen.getByText('tester')).toBeInTheDocument();
    });
  });

  it('shows "No agents match" when search has no results', async () => {
    mockProjectId = 'proj-1';
    const agents = [
      makeAgent({ agentId: 'a1', role: 'developer', teamId: 'lead-1', parentId: 'lead-1' }),
    ];
    setupApiMocks(agents);
    renderPage({ scope: 'project' });

    await waitFor(() => {
      expect(screen.getByText('developer')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('Search agents...');
    fireEvent.change(input, { target: { value: 'zzz-nonexistent' } });

    await waitFor(() => {
      expect(screen.getByText(/No agents match/)).toBeInTheDocument();
    });
  });

  it('clear button resets search', async () => {
    mockProjectId = 'proj-1';
    const agents = [
      makeAgent({ agentId: 'a1', role: 'developer', teamId: 'lead-1', parentId: 'lead-1' }),
    ];
    setupApiMocks(agents);
    renderPage({ scope: 'project' });

    await waitFor(() => {
      expect(screen.getByText('developer')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('Search agents...');
    fireEvent.change(input, { target: { value: 'nonexistent' } });

    await waitFor(() => {
      expect(screen.getByText(/No agents match/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Clear'));

    await waitFor(() => {
      expect(screen.getByText('developer')).toBeInTheDocument();
      expect(screen.queryByText(/No agents match/)).not.toBeInTheDocument();
    });
  });

  // ─── Status filter ──────────────────────────────────────

  it('renders status filter buttons in project scope', async () => {
    mockProjectId = 'proj-1';
    setupApiMocks([]);
    renderPage({ scope: 'project' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'active' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'all' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'running' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'terminated' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'failed' })).toBeInTheDocument();
    });
  });

  it('does NOT render status filter buttons in global scope', async () => {
    setupApiMocks([]);
    renderPage({ scope: 'global' });

    await waitFor(() => {
      expect(screen.getByText(/No active agents/)).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'active' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'terminated' })).not.toBeInTheDocument();
  });

  // ─── Interactions ───────────────────────────────────────

  it('clicking an agent opens AgentDetailPanel', async () => {
    const agent = makeAgent({
      agentId: 'agent-click-me',
      role: 'developer',
      liveStatus: 'running',
    });
    setupApiMocks([agent]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('developer')).toBeInTheDocument();
    });

    // Agent rows are rendered with role="button"
    const agentRow = screen.getByRole('button', { name: /developer/i });
    fireEvent.click(agentRow);

    await waitFor(() => {
      expect(screen.getByTestId('agent-detail-panel')).toBeInTheDocument();
      expect(screen.getByTestId('agent-detail-panel').dataset.agentId).toBe(
        'agent-click-me',
      );
    });
  });

  it('closing AgentDetailPanel deselects agent', async () => {
    const agent = makeAgent({
      agentId: 'agent-closable',
      role: 'developer',
      liveStatus: 'running',
    });
    setupApiMocks([agent]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('developer')).toBeInTheDocument();
    });

    const agentRow = screen.getByRole('button', { name: /developer/i });
    fireEvent.click(agentRow);

    await waitFor(() => {
      expect(screen.getByTestId('agent-detail-panel')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Close'));

    await waitFor(() => {
      expect(screen.queryByTestId('agent-detail-panel')).not.toBeInTheDocument();
    });
  });

  it('Refresh button triggers re-fetch', async () => {
    setupApiMocks([]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/No active agents/)).toBeInTheDocument();
    });

    const callsBefore = mockApiFetch.mock.calls.length;
    fireEvent.click(screen.getByText('Refresh'));

    await waitFor(() => {
      expect(mockApiFetch.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('HealthStrip renders at bottom with agent counts', async () => {
    const agents = [
      makeAgent({ agentId: 'r1', liveStatus: 'running', teamId: 'lead-1', parentId: 'lead-1' }),
      makeAgent({ agentId: 'r2', liveStatus: 'idle', teamId: 'lead-1', parentId: 'lead-1' }),
    ];
    setupApiMocks(agents);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Health')).toBeInTheDocument();
      expect(screen.getByText(/2 total/)).toBeInTheDocument();
    });
  });

  // ─── Scope behavior ─────────────────────────────────────

  it('global scope only shows active agents (filters out terminated)', async () => {
    const agents = [
      makeAgent({ agentId: 'active-1', role: 'developer', liveStatus: 'running', teamId: 'lead-1', parentId: 'lead-1' }),
      makeAgent({ agentId: 'dead-1', role: 'reviewer', liveStatus: 'terminated', status: 'terminated', teamId: 'lead-1', parentId: 'lead-1' }),
    ];
    // Return all agents from the API; component filters globally
    setupApiMocks(agents);
    renderPage({ scope: 'global' });

    await waitFor(() => {
      expect(screen.getByText('developer')).toBeInTheDocument();
    });

    // Terminated agent should NOT appear in global scope (client-side filter)
    expect(screen.queryByText('reviewer')).not.toBeInTheDocument();
  });

  it('project scope shows all agents including terminated', async () => {
    mockProjectId = 'proj-1';
    const agents = [
      makeAgent({ agentId: 'active-1', role: 'developer', liveStatus: 'running', teamId: 'lead-1', parentId: 'lead-1' }),
      makeAgent({ agentId: 'dead-1', role: 'reviewer', liveStatus: 'terminated', status: 'terminated', teamId: 'lead-1', parentId: 'lead-1' }),
    ];
    setupApiMocks(agents);
    renderPage({ scope: 'project' });

    await waitFor(() => {
      expect(screen.getByText('developer')).toBeInTheDocument();
    });

    // In project scope with "all" filter, terminated agent should appear.
    // Default statusFilter for project is 'active' so switch to 'all' first.
    fireEvent.click(screen.getByRole('button', { name: 'all' }));

    await waitFor(() => {
      expect(screen.getByText('reviewer')).toBeInTheDocument();
    });
  });

  it('Active filter includes idle agents, not just running', async () => {
    mockProjectId = 'proj-1';
    const agents = [
      makeAgent({ agentId: 'lead-1', role: 'lead', liveStatus: 'running', status: 'running', teamId: 'lead-1', parentId: null }),
      makeAgent({ agentId: 'running-1', role: 'developer', liveStatus: 'running', status: 'running', teamId: 'lead-1', parentId: 'lead-1' }),
      makeAgent({ agentId: 'idle-1', role: 'architect', liveStatus: 'idle', status: 'idle', teamId: 'lead-1', parentId: 'lead-1' }),
      makeAgent({ agentId: 'term-1', role: 'reviewer', liveStatus: 'terminated', status: 'terminated', teamId: 'lead-1', parentId: 'lead-1' }),
    ];
    setupApiMocks(agents);
    renderPage({ scope: 'project' });

    // Default filter is 'active' in project scope — should show running + idle
    await waitFor(() => {
      expect(screen.getByText('developer')).toBeInTheDocument();
      expect(screen.getByText('architect')).toBeInTheDocument();
    });

    // Terminated agent should NOT appear under 'active' filter
    expect(screen.queryByText('reviewer')).not.toBeInTheDocument();
  });

  it('Active filter uses liveStatus over DB status', async () => {
    mockProjectId = 'proj-1';
    const agents = [
      makeAgent({ agentId: 'lead-1', role: 'lead', liveStatus: 'running', status: 'running', teamId: 'lead-1', parentId: null }),
      // DB says running but live says terminated — should be filtered out
      makeAgent({ agentId: 'stale-1', role: 'developer', liveStatus: 'terminated', status: 'running', teamId: 'lead-1', parentId: 'lead-1' }),
      // DB says terminated but live says idle — should be shown
      makeAgent({ agentId: 'revived-1', role: 'architect', liveStatus: 'idle', status: 'terminated', teamId: 'lead-1', parentId: 'lead-1' }),
    ];
    setupApiMocks(agents);
    renderPage({ scope: 'project' });

    // Default 'active' filter — liveStatus takes precedence
    await waitFor(() => {
      expect(screen.getByText('architect')).toBeInTheDocument();
    });

    // Stale agent with liveStatus=terminated should NOT appear
    expect(screen.queryByText('developer')).not.toBeInTheDocument();
  });

  // ─── Title & header ─────────────────────────────────────

  it('shows "Agents" title in global scope', async () => {
    setupApiMocks([]);
    renderPage({ scope: 'global' });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Agents' })).toBeInTheDocument();
    });
  });

  it('shows "Crew" title in project scope', async () => {
    mockProjectId = 'proj-1';
    setupApiMocks([]);
    renderPage({ scope: 'project' });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Crew' })).toBeInTheDocument();
    });
  });

  // ─── Agent count display ────────────────────────────────

  it('displays correct filtered agent count in header', async () => {
    const agents = [
      makeAgent({ agentId: 'a1', role: 'developer', liveStatus: 'running', teamId: 'lead-1', parentId: 'lead-1' }),
      makeAgent({ agentId: 'a2', role: 'tester', liveStatus: 'running', teamId: 'lead-1', parentId: 'lead-1' }),
      makeAgent({ agentId: 'a3', role: 'designer', liveStatus: 'idle', teamId: 'lead-1', parentId: 'lead-1' }),
    ];
    setupApiMocks(agents);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('3 agents')).toBeInTheDocument();
    });
  });
});
