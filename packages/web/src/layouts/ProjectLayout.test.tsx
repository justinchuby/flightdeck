// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProjectLayout } from './ProjectLayout';

// ── localStorage polyfill (jsdom may not provide a working one) ────
const store: Record<string, string> = {};
const localStorageMock: Storage = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  get length() { return Object.keys(store).length; },
  key: (i: number) => Object.keys(store)[i] ?? null,
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

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
    expect(screen.getByTestId('tab-artifacts')).toBeInTheDocument();
    expect(screen.getByTestId('tab-knowledge')).toBeInTheDocument();
    expect(screen.getByTestId('tab-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('tab-groups')).toBeInTheDocument();
    expect(screen.getByTestId('tab-org-chart')).toBeInTheDocument();
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
    expect(screen.getByTestId('overflow-item-agents')).toBeInTheDocument();
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

  // ── B-10: Tab persistence ──────────────────────────────────────

  describe('tab persistence (B-10)', () => {
    beforeEach(() => {
      localStorage.removeItem('flightdeck-project-tab');
    });

    it('saves active tab to localStorage on tab change', () => {
      renderLayout('/projects/proj-123/tasks');
      const stored = JSON.parse(localStorage.getItem('flightdeck-project-tab') ?? '{}');
      expect(stored['proj-123']).toBe('tasks');
    });

    it('does not save overview tab (it is the default)', () => {
      renderLayout('/projects/proj-123/overview');
      const stored = JSON.parse(localStorage.getItem('flightdeck-project-tab') ?? '{}');
      expect(stored['proj-123']).toBeUndefined();
    });

    it('restores saved tab on project root navigation', () => {
      localStorage.setItem('flightdeck-project-tab', JSON.stringify({ 'proj-123': 'agents' }));
      renderLayout('/projects/proj-123');
      expect(mockNavigate).toHaveBeenCalledWith('/projects/proj-123/agents', { replace: true });
    });

    it('handles corrupted JSON gracefully', () => {
      localStorage.setItem('flightdeck-project-tab', 'not-json!!!');
      // Should not throw
      renderLayout('/projects/proj-123');
      expect(screen.getByTestId('project-layout')).toBeInTheDocument();
    });

    it('ignores invalid tab names from localStorage', () => {
      localStorage.setItem('flightdeck-project-tab', JSON.stringify({ 'proj-123': 'nonexistent-tab' }));
      renderLayout('/projects/proj-123');
      // Should NOT navigate to an invalid tab
      expect(mockNavigate).not.toHaveBeenCalledWith(
        expect.stringContaining('nonexistent-tab'),
        expect.anything(),
      );
    });

    it('evicts oldest entries when exceeding max stored projects', () => {
      const stored: Record<string, string> = {};
      for (let i = 0; i < 55; i++) {
        stored[`proj-old-${i}`] = 'tasks';
      }
      localStorage.setItem('flightdeck-project-tab', JSON.stringify(stored));
      renderLayout('/projects/proj-123/agents');
      const result = JSON.parse(localStorage.getItem('flightdeck-project-tab') ?? '{}');
      expect(Object.keys(result).length).toBeLessThanOrEqual(51);
    });
  });

  // ── B-11: Keyboard shortcuts ───────────────────────────────────

  describe('keyboard shortcuts (B-11)', () => {
    it('navigates to tab on Alt+1', () => {
      renderLayout();
      fireEvent.keyDown(window, { key: '1', altKey: true });
      expect(mockNavigate).toHaveBeenCalledWith('/projects/proj-123/overview');
    });

    it('navigates to tab on Alt+3', () => {
      renderLayout();
      fireEvent.keyDown(window, { key: '3', altKey: true });
      expect(mockNavigate).toHaveBeenCalledWith('/projects/proj-123/tasks');
    });

    it('ignores number keys without Alt', () => {
      renderLayout();
      mockNavigate.mockClear();
      fireEvent.keyDown(window, { key: '1' });
      // Only the initial render may have called navigate, not from keyboard
      const kbCalls = mockNavigate.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('/overview'),
      );
      expect(kbCalls).toHaveLength(0);
    });

    it('ignores Alt+key for numbers beyond tab count', () => {
      renderLayout();
      mockNavigate.mockClear();
      fireEvent.keyDown(window, { key: '9', altKey: true });
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('cleans up keydown listener on unmount', () => {
      const spy = vi.spyOn(window, 'removeEventListener');
      const { unmount } = renderLayout();
      unmount();
      expect(spy).toHaveBeenCalledWith('keydown', expect.any(Function));
      spy.mockRestore();
    });
  });
});
