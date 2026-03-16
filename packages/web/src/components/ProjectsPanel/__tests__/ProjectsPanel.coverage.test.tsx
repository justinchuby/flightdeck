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

// Mock Toast store
const mockAddToast = vi.fn();
vi.mock('../../Toast', () => ({
  useToastStore: vi.fn((selector: any) => selector({ add: mockAddToast })),
}));

// Mock heavy sub-components to keep tests focused
vi.mock('../../LeadDashboard/NewProjectModal', () => ({
  NewProjectModal: ({ onClose }: any) => (
    <div data-testid="new-project-modal">
      <button onClick={onClose}>Close Modal</button>
    </div>
  ),
}));

vi.mock('../../SessionHistory', () => ({
  SessionViewer: ({ session, onClose, onResume }: any) => (
    <div data-testid="session-viewer">
      <span>{session.task}</span>
      <button onClick={onClose}>Close Session</button>
      {onResume && <button onClick={onResume}>Resume Session</button>}
    </div>
  ),
}));

import { ProjectsPanel } from '../ProjectsPanel';

function renderPanel() {
  return render(<MemoryRouter><ProjectsPanel /></MemoryRouter>);
}

function renderPanelWithParams(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects${search}`]}>
      <ProjectsPanel />
    </MemoryRouter>,
  );
}

const sampleProjects = [
  {
    id: 'proj-1',
    name: 'Alpha Project',
    description: 'First test project',
    cwd: '/home/user/alpha',
    status: 'active',
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-03-07T14:00:00Z',
    activeAgentCount: 3,
    runningAgentCount: 2,
    idleAgentCount: 1,
    failedAgentCount: 0,
    storageMode: 'user' as const,
  },
  {
    id: 'proj-2',
    name: 'Beta Project',
    description: '',
    cwd: null,
    status: 'archived',
    createdAt: '2026-02-01T08:00:00Z',
    updatedAt: '2026-02-15T12:00:00Z',
    activeAgentCount: 0,
    storageMode: 'local' as const,
  },
];

describe('ProjectsPanelCoverage', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue([]);
  });

  // ── Lines 36-38: error handling in fetchProjects ──────────────
  describe('fetch error handling', () => {
    it('shows error toast when API call rejects with Error', async () => {
      mockApiFetch.mockRejectedValue(new Error('Network failure'));
      renderPanel();
      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('error', expect.stringContaining('Network failure'));
      });
    });

    it('shows error toast when API call rejects with string', async () => {
      mockApiFetch.mockRejectedValue('timeout');
      renderPanel();
      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('error', expect.stringContaining('timeout'));
      });
    });
  });

  // ── Lines 25-28: ?action=new auto-opens new project modal ─────
  describe('action=new search param', () => {
    it('auto-opens new project modal when action=new is in URL', async () => {
      mockApiFetch.mockResolvedValue([]);
      renderPanelWithParams('?action=new');
      await waitFor(() => {
        expect(screen.getByTestId('new-project-modal')).toBeTruthy();
      });
    });
  });

  // ── Lines 111-123: empty state with "all" filter ──────────────
  describe('empty state', () => {
    it('shows "No projects yet" with Create button when all filter is empty', async () => {
      mockApiFetch.mockResolvedValue([]);
      renderPanel();

      // Wait for loading to finish (default filter is 'active')
      await waitFor(() => {
        expect(screen.getByText(/No active projects/)).toBeTruthy();
      });

      // Switch to "All" filter
      const allBtn = screen.getAllByRole('button').find((b) => b.textContent === 'All');
      expect(allBtn).toBeTruthy();
      fireEvent.click(allBtn!);

      expect(screen.getByText(/No projects yet/)).toBeTruthy();
      expect(screen.getByText('Create Project')).toBeTruthy();
    });

    it('Create Project button opens new project modal', async () => {
      mockApiFetch.mockResolvedValue([]);
      renderPanel();

      await waitFor(() => {
        expect(screen.getByText(/No active projects/)).toBeTruthy();
      });

      const allBtn = screen.getAllByRole('button').find((b) => b.textContent === 'All');
      fireEvent.click(allBtn!);

      fireEvent.click(screen.getByText('Create Project'));
      expect(screen.getByTestId('new-project-modal')).toBeTruthy();
    });
  });

  // ── Lines 46-66: task progress fetching ───────────────────────
  describe('task progress fetching', () => {
    it('fetches DAG progress for projects without taskProgress', async () => {
      const projectsWithoutProgress = [
        { ...sampleProjects[0], taskProgress: undefined },
      ];

      mockApiFetch.mockImplementation((path: string) => {
        if (path === '/projects') return Promise.resolve(projectsWithoutProgress);
        if (path.includes('/dag')) {
          return Promise.resolve({
            summary: { done: 3, in_progress: 2, pending: 1 },
          });
        }
        return Promise.resolve([]);
      });

      renderPanel();

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith('/projects/proj-1/dag');
      });
    });

    it('handles DAG response without summary gracefully', async () => {
      const projectsWithoutProgress = [
        { ...sampleProjects[0], taskProgress: undefined },
      ];

      mockApiFetch.mockImplementation((path: string) => {
        if (path === '/projects') return Promise.resolve(projectsWithoutProgress);
        if (path.includes('/dag')) return Promise.resolve({});
        return Promise.resolve([]);
      });

      renderPanel();

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith('/projects/proj-1/dag');
      });
      // Should not crash when summary is missing
      expect(screen.getByText('Alpha Project')).toBeTruthy();
    });

    it('skips fetching progress for projects that already have it', async () => {
      const projectsWithProgress = [
        { ...sampleProjects[0], taskProgress: { done: 1, total: 5 } },
      ];

      mockApiFetch.mockImplementation((path: string) => {
        if (path === '/projects') return Promise.resolve(projectsWithProgress);
        return Promise.resolve([]);
      });

      renderPanel();

      await waitFor(() => {
        expect(screen.getByText('Alpha Project')).toBeTruthy();
      });

      // DAG endpoint should not be called for projects with existing progress
      expect(mockApiFetch).not.toHaveBeenCalledWith('/projects/proj-1/dag');
    });

    it('handles DAG fetch failure gracefully', async () => {
      const projectsWithoutProgress = [
        { ...sampleProjects[0], taskProgress: undefined },
      ];

      mockApiFetch.mockImplementation((path: string) => {
        if (path === '/projects') return Promise.resolve(projectsWithoutProgress);
        if (path.includes('/dag')) return Promise.reject(new Error('DAG not found'));
        return Promise.resolve([]);
      });

      renderPanel();

      await waitFor(() => {
        expect(screen.getByText('Alpha Project')).toBeTruthy();
      });
      // Should not crash
    });
  });

  // ── Line 162: NewProjectModal onClose calls fetchProjects ─────
  describe('new project modal close', () => {
    it('refetches projects when modal is closed', async () => {
      mockApiFetch.mockResolvedValue([]);
      renderPanelWithParams('?action=new');

      await waitFor(() => {
        expect(screen.getByTestId('new-project-modal')).toBeTruthy();
      });

      mockApiFetch.mockClear();
      mockApiFetch.mockResolvedValue(sampleProjects);

      fireEvent.click(screen.getByText('Close Modal'));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith('/projects');
      });
    });
  });
});
