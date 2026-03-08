/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
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
  { id: 'agent-1', role: { id: 'lead' }, status: 'running', projectId: 'proj-1', projectName: 'Alpha Project' },
  { id: 'agent-2', role: { id: 'developer' }, status: 'running', projectId: 'proj-1' },
  { id: 'agent-3', role: { id: 'developer' }, status: 'running', projectId: 'proj-1' },
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

// ── Helpers ─────────────────────────────────────────────────────────

function renderWithRouter(component: React.ReactElement) {
  return render(<MemoryRouter>{component}</MemoryRouter>);
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
        expect(screen.getByText('Welcome to Flightdeck')).toBeTruthy();
      });
    });

    it('shows View Projects action button', async () => {
      mockApiFetch.mockResolvedValue([]);
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByText('View Projects')).toBeTruthy();
      });
    });
  });

  describe('dashboard with projects', () => {
    beforeEach(() => {
      mockApiFetch.mockResolvedValue(sampleProjects);
      mockAppState.agents = sampleAgents as any;
    });

    it('renders the dashboard with header', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByTestId('home-dashboard')).toBeTruthy();
        expect(screen.getByText('Home')).toBeTruthy();
      });
    });

    it('shows quick stats cards', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByTestId('home-stats')).toBeTruthy();
        expect(screen.getByText('Active Projects')).toBeTruthy();
        expect(screen.getByText('Running Agents')).toBeTruthy();
        expect(screen.getByText('Needs Attention')).toBeTruthy();
      });
    });

    it('displays correct project count in stats', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        const statsEl = screen.getByTestId('home-stats');
        expect(statsEl.textContent).toContain('2'); // 2 active projects
      });
    });

    it('displays correct running agent count from live WebSocket data', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        const statsEl = screen.getByTestId('home-stats');
        expect(statsEl.textContent).toContain('3'); // 3 running agents
      });
    });

    it('renders project cards for each project', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        const cards = screen.getAllByTestId('project-card');
        expect(cards).toHaveLength(2);
        expect(screen.getByText('Alpha Project')).toBeTruthy();
        expect(screen.getByText('Beta Project')).toBeTruthy();
      });
    });

    it('shows project descriptions', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByText('Frontend redesign')).toBeTruthy();
        expect(screen.getByText('API migration')).toBeTruthy();
      });
    });

    it('navigates to project session on card click', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByText('Alpha Project')).toBeTruthy();
      });

      fireEvent.click(screen.getByText('Alpha Project'));
      expect(mockNavigate).toHaveBeenCalledWith('/projects/proj-1/session');
    });

    it('sorts projects with active agents first', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        const cards = screen.getAllByTestId('project-card');
        // Alpha Project (3 agents) should be first
        expect(cards[0].textContent).toContain('Alpha Project');
        // Beta Project (0 agents) should be second
        expect(cards[1].textContent).toContain('Beta Project');
      });
    });

    it('filters out archived projects', async () => {
      mockApiFetch.mockResolvedValue([
        ...sampleProjects,
        { ...sampleProjects[1], id: 'proj-archived', name: 'Archived One', status: 'archived' },
      ]);
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.queryByText('Archived One')).toBeNull();
      });
    });
  });

  describe('connection status', () => {
    beforeEach(() => {
      mockApiFetch.mockResolvedValue(sampleProjects);
    });

    it('shows Connected badge when connected', async () => {
      mockAppState.connected = true;
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByText('Connected')).toBeTruthy();
      });
    });

    it('shows Disconnected badge when not connected', async () => {
      mockAppState.connected = false;
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByText('Disconnected')).toBeTruthy();
      });
    });
  });

  describe('attention queue', () => {
    beforeEach(() => {
      mockApiFetch.mockResolvedValue(sampleProjects);
      mockAppState.agents = sampleAgents as any;
      mockAppState.pendingDecisions = sampleDecisions as any;
    });

    it('shows attention queue when there are pending decisions', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByTestId('attention-queue')).toBeTruthy();
        expect(screen.getByText('Needs Your Attention')).toBeTruthy();
      });
    });

    it('displays decision title and agent role', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByText('Add lodash dependency')).toBeTruthy();
        expect(screen.getByText(/Developer/)).toBeTruthy();
      });
    });

    it('shows project name in attention items', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        const items = screen.getAllByTestId('attention-item');
        expect(items[0].textContent).toContain('Alpha Project');
      });
    });

    it('navigates to project on attention item click', async () => {
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByText('Add lodash dependency')).toBeTruthy();
      });

      fireEvent.click(screen.getByText('Add lodash dependency'));
      expect(mockNavigate).toHaveBeenCalledWith('/projects/proj-1/session');
    });

    it('hides attention queue when no pending decisions', async () => {
      mockAppState.pendingDecisions = [];
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByTestId('home-dashboard')).toBeTruthy();
      });
      expect(screen.queryByTestId('attention-queue')).toBeNull();
    });

    it('does not show already-confirmed decisions', async () => {
      mockAppState.pendingDecisions = [
        { ...sampleDecisions[0], id: 'dec-confirmed', status: 'confirmed' },
      ] as any;
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByTestId('home-dashboard')).toBeTruthy();
      });
      expect(screen.queryByTestId('attention-queue')).toBeNull();
    });
  });

  describe('navigation', () => {
    it('navigates to projects page via Manage Projects button', async () => {
      mockApiFetch.mockResolvedValue(sampleProjects);
      renderWithRouter(<HomeDashboard />);
      await waitFor(() => {
        expect(screen.getByText('Manage Projects')).toBeTruthy();
      });

      fireEvent.click(screen.getByText('Manage Projects'));
      expect(mockNavigate).toHaveBeenCalledWith('/projects');
    });
  });
});
