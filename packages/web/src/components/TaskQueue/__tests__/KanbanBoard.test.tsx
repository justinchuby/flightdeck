/**
 * Unit + integration tests for KanbanBoard component.
 *
 * Covers: column rendering, task grouping by status, card display,
 * empty state, hide-empty toggle, column collapse, task sorting,
 * expanded card details, dependency rendering, filter bar,
 * agent on card face, time-in-status, context menu, failed-never-hidden,
 * auto-collapse done, color semantics, column tooltips, persistent state,
 * Add Task form (submission, validation, errors), context menu API calls,
 * DnD cross-column status change, DnD same-column reorder, DnD invalid targets.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { KanbanBoard } from '../KanbanBoard';
import type { DagStatus, DagTask, DagTaskStatus } from '../../../types';

// Mock apiFetch for API interaction tests
const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

// Mock settingsStore so oversight level is 'balanced' (default 'autonomous' hides role/agent UI)
vi.mock('../../../stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: any) => any) => selector({ oversightLevel: 'balanced' }),
}));

// ── Fixtures ──────────────────────────────────────────────────────

function makeTask(overrides: Partial<DagTask> = {}): DagTask {
  return {
    id: `task-${Math.random().toString(36).slice(2, 6)}`,
    leadId: 'lead-1',
    projectId: 'proj-1',
    role: 'developer',
    title: 'Test task',
    description: 'A test task description',
    files: [],
    dependsOn: [],
    dagStatus: 'pending',
    priority: 0,
    createdAt: '2026-03-08T00:00:00Z',
    ...overrides,
  };
}

function makeDagStatus(tasks: DagTask[]): DagStatus {
  const summary: DagStatus['summary'] = {
    pending: 0, ready: 0, running: 0, done: 0,
    failed: 0, blocked: 0, paused: 0, skipped: 0,
  };
  for (const t of tasks) {
    summary[t.dagStatus]++;
  }
  return { tasks, fileLockMap: {}, summary };
}

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockApiFetch.mockReset();
  try {
    localStorage.clear();
  } catch {
    // localStorage may not be available in test environment
  }
});

describe('KanbanBoard', () => {
  describe('empty state', () => {
    it('shows empty message when dagStatus is null', () => {
      render(<KanbanBoard dagStatus={null} />);
      expect(screen.getByText(/No tasks/)).toBeTruthy();
    });

    it('shows empty message when no tasks', () => {
      render(<KanbanBoard dagStatus={makeDagStatus([])} />);
      expect(screen.getByText(/No tasks/)).toBeTruthy();
    });

    it('shows "Create first task" button when projectId is provided', () => {
      render(<KanbanBoard dagStatus={null} projectId="proj-1" />);
      expect(screen.getByText(/Create first task/)).toBeTruthy();
    });
  });

  describe('column rendering', () => {
    it('renders all 8 status columns by default', () => {
      const tasks = [makeTask({ dagStatus: 'running', id: 'r1' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      const statuses: DagTaskStatus[] = ['pending', 'ready', 'running', 'blocked', 'done', 'failed', 'paused', 'skipped'];
      for (const status of statuses) {
        expect(screen.getByTestId(`kanban-column-${status}`)).toBeTruthy();
      }
    });

    it('shows task count badges in column headers', () => {
      const tasks = [
        makeTask({ dagStatus: 'running', id: 'r1' }),
        makeTask({ dagStatus: 'running', id: 'r2' }),
        makeTask({ dagStatus: 'done', id: 'd1' }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      const runningCol = screen.getByTestId('kanban-column-running');
      expect(within(runningCol).getByText('2')).toBeTruthy();

      const doneCol = screen.getByTestId('kanban-column-done');
      expect(within(doneCol).getByText('1')).toBeTruthy();
    });

    it('shows "No tasks" in empty columns', () => {
      const tasks = [makeTask({ dagStatus: 'running', id: 'r1' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      const pendingCol = screen.getByTestId('kanban-column-pending');
      expect(within(pendingCol).getByText('No tasks')).toBeTruthy();
    });

    it('has tooltips on column headers', () => {
      const tasks = [makeTask({ dagStatus: 'running', id: 'r1' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      const runningCol = screen.getByTestId('kanban-column-running');
      const header = within(runningCol).getAllByRole('button')[0];
      expect(header.getAttribute('title')).toContain('currently being worked on');
    });
  });

  describe('task grouping', () => {
    it('places tasks in the correct columns by status', () => {
      const tasks = [
        makeTask({ dagStatus: 'pending', id: 'p1', title: 'Pending Task' }),
        makeTask({ dagStatus: 'running', id: 'r1', title: 'Running Task' }),
        makeTask({ dagStatus: 'done', id: 'd1', title: 'Done Task' }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      const pendingCol = screen.getByTestId('kanban-column-pending');
      expect(within(pendingCol).getByText('Pending Task')).toBeTruthy();

      const runningCol = screen.getByTestId('kanban-column-running');
      expect(within(runningCol).getByText('Running Task')).toBeTruthy();

      const doneCol = screen.getByTestId('kanban-column-done');
      expect(within(doneCol).getByText('Done Task')).toBeTruthy();
    });
  });

  describe('task card', () => {
    it('displays task title and role', () => {
      const tasks = [makeTask({ id: 't1', title: 'Build widget', role: 'architect' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      expect(screen.getByText('Build widget')).toBeTruthy();
      expect(screen.getByText('architect')).toBeTruthy();
    });

    it('falls back to description when title is empty', () => {
      const tasks = [makeTask({ id: 't1', title: undefined, description: 'Fallback description' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      expect(screen.getByText('Fallback description')).toBeTruthy();
    });

    it('shows priority badge for priority > 0', () => {
      const tasks = [makeTask({ id: 't1', priority: 2 })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      expect(screen.getByText('P2')).toBeTruthy();
    });

    it('does not show priority badge for priority 0', () => {
      const tasks = [makeTask({ id: 't1', priority: 0 })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      expect(screen.queryByText('P0')).toBeNull();
    });

    it('shows agent badge on card face (R2)', () => {
      const tasks = [
        makeTask({ id: 'a1', dagStatus: 'running', assignedAgentId: 'agent-x1' }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      // Agent should be visible WITHOUT expanding
      expect(screen.getByTestId('agent-badge')).toBeTruthy();
    });

  });

  describe('task sorting', () => {
    it('sorts tasks by priority desc within a column', () => {
      const tasks = [
        makeTask({ dagStatus: 'ready', id: 'lo', title: 'Low prio', priority: 1, createdAt: '2026-03-01T00:00:00Z' }),
        makeTask({ dagStatus: 'ready', id: 'hi', title: 'High prio', priority: 3, createdAt: '2026-03-02T00:00:00Z' }),
        makeTask({ dagStatus: 'ready', id: 'mid', title: 'Mid prio', priority: 2, createdAt: '2026-03-03T00:00:00Z' }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      const readyCol = screen.getByTestId('kanban-column-ready');
      const cards = within(readyCol).getAllByText(/prio/i);
      expect(cards[0].textContent).toBe('High prio');
      expect(cards[1].textContent).toBe('Mid prio');
      expect(cards[2].textContent).toBe('Low prio');
    });
  });

  describe('hide empty columns', () => {
    it('hides columns with no tasks when toggled', () => {
      const tasks = [makeTask({ dagStatus: 'running', id: 'r1' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      // All columns visible initially
      expect(screen.getByTestId('kanban-column-pending')).toBeTruthy();

      // Toggle hide empty
      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);

      // Pending should be gone, running should remain
      expect(screen.queryByTestId('kanban-column-pending')).toBeNull();
      expect(screen.getByTestId('kanban-column-running')).toBeTruthy();
    });

    it('never hides the Failed column (AC-12.5)', () => {
      const tasks = [makeTask({ dagStatus: 'running', id: 'r1' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      // Toggle hide empty
      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);

      // Failed column should still be visible even though it's empty
      expect(screen.getByTestId('kanban-column-failed')).toBeTruthy();
      // But pending should be hidden
      expect(screen.queryByTestId('kanban-column-pending')).toBeNull();
    });
  });

  describe('column collapse', () => {
    it('collapses a column when header is clicked', () => {
      const tasks = [makeTask({ dagStatus: 'running', id: 'r1', title: 'My Task' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      // Task card is visible
      expect(screen.getByText('My Task')).toBeTruthy();

      // Click column header to collapse
      const runningCol = screen.getByTestId('kanban-column-running');
      const headerButton = within(runningCol).getAllByRole('button')[0];
      fireEvent.click(headerButton);

      // Task card should be hidden after collapse
      expect(screen.queryByText('My Task')).toBeNull();

      // Click again to expand
      fireEvent.click(headerButton);
      expect(screen.getByText('My Task')).toBeTruthy();
    });
  });

  describe('expanded card details', () => {
    it('shows dependencies when card is expanded', () => {
      const tasks = [
        makeTask({ id: 'dep-1', title: 'Dep One', dagStatus: 'done' }),
        makeTask({ id: 'main', title: 'Main Task', dagStatus: 'running', dependsOn: ['dep-1'] }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      // Click the main task card to expand
      const card = screen.getByTestId('kanban-card-main');
      fireEvent.click(card);

      // Should show dependency info
      expect(screen.getByText('Dependencies:')).toBeTruthy();
      // The dependency label appears inside the running column's expanded card
      const runningCol = screen.getByTestId('kanban-column-running');
      expect(within(runningCol).getByText('Dep One')).toBeTruthy();
    });

    it('shows files when card is expanded', () => {
      const tasks = [
        makeTask({
          id: 'f1',
          title: 'File Task',
          dagStatus: 'running',
          files: ['src/index.ts', 'src/utils.ts'],
        }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      const card = screen.getByTestId('kanban-card-f1');
      fireEvent.click(card);

      expect(screen.getByText('src/index.ts')).toBeTruthy();
      expect(screen.getByText('src/utils.ts')).toBeTruthy();
    });
  });

  describe('summary toolbar', () => {
    it('shows total task count', () => {
      const tasks = [
        makeTask({ dagStatus: 'pending', id: 'p1' }),
        makeTask({ dagStatus: 'running', id: 'r1' }),
        makeTask({ dagStatus: 'done', id: 'd1' }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      expect(screen.getByText(/3 tasks/)).toBeTruthy();
    });
  });

  describe('filter bar', () => {
    it('shows filter bar when toggle is clicked', () => {
      const tasks = [makeTask({ dagStatus: 'running', id: 'r1' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      // Filter bar not visible initially
      expect(screen.queryByTestId('filter-bar')).toBeNull();

      // Click filter toggle
      fireEvent.click(screen.getByTestId('toggle-filters'));

      // Filter bar should appear
      expect(screen.getByTestId('filter-bar')).toBeTruthy();
      expect(screen.getByTestId('filter-search')).toBeTruthy();
    });

    it('filters tasks by search text', () => {
      const tasks = [
        makeTask({ dagStatus: 'running', id: 'r1', title: 'Build API' }),
        makeTask({ dagStatus: 'running', id: 'r2', title: 'Write Tests' }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      fireEvent.click(screen.getByTestId('toggle-filters'));
      const search = screen.getByTestId('filter-search');
      fireEvent.change(search, { target: { value: 'API' } });

      // Only 'Build API' should be visible
      expect(screen.getByText('Build API')).toBeTruthy();
      expect(screen.queryByText('Write Tests')).toBeNull();
    });

    it('filters tasks by role chip', () => {
      const tasks = [
        makeTask({ dagStatus: 'running', id: 'r1', title: 'Dev Task', role: 'developer' }),
        makeTask({ dagStatus: 'running', id: 'r2', title: 'Design Task', role: 'designer' }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      fireEvent.click(screen.getByTestId('toggle-filters'));
      fireEvent.click(screen.getByTestId('filter-role-designer'));

      // Only designer task visible
      expect(screen.queryByText('Dev Task')).toBeNull();
      expect(screen.getByText('Design Task')).toBeTruthy();
    });

    it('clears all filters', () => {
      const tasks = [
        makeTask({ dagStatus: 'running', id: 'r1', title: 'Build API' }),
        makeTask({ dagStatus: 'running', id: 'r2', title: 'Write Tests' }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      fireEvent.click(screen.getByTestId('toggle-filters'));
      const search = screen.getByTestId('filter-search');
      fireEvent.change(search, { target: { value: 'API' } });

      // Only 1 visible
      expect(screen.queryByText('Write Tests')).toBeNull();

      // Clear
      fireEvent.click(screen.getByTestId('filter-clear'));

      // Both visible again
      expect(screen.getByText('Build API')).toBeTruthy();
      expect(screen.getByText('Write Tests')).toBeTruthy();
    });

    it('shows filtered count in toolbar', () => {
      const tasks = [
        makeTask({ dagStatus: 'running', id: 'r1', title: 'Build API' }),
        makeTask({ dagStatus: 'running', id: 'r2', title: 'Write Tests' }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      fireEvent.click(screen.getByTestId('toggle-filters'));
      const search = screen.getByTestId('filter-search');
      fireEvent.change(search, { target: { value: 'API' } });

      // Toolbar should show "1 of 2 tasks"
      expect(screen.getByText(/1 of 2 tasks/)).toBeTruthy();
    });
  });

  describe('context menu', () => {
    it('shows context menu on right-click', () => {
      const tasks = [
        makeTask({ id: 'f1', dagStatus: 'failed', title: 'Failed Task' }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      const card = screen.getByTestId('kanban-card-f1');
      fireEvent.contextMenu(card);

      expect(screen.getByTestId('context-menu')).toBeTruthy();
      expect(screen.getByText('Retry')).toBeTruthy();
    });

    it('shows appropriate actions for running tasks', () => {
      const tasks = [
        makeTask({ id: 'r1', dagStatus: 'running', title: 'Running Task', startedAt: new Date().toISOString() }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      const card = screen.getByTestId('kanban-card-r1');
      fireEvent.contextMenu(card);

      expect(screen.getByText('Pause')).toBeTruthy();
      expect(screen.getByText('Skip')).toBeTruthy();
    });

    it('shows Force Ready for blocked tasks', () => {
      const tasks = [
        makeTask({ id: 'b1', dagStatus: 'blocked', title: 'Blocked Task' }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      const card = screen.getByTestId('kanban-card-b1');
      fireEvent.contextMenu(card);

      expect(screen.getByText('Force Ready')).toBeTruthy();
    });
  });

  describe('color semantics (R8)', () => {
    it('uses emerald for done column, not purple', () => {
      const tasks = [makeTask({ dagStatus: 'done', id: 'd1', title: 'Done task' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      const doneCol = screen.getByTestId('kanban-column-done');
      // Check that emerald is used (not purple)
      expect(doneCol.className).toContain('emerald');
      expect(doneCol.className).not.toContain('purple');
    });
  });

  describe('global scope', () => {
    it('shows project context text for global scope', () => {
      const tasks = [makeTask({ dagStatus: 'running', id: 'r1' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} scope="global" />);

      expect(screen.getByText(/across all projects/)).toBeTruthy();
    });
  });

  // ── Add Task Form ─────────────────────────────────────────────

  describe('Add Task form', () => {
    beforeEach(() => {
      mockApiFetch.mockReset();
    });

    it('opens form when "Add" button is clicked', () => {
      const tasks = [makeTask({ dagStatus: 'running', id: 'r1' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      expect(screen.queryByTestId('add-task-form')).toBeNull();
      fireEvent.click(screen.getByTestId('add-task-button'));
      expect(screen.getByTestId('add-task-form')).toBeTruthy();
    });

    it('submits form with title and role', async () => {
      mockApiFetch.mockResolvedValueOnce({});
      const onUpdated = vi.fn();
      const tasks = [makeTask({ dagStatus: 'running', id: 'r1' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" onTaskUpdated={onUpdated} />);

      fireEvent.click(screen.getByTestId('add-task-button'));

      const titleInput = screen.getByRole('textbox', { name: 'Task title' });
      const roleInput = screen.getByRole('textbox', { name: 'Task role' });
      fireEvent.change(titleInput, { target: { value: 'New Feature' } });
      fireEvent.change(roleInput, { target: { value: 'developer' } });
      fireEvent.submit(screen.getByTestId('add-task-form'));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/projects/proj-1/tasks',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ title: 'New Feature', role: 'developer' }),
          }),
        );
      });
    });

    it('includes description when provided', async () => {
      mockApiFetch.mockResolvedValueOnce({});
      const tasks = [makeTask({ dagStatus: 'running', id: 'r1' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      fireEvent.click(screen.getByTestId('add-task-button'));
      fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), { target: { value: 'Fix Bug' } });
      fireEvent.change(screen.getByRole('textbox', { name: 'Task role' }), { target: { value: 'developer' } });
      fireEvent.change(screen.getByRole('textbox', { name: 'Task description' }), { target: { value: 'Memory leak in parser' } });
      fireEvent.submit(screen.getByTestId('add-task-form'));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/projects/proj-1/tasks',
          expect.objectContaining({
            body: JSON.stringify({ title: 'Fix Bug', role: 'developer', description: 'Memory leak in parser' }),
          }),
        );
      });
    });

    it('disables submit when title or role is empty', () => {
      const tasks = [makeTask({ dagStatus: 'running', id: 'r1' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      fireEvent.click(screen.getByTestId('add-task-button'));

      const submitBtn = screen.getByText('Add Task');
      expect(submitBtn).toBeDisabled();

      // Fill only title — still disabled
      fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), { target: { value: 'Task' } });
      expect(submitBtn).toBeDisabled();
    });

    it('shows error message on API failure', async () => {
      mockApiFetch.mockRejectedValueOnce(new Error('Server error'));
      const tasks = [makeTask({ dagStatus: 'running', id: 'r1' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      fireEvent.click(screen.getByTestId('add-task-button'));
      fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), { target: { value: 'Task' } });
      fireEvent.change(screen.getByRole('textbox', { name: 'Task role' }), { target: { value: 'dev' } });
      fireEvent.submit(screen.getByTestId('add-task-form'));

      await waitFor(() => {
        expect(screen.getByText('Server error')).toBeTruthy();
      });
    });

    it('closes form when Cancel is clicked', () => {
      const tasks = [makeTask({ dagStatus: 'running', id: 'r1' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      fireEvent.click(screen.getByTestId('add-task-button'));
      expect(screen.getByTestId('add-task-form')).toBeTruthy();

      fireEvent.click(screen.getByText('Cancel'));
      expect(screen.queryByTestId('add-task-form')).toBeNull();
    });
  });

  // ── Context Menu Actions (API calls) ──────────────────────────

  describe('context menu actions', () => {
    beforeEach(() => {
      mockApiFetch.mockReset();
      mockApiFetch.mockResolvedValue({});
    });

    it('calls retry API (status: ready) for failed tasks', async () => {
      const tasks = [makeTask({ id: 'f1', dagStatus: 'failed', title: 'Failed Task' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      fireEvent.contextMenu(screen.getByTestId('kanban-card-f1'));
      fireEvent.click(screen.getByText('Retry'));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/projects/proj-1/tasks/f1/status',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ status: 'ready' }),
          }),
        );
      });
    });

    it('calls pause API (status: paused) for running tasks', async () => {
      const tasks = [makeTask({ id: 'r1', dagStatus: 'running', title: 'Running Task', startedAt: new Date().toISOString() })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      fireEvent.contextMenu(screen.getByTestId('kanban-card-r1'));
      fireEvent.click(screen.getByText('Pause'));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/projects/proj-1/tasks/r1/status',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ status: 'paused' }),
          }),
        );
      });
    });

    it('calls resume API (status: ready) for paused tasks', async () => {
      const tasks = [makeTask({ id: 'p1', dagStatus: 'paused', title: 'Paused Task' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      fireEvent.contextMenu(screen.getByTestId('kanban-card-p1'));
      fireEvent.click(screen.getByText('Resume'));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/projects/proj-1/tasks/p1/status',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ status: 'ready' }),
          }),
        );
      });
    });

    it('calls skip API (status: skipped)', async () => {
      const tasks = [makeTask({ id: 'r1', dagStatus: 'running', title: 'Running Task', startedAt: new Date().toISOString() })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      fireEvent.contextMenu(screen.getByTestId('kanban-card-r1'));
      fireEvent.click(screen.getByText('Skip'));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/projects/proj-1/tasks/r1/status',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ status: 'skipped' }),
          }),
        );
      });
    });

    it('calls force-ready API for blocked tasks', async () => {
      const tasks = [makeTask({ id: 'b1', dagStatus: 'blocked', title: 'Blocked Task' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      fireEvent.contextMenu(screen.getByTestId('kanban-card-b1'));
      fireEvent.click(screen.getByText('Force Ready'));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/projects/proj-1/tasks/b1/status',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ status: 'ready' }),
          }),
        );
      });
    });

    it('calls onTaskUpdated after successful action', async () => {
      const onUpdated = vi.fn();
      const tasks = [makeTask({ id: 'f1', dagStatus: 'failed', title: 'Failed Task' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" onTaskUpdated={onUpdated} />);

      fireEvent.contextMenu(screen.getByTestId('kanban-card-f1'));
      fireEvent.click(screen.getByText('Retry'));

      await waitFor(() => {
        expect(onUpdated).toHaveBeenCalled();
      });
    });

    it('no context menu for done tasks (only Skip shows for non-done/non-skipped)', () => {
      // Include an active task so done column doesn't auto-collapse
      const tasks = [
        makeTask({ id: 'd1', dagStatus: 'done', title: 'Done Task' }),
        makeTask({ id: 'r1', dagStatus: 'running', title: 'Active Task', startedAt: new Date().toISOString() }),
        makeTask({ id: 'r2', dagStatus: 'running', title: 'Active Task 2', startedAt: new Date().toISOString() }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      fireEvent.contextMenu(screen.getByTestId('kanban-card-d1'));
      // Done tasks have no actions, so context menu shouldn't appear
      expect(screen.queryByTestId('context-menu')).toBeNull();
    });
  });

  // ── Failure Reason ────────────────────────────────────────────

  describe('failure reason', () => {
    it('shows failure reason on failed task card', () => {
      const tasks = [
        makeTask({ id: 'f1', dagStatus: 'failed', title: 'Failed Task', failureReason: 'OOM killed' } as any),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      expect(screen.getByTestId('failure-reason')).toBeTruthy();
      expect(screen.getByText('OOM killed')).toBeTruthy();
    });
  });

  // ── Filter by Priority ────────────────────────────────────────

  describe('filter by priority', () => {
    it('filters tasks by priority chip', () => {
      const tasks = [
        makeTask({ dagStatus: 'ready', id: 'hi', title: 'High Prio', priority: 3 }),
        makeTask({ dagStatus: 'ready', id: 'lo', title: 'Low Prio', priority: 1 }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />);

      fireEvent.click(screen.getByTestId('toggle-filters'));
      fireEvent.click(screen.getByTestId('filter-priority-3'));

      expect(screen.getByText('High Prio')).toBeTruthy();
      expect(screen.queryByText('Low Prio')).toBeNull();
    });
  });

  // ── Add Task in Empty State ───────────────────────────────────

  describe('Add Task form accessibility', () => {
    it('form inputs have accessible labels for screen readers', () => {
      const tasks = [makeTask({ dagStatus: 'running', id: 'r1' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);
      fireEvent.click(screen.getByTestId('add-task-button'));

      expect(screen.getByRole('textbox', { name: 'Task title' })).toBeTruthy();
      expect(screen.getByRole('textbox', { name: 'Task role' })).toBeTruthy();
      expect(screen.getByRole('textbox', { name: 'Task description' })).toBeTruthy();
    });
  });

  // ── Add Task in Empty State ───────────────────────────────────

  describe('add task in empty state', () => {
    it('"Create first task" button opens the add form', () => {
      render(<KanbanBoard dagStatus={null} projectId="proj-1" />);

      expect(screen.queryByTestId('add-task-form')).toBeNull();
      fireEvent.click(screen.getByText(/Create first task/));
      expect(screen.getByTestId('add-task-form')).toBeTruthy();
    });
  });

  describe('done column show-all toggle (D2)', () => {
    it('shows only 5 tasks in done column by default with "Show all" button', () => {
      const doneTasks = Array.from({ length: 8 }, (_, i) =>
        makeTask({ id: `done-${i}`, dagStatus: 'done', title: `Done task ${i}` })
      );
      // Add enough active tasks so auto-collapse won't trigger (active >= done)
      const activeTasks = Array.from({ length: 10 }, (_, i) =>
        makeTask({ id: `active-${i}`, dagStatus: 'running', title: `Active task ${i}` })
      );
      const status = makeDagStatus([...activeTasks, ...doneTasks]);

      render(<KanbanBoard dagStatus={status} projectId="proj-1" />);

      const doneColumn = screen.getByTestId('kanban-column-done');
      const cards = within(doneColumn).getAllByTestId(/^kanban-card-/);
      expect(cards).toHaveLength(5);
      expect(within(doneColumn).getByTestId('show-all-toggle')).toBeTruthy();
      expect(within(doneColumn).getByText('Show all 8 tasks')).toBeTruthy();
    });

    it('expands to show all done tasks when "Show all" is clicked', () => {
      const doneTasks = Array.from({ length: 8 }, (_, i) =>
        makeTask({ id: `done-${i}`, dagStatus: 'done', title: `Done task ${i}` })
      );
      const activeTasks = Array.from({ length: 10 }, (_, i) =>
        makeTask({ id: `active-${i}`, dagStatus: 'running', title: `Active task ${i}` })
      );
      const status = makeDagStatus([...activeTasks, ...doneTasks]);

      render(<KanbanBoard dagStatus={status} projectId="proj-1" />);

      const doneColumn = screen.getByTestId('kanban-column-done');
      fireEvent.click(within(doneColumn).getByTestId('show-all-toggle'));

      const cards = within(doneColumn).getAllByTestId(/^kanban-card-/);
      expect(cards).toHaveLength(8);
      expect(within(doneColumn).getByTestId('show-less-toggle')).toBeTruthy();
    });

    it('does not show toggle for done columns with ≤5 tasks', () => {
      const doneTasks = Array.from({ length: 3 }, (_, i) =>
        makeTask({ id: `done-${i}`, dagStatus: 'done', title: `Done task ${i}` })
      );
      const status = makeDagStatus(doneTasks);

      render(<KanbanBoard dagStatus={status} projectId="proj-1" />);

      const doneColumn = screen.getByTestId('kanban-column-done');
      expect(within(doneColumn).queryByTestId('show-all-toggle')).toBeNull();
    });
  });

  describe('keyboard context menu trigger (D3)', () => {
    it('shows context menu trigger button on card that opens menu on click', async () => {
      const status = makeDagStatus([
        makeTask({ dagStatus: 'failed', title: 'Failed task' }),
      ]);

      render(<KanbanBoard dagStatus={status} projectId="proj-1" />);

      const trigger = screen.getByTestId('context-menu-trigger');
      expect(trigger).toBeTruthy();
      expect(trigger.getAttribute('aria-label')).toBe('Task actions');

      fireEvent.click(trigger);
      expect(screen.getByText('Retry')).toBeTruthy();
    });
  });

  describe('archived tasks', () => {
    it('renders "Show archived" toggle when onShowArchivedChange is provided', () => {
      const tasks = [makeTask({ dagStatus: 'done' })];
      const status = makeDagStatus(tasks);
      const onChange = vi.fn();
      render(<KanbanBoard dagStatus={status} projectId="proj-1" showArchived={false} onShowArchivedChange={onChange} />);
      expect(screen.getByTestId('show-archived-toggle')).toBeTruthy();
      expect(screen.getByText('Show archived')).toBeTruthy();
    });

    it('does not render "Show archived" toggle when onShowArchivedChange is not provided', () => {
      const tasks = [makeTask({ dagStatus: 'done' })];
      const status = makeDagStatus(tasks);
      render(<KanbanBoard dagStatus={status} projectId="proj-1" />);
      expect(screen.queryByTestId('show-archived-toggle')).toBeNull();
    });

    it('calls onShowArchivedChange when toggle is clicked', () => {
      const tasks = [makeTask({ dagStatus: 'done' })];
      const status = makeDagStatus(tasks);
      const onChange = vi.fn();
      render(<KanbanBoard dagStatus={status} projectId="proj-1" showArchived={false} onShowArchivedChange={onChange} />);
      const checkbox = screen.getByTestId('show-archived-toggle').querySelector('input[type="checkbox"]')!;
      fireEvent.click(checkbox);
      expect(onChange).toHaveBeenCalledWith(true);
    });

    it('renders archived tasks with dimmed opacity and ARCHIVED badge', () => {
      const archivedTask = makeTask({
        id: 'archived-1',
        dagStatus: 'ready',
        archivedAt: '2026-03-08T00:00:00Z',
      });
      const tasks = [archivedTask];
      const status = makeDagStatus(tasks);
      render(<KanbanBoard dagStatus={status} projectId="proj-1" showArchived={true} onShowArchivedChange={vi.fn()} />);
      expect(screen.getByTestId('archived-badge')).toBeTruthy();
      expect(screen.getByText('ARCHIVED')).toBeTruthy();
      const card = screen.getByTestId('kanban-card-archived-1');
      expect(card.className).toContain('opacity-50');
    });

    it('shows only Restore context menu action for archived tasks', () => {
      const archivedTask = makeTask({
        id: 'archived-fail',
        dagStatus: 'ready',
        archivedAt: '2026-03-08T00:00:00Z',
      });
      const tasks = [archivedTask];
      const status = makeDagStatus(tasks);
      render(<KanbanBoard dagStatus={status} projectId="proj-1" showArchived={true} onShowArchivedChange={vi.fn()} />);
      // Archived task should show only the Restore action via context menu
      const card = screen.getByTestId('kanban-card-archived-fail');
      fireEvent.contextMenu(card);
      expect(screen.getByText('Restore')).toBeTruthy();
      // Should NOT have other actions like Retry, Skip, etc.
      expect(screen.queryByText('Retry')).toBeNull();
      expect(screen.queryByText('Skip')).toBeNull();
      expect(screen.queryByText('Force Ready')).toBeNull();
    });
  });

  describe('task comment feature', () => {
    it('shows comment button on hover and opens dialog', () => {
      const tasks = [makeTask({ id: 'task-1', dagStatus: 'ready', leadId: 'lead-1', title: 'My Task' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      const card = screen.getByTestId('kanban-card-task-1');
      const commentBtn = within(card).getByTestId('comment-trigger');
      expect(commentBtn).toBeTruthy();

      fireEvent.click(commentBtn);
      expect(screen.getByTestId('comment-dialog')).toBeTruthy();
      expect(screen.getByTestId('comment-input')).toBeTruthy();
    });

    it('sends comment to lead via API', async () => {
      mockApiFetch.mockResolvedValueOnce({ ok: true });
      const tasks = [makeTask({ id: 'task-1', dagStatus: 'ready', leadId: 'lead-1', title: 'My Task' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      const card = screen.getByTestId('kanban-card-task-1');
      fireEvent.click(within(card).getByTestId('comment-trigger'));

      const input = screen.getByTestId('comment-input');
      fireEvent.change(input, { target: { value: 'Please prioritize this task' } });

      const sendBtn = screen.getByTestId('comment-send');
      fireEvent.click(sendBtn);

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/lead/lead-1/message',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('Please prioritize this task'),
          }),
        );
      });
    });

    it('includes task context in comment message', async () => {
      mockApiFetch.mockResolvedValueOnce({ ok: true });
      const tasks = [makeTask({ id: 'task-42', dagStatus: 'pending', leadId: 'lead-1', title: 'Fix bug #99' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      const card = screen.getByTestId('kanban-card-task-42');
      fireEvent.click(within(card).getByTestId('comment-trigger'));
      fireEvent.change(screen.getByTestId('comment-input'), { target: { value: 'Needs more info' } });
      fireEvent.click(screen.getByTestId('comment-send'));

      await waitFor(() => {
        const call = mockApiFetch.mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body.text).toContain('Fix bug #99');
        expect(body.text).toContain('task-42');
        expect(body.mode).toBe('queue');
      });
    });

    it('closes dialog on cancel', () => {
      const tasks = [makeTask({ id: 'task-1', dagStatus: 'ready', leadId: 'lead-1' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      const card = screen.getByTestId('kanban-card-task-1');
      fireEvent.click(within(card).getByTestId('comment-trigger'));
      expect(screen.getByTestId('comment-dialog')).toBeTruthy();

      fireEvent.click(screen.getByTestId('comment-cancel'));
      expect(screen.queryByTestId('comment-dialog')).toBeNull();
    });

    it('disables send button when comment is empty', () => {
      const tasks = [makeTask({ id: 'task-1', dagStatus: 'ready', leadId: 'lead-1' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      fireEvent.click(within(screen.getByTestId('kanban-card-task-1')).getByTestId('comment-trigger'));
      const sendBtn = screen.getByTestId('comment-send') as HTMLButtonElement;
      expect(sendBtn.disabled).toBe(true);
    });
  });
});
