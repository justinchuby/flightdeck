import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ── Mocks ─────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  Outlet: () => <div data-testid="outlet">Outlet</div>,
  useParams: () => ({ id: 'proj-1' }),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/projects/proj-1/overview' }),
}));

const mockApiFetch = vi.fn().mockResolvedValue({
  id: 'proj-1',
  name: 'Fetched Project',
  status: 'active',
  agentCount: 3,
});
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../../hooks/useProjects', () => ({
  useProjects: () => ({ projects: [] }),
}));

vi.mock('../../components/ProjectOversightPicker/ProjectOversightPicker', () => ({
  ProjectOversightPicker: () => <div data-testid="oversight-picker" />,
}));

vi.mock('../../components/ui/Tabs', () => ({
  Tabs: ({ tabs, activeTab, onTabChange }: any) => (
    <div data-testid="tabs">
      {tabs.map((t: any) => (
        <button
          key={t.id}
          data-testid={`tab-${t.id}`}
          data-active={t.id === activeTab}
          onClick={() => onTabChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../../components/ui/StatusBadge', () => ({
  StatusBadge: ({ label }: any) => <span data-testid="status-badge">{label}</span>,
}));

vi.mock('../../components/PageTransition', () => ({
  PageTransition: ({ children }: any) => <div data-testid="page-transition">{children}</div>,
}));

import { useAppStore } from '../../stores/appStore';
import { ProjectLayout } from '../ProjectLayout';

describe('ProjectLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ agents: [] });
    try { localStorage.clear(); } catch { /* jsdom may not support */ }
  });

  it('renders project layout with header, tabs, and outlet', async () => {
    await act(async () => {
      render(<ProjectLayout />);
    });
    expect(screen.getByTestId('project-layout')).toBeTruthy();
    expect(screen.getByTestId('tabs')).toBeTruthy();
    expect(screen.getByTestId('outlet')).toBeTruthy();
  });

  it('shows project name from fetched details', async () => {
    await act(async () => {
      render(<ProjectLayout />);
    });
    // Will display short ID initially, then fetched name after apiFetch resolves
    expect(mockApiFetch).toHaveBeenCalledWith('/projects/proj-1');
  });

  it('renders back button that navigates to /projects', async () => {
    await act(async () => {
      render(<ProjectLayout />);
    });
    fireEvent.click(screen.getByTestId('back-button'));
    expect(mockNavigate).toHaveBeenCalledWith('/projects');
  });

  it('navigates to tab route on tab click', async () => {
    await act(async () => {
      render(<ProjectLayout />);
    });
    fireEvent.click(screen.getByTestId('tab-tasks'));
    expect(mockNavigate).toHaveBeenCalledWith('/projects/proj-1/tasks');
  });

  it('renders overflow menu button', async () => {
    await act(async () => {
      render(<ProjectLayout />);
    });
    expect(screen.getByTestId('overflow-menu')).toBeTruthy();
  });

  it('opens and closes overflow menu', async () => {
    await act(async () => {
      render(<ProjectLayout />);
    });
    fireEvent.click(screen.getByTestId('overflow-menu'));
    expect(screen.getByTestId('overflow-dropdown')).toBeTruthy();

    // Click overflow menu again to toggle
    fireEvent.click(screen.getByTestId('overflow-menu'));
    expect(screen.queryByTestId('overflow-dropdown')).toBeNull();
  });

  it('navigates on overflow item click', async () => {
    await act(async () => {
      render(<ProjectLayout />);
    });
    fireEvent.click(screen.getByTestId('overflow-menu'));
    fireEvent.click(screen.getByTestId('overflow-item-analytics'));
    expect(mockNavigate).toHaveBeenCalledWith('/projects/proj-1/analytics');
  });

  it('shows live indicator when running agents exist', async () => {
    useAppStore.setState({
      agents: [{
        id: 'agent-1',
        projectId: 'proj-1',
        parentId: null,
        status: 'running',
        role: { id: 'lead', name: 'Lead', icon: '👑' },
      }] as any[],
    });
    await act(async () => {
      render(<ProjectLayout />);
    });
    expect(screen.getByTitle('Project has running agents')).toBeTruthy();
  });

  it('displays agent count stats when agents exist', async () => {
    useAppStore.setState({
      agents: [
        { id: 'a1', projectId: 'proj-1', parentId: null, status: 'running', role: { id: 'lead', name: 'Lead', icon: '👑' } },
        { id: 'a2', projectId: 'proj-1', parentId: 'a1', status: 'idle', role: { id: 'dev', name: 'Dev', icon: '💻' } },
      ] as any[],
    });
    await act(async () => {
      render(<ProjectLayout />);
    });
    expect(screen.getByTestId('agent-count')).toBeTruthy();
  });
});
