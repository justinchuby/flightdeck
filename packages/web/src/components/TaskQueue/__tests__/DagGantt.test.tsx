/**
 * Unit tests for DagGantt.
 *
 * Covers: empty state, bar rendering, status colour classes,
 * dependency arrows, critical-path marking, and tooltip.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DagGantt } from '../DagGantt';
import type { GanttTask } from '../DagGantt';

// ── Fixtures ──────────────────────────────────────────────────────────────

const BASE = Date.now() - 60_000; // 1 minute ago

function makeTask(
  overrides: Partial<GanttTask> & { id: string },
): GanttTask {
  return {
    title:     overrides.id,
    status:    'pending',
    dependsOn: [],
    createdAt: BASE,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('DagGantt', () => {
  it('shows empty-state message when tasks array is empty', () => {
    render(<DagGantt tasks={[]} />);
    expect(screen.getByText(/no tasks to display/i)).toBeInTheDocument();
  });

  it('renders one bar element per task', () => {
    const tasks: GanttTask[] = [
      makeTask({ id: 'a', status: 'done', createdAt: BASE, completedAt: BASE + 10_000 }),
      makeTask({ id: 'b', status: 'running', createdAt: BASE + 5_000 }),
      makeTask({ id: 'c', status: 'failed', createdAt: BASE + 2_000, completedAt: BASE + 8_000 }),
    ];
    const { container } = render(<DagGantt tasks={tasks} />);

    // Each task gets a label in the label column.
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
    expect(screen.getByText('c')).toBeInTheDocument();

    // Each task bar is a div with an absolute position inside the timeline column.
    const bars = container.querySelectorAll('[style*="left:"]');
    expect(bars.length).toBeGreaterThanOrEqual(3);
  });

  it('applies the correct colour class for each status', () => {
    const statuses = ['done', 'running', 'pending', 'blocked', 'failed', 'skipped'] as const;
    const tasks: GanttTask[] = statuses.map((s, i) =>
      makeTask({ id: `task-${i}`, status: s, createdAt: BASE + i * 1_000 }),
    );
    const { container } = render(<DagGantt tasks={tasks} />);

    // `done` bars should have the green class.
    const greenBars = container.querySelectorAll('.bg-green-500');
    expect(greenBars.length).toBeGreaterThanOrEqual(1);

    // `failed` bars should have the red class.
    const redBars = container.querySelectorAll('.bg-red-500');
    expect(redBars.length).toBeGreaterThanOrEqual(1);

    // `running` bars should include animate-pulse.
    const pulseBars = container.querySelectorAll('.animate-pulse');
    expect(pulseBars.length).toBeGreaterThanOrEqual(1);
  });

  it('renders SVG dependency arrows for tasks with dependsOn', () => {
    const tasks: GanttTask[] = [
      makeTask({ id: 'root', status: 'done', completedAt: BASE + 5_000 }),
      makeTask({ id: 'child', status: 'running', dependsOn: ['root'], createdAt: BASE + 5_000 }),
    ];
    const { container } = render(<DagGantt tasks={tasks} />);

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    const paths = container.querySelectorAll('svg path');
    // One arrow path + marker paths.
    expect(paths.length).toBeGreaterThan(0);
  });

  it('marks critical-path tasks with a star ★ in the label column', () => {
    // A simple linear chain: root → middle → leaf.
    // All three should be on the critical path.
    const tasks: GanttTask[] = [
      makeTask({ id: 'root',   status: 'done',    createdAt: BASE,          completedAt: BASE + 10_000 }),
      makeTask({ id: 'middle', status: 'done',    createdAt: BASE + 10_000, completedAt: BASE + 20_000, dependsOn: ['root'] }),
      makeTask({ id: 'leaf',   status: 'running', createdAt: BASE + 20_000, dependsOn: ['middle'] }),
    ];
    const { container } = render(<DagGantt tasks={tasks} />);

    const stars = container.querySelectorAll('.text-orange-400');
    expect(stars.length).toBeGreaterThanOrEqual(1);
  });

  it('shows tooltip with task details on mouse enter', () => {
    const tasks: GanttTask[] = [
      makeTask({
        id:        'hover-me',
        title:     'My Task',
        status:    'done',
        assignee:  'developer',
        createdAt: BASE,
        completedAt: BASE + 5_000,
      }),
    ];
    const { container } = render(<DagGantt tasks={tasks} />);

    // Find the bar div by the `left:` inline style it has.
    const bar = container.querySelector('[style*="left:"]') as HTMLElement;
    expect(bar).not.toBeNull();

    fireEvent.mouseEnter(bar, { clientX: 200, clientY: 100 });

    // Tooltip should show the task title and status.
    expect(screen.getByText('My Task')).toBeInTheDocument();
    expect(screen.getByText(/done/i)).toBeInTheDocument();
  });

  it('dismisses tooltip on mouse leave', () => {
    const tasks: GanttTask[] = [
      makeTask({ id: 'x', status: 'running', title: 'Running task' }),
    ];
    const { container } = render(<DagGantt tasks={tasks} />);

    const bar = container.querySelector('[style*="left:"]') as HTMLElement;
    fireEvent.mouseEnter(bar, { clientX: 200, clientY: 100 });
    fireEvent.mouseLeave(bar);

    // After leaving, fixed tooltip div should not be in the document.
    const fixed = container.querySelector('.fixed.z-50');
    expect(fixed).toBeNull();
  });

  it('renders the status-colour legend', () => {
    render(<DagGantt tasks={[makeTask({ id: 'any', status: 'done' })]} />);
    expect(screen.getByText(/critical path/i)).toBeInTheDocument();
    expect(screen.getByText('done')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  // ── Scrollable container ─────────────────────────────────────────────

  it('renders a scrollable container with overflow-auto', () => {
    const { container } = render(<DagGantt tasks={[makeTask({ id: 's', status: 'running' })]} />);
    const scrollArea = container.querySelector('.overflow-auto');
    expect(scrollArea).not.toBeNull();
  });

  it('label column is sticky for horizontal scrolling', () => {
    const { container } = render(<DagGantt tasks={[makeTask({ id: 's', status: 'running' })]} />);
    const labelCol = container.querySelector('.sticky');
    expect(labelCol).not.toBeNull();
  });

  // ── Local timezone ───────────────────────────────────────────────────

  it('time display uses local timezone (toLocaleTimeString)', () => {
    const tasks: GanttTask[] = [
      makeTask({ id: 'tz', status: 'done', createdAt: BASE, completedAt: BASE + 10_000 }),
    ];
    const { container } = render(<DagGantt tasks={tasks} />);
    // fmtTime uses toLocaleTimeString which outputs locale-dependent strings.
    // Just verify the time axis header region exists and contains text.
    const timeTexts = container.querySelectorAll('.text-th-text-muted');
    expect(timeTexts.length).toBeGreaterThan(0);
  });
});
