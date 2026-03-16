// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

/* ------------------------------------------------------------------ */
/*  Test data                                                         */
/* ------------------------------------------------------------------ */

const leadId = 'lead-abc123';

let currentMockAgents = [
  {
    id: leadId,
    role: { id: 'lead', name: 'Project Lead', icon: '👑' },
    status: 'running',
    parentId: undefined,
    projectId: 'proj-1',
    projectName: 'My Project',
    childIds: ['agent-1'],
  },
];

const mockDagStatus = {
  tasks: [
    {
      id: 'task-1',
      title: 'Build auth module',
      description: 'Implement JWT auth',
      dagStatus: 'done',
      role: 'developer',
      dependsOn: [],
      createdAt: '2026-01-01 00:00:00',
      startedAt: '2026-01-01 00:01:00',
      completedAt: '2026-01-01 00:10:00',
    },
    {
      id: 'task-2',
      title: 'Write tests',
      description: 'Unit tests for auth',
      dagStatus: 'running',
      role: 'tester',
      dependsOn: ['task-1'],
      createdAt: '2026-01-01 00:00:00',
      startedAt: '2026-01-01 00:11:00',
      completedAt: null,
    },
    {
      id: 'task-3',
      title: 'Deploy to staging',
      description: 'Deploy auth to staging',
      dagStatus: 'pending',
      role: 'devops',
      dependsOn: ['task-2'],
      createdAt: '2026-01-01 00:00:00',
      startedAt: null,
      completedAt: null,
    },
  ],
  fileLockMap: {},
  summary: {
    pending: 1,
    ready: 0,
    running: 1,
    done: 1,
    failed: 0,
    blocked: 0,
    paused: 0,
    skipped: 0,
  },
};

const mockProgress = {
  totalDelegations: 2,
  active: 1,
  completed: 1,
  failed: 0,
  completionPct: 50,
  crewSize: 2,
  crewAgents: [
    {
      id: 'agent-1',
      role: { id: 'developer', name: 'Developer', icon: '💻' },
      status: 'running',
      task: 'Build auth module',
      model: 'gpt-4',
    },
    {
      id: 'agent-2',
      role: { id: 'tester', name: 'Tester', icon: '🧪' },
      status: 'idle',
      task: undefined,
      model: 'gpt-4',
    },
  ],
  delegations: [],
};

/* ------------------------------------------------------------------ */
/*  Mocks                                                             */
/* ------------------------------------------------------------------ */

const mockApiFetch = vi.fn().mockImplementation((url: string) => {
  if (url.includes('/progress')) return Promise.resolve(mockProgress);
  if (url === '/projects') return Promise.resolve([]);
  if (url.includes('/tasks')) return Promise.resolve({ tasks: [], total: 0, hasMore: false, offset: 0, limit: 200 });
  if (url.includes('/resume')) return Promise.resolve({ id: 'new-lead-1' });
  if (url.includes('/dag')) return Promise.resolve(mockDagStatus);
  if (url.includes('/projects/')) return Promise.resolve({ id: 'proj-old', name: 'Old Project', sessions: [] });
  return Promise.resolve({});
});

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockApiContext = {
  fetchDagStatus: vi.fn().mockResolvedValue(mockDagStatus),
};

vi.mock('../../../contexts/ApiContext', () => ({
  useApiContext: () => mockApiContext,
}));

vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ agents: currentMockAgents }),
    { getState: () => ({ agents: currentMockAgents }) },
  ),
}));

let mockLeadProjects: Record<string, any> = {
  [leadId]: { dagStatus: mockDagStatus },
};

vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ projects: mockLeadProjects }),
    {
      getState: () => ({
        projects: mockLeadProjects,
        setDagStatus: vi.fn(),
      }),
    },
  ),
}));

