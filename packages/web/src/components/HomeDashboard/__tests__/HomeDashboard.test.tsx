/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock apiFetch
const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

// Mock navigation
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...original,
    useNavigate: () => mockNavigate,
  };
});

// Mock useAttentionItems (shared hook from AttentionBar)
const mockAttentionState = {
  items: [],
  escalation: 'green' as const,
  progressText: '',
  agentCount: 0,
  runningCount: 0,
  failedTaskCount: 0,
  pendingDecisionCount: 0,
};
vi.mock('../../AttentionBar', () => ({
  useAttentionItems: () => mockAttentionState,
}));

// Mock appStore
const mockAppState = {
  agents: [] as any[],
  connected: true,
  pendingDecisions: [] as any[],
};
vi.mock('../../../stores/appStore', () => ({
  useAppStore: vi.fn((selector: any) => selector(mockAppState)),
}));

import { HomeDashboard } from '../HomeDashboard';

// ── Test Data ───────────────────────────────────────────────────────

const sampleProjects = [
  {
    id: 'proj-1',
    name: 'Alpha Project',
    description: 'Frontend redesign',
    cwd: '/home/user/alpha',
    status: 'active',
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-03-08T04:00:00Z',
    activeAgentCount: 3,
    storageMode: 'user' as const,
    activeLeadId: 'lead-1',
    sessions: [
      { id: 1, projectId: 'proj-1', leadId: 'lead-1', status: 'active', startedAt: '2026-03-08T03:00:00Z', endedAt: null, task: 'Build feature' },
    ],
  },
  {
    id: 'proj-2',
    name: 'Beta Project',
    description: 'API migration',
    cwd: '/home/user/beta',
    status: 'active',
    createdAt: '2026-02-01T08:00:00Z',
    updatedAt: '2026-03-07T12:00:00Z',
    activeAgentCount: 0,
    storageMode: 'local' as const,
    sessions: [],
  },
];

const sampleAgents = [
  { id: 'agent-1', role: { id: 'lead', name: 'Project Lead' }, status: 'running', projectId: 'proj-1', projectName: 'Alpha Project', task: 'Coordinate team' },
  { id: 'agent-2', role: { id: 'developer', name: 'Developer' }, status: 'running', projectId: 'proj-1', task: 'Implement auth module' },
  { id: 'agent-3', role: { id: 'developer', name: 'Developer' }, status: 'running', projectId: 'proj-1', task: 'Write tests' },
];

const sampleDecisions = [
  {
    id: 'dec-1',
    agentId: 'agent-2',
    agentRole: 'Developer',
    leadId: 'agent-1',
    projectId: 'proj-1',
    title: 'Add lodash dependency',
    rationale: 'Needed for utility functions',
    needsConfirmation: true,
    status: 'recorded',
    autoApproved: false,
    confirmedAt: null,
    timestamp: '2026-03-08T05:00:00Z',
    category: 'dependency',
  },
];

const sampleAllDecisions = [
  ...sampleDecisions,
  {
    id: 'dec-2',
    agentId: 'agent-1',
    agentRole: 'Project Lead',
    leadId: null,
    projectId: 'proj-1',
    title: 'Use TypeScript strict mode',
    rationale: 'Better type safety',
    needsConfirmation: false,
    status: 'confirmed',
    autoApproved: true,
    confirmedAt: '2026-03-08T04:30:00Z',
    timestamp: '2026-03-08T04:30:00Z',
    category: 'architecture',
  },
  {
    id: 'dec-3',
    agentId: 'agent-3',
    agentRole: 'Developer',
    leadId: 'agent-1',
    projectId: 'proj-1',
    title: 'Use vitest for testing',
    rationale: 'Faster than jest',
    needsConfirmation: false,
    status: 'confirmed',
    autoApproved: true,
    confirmedAt: '2026-03-08T04:00:00Z',
    timestamp: '2026-03-08T04:00:00Z',
    category: 'testing',
  },
];

const sampleDagStatus = {
  tasks: [],
  fileLockMap: {},
  summary: { pending: 2, ready: 1, running: 3, done: 5, failed: 0, blocked: 0, paused: 0, skipped: 1 },
};

// ── Helpers ─────────────────────────────────────────────────────────

function renderWithRouter(component: React.ReactElement) {
  return render(<MemoryRouter>{component}</MemoryRouter>);
}

