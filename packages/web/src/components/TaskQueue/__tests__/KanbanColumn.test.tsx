import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KanbanColumn, InlineToast } from '../KanbanColumn';
import type { KanbanColumnProps } from '../KanbanColumn';
import type { DagTask } from '../../../types';
import { DEFAULT_VISIBLE } from '../kanbanConstants';

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: any) => <div data-testid="sortable-context">{children}</div>,
  verticalListSortingStrategy: {},
}));

vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ setNodeRef: vi.fn() }),
}));

vi.mock('../TaskCard', () => ({
  SortableTaskCard: ({ task }: any) => (
    <div data-testid={`task-${task.id}`}>{task.title}</div>
  ),
}));

// ── Fixtures ──────────────────────────────────────────────────────

function makeTask(overrides: Partial<DagTask> = {}): DagTask {
  return {
    id: `task-${Math.random().toString(36).slice(2, 8)}`,
    leadId: 'lead-1',
    projectId: 'proj-1',
    role: 'developer',
    title: 'Test task',
    description: '',
    files: [],
    dependsOn: [],
    dagStatus: 'pending',
    priority: 0,
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

const pendingColumn = {
  status: 'pending' as const,
  label: 'Pending',
  icon: '⏳',
  accentClass: 'text-th-text-muted',
  borderClass: 'border-th-border',
};

const doneColumn = {
  status: 'done' as const,
  label: 'Done',
  icon: '✅',
  accentClass: 'text-emerald-400',
  borderClass: 'border-emerald-500/30',
};

function defaultProps(overrides: Partial<KanbanColumnProps> = {}): KanbanColumnProps {
  return {
    column: pendingColumn,
    tasks: [],
    allTasks: [],
    collapsed: false,
    onToggleCollapse: vi.fn(),
    isDropTarget: false,
    isInvalidTarget: false,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('KanbanColumn', () => {
  it('renders column header with label and count', () => {
    const tasks = [makeTask(), makeTask()];
    render(<KanbanColumn {...defaultProps({ tasks, allTasks: tasks })} />);
    expect(screen.getByText('Pending')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('renders task cards when not collapsed', () => {
    const tasks = [makeTask({ title: 'Task A' }), makeTask({ title: 'Task B' })];
    render(<KanbanColumn {...defaultProps({ tasks, allTasks: tasks })} />);
    expect(screen.getByText('Task A')).toBeTruthy();
    expect(screen.getByText('Task B')).toBeTruthy();
  });

  it('hides task cards when collapsed', () => {
    const tasks = [makeTask({ title: 'Task A' })];
    render(<KanbanColumn {...defaultProps({ tasks, allTasks: tasks, collapsed: true })} />);
    expect(screen.queryByText('Task A')).toBeNull();
  });

  it('shows empty message when no tasks', () => {
    render(<KanbanColumn {...defaultProps()} />);
    expect(screen.getByText('No tasks')).toBeTruthy();
  });

  it('calls onToggleCollapse when header is clicked', () => {
    const props = defaultProps();
    render(<KanbanColumn {...props} />);
    fireEvent.click(screen.getByText('Pending'));
    expect(props.onToggleCollapse).toHaveBeenCalled();
  });

  it('applies blue ring class when isDropTarget', () => {
    render(<KanbanColumn {...defaultProps({ isDropTarget: true })} />);
    const col = screen.getByTestId('kanban-column-pending');
    expect(col.className).toContain('ring-blue-500');
  });

  it('applies red ring class when isInvalidTarget', () => {
    render(<KanbanColumn {...defaultProps({ isInvalidTarget: true })} />);
    const col = screen.getByTestId('kanban-column-pending');
    expect(col.className).toContain('ring-red-500');
  });

  it('limits visible tasks in done column and shows "Show all" button', () => {
    const tasks = Array.from({ length: DEFAULT_VISIBLE + 3 }, (_, i) =>
      makeTask({ id: `t-${i}`, title: `Done ${i}`, dagStatus: 'done' }),
    );
    render(<KanbanColumn {...defaultProps({ column: doneColumn, tasks, allTasks: tasks })} />);

    // Only DEFAULT_VISIBLE should render initially
    expect(screen.getByTestId('show-all-toggle')).toBeTruthy();
    expect(screen.getByText(`Show all ${tasks.length} tasks`)).toBeTruthy();
  });

  it('shows all tasks when "Show all" is clicked', () => {
    const tasks = Array.from({ length: DEFAULT_VISIBLE + 3 }, (_, i) =>
      makeTask({ id: `t-${i}`, title: `Done ${i}`, dagStatus: 'done' }),
    );
    render(<KanbanColumn {...defaultProps({ column: doneColumn, tasks, allTasks: tasks })} />);

    fireEvent.click(screen.getByTestId('show-all-toggle'));

    // All tasks should now be visible and "Show recent" should appear
    expect(screen.queryByTestId('show-all-toggle')).toBeNull();
    expect(screen.getByTestId('show-less-toggle')).toBeTruthy();
  });

  it('collapses back to recent when "Show recent" is clicked', () => {
    const tasks = Array.from({ length: DEFAULT_VISIBLE + 3 }, (_, i) =>
      makeTask({ id: `t-${i}`, title: `Done ${i}`, dagStatus: 'done' }),
    );
    render(<KanbanColumn {...defaultProps({ column: doneColumn, tasks, allTasks: tasks })} />);

    fireEvent.click(screen.getByTestId('show-all-toggle'));
    fireEvent.click(screen.getByTestId('show-less-toggle'));

    expect(screen.getByTestId('show-all-toggle')).toBeTruthy();
  });

  it('renders column tooltip on header button', () => {
    render(<KanbanColumn {...defaultProps()} />);
    const headerBtn = screen.getByText('Pending').closest('button')!;
    expect(headerBtn.getAttribute('title')).toBeTruthy();
  });
});

describe('InlineToast', () => {
  it('renders message text', () => {
    render(<InlineToast message="Something went wrong" onDismiss={vi.fn()} />);
    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });

  it('calls onDismiss when dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(<InlineToast message="Error" onDismiss={onDismiss} />);
    // The dismiss button is the only button in the toast
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    expect(onDismiss).toHaveBeenCalled();
  });
});