let mockProjectId: string | null = null;
vi.mock('../../../contexts/ProjectContext', () => ({
  useOptionalProjectId: () => mockProjectId,
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

// Mock child visualization components
vi.mock('../../LeadDashboard/TaskDagPanel', () => ({
  TaskDagPanelContent: ({ dagStatus }: any) => (
    <div data-testid="task-dag-panel">
      {dagStatus?.tasks?.length ?? 0} tasks in list
    </div>
  ),
}));

vi.mock('../DagGraph', () => ({
  DagGraph: () => <div data-testid="dag-graph">DAG Graph</div>,
}));

vi.mock('../DagGantt', () => ({
  DagGantt: () => <div data-testid="dag-gantt">DAG Gantt</div>,
}));

vi.mock('../DagResourceView', () => ({
  DagResourceView: () => <div data-testid="dag-resource">DAG Resource</div>,
}));

vi.mock('../KanbanBoard', () => ({
  KanbanBoard: () => <div data-testid="kanban-board">Kanban Board</div>,
}));

vi.mock('../../Shared', () => ({
  EmptyState: ({ title }: { title: string }) => (
    <div data-testid="empty-state">{title}</div>
  ),
}));

/* ------------------------------------------------------------------ */
/*  Import after mocks                                                */
/* ------------------------------------------------------------------ */
import { TaskQueuePanel } from '../TaskQueuePanel';

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockProjectId = null;
  mockLeadProjects = { [leadId]: { dagStatus: mockDagStatus } };
  currentMockAgents = [
    {
      id: leadId,
      role: { id: 'lead', name: 'Project Lead', icon: '👑' },
      status: 'running',
      parentId: undefined,
      projectId: 'proj-1',
      projectName: 'My Project',
      childIds: ['agent-1'],
    },
  ];
  // Restore default mock implementation (clearAllMocks preserves overrides from previous tests)
  mockApiFetch.mockImplementation((url: string) => {
    if (url.includes('/progress')) return Promise.resolve(mockProgress);
    if (url === '/projects') return Promise.resolve([]);
    if (url.includes('/tasks')) return Promise.resolve({ tasks: [], total: 0, hasMore: false, offset: 0, limit: 200 });
    if (url.includes('/resume')) return Promise.resolve({ id: 'new-lead-1' });
    if (url.includes('/dag')) return Promise.resolve(mockDagStatus);
    if (url.includes('/projects/')) return Promise.resolve({ id: 'proj-old', name: 'Old Project', sessions: [] });
    return Promise.resolve({});
  });
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

async function renderAndSettle() {
  const result = render(<TaskQueuePanel />);
  await act(async () => {});
  return result;
}

/** Flush multiple microtask cycles for async state chains (fetch → setState → re-render → fetch...) */
async function settleAsync() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {});
  }
}

