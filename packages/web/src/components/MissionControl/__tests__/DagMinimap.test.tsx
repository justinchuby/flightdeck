// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockLeadStore: Record<string, unknown> = { projects: {} };
vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: (selector: (s: Record<string, unknown>) => unknown) =>
    typeof selector === 'function' ? selector(mockLeadStore) : mockLeadStore,
}));

import { DagMinimap } from '../DagMinimap';

function renderMinimap(props: { projectId: string; leadId?: string } = { projectId: 'p1' }) {
  return render(
    <MemoryRouter>
      <DagMinimap {...props} />
    </MemoryRouter>,
  );
}

function makeDag(tasks: Record<string, unknown>[], summary: Record<string, number>) {
  return {
    dagStatus: {
      tasks,
      fileLockMap: {},
      summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0, ...summary },
    },
  };
}

describe('DagMinimap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLeadStore.projects = {};
    mockApiFetch.mockResolvedValue(null);
  });

  // ── Empty / loading states ────────────────────────────────

  it('shows empty state when store has no data and API returns null', async () => {
    mockApiFetch.mockResolvedValue(null);
    renderMinimap();
    await waitFor(() => {
      expect(screen.getByText('No task DAG defined')).toBeInTheDocument();
    });
  });

  it('shows empty state when tasks array is empty', async () => {
    mockApiFetch.mockResolvedValue({
      tasks: [],
      summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 },
    });
    renderMinimap();
    await waitFor(() => {
      expect(screen.getByText('No task DAG defined')).toBeInTheDocument();
    });
  });

  // ── Data from store ───────────────────────────────────────

  it('uses store data by projectId and does not fetch', () => {
    mockLeadStore.projects = {
      p1: makeDag(
        [{ id: 't1', title: 'Task A', description: 'Do A', dagStatus: 'done', completedAt: '2024-01-01T10:00:00Z', assignedAgentId: 'a1', dependencies: [] }],
        { done: 1 },
      ),
    };
    renderMinimap();
    expect(screen.getByText('Task Progress')).toBeInTheDocument();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('falls back to leadId store key when projectId has no data', () => {
    mockLeadStore.projects = {
      'lead-1': makeDag(
        [{ id: 't1', title: 'Fallback task', description: 'Via leadId', dagStatus: 'running', completedAt: null, assignedAgentId: 'a1', dependencies: [] }],
        { running: 1 },
      ),
    };
    renderMinimap({ projectId: 'p1', leadId: 'lead-1' });
    expect(screen.getByText('Task Progress')).toBeInTheDocument();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  // ── API fetch path ────────────────────────────────────────

  it('fetches DAG from API when store has no data', async () => {
    const dagData = {
      tasks: [{ id: 't1', title: 'Fetched task', description: 'From API', dagStatus: 'done', completedAt: '2024-06-01T12:00:00Z', assignedAgentId: 'a1', dependencies: [] }],
      fileLockMap: {},
      summary: { pending: 0, ready: 0, running: 0, done: 1, failed: 0, blocked: 0, paused: 0, skipped: 0 },
    };
    mockApiFetch.mockResolvedValue(dagData);
    renderMinimap();
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/projects/p1/dag');
    });
    await waitFor(() => {
      expect(screen.getByText('Task Progress')).toBeInTheDocument();
    });
  });

  it('handles fetch error gracefully — shows empty state', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    renderMinimap();
    await waitFor(() => {
      expect(screen.getByText('No task DAG defined')).toBeInTheDocument();
    });
  });

  // ── Status bar rendering ──────────────────────────────────

  it('renders status bar segments with counts', () => {
    mockLeadStore.projects = {
      p1: makeDag(
        [
          { id: 't1', dagStatus: 'done', completedAt: '2024-01-01T10:00:00Z', dependencies: [] },
          { id: 't2', dagStatus: 'running', completedAt: null, dependencies: [] },
          { id: 't3', dagStatus: 'pending', completedAt: null, dependencies: [] },
        ],
        { done: 1, running: 1, pending: 1 },
      ),
    };
    renderMinimap();
    expect(screen.getByText(/done \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/running \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/pending \(1\)/)).toBeInTheDocument();
  });

  // ── Recent completions column ─────────────────────────────

  it('renders recently completed task descriptions', () => {
    mockLeadStore.projects = {
      p1: makeDag(
        [
          { id: 't1', description: 'Set up the database', dagStatus: 'done', completedAt: '2024-06-01T12:00:00Z', dependencies: [] },
          { id: 't2', description: 'Build the API layer', dagStatus: 'done', completedAt: '2024-06-01T11:00:00Z', dependencies: [] },
        ],
        { done: 2 },
      ),
    };
    renderMinimap();
    expect(screen.getByText(/Set up the database/)).toBeInTheDocument();
    expect(screen.getByText(/Build the API layer/)).toBeInTheDocument();
  });

  it('shows "None yet" when no tasks are completed', () => {
    mockLeadStore.projects = {
      p1: makeDag(
        [{ id: 't1', description: 'In progress', dagStatus: 'running', completedAt: null, dependencies: [] }],
        { running: 1 },
      ),
    };
    renderMinimap();
    expect(screen.getByText('None yet')).toBeInTheDocument();
  });

  // ── Running tasks column ──────────────────────────────────

  it('renders currently running task descriptions', () => {
    mockLeadStore.projects = {
      p1: makeDag(
        [{ id: 't1', description: 'Building frontend', dagStatus: 'running', completedAt: null, dependencies: [] }],
        { running: 1 },
      ),
    };
    renderMinimap();
    expect(screen.getByText(/Building frontend/)).toBeInTheDocument();
  });

  it('shows "None" when no tasks are running', () => {
    mockLeadStore.projects = {
      p1: makeDag(
        [{ id: 't1', description: 'All done', dagStatus: 'done', completedAt: '2024-01-01T10:00:00Z', dependencies: [] }],
        { done: 1 },
      ),
    };
    renderMinimap();
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  // ── Layout elements ───────────────────────────────────────

  it('renders "Task Progress" heading', () => {
    mockLeadStore.projects = {
      p1: makeDag(
        [{ id: 't1', dagStatus: 'done', completedAt: '2024-01-01T10:00:00Z', dependencies: [] }],
        { done: 1 },
      ),
    };
    renderMinimap();
    expect(screen.getByText('Task Progress')).toBeInTheDocument();
  });

  it('renders "Full DAG →" link pointing to /tasks', () => {
    mockLeadStore.projects = {
      p1: makeDag(
        [{ id: 't1', dagStatus: 'done', completedAt: '2024-01-01T10:00:00Z', dependencies: [] }],
        { done: 1 },
      ),
    };
    renderMinimap();
    const link = screen.getByText('Full DAG →');
    expect(link.closest('a')).toHaveAttribute('href', '/tasks');
  });

  it('renders "Recent" and "Running" column headers', () => {
    mockLeadStore.projects = {
      p1: makeDag(
        [
          { id: 't1', dagStatus: 'done', completedAt: '2024-01-01T10:00:00Z', dependencies: [] },
          { id: 't2', dagStatus: 'running', completedAt: null, dependencies: [] },
        ],
        { done: 1, running: 1 },
      ),
    };
    renderMinimap();
    expect(screen.getByText('Recent')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('falls back to task id when description is missing', () => {
    mockLeadStore.projects = {
      p1: makeDag(
        [{ id: 'task-fallback-id', dagStatus: 'running', completedAt: null, dependencies: [] }],
        { running: 1 },
      ),
    };
    renderMinimap();
    expect(screen.getByText(/task-fallback-id/)).toBeInTheDocument();
  });
});