function setupDefaultMocks() {
  mockApiFetch.mockImplementation((path: string) => {
    if (path === '/projects') return Promise.resolve(sampleProjects);
    if (path === '/decisions') return Promise.resolve(sampleAllDecisions);
    if (path.includes('/dag')) return Promise.resolve(sampleDagStatus);
    return Promise.resolve([]);
  });
  mockAppState.agents = sampleAgents as any;
  mockAppState.connected = true;
  mockAppState.pendingDecisions = sampleDecisions as any;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('HomeDashboard', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue([]);
    mockAppState.agents = [];
    mockAppState.connected = true;
    mockAppState.pendingDecisions = [];
    // Reset attention mock to default green state
    mockAttentionState.items = [];
    mockAttentionState.escalation = 'green';
    mockAttentionState.progressText = '';
    mockAttentionState.agentCount = 0;
    mockAttentionState.runningCount = 0;
    mockAttentionState.failedTaskCount = 0;
    mockAttentionState.pendingDecisionCount = 0;
  });

  describe('loading state', () => {
    it('shows spinner while loading projects', () => {
      mockApiFetch.mockReturnValue(new Promise(() => {}));
      renderWithRouter(<HomeDashboard />);
      expect(screen.getByTestId('home-loading')).toBeTruthy();
    });
  });

  describe('empty state', () => {
    it('shows welcome message when no projects exist', async () => {
      mockApiFetch.mockResolvedValue([]);
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByTestId('home-empty')).toBeTruthy();
        expect(screen.getByText('Welcome to Flightdeck!')).toBeTruthy();
      });
    });

    it('shows Create Project action button', async () => {
      mockApiFetch.mockResolvedValue([]);
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByText('Create Project')).toBeTruthy();
      });
    });

    it('shows onboarding guide cards', async () => {
      mockApiFetch.mockResolvedValue([]);
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByText('Projects')).toBeTruthy();
        expect(screen.getByText('Crews')).toBeTruthy();
        expect(screen.getByText('Tasks')).toBeTruthy();
      });
    });
  });

  describe('dashboard with projects', () => {
    beforeEach(setupDefaultMocks);

    it('renders the dashboard with header', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByTestId('home-dashboard')).toBeTruthy();
        expect(screen.getByText('Home')).toBeTruthy();
      });
    });

    it('shows compact stat strip with project count and agent count', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        const stats = screen.getByTestId('home-stats');
        expect(stats).toBeTruthy();
        expect(stats.textContent).toContain('2 projects');
        expect(stats.textContent).toContain('3 agents running');
      });
    });

    it('renders project cards for each project', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        const cards = screen.getAllByTestId('project-card');
        expect(cards).toHaveLength(2);
        expect(cards[0].textContent).toContain('Alpha Project');
        expect(cards[1].textContent).toContain('Beta Project');
      });
    });

    it('navigates to project session on card click', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        const cards = screen.getAllByTestId('project-card');
        expect(cards.length).toBeGreaterThan(0);
      });
      const card = screen.getAllByTestId('project-card')[0];
      fireEvent.click(card);
      expect(mockNavigate).toHaveBeenCalledWith('/projects/proj-1/session');
    });

    it('sorts projects with active agents first', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        const cards = screen.getAllByTestId('project-card');
        expect(cards[0].textContent).toContain('Alpha Project');
        expect(cards[1].textContent).toContain('Beta Project');
      });
    });

    it('filters out archived projects', async () => {
      mockApiFetch.mockImplementation((path: string) => {
        if (path === '/projects') return Promise.resolve([
          ...sampleProjects,
          { ...sampleProjects[1], id: 'proj-archived', name: 'Archived One', status: 'archived' },
        ]);
        if (path === '/decisions') return Promise.resolve([]);
        return Promise.resolve([]);
      });
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.queryByText('Archived One')).toBeNull();
      });
    });
  });

  describe('user action required section', () => {
    beforeEach(setupDefaultMocks);

    it('shows action required section when there are pending decisions', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByTestId('action-required-section')).toBeTruthy();
        expect(screen.getByText('User Action Required')).toBeTruthy();
      });
    });

    it('displays pending decision titles', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        const section = screen.getByTestId('action-required-section');
        expect(within(section).getByText('Add lodash dependency')).toBeTruthy();
      });
    });

    it('shows permission requests when agents have pendingPermission', async () => {
      mockAppState.agents = [
        ...sampleAgents,
        {
          id: 'agent-perm',
          role: { id: 'developer', name: 'Developer' },
          status: 'running',
          projectId: 'proj-1',
          createdAt: '2026-03-08T05:00:00Z',
          pendingPermission: {
            id: 'perm-1',
            agentId: 'agent-perm',
            toolName: 'write_file',
            arguments: { path: '/etc/config' },
            timestamp: '2026-03-08T05:30:00Z',
          },
        },
      ] as any;

      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        const items = screen.getAllByTestId('action-required-item');
        // Permission request should be first (most urgent)
        expect(items[0].textContent).toContain('write_file');
      });
    });

    it('navigates to project on action item click', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByTestId('action-required-section')).toBeTruthy();
      });
      const section = screen.getByTestId('action-required-section');
      const item = within(section).getByText('Add lodash dependency');
      fireEvent.click(item);
      expect(mockNavigate).toHaveBeenCalledWith('/projects/proj-1/session');
    });

    it('hides action section when no pending items', async () => {
      mockAppState.pendingDecisions = [];
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByTestId('home-dashboard')).toBeTruthy();
      });
      expect(screen.queryByTestId('action-required-section')).toBeNull();
    });
  });

  describe('active work section', () => {
    beforeEach(setupDefaultMocks);

    it('shows active agents with their tasks', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByTestId('active-work-section')).toBeTruthy();
        expect(screen.getByText('Active Work')).toBeTruthy();
      });
    });

    it('displays agent roles and tasks', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        const rows = screen.getAllByTestId('active-agent-row');
        expect(rows.length).toBe(3);
        expect(screen.getByText('Implement auth module')).toBeTruthy();
        expect(screen.getByText('Write tests')).toBeTruthy();
      });
    });

    it('hides when no active agents', async () => {
      mockAppState.agents = [];
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByTestId('home-dashboard')).toBeTruthy();
      });
      expect(screen.queryByTestId('active-work-section')).toBeNull();
    });

    it('groups agents by project', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        const groups = screen.getAllByTestId('active-work-group');
        expect(groups.length).toBeGreaterThanOrEqual(1);
        // All 3 agents belong to proj-1 (Alpha Project)
        expect(groups[0].textContent).toContain('Alpha Project');
      });
    });
  });

  describe('decisions feed section', () => {
    beforeEach(setupDefaultMocks);

    it('shows recent decisions feed', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByTestId('decisions-feed-section')).toBeTruthy();
        expect(screen.getByText('Recent Decisions')).toBeTruthy();
      });
    });

    it('displays decision titles with status icons', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        const items = screen.getAllByTestId('decision-feed-item');
        expect(items.length).toBe(3); // 3 sample decisions
        expect(screen.getByText('Use TypeScript strict mode')).toBeTruthy();
        expect(screen.getByText('Use vitest for testing')).toBeTruthy();
      });
    });
  });

  describe('progress section', () => {
    beforeEach(setupDefaultMocks);

    it('shows progress bars for projects with DAG tasks', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByTestId('progress-section')).toBeTruthy();
        expect(screen.getByText('Progress')).toBeTruthy();
      });
    });

    it('displays task counts in progress bar', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        const bars = screen.getAllByTestId('progress-bar');
        expect(bars.length).toBeGreaterThan(0);
        // 5 done out of 12 total = 42%
        expect(bars[0].textContent).toContain('5/12');
        expect(bars[0].textContent).toContain('42%');
      });
    });

    it('navigates to project on progress card click', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        const cards = screen.getAllByTestId('progress-card');
        expect(cards.length).toBeGreaterThan(0);
      });
      const card = screen.getAllByTestId('progress-card')[0];
      fireEvent.click(card);
      expect(mockNavigate).toHaveBeenCalledWith('/projects/proj-1/session');
    });

    it('shows failed task count when projects have failures', async () => {
      const dagWithFailures = {
        ...sampleDagStatus,
        summary: { ...sampleDagStatus.summary, failed: 2 },
      };
      mockApiFetch.mockImplementation((path: string) => {
        if (path === '/projects') return Promise.resolve(sampleProjects);
        if (path === '/decisions') return Promise.resolve(sampleAllDecisions);
        if (path.includes('/dag')) return Promise.resolve(dagWithFailures);
        return Promise.resolve([]);
      });
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        const bars = screen.getAllByTestId('progress-bar');
        expect(bars[0].textContent).toContain('2 failed');
      });
    });
  });

  describe('navigation', () => {
    beforeEach(setupDefaultMocks);

    it('navigates to projects page via Manage Projects button', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByText('Manage Projects')).toBeTruthy();
      });
      fireEvent.click(screen.getByText('Manage Projects'));
      expect(mockNavigate).toHaveBeenCalledWith('/projects');
    });
  });

  describe('attention hook integration', () => {
    it('shows failed count in stat strip when attention reports failures', async () => {
      setupDefaultMocks();
      mockAttentionState.failedTaskCount = 3;
      mockAttentionState.escalation = 'red';
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        const stats = screen.getByTestId('home-stats');
        expect(stats.textContent).toContain('3 failed');
      });
    });

    it('does not show failed indicator when no failures', async () => {
      setupDefaultMocks();
      mockAttentionState.failedTaskCount = 0;
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        const stats = screen.getByTestId('home-stats');
        expect(stats.textContent).not.toContain('failed');
      });
    });
  });

  describe('clickable detail modals', () => {
    beforeEach(setupDefaultMocks);

    it('opens DecisionDetailModal when clicking a decision', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByTestId('decisions-feed-section')).toBeTruthy();
      });

      const items = screen.getAllByTestId('decision-feed-item');
      fireEvent.click(items[0]);

      expect(screen.getByTestId('decision-detail-modal')).toBeTruthy();
      expect(screen.getByText('Decision Detail')).toBeTruthy();
      expect(screen.getByText('Rationale')).toBeTruthy();
    });

    it('shows full decision info in the modal', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByTestId('decisions-feed-section')).toBeTruthy();
      });

      // Click the "Use TypeScript strict mode" decision
      const items = screen.getAllByTestId('decision-feed-item');
      fireEvent.click(items[1]); // second decision

      const modal = screen.getByTestId('decision-detail-modal');
      expect(within(modal).getByText('Better type safety')).toBeTruthy(); // rationale
      expect(within(modal).getByText('Architecture')).toBeTruthy(); // category label
      expect(within(modal).getByText('Confirmed')).toBeTruthy(); // status
    });

    it('closes DecisionDetailModal when clicking outside', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByTestId('decisions-feed-section')).toBeTruthy();
      });

      const items = screen.getAllByTestId('decision-feed-item');
      fireEvent.click(items[0]);
      expect(screen.getByTestId('decision-detail-modal')).toBeTruthy();

      // Click the overlay (outside the dialog)
      fireEvent.mouseDown(screen.getByTestId('decision-detail-modal'));
      expect(screen.queryByTestId('decision-detail-modal')).toBeNull();
    });

    it('opens ActivityDetailModal when clicking a progress item', async () => {
      // Setup activity data
      mockApiFetch.mockImplementation((path: string) => {
        if (path === '/projects') return Promise.resolve(sampleProjects);
        if (path === '/decisions') return Promise.resolve(sampleAllDecisions);
        if (path.includes('/dag')) return Promise.resolve(sampleDagStatus);
        if (path.includes('/coordination/activity')) return Promise.resolve([
          { id: 1, agentId: 'agent-1', agentRole: 'lead', actionType: 'progress', summary: 'Implemented auth module', timestamp: '2026-03-08T06:00:00Z', projectId: 'proj-1' },
        ]);
        return Promise.resolve([]);
      });

      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByTestId('activity-feed-section')).toBeTruthy();
      });

      const items = screen.getAllByTestId('activity-feed-item');
      fireEvent.click(items[0]);

      const modal = screen.getByTestId('activity-detail-modal');
      expect(modal).toBeTruthy();
      expect(within(modal).getByText('Activity Detail')).toBeTruthy();
      expect(within(modal).getByText('Implemented auth module')).toBeTruthy();
      expect(within(modal).getByText('Progress Update')).toBeTruthy();
    });

    it('closes ActivityDetailModal when clicking outside', async () => {
      mockApiFetch.mockImplementation((path: string) => {
        if (path === '/projects') return Promise.resolve(sampleProjects);
        if (path === '/decisions') return Promise.resolve(sampleAllDecisions);
        if (path.includes('/dag')) return Promise.resolve(sampleDagStatus);
        if (path.includes('/coordination/activity')) return Promise.resolve([
          { id: 1, agentId: 'agent-1', agentRole: 'lead', actionType: 'progress', summary: 'Done', timestamp: '2026-03-08T06:00:00Z', projectId: 'proj-1' },
        ]);
        return Promise.resolve([]);
      });

      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByTestId('activity-feed-section')).toBeTruthy();
      });

      fireEvent.click(screen.getAllByTestId('activity-feed-item')[0]);
      expect(screen.getByTestId('activity-detail-modal')).toBeTruthy();

      fireEvent.mouseDown(screen.getByTestId('activity-detail-modal'));
      expect(screen.queryByTestId('activity-detail-modal')).toBeNull();
    });
  });
});
