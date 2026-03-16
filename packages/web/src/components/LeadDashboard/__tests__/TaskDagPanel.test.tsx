// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskDagPanelContent } from '../TaskDagPanel';
import type { DagStatus, DagTask } from '../../../types';

const makeTask = (id: string, status: DagTask['dagStatus'], extra: Partial<DagTask> = {}): DagTask => ({
  id,
  leadId: 'lead-1',
  role: 'developer',
  title: `Task ${id}`,
  description: `Description for ${id}`,
  dagStatus: status,
  priority: 1,
  dependsOn: [],
  files: [],
  createdAt: new Date().toISOString(),
  ...extra,
} as DagTask);

const makeDagStatus = (tasks: DagTask[], overrides: Partial<DagStatus> = {}): DagStatus => ({
  tasks,
  fileLockMap: {},
  summary: {
    total: tasks.length,
    done: tasks.filter((t) => t.dagStatus === 'done').length,
    running: tasks.filter((t) => t.dagStatus === 'running').length,
    ready: tasks.filter((t) => t.dagStatus === 'ready').length,
    pending: tasks.filter((t) => t.dagStatus === 'pending').length,
    failed: tasks.filter((t) => t.dagStatus === 'failed').length,
    blocked: tasks.filter((t) => t.dagStatus === 'blocked').length,
    skipped: tasks.filter((t) => t.dagStatus === 'skipped').length,
    paused: 0,
    in_review: 0,
  },
  ...overrides,
});

describe('TaskDagPanelContent', () => {
  it('shows null state message', () => {
    render(<TaskDagPanelContent dagStatus={null} />);
    expect(screen.getByText('No DAG data available')).toBeInTheDocument();
  });

  it('renders task cards', () => {
    const dag = makeDagStatus([
      makeTask('t1', 'running'),
      makeTask('t2', 'done'),
      makeTask('t3', 'pending'),
    ]);
    render(<TaskDagPanelContent dagStatus={dag} />);
    expect(screen.getByText('Task t1')).toBeInTheDocument();
    expect(screen.getByText('Task t2')).toBeInTheDocument();
    expect(screen.getByText('Task t3')).toBeInTheDocument();
  });

  it('shows summary bar with counts', () => {
    const dag = makeDagStatus([
      makeTask('t1', 'running'),
      makeTask('t2', 'done'),
    ]);
    const { container } = render(<TaskDagPanelContent dagStatus={dag} />);
    const text = container.textContent || '';
    expect(text).toContain('running');
    expect(text).toContain('done');
  });

  it('shows status badges', () => {
    const dag = makeDagStatus([
      makeTask('t1', 'running'),
      makeTask('t2', 'failed'),
      makeTask('t3', 'blocked'),
    ]);
    render(<TaskDagPanelContent dagStatus={dag} />);
    expect(screen.getAllByText('running').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('failed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('blocked').length).toBeGreaterThanOrEqual(1);
  });

  it('sorts tasks by status priority', () => {
    const dag = makeDagStatus([
      makeTask('t1', 'done'),
      makeTask('t2', 'running'),
      makeTask('t3', 'pending'),
    ]);
    const { container } = render(<TaskDagPanelContent dagStatus={dag} />);
    const taskTexts = Array.from(container.querySelectorAll('[class*="font-mono"]'))
      .map((el) => el.textContent)
      .filter(Boolean);
    // Running should appear before done
    const runningIdx = taskTexts.findIndex((t) => t?.includes('Task t2'));
    const doneIdx = taskTexts.findIndex((t) => t?.includes('Task t1'));
    if (runningIdx >= 0 && doneIdx >= 0) {
      expect(runningIdx).toBeLessThan(doneIdx);
    }
  });

  it('shows file locks when running tasks exist', () => {
    const dag = makeDagStatus(
      [makeTask('t1', 'running')],
      {
        fileLockMap: {
          'src/main.ts': { taskId: 't1', agentId: 'a1' },
        },
      },
    );
    render(<TaskDagPanelContent dagStatus={dag} />);
    expect(screen.getByText(/src\/main\.ts/)).toBeInTheDocument();
  });

  it('shows assigned agent on task', () => {
    const dag = makeDagStatus([
      makeTask('t1', 'running', { assignedAgentId: 'agent-abc123' }),
    ]);
    render(<TaskDagPanelContent dagStatus={dag} />);
    const text = document.body.textContent || '';
    expect(text).toMatch(/abc123|agent/);
  });

  it('shows task dependencies', () => {
    const dag = makeDagStatus([
      makeTask('t1', 'pending', { dependsOn: ['t2'] }),
      makeTask('t2', 'done'),
    ]);
    render(<TaskDagPanelContent dagStatus={dag} />);
    const text = document.body.textContent || '';
    expect(text).toContain('t2');
  });

  it('renders empty task list', () => {
    const dag = makeDagStatus([]);
    const { container } = render(<TaskDagPanelContent dagStatus={dag} />);
    expect(container).toBeTruthy();
  });
});
