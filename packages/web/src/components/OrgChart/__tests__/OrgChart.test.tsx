// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../Shared', () => ({
  EmptyState: ({ title, description }: { title?: string; description?: string; message?: string }) => (
    <div data-testid="empty-state">{title ?? ''} {description ?? ''}</div>
  ),
}));

vi.mock('../../FleetOverview/CommHeatmap', () => ({
  CommHeatmap: ({ agents, messages }: any) => (
    <div data-testid="comm-heatmap">agents:{agents?.length ?? 0} msgs:{messages?.length ?? 0}</div>
  ),
}));

vi.mock('../../CommFlow/CommFlowGraph', () => ({
  CommFlowGraph: ({ leadId }: any) => <div data-testid="comm-flow">flow-{leadId}</div>,
}));

vi.mock('../../AgentDetailPanel', () => ({
  AgentDetailPanel: ({ agentId }: any) => <div data-testid="agent-detail">{agentId}</div>,
}));

let mockContextProjectId: string | null = 'p1';
vi.mock('../../../contexts/ProjectContext', () => ({
  useProjectId: () => mockContextProjectId ?? 'p1',
  useOptionalProjectId: () => mockContextProjectId,
}));

const storeState = {
  agents: [] as unknown[],
  projects: {} as Record<string, unknown>,
  selectedLeadId: 'lead-1',
};

vi.mock('../../../stores/appStore', () => ({
  useAppStore: (sel: (s: typeof storeState) => unknown) =>
    typeof sel === 'function' ? sel(storeState) : storeState,
}));

vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: (sel: (s: typeof storeState) => unknown) =>
    typeof sel === 'function' ? sel(storeState) : storeState,
}));

import { OrgChart } from '../OrgChart';

// ── Helpers ─────────────────────────────────────────────────

function makeAgent(id: string, role: string, parentId?: string) {
  return {
    id,
    role: { id: role.toLowerCase(), name: role, icon: '🤖', description: '' },
    status: 'running',
    childIds: [],
    parentId,
    model: 'gpt-4',
    projectId: 'p1',
  };
}

function makeComm(id: string, fromId: string, toId: string) {
  return {
    id,
    fromId,
    fromRole: 'dev',
    toId,
    toRole: 'reviewer',
    content: `message ${id}`,
    timestamp: Date.now(),
    type: 'message',
  };
}

function makeGroupMsg(id: string, fromAgentId: string, groupName: string) {
  return {
    id,
    fromAgentId,
    fromRole: 'dev',
    content: `group message ${id}`,
    timestamp: Date.now(),
    groupName,
  };
}

