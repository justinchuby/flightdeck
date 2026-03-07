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

  it('uses lead.projectId as tab ID when available', () => {
    vi.mocked(useAppStore).mockImplementation((selector: any) =>
      selector({
        agents: [
          { id: 'agent-uuid-1', projectId: 'proj-uuid-1', role: { id: 'lead', name: 'Lead' }, parentId: null, projectName: 'My Project', status: 'running' },
        ],
      }),
    );
    vi.mocked(useProjects).mockReturnValue({ projects: [], loading: false });

    render(<ProjectTabs activeId="proj-uuid-1" onChange={onChange} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(1);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('My Project')).toBeTruthy();
  });

  it('deduplicates live lead by projectId against historical project', () => {
    vi.mocked(useAppStore).mockImplementation((selector: any) =>
      selector({
        agents: [
          { id: 'agent-uuid-1', projectId: 'proj-1', role: { id: 'lead', name: 'Lead' }, parentId: null, projectName: 'Live Alpha', status: 'running' },
        ],
      }),
    );
    vi.mocked(useProjects).mockReturnValue({
      projects: [
        { id: 'proj-1', name: 'Historical Alpha', description: '', cwd: null, status: 'completed', createdAt: '', updatedAt: '' },
      ],
      loading: false,
    });

    render(<ProjectTabs activeId="proj-1" onChange={onChange} />);
    // Live version should win; historical duplicate suppressed
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(1);
    expect(screen.getByText('Live Alpha')).toBeTruthy();
  });

  it('falls back to lead.id when projectId is missing', () => {
    vi.mocked(useAppStore).mockImplementation((selector: any) =>
      selector({
        agents: [
          { id: 'agent-uuid-1', role: { id: 'lead', name: 'Lead' }, parentId: null, projectName: 'Untitled', status: 'running' },
        ],
      }),
    );
    vi.mocked(useProjects).mockReturnValue({ projects: [], loading: false });

    render(<ProjectTabs activeId="agent-uuid-1" onChange={onChange} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(1);
    fireEvent.click(tabs[0]);
    expect(onChange).toHaveBeenCalledWith('agent-uuid-1');
  });

  it('falls back to lead.id when projectId is empty string (untitled project)', () => {
    vi.mocked(useAppStore).mockImplementation((selector: any) =>
      selector({
        agents: [
          { id: 'agent-uuid-1', projectId: '', role: { id: 'lead', name: 'Lead' }, parentId: null, projectName: '', status: 'running' },
        ],
      }),
    );
    vi.mocked(useProjects).mockReturnValue({ projects: [], loading: false });

    render(<ProjectTabs activeId="agent-uuid-1" onChange={onChange} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(1);
    fireEvent.click(tabs[0]);
    // Empty string projectId is falsy, so falls back to lead.id
    expect(onChange).toHaveBeenCalledWith('agent-uuid-1');
  });

  it('auto-selects first tab when activeId is null', () => {
    vi.mocked(useAppStore).mockImplementation((selector: any) =>
      selector({ agents: [] }),
    );
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
    vi.mocked(useAppStore).mockImplementation((selector: any) =>
      selector({ agents: [] }),
    );
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
