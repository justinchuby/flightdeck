// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TaskDagPanelContent } from '../TaskDagPanel';
import type { DagStatus, DagTask } from '../../../types';

vi.mock('../../../utils/statusColors', () => ({
  dagTaskText: () => 'text-green-400',
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

function makeTask(overrides: Partial<DagTask> = {}): DagTask {
  return {
    id: 'task-1',
    title: 'Build feature',
    description: '',
    dagStatus: 'pending',
    role: 'developer',
    priority: 0,
    dependsOn: [],
    files: [],
    ...overrides,
  } as DagTask;
}

function makeDagStatus(overrides: Partial<DagStatus> = {}): DagStatus {
  return {
    tasks: [],
    fileLockMap: {},
    summary: { done: 0, running: 0, ready: 0, pending: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 },
    ...overrides,
  } as DagStatus;
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('TaskDagPanelContent', () => {
  it('shows "No DAG data" when dagStatus is null', () => {
    render(<TaskDagPanelContent dagStatus={null} />);
    expect(screen.getByText('No DAG data available')).toBeDefined();
  });

  it('renders summary bar with counts', () => {
    const status = makeDagStatus({ summary: { done: 3, running: 2, ready: 1, pending: 4, failed: 0, blocked: 0, paused: 0, skipped: 0 } });
    render(<TaskDagPanelContent dagStatus={status} />);
    expect(screen.getByText(/3/)).toBeDefined();
    expect(screen.getByText(/done/)).toBeDefined();
    expect(screen.getByText(/running/)).toBeDefined();
  });

  it('renders task cards', () => {
    const status = makeDagStatus({
      tasks: [makeTask({ id: 't1', title: 'First task', dagStatus: 'running' }), makeTask({ id: 't2', title: 'Second task', dagStatus: 'pending' })],
      summary: { done: 0, running: 1, ready: 0, pending: 1, failed: 0, blocked: 0, paused: 0, skipped: 0 },
    });
    render(<TaskDagPanelContent dagStatus={status} />);
    expect(screen.getByText('First task')).toBeDefined();
    expect(screen.getByText('Second task')).toBeDefined();
  });

  it('shows task dependencies', () => {
    const status = makeDagStatus({
      tasks: [makeTask({ id: 't1', title: 'Dep task', dependsOn: ['t0'], dagStatus: 'pending' })],
      summary: { done: 0, running: 0, ready: 0, pending: 1, failed: 0, blocked: 0, paused: 0, skipped: 0 },
    });
    render(<TaskDagPanelContent dagStatus={status} />);
    expect(screen.getByText('deps: [t0]')).toBeDefined();
  });

  it('shows file list on tasks', () => {
    const status = makeDagStatus({
      tasks: [makeTask({ id: 't1', title: 'File task', files: ['src/a.ts'], dagStatus: 'running' })],
      summary: { done: 0, running: 1, ready: 0, pending: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 },
    });
    render(<TaskDagPanelContent dagStatus={status} />);
    expect(screen.getByText('files: [src/a.ts]')).toBeDefined();
  });

  it('shows file locks when running tasks have them', () => {
    const status = makeDagStatus({
      tasks: [makeTask({ id: 't1', dagStatus: 'running' })],
      fileLockMap: { 'src/index.ts': { taskId: 't1', agentId: 'agent-abc' } },
      summary: { done: 0, running: 1, ready: 0, pending: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 },
    });
    render(<TaskDagPanelContent dagStatus={status} />);
    expect(screen.getByText('src/index.ts')).toBeDefined();
    expect(screen.getByText('File Locks')).toBeDefined();
  });

  it('sorts tasks by status priority', () => {
    const status = makeDagStatus({
      tasks: [
        makeTask({ id: 'pending-1', title: 'Pending', dagStatus: 'pending' }),
        makeTask({ id: 'running-1', title: 'Running', dagStatus: 'running' }),
        makeTask({ id: 'done-1', title: 'Done', dagStatus: 'done' }),
      ],
      summary: { done: 1, running: 1, ready: 0, pending: 1, failed: 0, blocked: 0, paused: 0, skipped: 0 },
    });
    const { container } = render(<TaskDagPanelContent dagStatus={status} />);
    const titles = Array.from(container.querySelectorAll('.truncate')).map((el) => el.textContent);
    expect(titles.indexOf('Running')).toBeLessThan(titles.indexOf('Pending'));
    expect(titles.indexOf('Pending')).toBeLessThan(titles.indexOf('Done'));
  });
});
