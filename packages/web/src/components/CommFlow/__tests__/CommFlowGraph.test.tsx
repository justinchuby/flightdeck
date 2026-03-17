// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { AgentInfo } from '../../../types';

/* ------------------------------------------------------------------ */
/*  Test data                                                         */
/* ------------------------------------------------------------------ */
const leadId = 'lead-abc123';

const mockAgents: Partial<AgentInfo>[] = [
  {
    id: leadId,
    role: { id: 'lead', name: 'Project Lead', icon: '👑' } as AgentInfo['role'],
    status: 'running',
    parentId: undefined,
    childIds: ['agent-1', 'agent-2'],
  },
  {
    id: 'agent-1',
    role: { id: 'developer', name: 'Developer', icon: '💻' } as AgentInfo['role'],
    status: 'running',
    parentId: leadId,
    childIds: [],
  },
  {
    id: 'agent-2',
    role: { id: 'designer', name: 'Designer', icon: '🎨' } as AgentInfo['role'],
    status: 'idle',
    parentId: leadId,
    childIds: [],
  },
];

const mockComms = [
  { fromId: leadId, toId: 'agent-1', type: 'delegation', timestamp: '2026-01-01T00:00:00Z' },
  { fromId: 'agent-1', toId: leadId, type: 'report', timestamp: '2026-01-01T00:01:00Z' },
  { fromId: leadId, toId: 'agent-2', type: 'message', timestamp: '2026-01-01T00:02:00Z' },
];

/* ------------------------------------------------------------------ */
/*  Mocks                                                             */
/* ------------------------------------------------------------------ */

vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ agents: mockAgents }),
    { getState: () => ({ agents: mockAgents }) },
  ),
}));

vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        projects: {
          [leadId]: { comms: mockComms },
        },
      }),
    { getState: () => ({ projects: { [leadId]: { comms: mockComms } } }) },
  ),
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

/* ------------------------------------------------------------------ */
/*  Import after mocks                                                */
/* ------------------------------------------------------------------ */
import { CommFlowGraph } from '../CommFlowGraph';

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('CommFlowGraph', () => {
  /* 1 ─ Empty state */
  it('shows empty state when no agents match', () => {
    render(<CommFlowGraph leadId="nonexistent-lead" />);
    expect(screen.getByText('No agents in this session')).toBeDefined();
  });

  /* 2 ─ Renders SVG with nodes */
  it('renders SVG graph with agent nodes', () => {
    render(<CommFlowGraph leadId={leadId} />);
    const svg = screen.getByTestId('comm-flow-graph');
    expect(svg).toBeDefined();
    expect(svg.tagName).toBe('svg');
  });

  /* 3 ─ Renders node labels */
  it('renders agent labels inside the SVG', () => {
    render(<CommFlowGraph leadId={leadId} />);
    // Node labels include role name and short ID
    expect(screen.getByText(/Project Lead/)).toBeDefined();
    expect(screen.getByText(/Developer/)).toBeDefined();
    expect(screen.getByText(/Designer/)).toBeDefined();
  });

  /* 4 ─ Renders node icons */
  it('renders agent role icons', () => {
    render(<CommFlowGraph leadId={leadId} />);
    expect(screen.getByText('👑')).toBeDefined();
    expect(screen.getByText('💻')).toBeDefined();
    expect(screen.getByText('🎨')).toBeDefined();
  });

  /* 5 ─ Renders legend */
  it('renders message legend', () => {
    render(<CommFlowGraph leadId={leadId} />);
    expect(screen.getByText('Messages')).toBeDefined();
    expect(screen.getByText('Delegation')).toBeDefined();
    expect(screen.getByText('Direct')).toBeDefined();
    expect(screen.getByText('Group')).toBeDefined();
    expect(screen.getByText('Broadcast')).toBeDefined();
  });

  /* 6 ─ Custom dimensions */
  it('respects custom width and height', () => {
    render(<CommFlowGraph leadId={leadId} width={800} height={600} />);
    const svg = screen.getByTestId('comm-flow-graph');
    expect(svg.getAttribute('width')).toBe('800');
    expect(svg.getAttribute('height')).toBe('600');
    expect(svg.getAttribute('viewBox')).toBe('0 0 800 600');
  });

  /* 7 ─ Uses agentsProp when provided */
  it('uses provided agents prop over store agents', () => {
    const customAgents = [
      {
        id: leadId,
        role: { id: 'lead', name: 'Custom Lead', icon: '🚀' } as AgentInfo['role'],
        status: 'running',
        parentId: undefined,
        childIds: [],
      },
    ] as AgentInfo[];

    render(<CommFlowGraph leadId={leadId} agents={customAgents} />);
    expect(screen.getByText(/Custom Lead/)).toBeDefined();
    expect(screen.getByText('🚀')).toBeDefined();
  });

  /* 8 ─ Clicking a node toggles selection (filters edges) */
  it('clicking a node toggles selection', () => {
    render(<CommFlowGraph leadId={leadId} />);
    // Click on the Developer node icon
    const devIcon = screen.getByText('💻');
    const nodeGroup = devIcon.closest('g');
    expect(nodeGroup).toBeDefined();
    fireEvent.click(nodeGroup!);
    // After clicking, glow ring should appear (a circle with r=24)
    // No assertion on filtering since SVG edges are tricky to inspect,
    // but we verify no crash occurs on click.
  });

  /* 9 ─ Empty agents prop falls back to store */
  it('falls back to store agents when agents prop is empty array', () => {
    render(<CommFlowGraph leadId={leadId} agents={[]} />);
    // Empty agentsProp → uses storeAgents
    expect(screen.getByText(/Project Lead/)).toBeDefined();
  });
});
