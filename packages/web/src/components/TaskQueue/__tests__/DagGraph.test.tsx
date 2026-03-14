/**
 * Unit tests for DagGraph tooltip behavior.
 *
 * Covers: tooltip on hover (200ms delay), click-to-pin, Escape to unpin,
 * tooltip content (4 sections), dismiss on second click, empty state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { DagStatus, DagTask } from '../../../types';

// ── Mock @xyflow/react ────────────────────────────────────────────────────
// ReactFlow requires a DOM measurement environment. We mock the core
// components to isolate tooltip logic testing.

let capturedOnNodeMouseEnter: ((event: unknown, node: unknown) => void) | undefined;
let capturedOnNodeMouseLeave: ((event: unknown, node: unknown) => void) | undefined;
let capturedOnNodeClick: ((event: unknown, node: unknown) => void) | undefined;
let capturedOnMoveStart: (() => void) | undefined;

vi.mock('@xyflow/react', () => {
  const ReactFlow = ({ children, onNodeMouseEnter, onNodeMouseLeave, onNodeClick, onMoveStart, ..._rest }: Record<string, unknown>) => {
    capturedOnNodeMouseEnter = onNodeMouseEnter as typeof capturedOnNodeMouseEnter;
    capturedOnNodeMouseLeave = onNodeMouseLeave as typeof capturedOnNodeMouseLeave;
    capturedOnNodeClick = onNodeClick as typeof capturedOnNodeClick;
    capturedOnMoveStart = onMoveStart as typeof capturedOnMoveStart;
    return <div data-testid="react-flow">{children as React.ReactNode}</div>;
  };
  return {
    ReactFlow,
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    useNodesState: (init: unknown[]) => [init, vi.fn(), vi.fn()],
    useEdgesState: (init: unknown[]) => [init, vi.fn(), vi.fn()],
    useReactFlow: () => ({
      fitView: vi.fn(),
      flowToScreenPosition: ({ x, y }: { x: number; y: number }) => ({ x: x + 100, y: y + 50 }),
    }),
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Handle: () => null,
    Position: { Left: 'left', Right: 'right' },
    MarkerType: { ArrowClosed: 'arrowclosed' },
  };
});

// Must import AFTER mock
import { DagGraph } from '../DagGraph';

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<DagTask> & { id: string }): DagTask {
  return {
    leadId: 'lead-1',
    role: 'developer',
    description: 'Test task',
    files: [],
    dependsOn: [],
    dagStatus: 'running',
    priority: 1,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

function makeDagStatus(tasks: DagTask[]): DagStatus {
  const summary = { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 };
  for (const t of tasks) summary[t.dagStatus]++;
  return { tasks, fileLockMap: {}, summary };
}

function makeNode(task: DagTask) {
  return {
    id: task.id,
    type: 'dagTask',
    position: { x: 40, y: 40 },
    data: { task },
    width: 180,
    height: 100,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('DagGraph', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capturedOnNodeMouseEnter = undefined;
    capturedOnNodeMouseLeave = undefined;
    capturedOnNodeClick = undefined;
    capturedOnMoveStart = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders empty state when no tasks', () => {
    render(<DagGraph dagStatus={null} />);
    expect(screen.getByText(/no dag tasks/i)).toBeInTheDocument();
  });

  it('renders ReactFlow when tasks exist', () => {
    const status = makeDagStatus([makeTask({ id: 'task-1' })]);
    render(<DagGraph dagStatus={status} />);
    expect(screen.getByTestId('react-flow')).toBeInTheDocument();
  });

  it('shows tooltip after 200ms hover delay', () => {
    const task = makeTask({ id: 'hover-task', description: 'Hover description' });
    const status = makeDagStatus([task]);
    render(<DagGraph dagStatus={status} />);

    expect(capturedOnNodeMouseEnter).toBeDefined();

    // Trigger hover
    act(() => {
      capturedOnNodeMouseEnter!({}, makeNode(task));
    });

    // Before 200ms — no tooltip
    expect(screen.queryByTestId('dag-tooltip')).not.toBeInTheDocument();

    // After 200ms
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByTestId('dag-tooltip')).toBeInTheDocument();
    expect(screen.getByText('hover-task')).toBeInTheDocument();
    expect(screen.getByText('Hover description')).toBeInTheDocument();
  });

  it('hides tooltip on mouse leave before delay', () => {
    const task = makeTask({ id: 'quick-leave' });
    const status = makeDagStatus([task]);
    render(<DagGraph dagStatus={status} />);

    act(() => { capturedOnNodeMouseEnter!({}, makeNode(task)); });
    act(() => { vi.advanceTimersByTime(100); }); // Only 100ms
    act(() => { capturedOnNodeMouseLeave!({}, makeNode(task)); });
    act(() => { vi.advanceTimersByTime(200); }); // Timer should be cancelled

    expect(screen.queryByTestId('dag-tooltip')).not.toBeInTheDocument();
  });

  it('shows status pill with correct status text', () => {
    const task = makeTask({ id: 'status-check', dagStatus: 'failed' });
    const status = makeDagStatus([task]);
    render(<DagGraph dagStatus={status} />);

    act(() => { capturedOnNodeMouseEnter!({}, makeNode(task)); });
    act(() => { vi.advanceTimersByTime(200); });

    const pill = screen.getByTestId('dag-tooltip-status');
    expect(pill).toHaveTextContent('failed');
  });

  it('shows agent role, model, and assignedAgentId in tooltip', () => {
    const task = makeTask({
      id: 'agent-detail',
      role: 'architect',
      model: 'claude-sonnet',
      assignedAgentId: 'abc12345-long-id',
    });
    const status = makeDagStatus([task]);
    render(<DagGraph dagStatus={status} />);

    act(() => { capturedOnNodeMouseEnter!({}, makeNode(task)); });
    act(() => { vi.advanceTimersByTime(200); });

    expect(screen.getByText('architect')).toBeInTheDocument();
    expect(screen.getByText(/claude-sonnet/)).toBeInTheDocument();
    expect(screen.getByText(/abc12345/)).toBeInTheDocument();
  });

  it('shows files in tooltip detail section', () => {
    const task = makeTask({
      id: 'file-task',
      files: ['src/index.ts', 'src/utils.ts'],
    });
    const status = makeDagStatus([task]);
    render(<DagGraph dagStatus={status} />);

    act(() => { capturedOnNodeMouseEnter!({}, makeNode(task)); });
    act(() => { vi.advanceTimersByTime(200); });

    expect(screen.getByText(/src\/index\.ts/)).toBeInTheDocument();
    expect(screen.getByText(/src\/utils\.ts/)).toBeInTheDocument();
  });

  it('shows upstream dependencies in tooltip', () => {
    const parent = makeTask({ id: 'parent', description: 'Parent task' });
    const child = makeTask({ id: 'child', dependsOn: ['parent'] });
    const status = makeDagStatus([parent, child]);
    render(<DagGraph dagStatus={status} />);

    act(() => { capturedOnNodeMouseEnter!({}, makeNode(child)); });
    act(() => { vi.advanceTimersByTime(200); });

    expect(screen.getByText(/upstream/i)).toBeInTheDocument();
    expect(screen.getByText('Parent task')).toBeInTheDocument();
  });

  it('shows downstream dependencies in tooltip', () => {
    const parent = makeTask({ id: 'root', description: 'Root task' });
    const child = makeTask({ id: 'child-1', dependsOn: ['root'], description: 'Child task' });
    const status = makeDagStatus([parent, child]);
    render(<DagGraph dagStatus={status} />);

    act(() => { capturedOnNodeMouseEnter!({}, makeNode(parent)); });
    act(() => { vi.advanceTimersByTime(200); });

    expect(screen.getByText(/downstream/i)).toBeInTheDocument();
    expect(screen.getByText('Child task')).toBeInTheDocument();
  });

  it('pins tooltip on click and shows close button', () => {
    const task = makeTask({ id: 'pin-me' });
    const status = makeDagStatus([task]);
    render(<DagGraph dagStatus={status} />);

    // Click to pin
    act(() => { capturedOnNodeClick!({}, makeNode(task)); });
    expect(screen.getByTestId('dag-tooltip')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close tooltip/i })).toBeInTheDocument();
  });

  it('unpins tooltip on Escape key', () => {
    const task = makeTask({ id: 'escape-me' });
    const status = makeDagStatus([task]);
    render(<DagGraph dagStatus={status} />);

    // Pin
    act(() => { capturedOnNodeClick!({}, makeNode(task)); });
    expect(screen.getByTestId('dag-tooltip')).toBeInTheDocument();

    // Escape
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(screen.queryByTestId('dag-tooltip')).not.toBeInTheDocument();
  });

  it('unpins tooltip when clicking close button', () => {
    const task = makeTask({ id: 'close-btn' });
    const status = makeDagStatus([task]);
    render(<DagGraph dagStatus={status} />);

    act(() => { capturedOnNodeClick!({}, makeNode(task)); });
    const closeBtn = screen.getByRole('button', { name: /close tooltip/i });
    act(() => { fireEvent.click(closeBtn); });

    expect(screen.queryByTestId('dag-tooltip')).not.toBeInTheDocument();
  });

  it('toggles pinned tooltip off when clicking same node', () => {
    const task = makeTask({ id: 'toggle-task' });
    const status = makeDagStatus([task]);
    render(<DagGraph dagStatus={status} />);

    // Pin
    act(() => { capturedOnNodeClick!({}, makeNode(task)); });
    expect(screen.getByTestId('dag-tooltip')).toBeInTheDocument();

    // Click same node → unpin
    act(() => { capturedOnNodeClick!({}, makeNode(task)); });
    expect(screen.queryByTestId('dag-tooltip')).not.toBeInTheDocument();
  });

  it('dismisses hover tooltip on pan/zoom start', () => {
    const task = makeTask({ id: 'dismiss-on-move' });
    const status = makeDagStatus([task]);
    render(<DagGraph dagStatus={status} />);

    // Show tooltip
    act(() => { capturedOnNodeMouseEnter!({}, makeNode(task)); });
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByTestId('dag-tooltip')).toBeInTheDocument();

    // Pan starts → dismiss
    act(() => { capturedOnMoveStart!(); });
    expect(screen.queryByTestId('dag-tooltip')).not.toBeInTheDocument();
  });

  it('has role="tooltip" and aria-label', () => {
    const task = makeTask({ id: 'a11y-task' });
    const status = makeDagStatus([task]);
    render(<DagGraph dagStatus={status} />);

    act(() => { capturedOnNodeMouseEnter!({}, makeNode(task)); });
    act(() => { vi.advanceTimersByTime(200); });

    const tooltip = screen.getByTestId('dag-tooltip');
    expect(tooltip).toHaveAttribute('role', 'tooltip');
    expect(tooltip).toHaveAttribute('aria-label', 'Details for task a11y-task');
  });

  it('shows priority when > 0', () => {
    const task = makeTask({ id: 'prio-task', priority: 5 });
    const status = makeDagStatus([task]);
    render(<DagGraph dagStatus={status} />);

    act(() => { capturedOnNodeMouseEnter!({}, makeNode(task)); });
    act(() => { vi.advanceTimersByTime(200); });

    expect(screen.getByText(/Priority: 5/)).toBeInTheDocument();
  });
});
