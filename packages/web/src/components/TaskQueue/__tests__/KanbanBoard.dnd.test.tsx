/**
 * DnD-specific integration tests for KanbanBoard.
 *
 * Mocks @dnd-kit to capture drag event handlers, then tests the business
 * logic: cross-column status change, same-column reorder, invalid drop
 * targets (UNDROP_TARGETS), drag overlay, and API error handling.
 *
 * We trust @dnd-kit fires events correctly — we test what KanbanBoard
 * DOES with those events (API calls, toast messages, state updates).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import type { DagStatus, DagTask } from '../../../types';

// ── Capture DnD handlers ────────────────────────────────────────────

let capturedHandlers: {
  onDragStart?: (event: any) => void;
  onDragOver?: (event: any) => void;
  onDragEnd?: (event: any) => void;
  onDragCancel?: () => void;
} = {};

vi.mock('@dnd-kit/core', () => {
  return {
    DndContext: ({ children, onDragStart, onDragOver, onDragEnd, onDragCancel }: any) => {
      capturedHandlers = { onDragStart, onDragOver, onDragEnd, onDragCancel };
      return React.createElement('div', { 'data-testid': 'dnd-context' }, children);
    },
    DragOverlay: ({ children }: any) => children ?? null,
    closestCorners: vi.fn(),
    PointerSensor: class {},
    useSensor: vi.fn(() => ({})),
    useSensors: vi.fn(() => []),
    useDroppable: vi.fn(() => ({ setNodeRef: vi.fn(), isOver: false })),
  };
});

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: any) => children,
  useSortable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  })),
  verticalListSortingStrategy: {},
  arrayMove: (arr: any[], from: number, to: number) => {
    const result = [...arr];
    const [removed] = result.splice(from, 1);
    result.splice(to, 0, removed);
    return result;
  },
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}));

// Mock apiFetch for verifying API calls
const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

// Import AFTER mocks are set up
import { KanbanBoard } from '../KanbanBoard';

// ── Fixtures ────────────────────────────────────────────────────────

let taskCounter = 0;

function makeTask(overrides: Partial<DagTask> = {}): DagTask {
  taskCounter++;
  return {
    id: overrides.id ?? `task-${taskCounter}`,
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

// ── Tests ────────────────────────────────────────────────────────────

describe('KanbanBoard DnD', () => {
  beforeEach(() => {
    taskCounter = 0;
    capturedHandlers = {};
    mockApiFetch.mockReset();
    mockApiFetch.mockResolvedValue({});
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  describe('cross-column drag (blocked)', () => {
    it('blocks cross-column drag with toast message', async () => {
      const tasks = [
        makeTask({ id: 'task-a', dagStatus: 'ready', title: 'Ready Task' }),
        makeTask({ id: 'task-b', dagStatus: 'done', title: 'Done Task' }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      act(() => {
        capturedHandlers.onDragEnd?.({
          active: { id: 'task-a' },
          over: { id: 'column-done' },
        });
      });

      expect(mockApiFetch).not.toHaveBeenCalled();
      expect(screen.getByText('Only the lead can change task status')).toBeTruthy();
    });

    it('blocks drag onto a task in a different column', async () => {
      const tasks = [
        makeTask({ id: 'task-a', dagStatus: 'ready', title: 'Ready Task' }),
        makeTask({ id: 'task-b', dagStatus: 'done', title: 'Done Task' }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      act(() => {
        capturedHandlers.onDragEnd?.({
          active: { id: 'task-a' },
          over: { id: 'task-b' },
        });
      });

      expect(mockApiFetch).not.toHaveBeenCalled();
      expect(screen.getByText('Only the lead can change task status')).toBeTruthy();
    });

    it('blocks drag of failed task to ready column', async () => {
      const tasks = [makeTask({ id: 'task-f', dagStatus: 'failed' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      act(() => {
        capturedHandlers.onDragEnd?.({
          active: { id: 'task-f' },
          over: { id: 'column-ready' },
        });
      });

      expect(mockApiFetch).not.toHaveBeenCalled();
      expect(screen.getByText('Only the lead can change task status')).toBeTruthy();
    });

    it('blocks drag to running column', async () => {
      const tasks = [
        makeTask({ id: 'task-a', dagStatus: 'ready' }),
        makeTask({ id: 'task-b', dagStatus: 'running', startedAt: new Date().toISOString() }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      act(() => {
        capturedHandlers.onDragEnd?.({
          active: { id: 'task-a' },
          over: { id: 'column-running' },
        });
      });

      expect(mockApiFetch).not.toHaveBeenCalled();
      expect(screen.getByText('Only the lead can change task status')).toBeTruthy();
    });

    it('blocks drag to blocked column', async () => {
      const tasks = [
        makeTask({ id: 'task-a', dagStatus: 'ready' }),
        makeTask({ id: 'task-b', dagStatus: 'blocked' }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      act(() => {
        capturedHandlers.onDragEnd?.({
          active: { id: 'task-a' },
          over: { id: 'column-blocked' },
        });
      });

      expect(mockApiFetch).not.toHaveBeenCalled();
      expect(screen.getByText('Only the lead can change task status')).toBeTruthy();
    });
  });

  describe('same-column drag (priority reorder)', () => {
    it('calls PATCH /priority when reordered within ready column', async () => {
      const tasks = [
        makeTask({ id: 'task-a', dagStatus: 'ready', priority: 3, createdAt: '2026-03-01' }),
        makeTask({ id: 'task-b', dagStatus: 'ready', priority: 2, createdAt: '2026-03-02' }),
        makeTask({ id: 'task-c', dagStatus: 'ready', priority: 1, createdAt: '2026-03-03' }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      // Drag task-c onto task-a (reorder within ready column)
      act(() => {
        capturedHandlers.onDragEnd?.({
          active: { id: 'task-c' },
          over: { id: 'task-a' },
        });
      });

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/projects/proj-1/tasks/task-c/priority',
          expect.objectContaining({
            method: 'PATCH',
            body: expect.stringContaining('"priority"'),
          }),
        );
      });
    });

    it('calls PATCH /priority when reordered within pending column', async () => {
      const tasks = [
        makeTask({ id: 'task-a', dagStatus: 'pending', priority: 3 }),
        makeTask({ id: 'task-b', dagStatus: 'pending', priority: 1 }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      act(() => {
        capturedHandlers.onDragEnd?.({
          active: { id: 'task-b' },
          over: { id: 'task-a' },
        });
      });

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/projects/proj-1/tasks/task-b/priority',
          expect.objectContaining({
            method: 'PATCH',
            body: expect.stringContaining('"priority"'),
          }),
        );
      });
    });

    it('blocks reorder in non-reorderable columns (e.g. done)', async () => {
      const tasks = [
        makeTask({ id: 'task-a', dagStatus: 'done', priority: 2, completedAt: '2026-03-01T00:00:00Z' }),
        makeTask({ id: 'task-b', dagStatus: 'done', priority: 1, completedAt: '2026-03-02T00:00:00Z' }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      act(() => {
        capturedHandlers.onDragEnd?.({
          active: { id: 'task-b' },
          over: { id: 'task-a' },
        });
      });

      expect(mockApiFetch).not.toHaveBeenCalled();
      expect(screen.getByText(/Reordering is not allowed in the "done" column/)).toBeTruthy();
    });

    it('blocks reorder in running column', async () => {
      const tasks = [
        makeTask({ id: 'task-a', dagStatus: 'running', startedAt: '2026-03-01T00:00:00Z' }),
        makeTask({ id: 'task-b', dagStatus: 'running', startedAt: '2026-03-02T00:00:00Z' }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      act(() => {
        capturedHandlers.onDragEnd?.({
          active: { id: 'task-b' },
          over: { id: 'task-a' },
        });
      });

      expect(mockApiFetch).not.toHaveBeenCalled();
      expect(screen.getByText(/Reordering is not allowed in the "running" column/)).toBeTruthy();
    });

    it('does not call API when dropped on same position', () => {
      const tasks = [makeTask({ id: 'task-a', dagStatus: 'ready' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      // Drop task-a on itself — no reorder
      act(() => {
        capturedHandlers.onDragEnd?.({
          active: { id: 'task-a' },
          over: { id: 'task-a' },
        });
      });

      expect(mockApiFetch).not.toHaveBeenCalled();
    });
  });

  describe('drag edge cases', () => {
    it('ignores drag when dropped on nothing (over is null)', () => {
      const tasks = [makeTask({ id: 'task-a', dagStatus: 'ready' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      act(() => {
        capturedHandlers.onDragEnd?.({
          active: { id: 'task-a' },
          over: null,
        });
      });

      expect(mockApiFetch).not.toHaveBeenCalled();
    });

    it('ignores drag when no projectId is set', () => {
      const tasks = [makeTask({ id: 'task-a', dagStatus: 'ready' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} />); // no projectId

      act(() => {
        capturedHandlers.onDragEnd?.({
          active: { id: 'task-a' },
          over: { id: 'column-done' },
        });
      });

      expect(mockApiFetch).not.toHaveBeenCalled();
    });

    it('ignores drag of unknown task id', () => {
      const tasks = [makeTask({ id: 'task-a', dagStatus: 'ready' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      act(() => {
        capturedHandlers.onDragEnd?.({
          active: { id: 'nonexistent-task' },
          over: { id: 'column-done' },
        });
      });

      expect(mockApiFetch).not.toHaveBeenCalled();
    });

    it('dragCancel clears active state without API call', () => {
      const tasks = [makeTask({ id: 'task-a', dagStatus: 'ready' })];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      act(() => {
        capturedHandlers.onDragStart?.({ active: { id: 'task-a' } });
      });

      act(() => {
        capturedHandlers.onDragCancel?.();
      });

      expect(mockApiFetch).not.toHaveBeenCalled();
    });
  });

  describe('API error handling during reorder', () => {
    it('shows no error when reorder fails silently', async () => {
      mockApiFetch.mockRejectedValueOnce(new Error('Network error'));
      const tasks = [
        makeTask({ id: 'task-a', dagStatus: 'ready', priority: 3 }),
        makeTask({ id: 'task-b', dagStatus: 'ready', priority: 1 }),
      ];
      render(<KanbanBoard dagStatus={makeDagStatus(tasks)} projectId="proj-1" />);

      // Suppress expected warning from priority update failure
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await act(async () => {
        capturedHandlers.onDragEnd?.({
          active: { id: 'task-b' },
          over: { id: 'task-a' },
        });
      });

      // Priority reorder failures are logged but don't show toast
      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/projects/proj-1/tasks/task-b/priority',
          expect.objectContaining({ method: 'PATCH' }),
        );
      });
      spy.mockRestore();
    });
  });
});