describe('OrgChart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.agents = [];
    storeState.projects = { p1: { comms: [], groups: [], groupMessages: {} } };
    mockContextProjectId = 'p1';
  });

  it('renders without crashing', () => {
    const { container } = render(<OrgChart />);
    expect(container).toBeTruthy();
  });

  it('renders with agents', () => {
    storeState.agents = [
      makeAgent('a1', 'Lead'),
      makeAgent('a2', 'Dev', 'a1'),
    ];
    const { container } = render(<OrgChart />);
    expect(container).toBeTruthy();
  });

  it('renders empty state without agents', () => {
    storeState.agents = [];
    const { container } = render(<OrgChart />);
    expect(container).toBeTruthy();
  });

  // ── Communication section ───────────────────────────────
  // NOTE: selectedLeadId defaults to contextProjectId ('p1').
  // Agent team is built from agents matching: id===p1 OR parentId===p1.
  // Store projects are keyed by selectedLeadId ('p1').

  it('displays message count in communication section header', () => {
    storeState.agents = [makeAgent('p1', 'Lead'), makeAgent('a2', 'Dev', 'p1')];
    storeState.projects = {
      p1: {
        comms: [makeComm('c1', 'p1', 'a2'), makeComm('c2', 'a2', 'p1')],
        groups: [],
        groupMessages: {},
      },
    };

    render(<OrgChart />);
    expect(screen.getByText('2 messages')).toBeInTheDocument();
  });

  it('displays group message count', () => {
    storeState.agents = [makeAgent('p1', 'Lead'), makeAgent('a2', 'Dev', 'p1')];
    storeState.projects = {
      p1: {
        comms: [makeComm('c1', 'p1', 'a2')],
        groups: [],
        groupMessages: {
          'team-chat': [makeGroupMsg('g1', 'p1', 'team-chat')],
        },
      },
    };

    render(<OrgChart />);
    // Both message count and group count are inside the same span
    expect(screen.getByText(/2 messages/)).toBeInTheDocument();
    expect(screen.getByText(/1 group/)).toBeInTheDocument();
  });

  it('defaults to graph view and shows CommFlowGraph', () => {
    storeState.agents = [makeAgent('p1', 'Lead'), makeAgent('a2', 'Dev', 'p1')];
    storeState.projects = { p1: { comms: [], groups: [], groupMessages: {} } };

    render(<OrgChart />);
    expect(screen.getByTestId('comm-flow')).toBeInTheDocument();
  });

  it('switches to list view on List button click', () => {
    storeState.agents = [makeAgent('p1', 'Lead'), makeAgent('a2', 'Dev', 'p1')];
    storeState.projects = {
      p1: {
        comms: [makeComm('c1', 'p1', 'a2')],
        groups: [],
        groupMessages: {},
      },
    };

    render(<OrgChart />);
    fireEvent.click(screen.getByText('List'));
    expect(screen.queryByTestId('comm-flow')).not.toBeInTheDocument();
    expect(screen.queryByTestId('comm-heatmap')).not.toBeInTheDocument();
  });

  it('switches to matrix view on Matrix button click', () => {
    storeState.agents = [makeAgent('p1', 'Lead'), makeAgent('a2', 'Dev', 'p1')];
    storeState.projects = {
      p1: {
        comms: [makeComm('c1', 'p1', 'a2')],
        groups: [],
        groupMessages: {},
      },
    };

    render(<OrgChart />);
    fireEvent.click(screen.getByText('Matrix'));
    expect(screen.queryByTestId('comm-flow')).not.toBeInTheDocument();
    expect(screen.queryByTestId('comm-heatmap')).not.toBeInTheDocument();
  });

  it('switches to heatmap view on Heatmap button click', () => {
    storeState.agents = [makeAgent('p1', 'Lead'), makeAgent('a2', 'Dev', 'p1')];
    storeState.projects = {
      p1: {
        comms: [makeComm('c1', 'p1', 'a2')],
        groups: [],
        groupMessages: {},
      },
    };

    render(<OrgChart />);
    fireEvent.click(screen.getByText('Heatmap'));
    expect(screen.getByTestId('comm-heatmap')).toBeInTheDocument();
    expect(screen.queryByTestId('comm-flow')).not.toBeInTheDocument();
  });

  it('passes heatmap data to CommHeatmap component', () => {
    storeState.agents = [makeAgent('p1', 'Lead'), makeAgent('a2', 'Dev', 'p1')];
    storeState.projects = {
      p1: {
        comms: [makeComm('c1', 'p1', 'a2')],
        groups: [],
        groupMessages: {},
      },
    };

    render(<OrgChart />);
    fireEvent.click(screen.getByText('Heatmap'));

    const heatmap = screen.getByTestId('comm-heatmap');
    expect(heatmap.textContent).toContain('agents:2');
    expect(heatmap.textContent).toContain('msgs:1');
  });

  it('generates heatmap messages for group messages (fan-out to all team members)', () => {
    storeState.agents = [
      makeAgent('p1', 'Lead'),
      makeAgent('a2', 'Dev', 'p1'),
      makeAgent('a3', 'Reviewer', 'p1'),
    ];
    storeState.projects = {
      p1: {
        comms: [],
        groups: [],
        groupMessages: {
          'team-chat': [makeGroupMsg('g1', 'p1', 'team-chat')],
        },
      },
    };

    render(<OrgChart />);
    fireEvent.click(screen.getByText('Heatmap'));

    // Group msg from p1 should fan-out to a2 and a3 = 2 heatmap messages
    const heatmap = screen.getByTestId('comm-heatmap');
    expect(heatmap.textContent).toContain('msgs:2');
  });

  it('shows agent count in hierarchy section', () => {
    storeState.agents = [
      makeAgent('p1', 'Lead'),
      makeAgent('a2', 'Dev', 'p1'),
      makeAgent('a3', 'Reviewer', 'p1'),
    ];
    storeState.projects = { p1: { comms: [], groups: [], groupMessages: {} } };

    render(<OrgChart />);
    expect(screen.getByText('3 agents')).toBeInTheDocument();
  });

  it('shows empty state in graph view without lead', () => {
    mockContextProjectId = null;
    storeState.agents = [];
    storeState.projects = {};

    render(<OrgChart />);
    // Multiple EmptyState may render; just check at least one exists
    expect(screen.getAllByTestId('empty-state').length).toBeGreaterThanOrEqual(1);
  });

  it('displays Communication Flow header', () => {
    storeState.agents = [makeAgent('p1', 'Lead')];
    storeState.projects = { p1: { comms: [], groups: [], groupMessages: {} } };

    render(<OrgChart />);
    expect(screen.getByText('Communication Flow')).toBeInTheDocument();
  });

  it('displays Agent Hierarchy header', () => {
    storeState.agents = [makeAgent('p1', 'Lead')];
    storeState.projects = { p1: { comms: [], groups: [], groupMessages: {} } };

    render(<OrgChart />);
    expect(screen.getByText('Agent Hierarchy')).toBeInTheDocument();
  });

  it('filters heatmap entries with no fromId', () => {
    storeState.agents = [makeAgent('p1', 'Lead'), makeAgent('a2', 'Dev', 'p1')];
    storeState.projects = {
      p1: {
        comms: [
          { id: 'c1', fromId: '', fromRole: 'dev', toId: 'a2', toRole: 'reviewer', content: 'empty', timestamp: Date.now() },
          makeComm('c2', 'p1', 'a2'),
        ],
        groups: [],
        groupMessages: {},
      },
    };

    render(<OrgChart />);
    fireEvent.click(screen.getByText('Heatmap'));
    const heatmap = screen.getByTestId('comm-heatmap');
    // Only c2 should be counted (c1 has empty fromId)
    expect(heatmap.textContent).toContain('msgs:1');
  });
});
