// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DagGantt } from '../DagGantt';
import type { GanttTask } from '../DagGantt';

const BASE = Date.now() - 60_000;

function makeTask(overrides: Partial<GanttTask> & { id: string }): GanttTask {
  return {
    title: overrides.id,
    status: 'pending',
    dependsOn: [],
    createdAt: BASE,
    ...overrides,
  };
}

describe('DagGantt — extra coverage', () => {
  it('tooltip shows assignee role when present', () => {
    const tasks = [makeTask({ id: 'task-1', title: 'Build it', status: 'done', assignee: 'architect', createdAt: BASE, completedAt: BASE + 10000 })];
    const { container } = render(<DagGantt tasks={tasks} />);
    const bar = container.querySelector('[style*="left:"]') as HTMLElement;
    fireEvent.mouseEnter(bar, { clientX: 100, clientY: 50 });
    expect(screen.getByText('Build it')).toBeInTheDocument();
    expect(screen.getByText(/architect/)).toBeInTheDocument();
  });

  it('tooltip shows created time', () => {
    const tasks = [makeTask({ id: 'task-1', status: 'done', createdAt: BASE, completedAt: BASE + 10000 })];
    const { container } = render(<DagGantt tasks={tasks} />);
    const bar = container.querySelector('.cursor-default') as HTMLElement;
    expect(bar).toBeTruthy();
    fireEvent.mouseEnter(bar, { clientX: 100, clientY: 50 });
    const tooltip = container.querySelector('.fixed');
    expect(tooltip).toBeTruthy();
    expect(tooltip?.textContent).toContain('Created:');
  });

  it('tooltip shows started time', () => {
    const tasks = [makeTask({ id: 'task-1', status: 'done', startedAt: BASE + 1000, completedAt: BASE + 10000 })];
    const { container } = render(<DagGantt tasks={tasks} />);
    const bar = container.querySelector('.cursor-default') as HTMLElement;
    expect(bar).toBeTruthy();
    fireEvent.mouseEnter(bar, { clientX: 100, clientY: 50 });
    const tooltip = container.querySelector('.fixed');
    expect(tooltip).toBeTruthy();
    expect(tooltip?.textContent).toContain('Started:');
  });

  it('tooltip shows duration for completed tasks', () => {
    const tasks = [makeTask({ id: 'task-1', status: 'done', startedAt: BASE, completedAt: BASE + 65000 })];
    const { container } = render(<DagGantt tasks={tasks} />);
    const bar = container.querySelector('.cursor-default') as HTMLElement;
    expect(bar).toBeTruthy();
    fireEvent.mouseEnter(bar, { clientX: 100, clientY: 50 });
    const tooltip = container.querySelector('.fixed');
    expect(tooltip).toBeTruthy();
    expect(tooltip?.textContent).toContain('Duration:');
    expect(tooltip?.textContent).toContain('1m 5s');
  });

  it('tooltip shows deps when present', () => {
    const tasks = [
      makeTask({ id: 'root', status: 'done', completedAt: BASE + 5000 }),
      makeTask({ id: 'child', status: 'running', dependsOn: ['root'], createdAt: BASE + 5000 }),
    ];
    const { container } = render(<DagGantt tasks={tasks} />);
    const bars = container.querySelectorAll('.cursor-default');
    const childBar = bars[bars.length - 1] as HTMLElement;
    fireEvent.mouseEnter(childBar, { clientX: 100, clientY: 50 });
    const tooltip = container.querySelector('.fixed');
    expect(tooltip?.textContent).toContain('Deps:');
    expect(tooltip?.textContent).toContain('root');
  });

  it('tooltip shows critical path star for tasks on critical path', () => {
    const tasks = [
      makeTask({ id: 'root', status: 'done', createdAt: BASE, completedAt: BASE + 10000 }),
      makeTask({ id: 'leaf', status: 'running', dependsOn: ['root'], createdAt: BASE + 10000 }),
    ];
    const { container } = render(<DagGantt tasks={tasks} />);
    const bars = container.querySelectorAll('[style*="left:"]');
    const leafBar = bars[bars.length - 1] as HTMLElement;
    fireEvent.mouseEnter(leafBar, { clientX: 100, clientY: 50 });
    expect(screen.getByText(/On critical path/)).toBeInTheDocument();
  });

  it('tooltip follows mouse move', () => {
    const tasks = [makeTask({ id: 'task-1', status: 'running' })];
    const { container } = render(<DagGantt tasks={tasks} />);
    const bar = container.querySelector('[style*="left:"]') as HTMLElement;
    fireEvent.mouseEnter(bar, { clientX: 100, clientY: 50 });
    fireEvent.mouseMove(bar, { clientX: 200, clientY: 100 });
    // Tooltip should still be visible
    expect(screen.getByText('task-1')).toBeInTheDocument();
  });

  it('renders assignee text on task bar', () => {
    const tasks = [makeTask({ id: 'task-1', status: 'running', assignee: 'dev-agent' })];
    const { container } = render(<DagGantt tasks={tasks} />);
    expect(screen.getByText('dev-agent')).toBeInTheDocument();
  });

  it('renders all status types in the legend', () => {
    const tasks = [makeTask({ id: 'task-1', status: 'done' })];
    render(<DagGantt tasks={tasks} />);
    expect(screen.getByText('done')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByText('blocked')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('skipped')).toBeInTheDocument();
  });

  it('renders skipped tasks', () => {
    const tasks = [makeTask({ id: 'skipped-task', title: 'Skipped Work', status: 'skipped' })];
    const { container } = render(<DagGantt tasks={tasks} />);
    expect(screen.getByText('Skipped Work')).toBeInTheDocument();
  });

  it('renders blocked tasks', () => {
    const tasks = [makeTask({ id: 'blocked-task', title: 'Blocked Work', status: 'blocked' })];
    render(<DagGantt tasks={tasks} />);
    expect(screen.getByText('Blocked Work')).toBeInTheDocument();
  });

  it('renders time axis ticks inside the chart', () => {
    const tasks = [
      makeTask({ id: 'a', status: 'done', createdAt: BASE, completedAt: BASE + 10000 }),
      makeTask({ id: 'b', status: 'running', createdAt: BASE + 5000 }),
    ];
    const { container } = render(<DagGantt tasks={tasks} />);
    // Check for the internal time axis (5 tick labels)
    const timeLabels = container.querySelectorAll('.border-l .text-th-text-muted span');
    expect(timeLabels.length).toBeGreaterThanOrEqual(3);
  });

  it('handles tasks with no createdAt', () => {
    const tasks = [makeTask({ id: 'no-dates', status: 'pending', createdAt: undefined, startedAt: undefined })];
    const { container } = render(<DagGantt tasks={tasks} />);
    expect(container).toBeTruthy();
  });

  it('renders vertical grid lines', () => {
    const tasks = [makeTask({ id: 'a', status: 'done' })];
    const { container } = render(<DagGantt tasks={tasks} />);
    const gridLines = container.querySelectorAll('.bg-th-border\\/20');
    expect(gridLines.length).toBe(3); // 25%, 50%, 75%
  });
});
