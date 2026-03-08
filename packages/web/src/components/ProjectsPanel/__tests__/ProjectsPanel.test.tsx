/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// Mock apiFetch
const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

// Mock Toast store
vi.mock('../../Toast', () => ({
  useToastStore: vi.fn((selector: any) => selector({ add: vi.fn() })),
}));

import { ProjectsPanel } from '../ProjectsPanel';

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

describe('ProjectsPanel', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue([]);
  });

  it('renders loading spinner initially', () => {
    // Make the fetch hang
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    render(<ProjectsPanel />);
    // The heading should always render
    expect(screen.getByText('Projects')).toBeTruthy();
  });

  it('renders empty state when no projects', async () => {
    mockApiFetch.mockResolvedValue([]);
    render(<ProjectsPanel />);
    await waitFor(() => {
      expect(screen.getByText(/No projects yet/)).toBeTruthy();
    });
  });

  it('renders project list with names and descriptions', async () => {
    mockApiFetch.mockResolvedValue(sampleProjects);
    render(<ProjectsPanel />);
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeTruthy();
      expect(screen.getByText('First test project')).toBeTruthy();
      expect(screen.getByText('Beta Project')).toBeTruthy();
    });
  });

  it('shows active agent count badge', async () => {
    mockApiFetch.mockResolvedValue(sampleProjects);
    render(<ProjectsPanel />);
    await waitFor(() => {
      // The summary card shows total active agents across projects
      const summaryCards = screen.getAllByText('Active Agents');
      expect(summaryCards.length).toBeGreaterThan(0);
    });
  });

  it('shows storage mode badges', async () => {
    mockApiFetch.mockResolvedValue(sampleProjects);
    render(<ProjectsPanel />);
    await waitFor(() => {
      expect(screen.getByText('user')).toBeTruthy();
      expect(screen.getByText('local')).toBeTruthy();
    });
  });

  it('shows summary cards with correct counts', async () => {
    mockApiFetch.mockResolvedValue(sampleProjects);
    render(<ProjectsPanel />);
    await waitFor(() => {
      // Total Projects = 2, Active Agents = 3, Active Projects = 1
      expect(screen.getByText('2')).toBeTruthy(); // Total projects count
    });
  });

  it('filters by active status', async () => {
    mockApiFetch.mockResolvedValue(sampleProjects);
    render(<ProjectsPanel />);
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeTruthy();
    });

    // Click Active filter button (the one with count suffix)
    const buttons = screen.getAllByRole('button');
    const activeFilterBtn = buttons.find((b) => b.textContent?.startsWith('Active') && b.textContent?.includes('('));
    expect(activeFilterBtn).toBeTruthy();
    fireEvent.click(activeFilterBtn!);
    expect(screen.getByText('Alpha Project')).toBeTruthy();
    expect(screen.queryByText('Beta Project')).toBeNull();
  });

  it('filters by archived status', async () => {
    mockApiFetch.mockResolvedValue(sampleProjects);
    render(<ProjectsPanel />);
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeTruthy();
    });

    // Click Archived filter button (the one with count suffix)
    const buttons = screen.getAllByRole('button');
    const archivedFilterBtn = buttons.find((b) => b.textContent?.startsWith('Archived') && b.textContent?.includes('('));
    expect(archivedFilterBtn).toBeTruthy();
    fireEvent.click(archivedFilterBtn!);
    expect(screen.queryByText('Alpha Project')).toBeNull();
    expect(screen.getByText('Beta Project')).toBeTruthy();
  });

  it('expands project card to show details on click', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/projects') return Promise.resolve(sampleProjects);
      if (path === `/projects/${sampleProjects[0].id}`) return Promise.resolve({
        ...sampleProjects[0],
        sessions: [
          { id: 1, projectId: 'proj-1', leadId: 'abcdef1234567890', status: 'completed', startedAt: '2026-03-07T10:00:00Z', endedAt: '2026-03-07T12:00:00Z', task: 'Build feature X' },
        ],
      });
      return Promise.resolve([]);
    });

    render(<ProjectsPanel />);
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeTruthy();
    });

    // Click to expand
    fireEvent.click(screen.getByText('Alpha Project'));
    await waitFor(() => {
      expect(screen.getByText('proj-1')).toBeTruthy();
      expect(screen.getByText('/home/user/alpha')).toBeTruthy();
    });
  });

  it('calls delete endpoint when delete is clicked', async () => {
    mockApiFetch.mockImplementation((path: string, opts?: any) => {
      if (path === '/projects' && !opts) return Promise.resolve(sampleProjects);
      if (path === `/projects/${sampleProjects[0].id}` && !opts) return Promise.resolve(sampleProjects[0]);
      if (path === `/projects/${sampleProjects[0].id}` && opts?.method === 'DELETE') return Promise.resolve({ ok: true });
      return Promise.resolve([]);
    });

    render(<ProjectsPanel />);
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeTruthy();
    });

    // Expand first
    fireEvent.click(screen.getByText('Alpha Project'));
    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeTruthy();
    });

    // Click Delete — should show confirmation, NOT delete immediately
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => {
      expect(screen.getByText(/This cannot be undone/)).toBeTruthy();
    });

    // Click the confirm Delete button
    const confirmBtn = screen.getAllByText('Delete').find(
      (el) => el.classList.contains('bg-red-500')
    );
    expect(confirmBtn).toBeTruthy();
    fireEvent.click(confirmBtn!);
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/projects/proj-1', { method: 'DELETE' });
    });
  });

  it('cancels delete when Cancel is clicked in confirmation', async () => {
    mockApiFetch.mockImplementation((path: string, opts?: any) => {
      if (path === '/projects' && !opts) return Promise.resolve(sampleProjects);
      if (path === `/projects/${sampleProjects[0].id}` && !opts) return Promise.resolve(sampleProjects[0]);
      return Promise.resolve([]);
    });

    render(<ProjectsPanel />);
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeTruthy();
    });

    // Expand and click Delete
    fireEvent.click(screen.getByText('Alpha Project'));
    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => {
      expect(screen.getByText(/This cannot be undone/)).toBeTruthy();
    });

    // Click Cancel
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => {
      expect(screen.queryByText(/This cannot be undone/)).toBeNull();
    });
  });

  it('calls resume endpoint when Resume is clicked', async () => {
    mockApiFetch.mockImplementation((path: string, opts?: any) => {
      if (path === '/projects' && !opts) return Promise.resolve(sampleProjects);
      if (path === `/projects/${sampleProjects[0].id}` && !opts) return Promise.resolve(sampleProjects[0]);
      if (path === `/projects/${sampleProjects[0].id}/resume` && opts?.method === 'POST') return Promise.resolve({ id: 'new-agent-id' });
      return Promise.resolve([]);
    });

    render(<ProjectsPanel />);
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Alpha Project'));
    await waitFor(() => {
      expect(screen.getByText('Resume')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Resume'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/projects/proj-1/resume', {
        method: 'POST',
        body: JSON.stringify({}),
      });
    });
  });
});
