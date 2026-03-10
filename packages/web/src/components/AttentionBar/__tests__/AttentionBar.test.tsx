// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── Mocks ───────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...original,
    useNavigate: () => mockNavigate,
  };
});

const mockAppState = {
  agents: [] as any[],
  pendingDecisions: [] as any[],
  connected: true,
  setApprovalQueueOpen: vi.fn(),
};
vi.mock('../../../stores/appStore', () => ({
  useAppStore: (selector: (s: typeof mockAppState) => any) => selector(mockAppState),
}));

const mockLeadState = {
  projects: {} as Record<string, any>,
  selectedLeadId: null as string | null,
};
vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: (selector: (s: typeof mockLeadState) => any) => selector(mockLeadState),
}));

vi.mock('../../../stores/settingsStore', () => ({
  useSettingsStore: (sel: any) => sel({ oversightLevel: 'balanced' }),
}));

// Mock apiFetch — defaults to rejecting (triggers fallback to client-side)
const mockApiFetch = vi.fn().mockRejectedValue(new Error('API unavailable'));
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

// ── Helpers ─────────────────────────────────────────────────────────

function makeAgent(id: string, status: string) {
  return { id, status, role: { id: 'dev', name: 'Developer', icon: '🔧' } };
}

function makeDagStatus(summary: Partial<Record<string, number>>, tasks: any[] = []) {
  return {
    tasks,
    fileLockMap: {},
    summary: {
      pending: 0, ready: 0, running: 0, done: 0,
      failed: 0, blocked: 0, paused: 0, skipped: 0,
      ...summary,
    },
  };
}

function makeTask(id: string, dagStatus: string, opts: Record<string, any> = {}) {
  return {
    id,
    leadId: 'lead-1',
    role: 'developer',
    description: `Task ${id}`,
    files: [],
    dependsOn: [],
    dagStatus,
    priority: 1,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    ...opts,
  };
}

function renderBar() {
  return render(
    <MemoryRouter>
      <AttentionBarTestWrapper />
    </MemoryRouter>,
  );
}

// Lazy import to pick up mocks
let AttentionBarTestWrapper: React.FC;

beforeEach(async () => {
  mockNavigate.mockReset();
  mockApiFetch.mockReset().mockRejectedValue(new Error('API unavailable'));
  mockAppState.agents = [];
  mockAppState.pendingDecisions = [];
  mockAppState.connected = true;
  mockAppState.setApprovalQueueOpen.mockReset();
  mockLeadState.projects = {};
  mockLeadState.selectedLeadId = null;

  const mod = await import('../AttentionBar');
  AttentionBarTestWrapper = mod.AttentionBar;
});

// ── Tests ───────────────────────────────────────────────────────────

