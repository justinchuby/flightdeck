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

vi.mock('../../../utils/getRoleIcon', () => ({ getRoleIcon: () => '🤖' }));
vi.mock('../../../utils/statusColors', () => ({ sessionStatusDot: () => 'bg-green-400' }));
vi.mock('../../../utils/formatRelativeTime', () => ({ formatRelativeTime: () => '5m ago' }));
vi.mock('../../../utils/format', () => ({ formatTokens: (n: number | null) => (n != null ? `${n}` : '0') }));
vi.mock('../../../utils/agentLabel', () => ({ shortAgentId: (id: string) => id.slice(0, 8) }));

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

interface SessionDetail {
  id: string;
  leadId: string;
  status: string;
  task: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  taskSummary: { total: number; done: number; failed: number };
  hasRetro: boolean;
}

function setupApiMocks(
  agents: RosterAgent[],
  summaries: CrewSummary[] = [],
  sessions: SessionDetail[] = [],
) {
  const crewIds = [...new Set(agents.map(a => a.teamId))];
  mockApiFetch.mockImplementation((path: string, opts?: { method?: string }) => {
    if (opts?.method === 'DELETE') return Promise.resolve({});
    if (path.includes('/sessions/detail')) return Promise.resolve(sessions);
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

describe('UnifiedCrewPage – extra coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectId = null;
    setupApiMocks([]);
  });

  // ─── Crew Deletion ───────────────────────────────────────

  describe('Crew deletion', () => {
    function terminatedCrew() {
      return [
        makeAgent({ agentId: 'lead-1', role: 'lead', teamId: 'lead-1', parentId: null, status: 'terminated', liveStatus: 'terminated' }),
        makeAgent({ agentId: 'w-1', role: 'developer', teamId: 'lead-1', parentId: 'lead-1', status: 'terminated', liveStatus: 'terminated' }),
      ];
    }

    it('shows trash icon when crew has no active agents', async () => {
      mockProjectId = 'proj-1';
      setupApiMocks(terminatedCrew());
      renderPage({ scope: 'project' });

      await waitFor(() => {
        expect(screen.getByTitle('Delete crew')).toBeInTheDocument();
      });
    });

    it('hides trash icon when crew has active agents', async () => {
      mockProjectId = 'proj-1';
      setupApiMocks([
        makeAgent({ agentId: 'lead-1', role: 'lead', teamId: 'lead-1', parentId: null, status: 'running', liveStatus: 'running' }),
      ]);
      renderPage({ scope: 'project' });

      await waitFor(() => {
        expect(screen.getByText('lead')).toBeInTheDocument();
      });
      expect(screen.queryByTitle('Delete crew')).not.toBeInTheDocument();
    });

    it('clicking trash shows confirmation with agent count', async () => {
      mockProjectId = 'proj-1';
      setupApiMocks(terminatedCrew());
      renderPage({ scope: 'project' });

      await waitFor(() => {
        expect(screen.getByTitle('Delete crew')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle('Delete crew'));

      await waitFor(() => {
        expect(screen.getByText(/This cannot be undone/)).toBeInTheDocument();
        expect(screen.getByText(/all 2 agents/)).toBeInTheDocument();
      });
    });

    it('confirming deletion calls API and shows toast', async () => {
      mockProjectId = 'proj-1';
      setupApiMocks(terminatedCrew());
      renderPage({ scope: 'project' });

      await waitFor(() => {
        expect(screen.getByTitle('Delete crew')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle('Delete crew'));
      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith('/crews/lead-1', { method: 'DELETE' });
        expect(mockAddToast).toHaveBeenCalledWith('success', 'Crew deleted');
      });
    });

    it('cancel dismisses confirmation', async () => {
      mockProjectId = 'proj-1';
      setupApiMocks(terminatedCrew());
      renderPage({ scope: 'project' });

      await waitFor(() => {
        expect(screen.getByTitle('Delete crew')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle('Delete crew'));
      await waitFor(() => {
        expect(screen.getByText(/This cannot be undone/)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Cancel'));

      await waitFor(() => {
        expect(screen.queryByText(/This cannot be undone/)).not.toBeInTheDocument();
      });
    });

    it('unassigned crew deletion removes agents individually', async () => {
      mockProjectId = 'proj-1';
      setupApiMocks([
        makeAgent({ agentId: 'orphan-1', role: 'developer', teamId: 'unassigned', parentId: null, status: 'terminated', liveStatus: 'terminated' }),
        makeAgent({ agentId: 'orphan-2', role: 'tester', teamId: 'unassigned', parentId: null, status: 'terminated', liveStatus: 'terminated' }),
      ]);
      renderPage({ scope: 'project' });

      await waitFor(() => {
        expect(screen.getByTitle('Delete crew')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle('Delete crew'));
      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith('/roster/orphan-1', { method: 'DELETE' });
        expect(mockApiFetch).toHaveBeenCalledWith('/roster/orphan-2', { method: 'DELETE' });
        expect(mockAddToast).toHaveBeenCalledWith('success', 'Removed 2 unassigned agent(s)');
      });
    });
  });

  // ─── Agent Removal ───────────────────────────────────────

  describe('Agent removal', () => {
    // Active lead + terminated worker: crew renders; worker has remove button.
    function mixedCrew() {
      return [
        makeAgent({ agentId: 'lead-1', role: 'lead', teamId: 'lead-1', parentId: null, status: 'running', liveStatus: 'running' }),
        makeAgent({ agentId: 'dead-1', role: 'developer', teamId: 'lead-1', parentId: 'lead-1', status: 'terminated', liveStatus: 'terminated' }),
      ];
    }

    async function renderWithAllFilter() {
      mockProjectId = 'proj-1';
      setupApiMocks(mixedCrew());
      renderPage({ scope: 'project' });
      // Switch to 'all' so the terminated agent is visible
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'all' })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: 'all' }));
      await waitFor(() => {
        expect(screen.getByText('developer')).toBeInTheDocument();
      });
    }

    it('shows remove button for terminated agent without children', async () => {
      await renderWithAllFilter();
      expect(screen.getByTitle('Remove agent from roster')).toBeInTheDocument();
    });

    it('first click enters confirmation state', async () => {
      await renderWithAllFilter();

      fireEvent.click(screen.getByTitle('Remove agent from roster'));

      await waitFor(() => {
        expect(screen.getByTitle('Confirm removal')).toBeInTheDocument();
        // Cancel button also appears
        expect(screen.getByTitle('Cancel')).toBeInTheDocument();
      });
    });

    it('second click removes agent via API and shows toast', async () => {
      await renderWithAllFilter();

      fireEvent.click(screen.getByTitle('Remove agent from roster'));
      await waitFor(() => {
        expect(screen.getByTitle('Confirm removal')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle('Confirm removal'));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith('/roster/dead-1', { method: 'DELETE' });
        expect(mockAddToast).toHaveBeenCalledWith('success', 'Agent removed from roster');
      });
    });

    it('cancel button resets confirmation state', async () => {
      await renderWithAllFilter();

      fireEvent.click(screen.getByTitle('Remove agent from roster'));
      await waitFor(() => {
        expect(screen.getByTitle('Cancel')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle('Cancel'));

      await waitFor(() => {
        expect(screen.queryByTitle('Confirm removal')).not.toBeInTheDocument();
        expect(screen.getByTitle('Remove agent from roster')).toBeInTheDocument();
      });
    });

    it('lead with children shows badge instead of remove button', async () => {
      mockProjectId = 'proj-1';
      setupApiMocks([
        makeAgent({ agentId: 'lead-1', role: 'lead', teamId: 'lead-1', parentId: null, status: 'terminated', liveStatus: 'terminated' }),
        makeAgent({ agentId: 'child-1', role: 'developer', teamId: 'lead-1', parentId: 'lead-1', status: 'terminated', liveStatus: 'terminated' }),
      ]);
      renderPage({ scope: 'project' });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'all' })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: 'all' }));

      await waitFor(() => {
        expect(screen.getByText('Lead with children')).toBeInTheDocument();
      });
    });

    it('removing selected agent deselects it', async () => {
      await renderWithAllFilter();

      // Select the terminated agent
      const agentRow = screen.getByRole('button', { name: /developer/i });
      fireEvent.click(agentRow);
      await waitFor(() => {
        expect(screen.getByTestId('agent-detail-panel')).toBeInTheDocument();
        expect(screen.getByTestId('agent-detail-panel').dataset.agentId).toBe('dead-1');
      });

      // Two-click removal
      fireEvent.click(screen.getByTitle('Remove agent from roster'));
      await waitFor(() => {
        expect(screen.getByTitle('Confirm removal')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTitle('Confirm removal'));

      await waitFor(() => {
        expect(screen.queryByTestId('agent-detail-panel')).not.toBeInTheDocument();
      });
    });
  });

  // ─── Status filter switching ─────────────────────────────

  describe('Status filter switching', () => {
    function multiStatusCrew() {
      return [
        makeAgent({ agentId: 'r1', role: 'runner', status: 'running', liveStatus: 'running', teamId: 'lead-1', parentId: 'lead-1' }),
        makeAgent({ agentId: 'i1', role: 'idler', status: 'idle', liveStatus: 'idle', teamId: 'lead-1', parentId: 'lead-1' }),
        makeAgent({ agentId: 't1', role: 'stopper', status: 'terminated', liveStatus: 'terminated', teamId: 'lead-1', parentId: 'lead-1' }),
        makeAgent({ agentId: 'f1', role: 'crasher', status: 'failed', liveStatus: 'failed', teamId: 'lead-1', parentId: 'lead-1' }),
      ];
    }

    it('running filter shows only running agents', async () => {
      mockProjectId = 'proj-1';
      setupApiMocks(multiStatusCrew());
      renderPage({ scope: 'project' });

      await waitFor(() => {
        expect(screen.getByText('runner')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'running' }));

      await waitFor(() => {
        expect(screen.getByText('runner')).toBeInTheDocument();
        expect(screen.queryByText('idler')).not.toBeInTheDocument();
        expect(screen.queryByText('stopper')).not.toBeInTheDocument();
        expect(screen.queryByText('crasher')).not.toBeInTheDocument();
      });
    });

    it('terminated filter shows only terminated agents', async () => {
      mockProjectId = 'proj-1';
      setupApiMocks(multiStatusCrew());
      renderPage({ scope: 'project' });

      await waitFor(() => {
        expect(screen.getByText('runner')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'terminated' }));

      await waitFor(() => {
        expect(screen.getByText('stopper')).toBeInTheDocument();
        expect(screen.queryByText('runner')).not.toBeInTheDocument();
        expect(screen.queryByText('idler')).not.toBeInTheDocument();
        expect(screen.queryByText('crasher')).not.toBeInTheDocument();
      });
    });

    it('shows "hidden by filter" when all agents are filtered out', async () => {
      mockProjectId = 'proj-1';
      setupApiMocks([
        makeAgent({ agentId: 'r1', role: 'runner', status: 'running', liveStatus: 'running', teamId: 'lead-1', parentId: 'lead-1' }),
        makeAgent({ agentId: 'r2', role: 'sprinter', status: 'running', liveStatus: 'running', teamId: 'lead-1', parentId: 'lead-1' }),
      ]);
      renderPage({ scope: 'project' });

      await waitFor(() => {
        expect(screen.getByText('runner')).toBeInTheDocument();
      });

      // No terminated agents exist → all filtered out
      fireEvent.click(screen.getByRole('button', { name: 'terminated' }));

      await waitFor(() => {
        expect(screen.getByText(/2 agents hidden by filter/)).toBeInTheDocument();
      });
    });
  });

  // ─── All-terminated banner ───────────────────────────────

  describe('All-terminated banner', () => {
    it('shows banner when all agents are terminated', async () => {
      mockProjectId = 'proj-1';
      setupApiMocks([
        makeAgent({ agentId: 'a1', role: 'developer', status: 'terminated', liveStatus: 'terminated', teamId: 'lead-1', parentId: 'lead-1' }),
        makeAgent({ agentId: 'a2', role: 'tester', status: 'terminated', liveStatus: 'terminated', teamId: 'lead-1', parentId: 'lead-1' }),
      ]);
      renderPage({ scope: 'project' });

      await waitFor(() => {
        expect(screen.getByText('All agents from previous sessions are shown below.')).toBeInTheDocument();
      });
    });
  });

  // ─── Agent row details ──────────────────────────────────

  describe('Agent row details', () => {
    it('shows input and output tokens', async () => {
      setupApiMocks([
        makeAgent({ agentId: 'tok-1', role: 'developer', inputTokens: 15000, outputTokens: 8000 }),
      ]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('↓15000')).toBeInTheDocument();
        expect(screen.getByText('↑8000')).toBeInTheDocument();
      });
    });

    it('shows task with emoji prefix', async () => {
      setupApiMocks([
        makeAgent({ agentId: 'task-1', role: 'developer', task: 'Implement login flow' }),
      ]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/📋 Implement login flow/)).toBeInTheDocument();
      });
    });

    it('shows last line of output preview', async () => {
      setupApiMocks([
        makeAgent({
          agentId: 'out-1',
          role: 'developer',
          outputPreview: 'line one\nline two\nfinal output line',
        }),
      ]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('final output line')).toBeInTheDocument();
      });
    });

    it('shows red context window when usage > 85%', async () => {
      setupApiMocks([
        makeAgent({
          agentId: 'ctx-red',
          role: 'developer',
          inputTokens: 1000,
          outputTokens: 500,
          contextWindowSize: 100000,
          contextWindowUsed: 90000, // 90%
        }),
      ]);
      renderPage();

      await waitFor(() => {
        const el = screen.getByText('ctx 90%');
        expect(el).toBeInTheDocument();
        expect(el.className).toContain('text-red-400');
      });
    });

    it('shows yellow context window when usage > 60%', async () => {
      setupApiMocks([
        makeAgent({
          agentId: 'ctx-yellow',
          role: 'developer',
          inputTokens: 1000,
          outputTokens: 500,
          contextWindowSize: 100000,
          contextWindowUsed: 70000, // 70%
        }),
      ]);
      renderPage();

      await waitFor(() => {
        const el = screen.getByText('ctx 70%');
        expect(el).toBeInTheDocument();
        expect(el.className).toContain('text-yellow-400');
      });
    });

    it('shows lastTaskSummary text in agent row', async () => {
      setupApiMocks([
        makeAgent({ agentId: 'sum-1', role: 'developer', lastTaskSummary: 'Fixing auth module' }),
      ]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Fixing auth module')).toBeInTheDocument();
      });
    });
  });

  // ─── Keyboard navigation ─────────────────────────────────

  describe('Keyboard navigation', () => {
    it('Enter key selects agent', async () => {
      setupApiMocks([
        makeAgent({ agentId: 'kb-enter', role: 'developer' }),
      ]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('developer')).toBeInTheDocument();
      });

      const agentRow = screen.getByRole('button', { name: /developer/i });
      fireEvent.keyDown(agentRow, { key: 'Enter' });

      await waitFor(() => {
        expect(screen.getByTestId('agent-detail-panel')).toBeInTheDocument();
        expect(screen.getByTestId('agent-detail-panel').dataset.agentId).toBe('kb-enter');
      });
    });

    it('Space key selects agent', async () => {
      setupApiMocks([
        makeAgent({ agentId: 'kb-space', role: 'designer' }),
      ]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('designer')).toBeInTheDocument();
      });

      const agentRow = screen.getByRole('button', { name: /designer/i });
      fireEvent.keyDown(agentRow, { key: ' ' });

      await waitFor(() => {
        expect(screen.getByTestId('agent-detail-panel')).toBeInTheDocument();
        expect(screen.getByTestId('agent-detail-panel').dataset.agentId).toBe('kb-space');
      });
    });
  });

  // ─── Search by lastTaskSummary ───────────────────────────

  describe('Search', () => {
    it('filters agents by lastTaskSummary', async () => {
      mockProjectId = 'proj-1';
      setupApiMocks([
        makeAgent({ agentId: 'a1', role: 'developer', teamId: 'lead-1', parentId: 'lead-1', lastTaskSummary: 'fixing auth bug' }),
        makeAgent({ agentId: 'a2', role: 'tester', teamId: 'lead-1', parentId: 'lead-1', lastTaskSummary: 'writing unit tests' }),
      ]);
      renderPage({ scope: 'project' });

      await waitFor(() => {
        expect(screen.getByText('developer')).toBeInTheDocument();
        expect(screen.getByText('tester')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText('Search agents...');
      fireEvent.change(input, { target: { value: 'auth bug' } });

      await waitFor(() => {
        expect(screen.getByText('developer')).toBeInTheDocument();
        expect(screen.queryByText('tester')).not.toBeInTheDocument();
      });
    });
  });

  // ─── Crew sessions ──────────────────────────────────────

  describe('Crew sessions', () => {
    it('loads and displays session details when crew has projectId', async () => {
      const agents = [
        makeAgent({ agentId: 'lead-1', role: 'lead', teamId: 'lead-1', parentId: null }),
      ];
      const summaries = [
        makeSummary({ leadId: 'lead-1', projectId: 'proj-123', projectName: 'My Project', activeAgentCount: 1 }),
      ];
      const sessions: SessionDetail[] = [{
        id: 'sess-1',
        leadId: 'lead-1',
        status: 'running',
        task: 'Build the widget',
        startedAt: '2024-01-01T00:00:00Z',
        endedAt: null,
        durationMs: 3600000,
        taskSummary: { total: 5, done: 3, failed: 1 },
        hasRetro: false,
      }];
      setupApiMocks(agents, summaries, sessions);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Sessions')).toBeInTheDocument();
        expect(screen.getByText('Build the widget')).toBeInTheDocument();
      });
      // Duration: formatDuration(3600000) → "1h 0m"
      expect(screen.getByText('1h 0m')).toBeInTheDocument();
      // Task summary: 3/5 tasks · 1 failed
      expect(screen.getByText(/3\/5 tasks/)).toBeInTheDocument();
      expect(screen.getByText(/1 failed/)).toBeInTheDocument();
    });
  });

  // ─── Copy session ID ─────────────────────────────────────

  describe('Session ID copy', () => {
    it('clicking session ID button copies to clipboard', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        writable: true,
        configurable: true,
      });

      setupApiMocks([
        makeAgent({ agentId: 'copy-1', role: 'developer', sessionId: 'sess-abc-123' }),
      ]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('sess-abc-123')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('sess-abc-123'));

      expect(writeText).toHaveBeenCalledWith('sess-abc-123');
    });
  });
});
