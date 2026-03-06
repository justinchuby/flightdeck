/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// Mock stores and hooks
vi.mock('../../../stores/appStore', () => ({
  useAppStore: vi.fn((selector: any) => selector({ agents: [] })),
}));

vi.mock('../../../hooks/useProjects', () => ({
  useProjects: vi.fn(() => ({ projects: [], loading: false })),
}));

import { ProjectTabs } from '../ProjectTabs';
import { useAppStore } from '../../../stores/appStore';
import { useProjects } from '../../../hooks/useProjects';

describe('ProjectTabs', () => {
  const onChange = vi.fn();

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders nothing when no projects or agents', () => {
    const { container } = render(
      <ProjectTabs activeId={null} onChange={onChange} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders historical projects as tabs', () => {
    vi.mocked(useProjects).mockReturnValue({
      projects: [
        { id: 'p1', name: 'Alpha', description: '', cwd: null, status: 'completed', createdAt: '', updatedAt: '' },
        { id: 'p2', name: 'Beta', description: '', cwd: null, status: 'completed', createdAt: '', updatedAt: '' },
      ],
      loading: false,
    });

    render(<ProjectTabs activeId="p1" onChange={onChange} />);

    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.getByText('Alpha').closest('[role="tab"]')?.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Beta').closest('[role="tab"]')?.getAttribute('aria-selected')).toBe('false');
  });

  it('calls onChange when tab is clicked', () => {
    vi.mocked(useProjects).mockReturnValue({
      projects: [
        { id: 'p1', name: 'Alpha', description: '', cwd: null, status: 'completed', createdAt: '', updatedAt: '' },
        { id: 'p2', name: 'Beta', description: '', cwd: null, status: 'completed', createdAt: '', updatedAt: '' },
      ],
      loading: false,
    });

    render(<ProjectTabs activeId="p1" onChange={onChange} />);
    fireEvent.click(screen.getByText('Beta'));
    expect(onChange).toHaveBeenCalledWith('p2');
  });

  it('shows live indicator dot for live agents', () => {
    vi.mocked(useAppStore).mockImplementation((selector: any) =>
      selector({
        agents: [
          { id: 'lead-1', role: { id: 'lead', name: 'Lead' }, parentId: null, projectName: 'Live Project', status: 'running' },
        ],
      }),
    );

    render(<ProjectTabs activeId="lead-1" onChange={onChange} />);
    expect(screen.getByTitle('Live session')).toBeTruthy();
    expect(screen.getByText('Live Project')).toBeTruthy();
  });

  it('deduplicates live agents and historical projects with same id', () => {
    vi.mocked(useAppStore).mockImplementation((selector: any) =>
      selector({
        agents: [
          { id: 'p1', role: { id: 'lead', name: 'Lead' }, parentId: null, projectName: 'Alpha Live' },
        ],
      }),
    );
    vi.mocked(useProjects).mockReturnValue({
      projects: [
        { id: 'p1', name: 'Alpha', description: '', cwd: null, status: 'active', createdAt: '', updatedAt: '' },
      ],
      loading: false,
    });

    render(<ProjectTabs activeId="p1" onChange={onChange} />);
    // Should show live version only, not duplicate
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(1);
    expect(screen.getByText('Alpha Live')).toBeTruthy();
  });

  it('auto-selects first tab when activeId is null', () => {
    vi.mocked(useProjects).mockReturnValue({
      projects: [
        { id: 'p1', name: 'Alpha', description: '', cwd: null, status: 'completed', createdAt: '', updatedAt: '' },
        { id: 'p2', name: 'Beta', description: '', cwd: null, status: 'completed', createdAt: '', updatedAt: '' },
      ],
      loading: false,
    });

    render(<ProjectTabs activeId={null} onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith('p1');
  });

  it('auto-selects first tab when activeId is not in tabs', () => {
    vi.mocked(useProjects).mockReturnValue({
      projects: [
        { id: 'p1', name: 'Alpha', description: '', cwd: null, status: 'completed', createdAt: '', updatedAt: '' },
      ],
      loading: false,
    });

    render(<ProjectTabs activeId="nonexistent" onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith('p1');
  });
});
