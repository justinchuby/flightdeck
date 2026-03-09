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

import { ProjectsPanel } from '../ProjectsPanel';

function renderPanel() {
  return render(<MemoryRouter><ProjectsPanel /></MemoryRouter>);
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

describe('ProjectsPanel', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue([]);
  });

  it('renders loading spinner initially', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(screen.getByText('Projects')).toBeTruthy();
  });

  it('renders empty state when no projects', async () => {
    mockApiFetch.mockResolvedValue([]);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/No projects yet/)).toBeTruthy();
    });
  });

  it('defaults to Active filter showing only active projects', async () => {
    mockApiFetch.mockResolvedValue(sampleProjects);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeTruthy();
      expect(screen.queryByText('Beta Project')).toBeNull();
    });
  });

  it('renders all projects when All filter is selected', async () => {
    mockApiFetch.mockResolvedValue(sampleProjects);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeTruthy();
    });

    const buttons = screen.getAllByRole('button');
    const allFilterBtn = buttons.find((b) => b.textContent?.startsWith('All') && b.textContent?.includes('('));
    expect(allFilterBtn).toBeTruthy();
    fireEvent.click(allFilterBtn!);
    expect(screen.getByText('Alpha Project')).toBeTruthy();
    expect(screen.getByText('Beta Project')).toBeTruthy();
  });

  it('shows active agent count badge', async () => {
    mockApiFetch.mockResolvedValue(sampleProjects);
    renderPanel();
    await waitFor(() => {
      const summaryCards = screen.getAllByText('Active Agents');
      expect(summaryCards.length).toBeGreaterThan(0);
    });
  });

  it('shows storage mode badges', async () => {
    mockApiFetch.mockResolvedValue(sampleProjects);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('user')).toBeTruthy();
    });
    // Switch to All to see both
    const buttons = screen.getAllByRole('button');
    const allFilterBtn = buttons.find((b) => b.textContent?.startsWith('All') && b.textContent?.includes('('));
    fireEvent.click(allFilterBtn!);
    expect(screen.getByText('local')).toBeTruthy();
  });

  it('shows summary cards with correct counts', async () => {
    mockApiFetch.mockResolvedValue(sampleProjects);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('2')).toBeTruthy();
    });
  });

  it('filters by active status', async () => {
    mockApiFetch.mockResolvedValue(sampleProjects);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeTruthy();
    });
    // Default is active, so Beta should not be visible
    expect(screen.queryByText('Beta Project')).toBeNull();
  });

  it('filters by archived status', async () => {
    mockApiFetch.mockResolvedValue(sampleProjects);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeTruthy();
    });

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

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeTruthy();
    });

    const toggleButtons = screen.getAllByRole('button', { name: 'Toggle details' });
    fireEvent.click(toggleButtons[0]);
    await waitFor(() => {
      expect(screen.getByText('proj-1')).toBeTruthy();
      expect(screen.getByText('/home/user/alpha')).toBeTruthy();
    });
  });

  it('shows crew breakdown in expanded view', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/projects') return Promise.resolve(sampleProjects);
      if (path === `/projects/${sampleProjects[0].id}`) return Promise.resolve({
        ...sampleProjects[0],
        sessions: [],
      });
      return Promise.resolve([]);
    });

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeTruthy();
    });

    const toggleButtons = screen.getAllByRole('button', { name: 'Toggle details' });
    fireEvent.click(toggleButtons[0]);
    await waitFor(() => {
      expect(screen.getByText('Crew')).toBeTruthy();
      expect(screen.getByText(/3 total/)).toBeTruthy();
      expect(screen.getByText(/2 running/)).toBeTruthy();
    });
  });

  it('shows Delete button only for archived projects', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/projects') return Promise.resolve(sampleProjects);
      if (path === `/projects/${sampleProjects[0].id}`) return Promise.resolve(sampleProjects[0]);
      return Promise.resolve([]);
    });

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeTruthy();
    });

    // Expand active project - should NOT show Delete
    const toggleButtons = screen.getAllByRole('button', { name: 'Toggle details' });
    fireEvent.click(toggleButtons[0]);
    await waitFor(() => {
      expect(screen.getByText('Resume')).toBeTruthy();
    });
    expect(screen.queryByText('Delete')).toBeNull();
  });

  it('calls delete endpoint for archived project', async () => {
    mockApiFetch.mockImplementation((path: string, opts?: any) => {
      if (path === '/projects' && !opts) return Promise.resolve(sampleProjects);
      if (path === `/projects/${sampleProjects[1].id}` && !opts) return Promise.resolve(sampleProjects[1]);
      if (path === `/projects/${sampleProjects[1].id}` && opts?.method === 'DELETE') return Promise.resolve({ ok: true });
      return Promise.resolve([]);
    });

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeTruthy();
    });

    // Switch to Archived filter
    const buttons = screen.getAllByRole('button');
    const archivedFilterBtn = buttons.find((b) => b.textContent?.startsWith('Archived') && b.textContent?.includes('('));
    fireEvent.click(archivedFilterBtn!);
    await waitFor(() => {
      expect(screen.getByText('Beta Project')).toBeTruthy();
    });

    // Expand archived project
    const toggleButtons = screen.getAllByRole('button', { name: 'Toggle details' });
    fireEvent.click(toggleButtons[0]);
    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeTruthy();
    });

    // Click Delete - show confirmation
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => {
      expect(screen.getByText(/This cannot be undone/)).toBeTruthy();
    });

    // Confirm delete
    const confirmBtn = screen.getAllByText('Delete').find(
      (el) => el.classList.contains('bg-red-500')
    );
    expect(confirmBtn).toBeTruthy();
    fireEvent.click(confirmBtn!);
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/projects/proj-2', { method: 'DELETE' });
    });
  });

  it('cancels delete when Cancel is clicked in confirmation', async () => {
    mockApiFetch.mockImplementation((path: string, opts?: any) => {
      if (path === '/projects' && !opts) return Promise.resolve(sampleProjects);
      if (path === `/projects/${sampleProjects[1].id}` && !opts) return Promise.resolve(sampleProjects[1]);
      return Promise.resolve([]);
    });

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeTruthy();
    });

    // Switch to Archived filter
    const buttons = screen.getAllByRole('button');
    const archivedFilterBtn = buttons.find((b) => b.textContent?.startsWith('Archived') && b.textContent?.includes('('));
    fireEvent.click(archivedFilterBtn!);
    await waitFor(() => {
      expect(screen.getByText('Beta Project')).toBeTruthy();
    });

    const toggleButtons = screen.getAllByRole('button', { name: 'Toggle details' });
    fireEvent.click(toggleButtons[0]);
    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => {
      expect(screen.getByText(/This cannot be undone/)).toBeTruthy();
    });

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

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeTruthy();
    });

    const toggleButtons = screen.getAllByRole('button', { name: 'Toggle details' });
    fireEvent.click(toggleButtons[0]);
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

  it('shows Stop All Agents button when project has running agents', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/projects') return Promise.resolve(sampleProjects);
      if (path === `/projects/${sampleProjects[0].id}`) return Promise.resolve({
        ...sampleProjects[0],
        sessions: [],
      });
      return Promise.resolve([]);
    });

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeTruthy();
    });

    const toggleButtons = screen.getAllByRole('button', { name: 'Toggle details' });
    fireEvent.click(toggleButtons[0]);
    await waitFor(() => {
      expect(screen.getByText('Stop All Agents')).toBeTruthy();
    });
  });

  it('calls stop endpoint when Stop All Agents is clicked', async () => {
    mockApiFetch.mockImplementation((path: string, opts?: any) => {
      if (path === '/projects') return Promise.resolve(sampleProjects);
      if (path === `/projects/${sampleProjects[0].id}` && !opts) return Promise.resolve({
        ...sampleProjects[0],
        sessions: [],
      });
      if (path === `/projects/${sampleProjects[0].id}/stop` && opts?.method === 'POST')
        return Promise.resolve({ ok: true, terminated: 2, total: 3 });
      return Promise.resolve([]);
    });

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeTruthy();
    });

    const toggleButtons = screen.getAllByRole('button', { name: 'Toggle details' });
    fireEvent.click(toggleButtons[0]);
    await waitFor(() => {
      expect(screen.getByText('Stop All Agents')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Stop All Agents'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/projects/proj-1/stop', { method: 'POST' });
      expect(mockAddToast).toHaveBeenCalledWith('success', 'Stopped 2 agent(s)');
    });
  });

  it('does not show Stop button when project has no running agents', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/projects') return Promise.resolve(sampleProjects);
      if (path === `/projects/${sampleProjects[1].id}`) return Promise.resolve(sampleProjects[1]);
      return Promise.resolve([]);
    });

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Alpha Project')).toBeTruthy();
    });

    // Switch to Archived to see proj-2
    const buttons = screen.getAllByRole('button');
    const archivedFilterBtn = buttons.find((b) => b.textContent?.startsWith('Archived') && b.textContent?.includes('('));
    fireEvent.click(archivedFilterBtn!);
    await waitFor(() => {
      expect(screen.getByText('Beta Project')).toBeTruthy();
    });

    const toggleButtons = screen.getAllByRole('button', { name: 'Toggle details' });
    fireEvent.click(toggleButtons[0]);
    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeTruthy();
    });
    expect(screen.queryByText('Stop All Agents')).toBeNull();
  });
});
