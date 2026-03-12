// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within, cleanup } from '@testing-library/react';
import type { DagStatus, DagTask } from '../../../types';

// ── Mock @xyflow/react ────────────────────────────────────────────────────

let capturedOnNodeClick: ((event: unknown, node: unknown) => void) | undefined;
let capturedOnNodeMouseEnter: ((event: unknown, node: unknown) => void) | undefined;

vi.mock('@xyflow/react', () => {
  const ReactFlow = ({ children, onNodeClick, onNodeMouseEnter, ...rest }: Record<string, unknown>) => {
    capturedOnNodeClick = onNodeClick as typeof capturedOnNodeClick;
    capturedOnNodeMouseEnter = onNodeMouseEnter as typeof capturedOnNodeMouseEnter;
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

// Mock AgentDetailPanel to avoid heavy dependencies
vi.mock('../../AgentDetailPanel', () => ({
  AgentDetailPanel: ({ agentId, mode, onClose }: { agentId: string; mode: string; onClose: () => void }) => (
    <div data-testid="agent-detail-panel" data-agent-id={agentId} data-mode={mode}>
      <button onClick={onClose} data-testid="close-panel">Close</button>
    </div>
  ),
}));

// Must import AFTER mocks
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

describe('DagGraph clickable agent ID', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capturedOnNodeClick = undefined;
    capturedOnNodeMouseEnter = undefined;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders agent ID as clickable in tooltip', () => {
    const task = makeTask({ id: 'task-1', assignedAgentId: 'abc12345def67890' });
    render(<DagGraph dagStatus={makeDagStatus([task])} />);

    // Click node to pin tooltip
    act(() => { capturedOnNodeClick!({}, makeNode(task)); });

    const agentBtn = screen.getByTitle('View agent details');
    expect(agentBtn).toBeInTheDocument();
    expect(agentBtn).toHaveAttribute('role', 'button');
    expect(agentBtn.style.cursor).toBe('pointer');
    expect(agentBtn).toHaveTextContent('abc12345');
  });

  it('opens AgentDetailPanel in modal mode when agent ID is clicked', () => {
    const task = makeTask({ id: 'task-1', assignedAgentId: 'abc12345def67890' });
    render(<DagGraph dagStatus={makeDagStatus([task])} />);

    // Pin tooltip
    act(() => { capturedOnNodeClick!({}, makeNode(task)); });

    // Click agent ID in tooltip
    fireEvent.click(screen.getByTitle('View agent details'));

    const panel = screen.getByTestId('agent-detail-panel');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute('data-agent-id', 'abc12345def67890');
    expect(panel).toHaveAttribute('data-mode', 'modal');
  });

  it('closes AgentDetailPanel when onClose is called', () => {
    const task = makeTask({ id: 'task-1', assignedAgentId: 'abc12345def67890' });
    render(<DagGraph dagStatus={makeDagStatus([task])} />);

    // Pin tooltip, click agent
    act(() => { capturedOnNodeClick!({}, makeNode(task)); });
    fireEvent.click(screen.getByTitle('View agent details'));
    expect(screen.getByTestId('agent-detail-panel')).toBeInTheDocument();

    // Close panel
    fireEvent.click(screen.getByTestId('close-panel'));
    expect(screen.queryByTestId('agent-detail-panel')).not.toBeInTheDocument();
  });

  it('agent ID supports keyboard activation', () => {
    const task = makeTask({ id: 'task-1', assignedAgentId: 'abc12345def67890' });
    render(<DagGraph dagStatus={makeDagStatus([task])} />);

    act(() => { capturedOnNodeClick!({}, makeNode(task)); });

    const agentBtn = screen.getByTitle('View agent details');
    fireEvent.keyDown(agentBtn, { key: 'Enter' });

    expect(screen.getByTestId('agent-detail-panel')).toBeInTheDocument();
  });

  it('does not render clickable agent when assignedAgentId is absent', () => {
    const task = makeTask({ id: 'task-1' });
    render(<DagGraph dagStatus={makeDagStatus([task])} />);

    act(() => { capturedOnNodeClick!({}, makeNode(task)); });

    expect(screen.queryByRole('button', { name: /view agent/i })).not.toBeInTheDocument();
  });
});
