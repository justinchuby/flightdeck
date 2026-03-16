// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProjectCard, type EnrichedProject } from '../ProjectCard';

vi.mock('../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
vi.mock('../ProjectCardDetails', () => ({
  ProjectCardDetails: (props: any) => (
    <div data-testid="project-card-details">
      <span data-testid="detail-project-id">{props.project.id}</span>
    </div>
  ),
}));

function makeProject(overrides: Partial<EnrichedProject> = {}): EnrichedProject {
  return {
    id: 'proj-1',
    name: 'Test Project',
    description: 'A test project',
    cwd: '/home/user/project',
    status: 'active',
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T12:00:00Z',
    activeAgentCount: 3,
    runningAgentCount: 2,
    idleAgentCount: 1,
    failedAgentCount: 0,
    storageMode: 'local',
    sessions: [],
    taskProgress: { done: 5, total: 10 },
    tokenUsage: { inputTokens: 50000, outputTokens: 25000, costUsd: 0.5 },
    ...overrides,
  };
}

function renderCard(overrides: Record<string, any> = {}) {
  const defaultProps = {
    project: makeProject(),
    isExpanded: false,
    isSelected: false,
    onToggle: vi.fn(),
    onSelect: vi.fn(),
    onResume: vi.fn(),
    onArchive: vi.fn(),
    onStop: vi.fn(),
    onDelete: vi.fn(),
    confirmingDeleteId: null as string | null,
    onConfirmDelete: vi.fn(),
    onCancelDelete: vi.fn(),
    editingCwdId: null as string | null,
    cwdValue: '',
    onEditCwd: vi.fn(),
    onCwdChange: vi.fn(),
    onSaveCwd: vi.fn(),
    onCancelCwdEdit: vi.fn(),
    onViewSession: vi.fn(),
    ...overrides,
  };
  return {
    ...render(
      <MemoryRouter>
        <ProjectCard {...defaultProps} />
      </MemoryRouter>,
    ),
    props: defaultProps,
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('ProjectCard — extra coverage', () => {
  it('renders project name as a link', () => {
    renderCard();
    const link = screen.getByText('Test Project');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/projects/proj-1');
  });

  it('renders project description when present', () => {
    renderCard({ project: makeProject({ description: 'My desc' }) });
    expect(screen.getByText('My desc')).toBeInTheDocument();
  });

  it('does not render description when empty', () => {
    renderCard({ project: makeProject({ description: '' }) });
    expect(screen.queryByText('My desc')).not.toBeInTheDocument();
  });

  it('renders local storage badge', () => {
    renderCard({ project: makeProject({ storageMode: 'local' }) });
    expect(screen.getByText('local')).toBeInTheDocument();
  });

  it('renders user storage badge', () => {
    renderCard({ project: makeProject({ storageMode: 'user' }) });
    expect(screen.getByText('user')).toBeInTheDocument();
  });

  it('shows agent count in card header when activeAgentCount > 0', () => {
    renderCard({ project: makeProject({ activeAgentCount: 5 }) });
    // Agent count badge at top-right + inline count
    const fives = screen.getAllByText('5');
    expect(fives.length).toBeGreaterThanOrEqual(1);
  });

  it('hides agent count badge when activeAgentCount is 0', () => {
    renderCard({ project: makeProject({ activeAgentCount: 0 }) });
    expect(screen.queryByText('0 agents')).not.toBeInTheDocument();
  });

  it('shows task progress when present', () => {
    renderCard({ project: makeProject({ taskProgress: { done: 3, total: 7 } }) });
    expect(screen.getByText('3/7 tasks')).toBeInTheDocument();
  });

  it('hides task progress when total is 0', () => {
    renderCard({ project: makeProject({ taskProgress: { done: 0, total: 0 } }) });
    expect(screen.queryByText('tasks')).not.toBeInTheDocument();
  });

  it('hides task progress when not set', () => {
    renderCard({ project: makeProject({ taskProgress: undefined }) });
    expect(screen.queryByText('tasks')).not.toBeInTheDocument();
  });

  it('checkbox calls onSelect and stops propagation', () => {
    const { props } = renderCard();
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(props.onSelect).toHaveBeenCalled();
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it('checkbox reflects isSelected state', () => {
    renderCard({ isSelected: true });
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('clicking header calls onToggle', () => {
    const { props } = renderCard();
    const header = screen.getByRole('button', { name: /Toggle details/ });
    fireEvent.click(header);
    expect(props.onToggle).toHaveBeenCalled();
  });

  it('shows ChevronDown when expanded', () => {
    const { container } = renderCard({ isExpanded: true });
    expect(container.querySelector('[data-testid="project-card-details"]')).toBeTruthy();
  });

  it('does not show details when collapsed', () => {
    const { container } = renderCard({ isExpanded: false });
    expect(container.querySelector('[data-testid="project-card-details"]')).toBeNull();
  });

  it('link click does not propagate to toggle', () => {
    const { props } = renderCard();
    const link = screen.getByText('Test Project');
    fireEvent.click(link);
    // onToggle should not be called because link stops propagation
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it('renders aria-expanded attribute correctly', () => {
    const { rerender } = renderCard({ isExpanded: false });
    const header = screen.getByRole('button', { name: /Toggle details/ });
    expect(header.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders singular "agent" for count of 1', () => {
    renderCard({ project: makeProject({ activeAgentCount: 1 }) });
    expect(screen.getByText('1 agent')).toBeInTheDocument();
  });

  it('renders plural "agents" for count > 1', () => {
    renderCard({ project: makeProject({ activeAgentCount: 3 }) });
    expect(screen.getByText('3 agents')).toBeInTheDocument();
  });
});