describe('TaskQueuePanel – coverage', () => {
  /* ─── Persisted project tabs ─── */
  describe('persisted project tabs', () => {
    it('shows persisted project tabs for non-active projects', async () => {
      mockApiFetch.mockImplementation((url: string) => {
        if (url === '/projects') return Promise.resolve([
          { id: 'proj-old', name: 'Old Project', status: 'stopped', createdAt: '2026-01-01', updatedAt: '2026-01-02' },
        ]);
        if (url.includes('/progress')) return Promise.resolve(mockProgress);
        if (url.includes('/tasks')) return Promise.resolve({ tasks: [], total: 0, hasMore: false, offset: 0, limit: 200 });
        return Promise.resolve({});
      });

      await renderAndSettle();
      // Wait for projects fetch in useEffect
      await act(async () => {});

      expect(screen.getByText('Old Project')).toBeDefined();
    });

    it('does not show archived projects as persisted tabs', async () => {
      currentMockAgents = [];
      mockApiFetch.mockImplementation((url: string) => {
        if (url === '/projects') return Promise.resolve([
          { id: 'proj-archived', name: 'Archived Project', status: 'archived', createdAt: '2026-01-01', updatedAt: '2026-01-02' },
        ]);
        if (url.includes('/tasks')) return Promise.resolve({ tasks: [], total: 0, hasMore: false, offset: 0, limit: 200 });
        return Promise.resolve({});
      });

      await renderAndSettle();
      await act(async () => {});

      expect(screen.queryByText('Archived Project')).toBeNull();
    });

    it('renders persisted project content with resume button when tab selected', async () => {
      currentMockAgents = [];
      mockLeadProjects = {};
      mockApiFetch.mockImplementation((url: string) => {
        if (url === '/projects') return Promise.resolve([
          { id: 'proj-old', name: 'Old Project', status: 'stopped', description: 'A test project', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', cwd: '/test/path' },
        ]);
        if (url.includes('/projects/proj-old/dag')) return Promise.resolve(mockDagStatus);
        if (url.includes('/projects/proj-old')) return Promise.resolve({ id: 'proj-old', name: 'Old Project', description: 'A test project', sessions: [{ id: 's1', task: 'Build the app', status: 'completed', startedAt: '2026-01-01T00:00:00Z' }] });
        if (url.includes('/tasks')) return Promise.resolve({ tasks: [], total: 0, hasMore: false, offset: 0, limit: 200 });
        return Promise.resolve({});
      });

      await renderAndSettle();
      // Multiple settle cycles: fetch /projects → setState → useEffect auto-select → re-render → fetch project details
      await settleAsync();

      // The persisted tab should be auto-selected and content rendered
      expect(screen.getByText('Resume Project')).toBeDefined();
    });

    it('handles resume project click', async () => {
      currentMockAgents = [];
      mockLeadProjects = {};
      mockApiFetch.mockImplementation((url: string) => {
        if (url === '/projects') return Promise.resolve([
          { id: 'proj-old', name: 'Old Project', status: 'stopped', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
        ]);
        if (url.includes('/resume')) return Promise.resolve({ id: 'new-lead-resumed' });
        if (url.includes('/projects/proj-old/dag')) return Promise.resolve({ tasks: [], fileLockMap: {}, summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } });
        if (url.includes('/projects/proj-old')) return Promise.resolve({ id: 'proj-old', name: 'Old Project', sessions: [] });
        if (url.includes('/tasks')) return Promise.resolve({ tasks: [], total: 0, hasMore: false, offset: 0, limit: 200 });
        return Promise.resolve({});
      });

      await renderAndSettle();
      await settleAsync();

      const resumeButton = screen.getByText('Resume Project');
      await act(async () => {
        fireEvent.click(resumeButton);
      });

      expect(mockApiFetch).toHaveBeenCalledWith(
        '/projects/proj-old/resume',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('shows historical DAG and progress for persisted project', async () => {
      currentMockAgents = [];
      mockLeadProjects = {};
      mockApiFetch.mockImplementation((url: string) => {
        if (url === '/projects') return Promise.resolve([
          { id: 'proj-old', name: 'Old Project', status: 'stopped', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
        ]);
        if (url.includes('/projects/proj-old/dag')) return Promise.resolve(mockDagStatus);
        if (url.includes('/projects/proj-old')) return Promise.resolve({ id: 'proj-old', name: 'Old Project', sessions: [] });
        if (url.includes('/tasks')) return Promise.resolve({ tasks: [], total: 0, hasMore: false, offset: 0, limit: 200 });
        return Promise.resolve({});
      });

      await renderAndSettle();
      await settleAsync();

      // Historical DAG should render with progress
      expect(screen.getByText('Progress (historical)')).toBeDefined();
    });

    it('shows previous sessions for persisted project', async () => {
      currentMockAgents = [];
      mockLeadProjects = {};
      mockApiFetch.mockImplementation((url: string) => {
        if (url === '/projects') return Promise.resolve([
          { id: 'proj-old', name: 'Old Project', status: 'stopped', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
        ]);
        if (url.includes('/projects/proj-old/dag')) return Promise.resolve({ tasks: [], fileLockMap: {}, summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } });
        if (url.includes('/projects/proj-old')) return Promise.resolve({
          id: 'proj-old',
          name: 'Old Project',
          sessions: [
            { id: 's1', task: 'Build the app', status: 'completed', startedAt: '2026-01-01T00:00:00Z' },
            { id: 's2', task: 'Fix bugs', status: 'crashed', startedAt: '2026-01-02T00:00:00Z' },
          ],
        });
        if (url.includes('/tasks')) return Promise.resolve({ tasks: [], total: 0, hasMore: false, offset: 0, limit: 200 });
        return Promise.resolve({});
      });

      await renderAndSettle();
      await settleAsync();

      expect(screen.getByText('Previous Sessions')).toBeDefined();
      expect(screen.getByText(/Build the app/)).toBeDefined();
    });
  });

  /* ─── View mode switching ─── */
  describe('view mode switching', () => {
    it('switches to gantt view', async () => {
      await renderAndSettle();

      await act(async () => {
        fireEvent.click(screen.getByTitle('Gantt view'));
      });

      expect(screen.getByTestId('dag-gantt')).toBeDefined();
    });

    it('switches to resource view', async () => {
      await renderAndSettle();

      await act(async () => {
        fireEvent.click(screen.getByTitle('Resource view'));
      });

      expect(screen.getByTestId('dag-resource')).toBeDefined();
    });

    it('switches to kanban view', async () => {
      await renderAndSettle();

      await act(async () => {
        fireEvent.click(screen.getByTitle('Kanban board'));
      });

      expect(screen.getByTestId('kanban-board')).toBeDefined();
      expect(screen.queryByTestId('split-view')).toBeNull();
    });

    it('switches back to split view from another view', async () => {
      await renderAndSettle();

      await act(async () => {
        fireEvent.click(screen.getByTitle('Graph view'));
      });
      expect(screen.queryByTestId('split-view')).toBeNull();

      await act(async () => {
        fireEvent.click(screen.getByTitle('Split view (Kanban + Graph)'));
      });
      expect(screen.getByTestId('split-view')).toBeDefined();
    });
  });

  /* ─── DagPanel rendering ─── */
  describe('DagPanel rendering', () => {
    it('shows scope switcher when active lead has no projectId', async () => {
      // Scope switcher only shows when DagPanel receives projectId=undefined
      currentMockAgents = [
        {
          id: leadId,
          role: { id: 'lead', name: 'Project Lead', icon: '👑' },
          status: 'running',
          parentId: undefined,
          projectId: undefined, // no projectId — scope switcher should appear
          projectName: 'My Project',
          childIds: ['agent-1'],
        },
      ];

      await renderAndSettle();

      // In kanban/split view with no projectId, scope switcher appears
      expect(screen.getByTestId('scope-switcher')).toBeDefined();
    });

    it('hides scope switcher when active lead has projectId', async () => {
      await renderAndSettle();

      // Active lead has projectId 'proj-1', so scope switcher is hidden
      expect(screen.queryByTestId('scope-switcher')).toBeNull();
    });

    it('hides scope switcher in graph view', async () => {
      currentMockAgents = [
        {
          id: leadId,
          role: { id: 'lead', name: 'Project Lead', icon: '👑' },
          status: 'running',
          parentId: undefined,
          projectId: undefined,
          projectName: 'My Project',
          childIds: ['agent-1'],
        },
      ];

      await renderAndSettle();

      await act(async () => {
        fireEvent.click(screen.getByTitle('Graph view'));
      });

      expect(screen.queryByTestId('scope-switcher')).toBeNull();
    });
  });

  /* ─── Global scope vs project scope ─── */
  describe('global scope vs project scope', () => {
    it('fetches global tasks when scope is changed to global in kanban view', async () => {
      // Need agent without projectId for scope switcher to show
      currentMockAgents = [
        {
          id: leadId,
          role: { id: 'lead', name: 'Project Lead', icon: '👑' },
          status: 'running',
          parentId: undefined,
          projectId: undefined,
          projectName: 'My Project',
          childIds: ['agent-1'],
        },
      ];
      mockApiFetch.mockImplementation((url: string) => {
        if (url.includes('/progress')) return Promise.resolve(mockProgress);
        if (url === '/projects') return Promise.resolve([]);
        if (url.includes('/tasks?scope=global')) return Promise.resolve({
          tasks: [
            { id: 'g-1', title: 'Global task', dagStatus: 'pending', dependsOn: [], createdAt: '2026-01-01 00:00:00', startedAt: null, completedAt: null },
          ],
          total: 1,
          hasMore: false,
          offset: 0,
          limit: 200,
        });
        if (url.includes('/tasks')) return Promise.resolve({ tasks: [], total: 0, hasMore: false, offset: 0, limit: 200 });
        return Promise.resolve({});
      });

      await renderAndSettle();

      // Scope switcher should be visible in split view (default)
      const scopeSwitcher = screen.getByTestId('scope-switcher');
      await act(async () => {
        fireEvent.change(scopeSwitcher, { target: { value: 'global' } });
      });

      expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('/tasks?scope=global'));
    });

    it('hides tabs when inside project context (projectId set)', async () => {
      mockProjectId = 'proj-1';
      await renderAndSettle();

      // When projectId is set, the tab bar should be hidden
      expect(screen.queryByText('No projects yet')).toBeNull();
      // The active lead content should still render
      expect(screen.getByText('Progress')).toBeDefined();
    });
  });

  /* ─── Load more pagination ─── */
  describe('load more pagination', () => {
    it('fetches global tasks with pagination when scope is global', async () => {
      // Need agent without projectId for scope switcher to show
      currentMockAgents = [
        {
          id: leadId,
          role: { id: 'lead', name: 'Project Lead', icon: '👑' },
          status: 'running',
          parentId: undefined,
          projectId: undefined,
          projectName: 'My Project',
          childIds: ['agent-1'],
        },
      ];
      mockApiFetch.mockImplementation((url: string) => {
        if (url.includes('/progress')) return Promise.resolve(mockProgress);
        if (url === '/projects') return Promise.resolve([]);
        if (url.includes('/tasks?scope=global')) return Promise.resolve({
          tasks: [
            { id: 'g-1', title: 'Global task', dagStatus: 'pending', dependsOn: [], createdAt: '2026-01-01 00:00:00', startedAt: null, completedAt: null },
          ],
          total: 300,
          hasMore: true,
          offset: 0,
          limit: 200,
        });
        if (url.includes('/tasks')) return Promise.resolve({ tasks: [], total: 0, hasMore: false, offset: 0, limit: 200 });
        return Promise.resolve({});
      });

      await renderAndSettle();

      // Switch scope to global
      const scopeSwitcher = screen.getByTestId('scope-switcher');
      await act(async () => {
        fireEvent.change(scopeSwitcher, { target: { value: 'global' } });
      });

      // Verify global tasks API was called with pagination params
      expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('/tasks?scope=global&limit=200&offset=0'));
    });
  });

  /* ─── Tab auto-selection ─── */
  describe('tab auto-selection', () => {
    it('auto-selects first lead when multiple leads exist', async () => {
      currentMockAgents = [
        {
          id: 'lead-1',
          role: { id: 'lead', name: 'Project Lead', icon: '👑' },
          status: 'running',
          parentId: undefined,
          projectId: 'proj-1',
          projectName: 'Project Alpha',
          childIds: [],
        },
        {
          id: 'lead-2',
          role: { id: 'lead', name: 'Project Lead', icon: '👑' },
          status: 'running',
          parentId: undefined,
          projectId: 'proj-2',
          projectName: 'Project Beta',
          childIds: [],
        },
      ];
      mockLeadProjects = {
        'lead-1': { dagStatus: mockDagStatus },
        'lead-2': { dagStatus: mockDagStatus },
      };

      await renderAndSettle();
      await act(async () => {});

      // First tab content should be active (Project Alpha)
      expect(screen.getByText('Project Alpha')).toBeDefined();
      expect(screen.getByText('Project Beta')).toBeDefined();
    });

    it('selects project-matching tab when inside project context', async () => {
      mockProjectId = 'proj-1';
      currentMockAgents = [
        {
          id: 'lead-1',
          role: { id: 'lead', name: 'Project Lead', icon: '👑' },
          status: 'running',
          parentId: undefined,
          projectId: 'proj-1',
          projectName: 'Project Alpha',
          childIds: [],
        },
      ];
      mockLeadProjects = { 'lead-1': { dagStatus: mockDagStatus } };

      await renderAndSettle();

      // Content for the matching project should render
      expect(screen.getByText('Progress')).toBeDefined();
    });
  });

  /* ─── Active vs persisted tab content ─── */
  describe('active vs persisted tab content', () => {
    it('renders active lead content with progress and tasks', async () => {
      await renderAndSettle();

      expect(screen.getByText('Progress')).toBeDefined();
      expect(screen.getByText('Tasks')).toBeDefined();
      expect(screen.getByText('DAG Tasks')).toBeDefined();
    });

    it('renders crew agents in progress section', async () => {
      await renderAndSettle();

      // mockProgress has crew agents
      expect(screen.getByText(/Crew/)).toBeDefined();
    });

    it('renders persisted project content with description and timestamps', async () => {
      currentMockAgents = [];
      mockLeadProjects = {};
      mockApiFetch.mockImplementation((url: string) => {
        if (url === '/projects') return Promise.resolve([
          {
            id: 'proj-old',
            name: 'Old Project',
            description: 'Historical project desc',
            status: 'stopped',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            cwd: '/home/user/project',
          },
        ]);
        if (url.includes('/projects/proj-old/dag')) return Promise.resolve({ tasks: [], fileLockMap: {}, summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } });
        if (url.includes('/projects/proj-old')) return Promise.resolve({ id: 'proj-old', name: 'Old Project', description: 'Historical project desc', sessions: [] });
        if (url.includes('/tasks')) return Promise.resolve({ tasks: [], total: 0, hasMore: false, offset: 0, limit: 200 });
        return Promise.resolve({});
      });

      await renderAndSettle();
      await settleAsync();

      expect(screen.getByText('Historical project desc')).toBeDefined();
      expect(screen.getByText('Resume Project')).toBeDefined();
    });

    it('clicking between active and persisted tabs renders correct content', async () => {
      mockApiFetch.mockImplementation((url: string) => {
        if (url === '/projects') return Promise.resolve([
          { id: 'proj-old', name: 'Persisted Project', status: 'stopped', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
        ]);
        if (url.includes('/progress')) return Promise.resolve(mockProgress);
        if (url.includes('/projects/proj-old/dag')) return Promise.resolve({ tasks: [], fileLockMap: {}, summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } });
        if (url.includes('/projects/proj-old')) return Promise.resolve({ id: 'proj-old', name: 'Persisted Project', sessions: [] });
        if (url.includes('/tasks')) return Promise.resolve({ tasks: [], total: 0, hasMore: false, offset: 0, limit: 200 });
        return Promise.resolve({});
      });

      await renderAndSettle();
      await act(async () => {});

      // Initially on active lead tab
      expect(screen.getByText('Progress')).toBeDefined();

      // Click persisted tab
      const persistedTab = screen.getByText('Persisted Project');
      await act(async () => {
        fireEvent.click(persistedTab);
      });

      expect(screen.getByText('Resume Project')).toBeDefined();

      // Click back to active tab
      const activeTab = screen.getByText('My Project');
      await act(async () => {
        fireEvent.click(activeTab);
      });

      expect(screen.getByText('Progress')).toBeDefined();
    });
  });

  /* ─── SessionProgress edge cases ─── */
  describe('SessionProgress component', () => {
    it('shows empty state when no tasks or delegations', async () => {
      mockLeadProjects = {
        [leadId]: {
          dagStatus: { tasks: [], fileLockMap: {}, summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } },
        },
      };
      mockApiFetch.mockImplementation((url: string) => {
        if (url.includes('/progress')) return Promise.resolve({
          totalDelegations: 0,
          active: 0,
          completed: 0,
          failed: 0,
          completionPct: 0,
          crewSize: 0,
          crewAgents: [],
          delegations: [],
        });
        if (url === '/projects') return Promise.resolve([]);
        if (url.includes('/tasks')) return Promise.resolve({ tasks: [], total: 0, hasMore: false, offset: 0, limit: 200 });
        return Promise.resolve({});
      });

      await renderAndSettle();
      await act(async () => {});

      expect(screen.getByText('No tasks or delegations yet')).toBeDefined();
    });

    it('shows delegation progress stats', async () => {
      await renderAndSettle();
      // Wait for fetchData to resolve (API calls for progress + dag)
      await settleAsync();

      // mockProgress has delegations (totalDelegations: 2, completed: 1)
      expect(screen.getByText('Delegations')).toBeDefined();
      expect(screen.getByText(/1\/2/)).toBeDefined(); // 1 completed / 2 total
    });

    it('shows failed delegations count', async () => {
      mockApiFetch.mockImplementation((url: string) => {
        if (url.includes('/progress')) return Promise.resolve({
          ...mockProgress,
          failed: 2,
        });
        if (url === '/projects') return Promise.resolve([]);
        if (url.includes('/tasks')) return Promise.resolve({ tasks: [], total: 0, hasMore: false, offset: 0, limit: 200 });
        return Promise.resolve({});
      });

      await renderAndSettle();
      await act(async () => {});

      expect(screen.getByText(/2 failed/)).toBeDefined();
    });
  });
});