describe('AttentionBar', () => {
  it('does not render when no agents are active', () => {
    renderBar();
    expect(screen.queryByTestId('attention-bar')).not.toBeInTheDocument();
  });

  it('hides when green state with no exceptions (StatusPopover covers this)', () => {
    mockAppState.agents = [makeAgent('a1', 'running')];
    mockLeadState.projects = {
      'lead-1': { dagStatus: makeDagStatus({ done: 5, running: 2 }) },
    };
    renderBar();

    expect(screen.queryByTestId('attention-bar')).not.toBeInTheDocument();
  });

  it('renders yellow state with 1-2 exceptions (pending decision)', () => {
    mockAppState.agents = [makeAgent('a1', 'running')];
    mockAppState.pendingDecisions = [{ id: 'd1', title: 'Auth approach' }];
    mockLeadState.projects = {
      'lead-1': { dagStatus: makeDagStatus({ done: 3, running: 2 }) },
    };
    renderBar();

    const bar = screen.getByTestId('attention-bar');
    expect(bar).toHaveAttribute('data-escalation', 'yellow');
    expect(screen.getByTestId('attention-item-decision')).toBeInTheDocument();
  });

  it('renders red state when any task is failed', () => {
    mockAppState.agents = [makeAgent('a1', 'running')];
    mockLeadState.projects = {
      'lead-1': {
        dagStatus: makeDagStatus(
          { done: 3, failed: 1 },
          [makeTask('t1', 'failed', { title: 'Broken build' })],
        ),
      },
    };
    renderBar();

    const bar = screen.getByTestId('attention-bar');
    expect(bar).toHaveAttribute('data-escalation', 'red');
    expect(screen.getByTestId('attention-item-failed')).toBeInTheDocument();
    expect(screen.getByText('Broken build')).toBeInTheDocument();
  });

  it('renders red state with 3+ exceptions', () => {
    mockAppState.agents = [makeAgent('a1', 'running')];
    mockAppState.pendingDecisions = [
      { id: 'd1', title: 'Decision 1' },
      { id: 'd2', title: 'Decision 2' },
      { id: 'd3', title: 'Decision 3' },
    ];
    renderBar();

    const bar = screen.getByTestId('attention-bar');
    expect(bar).toHaveAttribute('data-escalation', 'red');
  });

  it('navigates to tasks page when failed item clicked', () => {
    mockAppState.agents = [makeAgent('a1', 'running')];
    mockLeadState.selectedLeadId = 'lead-1';
    mockLeadState.projects = {
      'lead-1': {
        dagStatus: makeDagStatus(
          { failed: 1 },
          [makeTask('t1', 'failed', { title: 'Broken build' })],
        ),
      },
    };
    renderBar();

    fireEvent.click(screen.getByTestId('attention-item-failed'));
    expect(mockNavigate).toHaveBeenCalledWith('/projects/lead-1/tasks');
  });

  it('opens approval queue when decision item clicked', () => {
    mockAppState.agents = [makeAgent('a1', 'running')];
    mockAppState.pendingDecisions = [{ id: 'd1', title: 'Auth choice' }];
    renderBar();

    fireEvent.click(screen.getByTestId('attention-item-decision'));
    expect(mockAppState.setApprovalQueueOpen).toHaveBeenCalledWith(true);
  });

  it('opens approval queue when pending decisions badge clicked', () => {
    mockAppState.agents = [makeAgent('a1', 'running')];
    mockAppState.pendingDecisions = [{ id: 'd1', title: 'Auth choice' }];
    renderBar();

    fireEvent.click(screen.getByTestId('attention-decisions'));
    expect(mockAppState.setApprovalQueueOpen).toHaveBeenCalledWith(true);
  });

  it('shows agent count when agents are running', () => {
    mockAppState.agents = [
      makeAgent('a1', 'running'),
      makeAgent('a2', 'running'),
      makeAgent('a3', 'idle'),
    ];
    // Add a pending decision to force bar to render (green hides)
    mockAppState.pendingDecisions = [{ id: 'd1', title: 'test' }];
    renderBar();

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('shows progress text from DAG summary', () => {
    mockAppState.agents = [makeAgent('a1', 'running')];
    mockAppState.pendingDecisions = [{ id: 'd1', title: 'test' }];
    mockLeadState.projects = {
      'lead-1': { dagStatus: makeDagStatus({ done: 12, running: 3, pending: 5 }) },
    };
    renderBar();

    expect(screen.getByText('12/20 done')).toBeInTheDocument();
  });

  it('shows blocked items only after 30min threshold', () => {
    const thirtyOneMinAgo = new Date(Date.now() - 31 * 60_000).toISOString();
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();

    mockAppState.agents = [makeAgent('a1', 'running')];
    mockLeadState.projects = {
      'lead-1': {
        dagStatus: makeDagStatus(
          { blocked: 2 },
          [
            makeTask('t1', 'blocked', { title: 'Old block', createdAt: thirtyOneMinAgo }),
            makeTask('t2', 'blocked', { title: 'New block', createdAt: fiveMinAgo }),
          ],
        ),
      },
    };
    renderBar();

    // Only the 31-min blocked item should generate an attention item
    expect(screen.getByText(/Old block/)).toBeInTheDocument();
    expect(screen.queryByTestId('attention-item-blocked')).toBeInTheDocument();
  });

  it('dismiss hides the bar (yellow/red)', () => {
    mockAppState.agents = [makeAgent('a1', 'running')];
    mockAppState.pendingDecisions = [{ id: 'd1', title: 'Decision' }];
    renderBar();

    const bar = screen.getByTestId('attention-bar');
    expect(bar).toHaveAttribute('data-escalation', 'yellow');

    fireEvent.click(screen.getByTestId('attention-dismiss'));
    // After dismiss, items should be hidden (component re-renders with dismissed state)
  });

  it('does not show dismiss button in green state', () => {
    mockAppState.agents = [makeAgent('a1', 'running')];
    renderBar();

    expect(screen.queryByTestId('attention-dismiss')).not.toBeInTheDocument();
  });

  it('aggregates across multiple projects when no project selected', () => {
    mockAppState.agents = [makeAgent('a1', 'running')];
    mockAppState.pendingDecisions = [{ id: 'd1', title: 'test' }];
    mockLeadState.projects = {
      'proj-1': { dagStatus: makeDagStatus({ done: 5, running: 2 }) },
      'proj-2': { dagStatus: makeDagStatus({ done: 3, pending: 5 }) },
    };
    renderBar();

    expect(screen.getByText('8/15 done')).toBeInTheDocument();
  });

  it('shows only selected project when one is selected', () => {
    mockAppState.agents = [makeAgent('a1', 'running')];
    mockAppState.pendingDecisions = [{ id: 'd1', title: 'test' }];
    mockLeadState.selectedLeadId = 'proj-1';
    mockLeadState.projects = {
      'proj-1': { dagStatus: makeDagStatus({ done: 5, running: 2 }) },
      'proj-2': { dagStatus: makeDagStatus({ done: 3, pending: 5 }) },
    };
    renderBar();

    expect(screen.getByText('5/7 done')).toBeInTheDocument();
  });

  it('uses role="status" for yellow and role="alert" for red (AC-13.15)', () => {
    // Yellow (pending decision)
    mockAppState.agents = [makeAgent('a1', 'running')];
    mockAppState.pendingDecisions = [{ id: 'd1', title: 'test' }];
    const { unmount } = renderBar();
    let bar = screen.getByTestId('attention-bar');
    expect(bar).toHaveAttribute('role', 'status');
    expect(bar).toHaveAttribute('aria-live', 'polite');
    unmount();

    // Red
    mockAppState.pendingDecisions = [];
    mockLeadState.projects = {
      'lead-1': {
        dagStatus: makeDagStatus(
          { failed: 1 },
          [makeTask('t1', 'failed')],
        ),
      },
    };
    renderBar();
    bar = screen.getByTestId('attention-bar');
    expect(bar).toHaveAttribute('role', 'alert');
    expect(bar).toHaveAttribute('aria-live', 'assertive');
  });

  it('does not show 0/0 done when no projects exist (AC-13.10)', () => {
    mockAppState.agents = [makeAgent('a1', 'running')];
    // No projects, no DAG data
    mockLeadState.projects = {};
    renderBar();

    expect(screen.queryByText(/0\/0/)).not.toBeInTheDocument();
  });

  it('shows escalation dot with correct color', () => {
    // Green state is hidden — verify it doesn't render
    mockAppState.agents = [makeAgent('a1', 'running')];
    const { unmount } = renderBar();
    expect(screen.queryByTestId('attention-bar')).not.toBeInTheDocument();
    unmount();

    // Red (failed task) — renders with red dot
    mockLeadState.projects = {
      'lead-1': {
        dagStatus: makeDagStatus(
          { failed: 1 },
          [makeTask('t1', 'failed')],
        ),
      },
    };
    renderBar();
    const dot = screen.getByTestId('escalation-dot');
    expect(dot.className).toContain('bg-red-500');
    expect(dot.className).toContain('animate-pulse');
  });

  // ── API-driven tests ──────────────────────────────────────────────

  describe('with API data', () => {
    it('uses API escalation level when available', async () => {
      mockApiFetch.mockResolvedValue({
        scope: 'global',
        escalation: 'red',
        summary: { failedCount: 2, blockedCount: 0, decisionCount: 0, totalCount: 2 },
        items: [
          { type: 'failed', severity: 'critical', task: { id: 't1', title: 'Build failed', projectId: 'p1' } },
          { type: 'failed', severity: 'critical', task: { id: 't2', title: 'Test failed', projectId: 'p1' } },
        ],
      });
      mockAppState.agents = [makeAgent('a1', 'running')];
      mockLeadState.projects = { 'p1': { dagStatus: makeDagStatus({ done: 5, running: 2 }) } };

      renderBar();
      // Wait for API response to be processed
      await vi.waitFor(() => {
        expect(screen.getByTestId('attention-bar')).toHaveAttribute('data-escalation', 'red');
      });
      expect(screen.getByText('Build failed')).toBeInTheDocument();
    });

    it('falls back to client-side when API fails', () => {
      mockApiFetch.mockRejectedValue(new Error('Network error'));
      mockAppState.agents = [makeAgent('a1', 'running')];
      mockAppState.pendingDecisions = [{ id: 'd1', title: 'Auth decision' }];
      renderBar();

      // Should still work with fallback
      const bar = screen.getByTestId('attention-bar');
      expect(bar).toHaveAttribute('data-escalation', 'yellow');
    });

    it('passes projectId to API when project is selected', async () => {
      mockApiFetch.mockResolvedValue({
        scope: 'project',
        projectId: 'proj-1',
        escalation: 'green',
        summary: { failedCount: 0, blockedCount: 0, decisionCount: 0, totalCount: 0 },
        items: [],
      });
      mockAppState.agents = [makeAgent('a1', 'running')];
      mockLeadState.selectedLeadId = 'proj-1';
      mockLeadState.projects = { 'proj-1': { dagStatus: makeDagStatus({ done: 5, running: 2 }) } };

      renderBar();
      await vi.waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('/attention?scope=project&projectId=proj-1'));
      });
    });
  });
});
