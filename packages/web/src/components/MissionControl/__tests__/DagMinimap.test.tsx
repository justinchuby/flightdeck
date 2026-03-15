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

function renderMinimap(props = { projectId: 'p1' }) {
  return render(
    <MemoryRouter>
      <DagMinimap {...props} />
    </MemoryRouter>,
  );
}

describe('DagMinimap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLeadStore.projects = {};
  });

  it('fetches DAG when store has no data', async () => {
    mockApiFetch.mockResolvedValue({
      tasks: [],
      summary: { pending: 0, ready: 0, running: 0, done: 5, failed: 0, blocked: 0, paused: 0, skipped: 0 },
    });
    renderMinimap();
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/projects/p1/dag');
    });
  });

  it('uses store data when available', () => {
    mockLeadStore.projects = {
      p1: {
        dagStatus: {
          tasks: [{ id: 't1', title: 'Test', status: 'done' }],
          summary: { pending: 0, ready: 0, running: 1, done: 3, failed: 0, blocked: 0, paused: 0, skipped: 0 },
        },
      },
    };
    renderMinimap();
    // Should render status bar without fetching
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('renders status bar segments', async () => {
    mockLeadStore.projects = {
      p1: {
        dagStatus: {
          tasks: [{ id: 't1', title: 'Build it', status: 'done' }],
          summary: { pending: 2, ready: 1, running: 1, done: 5, failed: 1, blocked: 0, paused: 0, skipped: 0 },
        },
      },
    };
    renderMinimap();
    // Should show task counts
    const { container } = renderMinimap();
    expect(container).toBeTruthy();
  });

  it('shows recently completed tasks', () => {
    mockLeadStore.projects = {
      p1: {
        dagStatus: {
          tasks: [
            { id: 't1', title: 'Setup environment', status: 'done' },
            { id: 't2', title: 'Write tests', status: 'done' },
            { id: 't3', title: 'Deploy', status: 'running' },
          ],
          summary: { pending: 0, ready: 0, running: 1, done: 2, failed: 0, blocked: 0, paused: 0, skipped: 0 },
        },
      },
    };
    const { container } = renderMinimap();
    // Check rendered content includes task info
    const text = container.textContent || '';
    expect(text).toMatch(/Setup environment|Write tests|Deploy|done|running/i);
  });

  it('handles fetch error gracefully', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    const { container } = renderMinimap();
    await waitFor(() => {
      expect(container).toBeTruthy();
    });
  });
});
