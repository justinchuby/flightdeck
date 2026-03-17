// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TaskCard } from '../TaskCard';
import type { DagTask } from '../../../types';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../utils/statusColors', () => ({
  dagTaskText: () => 'text-green-400',
}));

vi.mock('../../../stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: { oversightLevel: string }) => unknown) =>
    selector({ oversightLevel: 'balanced' }),
}));

vi.mock('../../AgentDetailPanel', () => ({
  AgentDetailPanel: () => <div data-testid="agent-detail" />,
}));

function makeTask(overrides: Partial<DagTask> = {}): DagTask {
  return {
    id: 'task-1',
    title: 'Build login page',
    description: 'Implement the login UI',
    dagStatus: 'running',
    role: 'developer',
    priority: 1,
    dependsOn: [],
    files: [],
    createdAt: '2026-03-14T10:00:00Z',
    ...overrides,
  } as DagTask;
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('TaskCard', () => {
  it('renders task title', () => {
    render(<TaskCard task={makeTask()} allTasks={[]} />);
    expect(screen.getByText('Build login page')).toBeDefined();
  });

  it('renders role badge', () => {
    render(<TaskCard task={makeTask()} allTasks={[]} />);
    expect(screen.getByText('developer')).toBeDefined();
  });

  it('shows priority badge for non-zero priority', () => {
    render(<TaskCard task={makeTask({ priority: 2 })} allTasks={[]} />);
    expect(screen.getByText('P2')).toBeDefined();
  });

  it('shows failure reason for failed tasks', () => {
    render(<TaskCard task={makeTask({ dagStatus: 'failed', failureReason: 'OOM killed' })} allTasks={[]} />);
    expect(screen.getByTestId('failure-reason')).toBeDefined();
    expect(screen.getByText('OOM killed')).toBeDefined();
  });

  it('shows dependencies when expanded', () => {
    const dep = makeTask({ id: 'dep-1', title: 'Setup DB' });
    const task = makeTask({ dependsOn: ['dep-1'] });
    render(<TaskCard task={task} allTasks={[dep, task]} />);
    // Click to expand
    fireEvent.click(screen.getByText('Build login page'));
    expect(screen.getByText('Dependencies:')).toBeDefined();
    expect(screen.getByText('Setup DB')).toBeDefined();
  });

  it('shows files when expanded', () => {
    const task = makeTask({ files: ['src/login.tsx', 'src/auth.ts'] });
    render(<TaskCard task={task} allTasks={[]} />);
    fireEvent.click(screen.getByText('Build login page'));
    expect(screen.getByText(/Files \(2\)/)).toBeDefined();
  });

  it('shows assigned agent badge', () => {
    render(<TaskCard task={makeTask({ assignedAgentId: 'agent-abc-123' })} allTasks={[]} />);
    expect(screen.getByTestId('agent-badge')).toBeDefined();
  });

  it('shows ARCHIVED badge for archived tasks', () => {
    render(<TaskCard task={makeTask({ archivedAt: '2026-03-14T12:00:00Z' })} allTasks={[]} />);
    expect(screen.getByTestId('archived-badge')).toBeDefined();
  });

  it('shows context menu on right click', () => {
    render(<TaskCard task={makeTask({ dagStatus: 'failed' })} allTasks={[]} projectId="p1" />);
    const card = screen.getByTestId('kanban-card-task-1');
    fireEvent.contextMenu(card);
    expect(screen.getByTestId('context-menu')).toBeDefined();
    expect(screen.getByText('Retry')).toBeDefined();
  });

  it('shows pause action for running tasks', () => {
    render(<TaskCard task={makeTask({ dagStatus: 'running' })} allTasks={[]} projectId="p1" />);
    fireEvent.contextMenu(screen.getByTestId('kanban-card-task-1'));
    expect(screen.getByText('Pause')).toBeDefined();
  });

  it('uses task id as fallback title when no title', () => {
    render(<TaskCard task={makeTask({ title: '', description: '', id: 'my-task-id' })} allTasks={[]} />);
    expect(screen.getByText('my-task-id')).toBeDefined();
  });
});
