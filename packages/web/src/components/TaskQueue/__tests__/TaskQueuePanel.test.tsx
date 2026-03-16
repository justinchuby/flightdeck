// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';

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
  crewAgents: [],
  delegations: [],
};

/* ------------------------------------------------------------------ */
/*  Mocks                                                             */
/* ------------------------------------------------------------------ */

const mockApiFetch = vi.fn().mockImplementation((url: string) => {
  if (url.includes('/progress')) return Promise.resolve(mockProgress);
  if (url === '/projects') return Promise.resolve([]);
  if (url.includes('/tasks')) return Promise.resolve({ tasks: [], total: 0, hasMore: false, offset: 0, limit: 200 });
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

vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        projects: {
          [leadId]: { dagStatus: mockDagStatus },
        },
      }),
    {
      getState: () => ({
        projects: { [leadId]: { dagStatus: mockDagStatus } },
        setDagStatus: vi.fn(),
      }),
    },
  ),
}));

vi.mock('../../../contexts/ProjectContext', () => ({
  useOptionalProjectId: () => null,
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
});

afterEach(() => {
  cleanup();
});

async function renderAndSettle() {
  const result = render(<TaskQueuePanel />);
  // Flush async state updates from useEffect API calls
  await act(async () => {});
  return result;
}

describe('TaskQueuePanel', () => {
  /* 1 ─ Empty state when no leads */
  it('shows empty state when no lead sessions exist', async () => {
    currentMockAgents = [];
    mockApiFetch.mockImplementation((url: string) => {
      if (url === '/projects') return Promise.resolve([]);
      return Promise.resolve({});
    });

    await renderAndSettle();

    expect(screen.getByText(/No lead sessions active/)).toBeDefined();
  });

  /* 2 ─ Renders with tabs for active leads */
  it('renders tab for active lead project', async () => {
    await renderAndSettle();

    // projectName "My Project" is used (not shortAgentId) — but shortAgentId mock truncates to 8 chars
    // The component uses: l.projectName || shortAgentId(l.id)
    expect(screen.getByText('My Project')).toBeDefined();
  });

  /* 3 ─ Shows progress section */
  it('shows progress section for active lead', async () => {
    await renderAndSettle();

    expect(screen.getByText('Progress')).toBeDefined();
  });

  /* 4 ─ Shows tasks heading */
  it('shows Tasks heading with count', async () => {
    await renderAndSettle();

    expect(screen.getByText('Tasks')).toBeDefined();
    expect(screen.getByText('3 total')).toBeDefined();
  });

  /* 5 ─ Default view is split view */
  it('renders split view by default', async () => {
    await renderAndSettle();

    expect(screen.getByTestId('split-view')).toBeDefined();
    expect(screen.getByTestId('dag-graph')).toBeDefined();
    expect(screen.getByTestId('kanban-board')).toBeDefined();
  });

  /* 6 ─ View mode switcher buttons */
  it('renders view mode switcher buttons', async () => {
    await renderAndSettle();

    expect(screen.getByTestId('view-split')).toBeDefined();
    expect(screen.getByTitle('Split view (Kanban + Graph)')).toBeDefined();
    expect(screen.getByTitle('Kanban board')).toBeDefined();
    expect(screen.getByTitle('Graph view')).toBeDefined();
    expect(screen.getByTitle('List view')).toBeDefined();
    expect(screen.getByTitle('Gantt view')).toBeDefined();
    expect(screen.getByTitle('Resource view')).toBeDefined();
  });

  /* 7 ─ Switching to list view */
  it('switches to list view when list button is clicked', async () => {
    await renderAndSettle();

    await act(async () => {
      fireEvent.click(screen.getByTitle('List view'));
    });

    expect(screen.getByTestId('task-dag-panel')).toBeDefined();
  });

  /* 8 ─ Switching to graph view */
  it('switches to graph view when graph button is clicked', async () => {
    await renderAndSettle();

    await act(async () => {
      fireEvent.click(screen.getByTitle('Graph view'));
    });

    expect(screen.getByTestId('dag-graph')).toBeDefined();
    expect(screen.queryByTestId('split-view')).toBeNull();
  });

  /* 9 ─ DAG summary in progress section */
  it('displays DAG summary stats in progress section', async () => {
    await renderAndSettle();

    expect(screen.getByText('DAG Tasks')).toBeDefined();
    expect(screen.getByText(/1\/3 done/)).toBeDefined();
  });

  /* 10 ─ No projects tab text */
  it('shows "No projects yet" when no tabs exist and no agents', async () => {
    currentMockAgents = [];
    mockApiFetch.mockImplementation((url: string) => {
      if (url === '/projects') return Promise.resolve([]);
      return Promise.resolve({});
    });

    await renderAndSettle();

    expect(screen.getByText('No projects yet')).toBeDefined();
  });
});
