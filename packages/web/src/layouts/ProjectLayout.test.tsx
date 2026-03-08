// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProjectLayout } from './ProjectLayout';

// ── Mocks ─────────────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../stores/appStore', () => ({
  useAppStore: () => [],
}));

vi.mock('../stores/leadStore', () => ({
  useLeadStore: Object.assign(
    () => null,
    { getState: () => ({ selectedLeadId: null, addProject: vi.fn(), selectLead: vi.fn() }) },
  ),
}));

vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ projects: [], loading: false }),
}));

// ── Helpers ───────────────────────────────────────────────────────

function renderLayout(path = '/projects/proj-123') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projects/:id/*" element={<ProjectLayout />}>
          <Route index element={<div data-testid="child-overview">Overview Content</div>} />
          <Route path="overview" element={<div data-testid="child-overview">Overview Content</div>} />
          <Route path="tasks" element={<div data-testid="child-tasks">Tasks Content</div>} />
          <Route path="agents" element={<div data-testid="child-agents">Agents Content</div>} />
          <Route path="analytics" element={<div data-testid="child-analytics">Analytics Content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const projectDetails = {
  id: 'proj-123',
  name: 'My Test Project',
  status: 'active',
  agentCount: 5,
};

// ── Tests ─────────────────────────────────────────────────────────

describe('ProjectLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue(projectDetails);
  });

  it('renders layout with project name', async () => {
    renderLayout();
    expect(screen.getByTestId('project-layout')).toBeInTheDocument();
    // Fallback name before fetch resolves (first 8 chars of id)
    expect(screen.getByTestId('project-name')).toBeInTheDocument();
  });

  it('fetches project details on mount', async () => {
    renderLayout();
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/projects/proj-123');
    });
  });

  it('shows status badge after fetch', async () => {
    renderLayout();
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  it('shows agent count after fetch', async () => {
    renderLayout();
    await waitFor(() => {
      expect(screen.getByTestId('agent-count')).toHaveTextContent('5');
    });
  });

  it('renders primary tabs', () => {
    renderLayout();
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    expect(screen.getByTestId('tab-session')).toBeInTheDocument();
    expect(screen.getByTestId('tab-tasks')).toBeInTheDocument();
    expect(screen.getByTestId('tab-agents')).toBeInTheDocument();
    expect(screen.getByTestId('tab-knowledge')).toBeInTheDocument();
  });

  it('renders child content via Outlet', () => {
    renderLayout();
    expect(screen.getByTestId('child-overview')).toBeInTheDocument();
  });

  it('navigates back to projects on back button click', () => {
    renderLayout();
    fireEvent.click(screen.getByTestId('back-button'));
    expect(mockNavigate).toHaveBeenCalledWith('/projects');
  });

  it('navigates to tab route on tab click', () => {
    renderLayout();
    fireEvent.click(screen.getByTestId('tab-tasks'));
    expect(mockNavigate).toHaveBeenCalledWith('/projects/proj-123/tasks');
  });

  it('navigates to overview tab on overview tab click', () => {
    renderLayout('/projects/proj-123/tasks');
    fireEvent.click(screen.getByTestId('tab-overview'));
    expect(mockNavigate).toHaveBeenCalledWith('/projects/proj-123/overview');
  });

  it('renders overflow menu button', () => {
    renderLayout();
    expect(screen.getByTestId('overflow-menu')).toBeInTheDocument();
  });

  it('opens overflow dropdown on click', () => {
    renderLayout();
    expect(screen.queryByTestId('overflow-dropdown')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('overflow-menu'));
    expect(screen.getByTestId('overflow-dropdown')).toBeInTheDocument();
  });

  it('shows all overflow items', () => {
    renderLayout();
    fireEvent.click(screen.getByTestId('overflow-menu'));
    expect(screen.getByTestId('overflow-item-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('overflow-item-groups')).toBeInTheDocument();
    expect(screen.getByTestId('overflow-item-org-chart')).toBeInTheDocument();
    expect(screen.getByTestId('overflow-item-analytics')).toBeInTheDocument();
    expect(screen.getByTestId('overflow-item-canvas')).toBeInTheDocument();
  });

  it('navigates on overflow item click and closes dropdown', () => {
    renderLayout();
    fireEvent.click(screen.getByTestId('overflow-menu'));
    fireEvent.click(screen.getByTestId('overflow-item-analytics'));
    expect(mockNavigate).toHaveBeenCalledWith('/projects/proj-123/analytics');
    expect(screen.queryByTestId('overflow-dropdown')).not.toBeInTheDocument();
  });

  it('closes overflow on outside click', () => {
    renderLayout();
    fireEvent.click(screen.getByTestId('overflow-menu'));
    expect(screen.getByTestId('overflow-dropdown')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('overflow-dropdown')).not.toBeInTheDocument();
  });

  it('degrades gracefully when project fetch fails', async () => {
    mockApiFetch.mockRejectedValue(new Error('not found'));
    renderLayout();
    // Should still render layout — details are non-critical
    await waitFor(() => {
      expect(screen.getByTestId('project-layout')).toBeInTheDocument();
    });
    expect(screen.getByTestId('project-name')).toBeInTheDocument();
  });

  it('highlights overflow button when overflow tab is active', () => {
    renderLayout('/projects/proj-123/analytics');
    const btn = screen.getByTestId('overflow-menu');
    expect(btn.className).toContain('text-accent');
  });
});
