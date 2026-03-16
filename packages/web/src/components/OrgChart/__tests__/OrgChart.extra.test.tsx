// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────

let mockAgents: any[] = [];
let mockProjects: Record<string, any> = {};

vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (selector: any) => selector({ agents: mockAgents }),
    { getState: () => ({ agents: mockAgents }) },
  ),
}));

vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: (selector: any) =>
    selector({
      projects: mockProjects,
    }),
}));

vi.mock('../../../contexts/ProjectContext', () => ({
  useOptionalProjectId: () => null,
}));

vi.mock('../../Shared', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
    </div>
  ),
}));

vi.mock('../../FleetOverview/CommHeatmap', () => ({
  CommHeatmap: () => <div data-testid="comm-heatmap" />,
}));

vi.mock('../../CommFlow/CommFlowGraph', () => ({
  CommFlowGraph: () => <div data-testid="comm-flow-graph" />,
}));

const mockDetailPanel = vi.fn().mockReturnValue(<div data-testid="agent-detail-modal" />);
vi.mock('../../AgentDetailPanel', () => ({
  AgentDetailPanel: (props: any) => mockDetailPanel(props),
}));

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

vi.mock('../../../utils/markdown', () => ({
  idColor: () => '#888',
}));

vi.mock('../../Toast', () => ({
  useToastStore: Object.assign(
    (selector: any) => selector({ add: vi.fn() }),
    { getState: () => ({ add: vi.fn() }) },
  ),
}));

import { OrgChart } from '../OrgChart';

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    role: { id: 'lead', name: 'Project Lead', icon: '🎯' },
    status: 'running',
    childIds: [],
    parentId: undefined,
    createdAt: '2026-01-01T00:00:00Z',
    model: 'claude-sonnet-4',
    provider: 'copilot',
    projectId: 'p1',
    projectName: 'Alpha Project',
    ...overrides,
  };
}

describe('OrgChart – extra coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDetailPanel.mockClear();
    mockAgents = [];
    mockProjects = {};
  });

  afterEach(cleanup);

  /* ── Empty state ──────────────────────────────────────────────── */

  it('shows empty state when no agents are running', () => {
    mockAgents = [];
    render(<OrgChart />);
    expect(screen.getByText('No agents running')).toBeInTheDocument();
  });

  /* ── Hierarchy tree with parent-child ─────────────────────────── */

  it('renders hierarchy tree with parent-child relationships', () => {
    const lead = makeAgent();
    const dev = makeAgent({
      id: 'dev-11111111',
      role: { id: 'developer', name: 'Developer', icon: '💻' },
      parentId: lead.id,
      provider: undefined,
      model: undefined,
    });
    const arch = makeAgent({
      id: 'arch-2222222',
      role: { id: 'architect', name: 'Architect', icon: '🏗️' },
      parentId: lead.id,
      provider: 'anthropic',
      model: 'claude-sonnet-4',
    });
    mockAgents = [lead, dev, arch];
    mockProjects = { [lead.id]: { comms: [], groups: [], groupMessages: {} } };

    render(<OrgChart />);

    expect(screen.getByText('Project Lead')).toBeInTheDocument();
    expect(screen.getByText('Developer')).toBeInTheDocument();
    expect(screen.getByText('Architect')).toBeInTheDocument();
  });

  /* ── AgentNode shows status, model, provider ──────────────────── */

  it('renders agent node with status badge', () => {
    const lead = makeAgent({ status: 'idle' });
    mockAgents = [lead];
    mockProjects = { [lead.id]: { comms: [], groups: [], groupMessages: {} } };

    render(<OrgChart />);
    expect(screen.getByText('idle')).toBeInTheDocument();
  });

  it('renders agent node with provider badge', () => {
    const lead = makeAgent({ provider: 'anthropic' });
    mockAgents = [lead];
    mockProjects = { [lead.id]: { comms: [], groups: [], groupMessages: {} } };

    render(<OrgChart />);
    expect(screen.getByText('anthropic')).toBeInTheDocument();
  });

  it('renders agent node with model label', () => {
    const lead = makeAgent({ model: 'claude-sonnet-4' });
    mockAgents = [lead];
    mockProjects = { [lead.id]: { comms: [], groups: [], groupMessages: {} } };

    render(<OrgChart />);
    expect(screen.getByText('sonnet-4')).toBeInTheDocument();
  });

  it('renders agents with different statuses using correct style', () => {
    const lead = makeAgent({
      id: 'lead-main-1111',
      role: { id: 'lead', name: 'Main Lead', icon: '🎯' },
      status: 'running',
    });
    const agents = ['idle', 'completed', 'failed'].map((status, i) =>
      makeAgent({
        id: `agent-${status}-${i}`,
        role: { id: 'dev', name: `${status} Agent`, icon: '💻' },
        status,
        parentId: lead.id,
      }),
    );
    mockAgents = [lead, ...agents];
    mockProjects = { [lead.id]: { comms: [], groups: [], groupMessages: {} } };

    render(<OrgChart />);

    expect(screen.getByText('running')).toBeInTheDocument();
    for (const status of ['idle', 'completed', 'failed']) {
      expect(screen.getByText(status)).toBeInTheDocument();
    }
  });

  /* ── Communication view switching ─────────────────────────────── */

  it('switches between communication views', () => {
    const lead = makeAgent();
    const dev = makeAgent({
      id: 'dev-view-test1',
      role: { id: 'developer', name: 'Dev Worker', icon: '💻' },
      parentId: lead.id,
    });
    mockAgents = [lead, dev];
    mockProjects = { [lead.id]: { comms: [], groups: [], groupMessages: {} } };

    render(<OrgChart />);

    // Default view is "graph"
    expect(screen.getByTestId('comm-flow-graph')).toBeInTheDocument();

    // Switch to List — empty comms shows "No messages yet"
    fireEvent.click(screen.getByText('List'));
    expect(screen.getByText('No messages yet')).toBeInTheDocument();

    // Switch to Matrix — with agents but no comms, shows table header
    fireEvent.click(screen.getByText('Matrix'));
    expect(screen.getByText('From ↓ / To →')).toBeInTheDocument();

    // Switch to Heatmap
    fireEvent.click(screen.getByText('Heatmap'));
    expect(screen.getByTestId('comm-heatmap')).toBeInTheDocument();

    // Switch back to Graph
    fireEvent.click(screen.getByText('Graph'));
    expect(screen.getByTestId('comm-flow-graph')).toBeInTheDocument();
  });

  /* ── CommsList with messages ──────────────────────────────────── */

  it('renders comms list with direct messages', () => {
    const lead = makeAgent();
    const dev = makeAgent({
      id: 'dev-11111111',
      role: { id: 'developer', name: 'Developer', icon: '💻' },
      parentId: lead.id,
    });
    mockAgents = [lead, dev];
    mockProjects = {
      [lead.id]: {
        comms: [
          {
            id: 'c1',
            fromId: lead.id,
            fromRole: 'Project Lead',
            toId: dev.id,
            toRole: 'Developer',
            content: 'Please implement the login feature',
            timestamp: Date.now() - 1000,
          },
        ],
        groups: [],
        groupMessages: {},
      },
    };

    render(<OrgChart />);
    fireEvent.click(screen.getByText('List'));

    expect(screen.getByText(/Please implement the login feature/)).toBeInTheDocument();
  });

  it('renders comms list with group messages', () => {
    const lead = makeAgent();
    mockAgents = [lead];
    mockProjects = {
      [lead.id]: {
        comms: [],
        groups: [],
        groupMessages: {
          'backend-team': [
            {
              id: 'gm1',
              fromAgentId: lead.id,
              fromRole: 'Project Lead',
              content: 'Group update from the lead',
              timestamp: new Date().toISOString(),
            },
          ],
        },
      },
    };

    render(<OrgChart />);
    fireEvent.click(screen.getByText('List'));

    expect(screen.getByText(/Group update from the lead/)).toBeInTheDocument();
    expect(screen.getByText('backend-team')).toBeInTheDocument();
  });

  it('shows message count with group count in comms section header', () => {
    const lead = makeAgent();
    mockAgents = [lead];
    mockProjects = {
      [lead.id]: {
        comms: [
          { id: 'c1', fromId: lead.id, fromRole: 'Lead', toId: 'dev-1', toRole: 'Dev', content: 'Hi', timestamp: Date.now() },
        ],
        groups: [],
        groupMessages: {
          team: [
            { id: 'gm1', fromAgentId: lead.id, fromRole: 'Lead', content: 'Group msg', timestamp: new Date().toISOString() },
          ],
        },
      },
    };

    render(<OrgChart />);
    expect(screen.getByText(/2 messages/)).toBeInTheDocument();
    expect(screen.getByText(/1 group/)).toBeInTheDocument();
  });

  /* ── CommsList expand/collapse long messages ───────────────────── */

  it('truncates long messages in comms list and expands on click', () => {
    const lead = makeAgent();
    const longContent = 'A'.repeat(200);
    mockAgents = [lead];
    mockProjects = {
      [lead.id]: {
        comms: [
          {
            id: 'c1',
            fromId: lead.id,
            fromRole: 'Project Lead',
            toId: 'dev-1',
            toRole: 'Developer',
            content: longContent,
            timestamp: Date.now(),
          },
        ],
        groups: [],
        groupMessages: {},
      },
    };

    render(<OrgChart />);
    fireEvent.click(screen.getByText('List'));

    // Should show truncated preview (120 chars + …)
    expect(screen.getByText(/200 chars/)).toBeInTheDocument();

    // Click to expand
    const msgButton = screen.getByText(/200 chars/).closest('button')!;
    fireEvent.click(msgButton);

    // After expand, should show full content
    expect(screen.getByText(longContent)).toBeInTheDocument();
  });

  /* ── CommsMatrix with data ────────────────────────────────────── */

  it('renders comms matrix with message counts', () => {
    const lead = makeAgent();
    const dev = makeAgent({
      id: 'dev-11111111',
      role: { id: 'developer', name: 'Developer', icon: '💻' },
      parentId: lead.id,
    });
    mockAgents = [lead, dev];
    mockProjects = {
      [lead.id]: {
        comms: [
          { id: 'c1', fromId: lead.id, fromRole: 'Project Lead', toId: dev.id, toRole: 'Developer', content: 'msg1', timestamp: Date.now() },
          { id: 'c2', fromId: lead.id, fromRole: 'Project Lead', toId: dev.id, toRole: 'Developer', content: 'msg2', timestamp: Date.now() },
          { id: 'c3', fromId: dev.id, fromRole: 'Developer', toId: lead.id, toRole: 'Project Lead', content: 'reply', timestamp: Date.now() },
        ],
        groups: [],
        groupMessages: {},
      },
    };

    render(<OrgChart />);
    fireEvent.click(screen.getByText('Matrix'));

    // Matrix header should have "From ↓ / To →"
    expect(screen.getByText('From ↓ / To →')).toBeInTheDocument();

    // Should show message count of 2 (lead→dev)
    expect(screen.getByText('2')).toBeInTheDocument();
    // And 1 (dev→lead)
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  /* ── Project tabs ─────────────────────────────────────────────── */

  it('renders project tabs when multiple leads exist', () => {
    const lead1 = makeAgent({
      projectName: 'Alpha',
    });
    const lead2 = makeAgent({
      id: 'lead-22222222',
      projectName: 'Beta',
      projectId: 'p2',
    });
    mockAgents = [lead1, lead2];
    mockProjects = {
      [lead1.id]: { comms: [], groups: [], groupMessages: {} },
      [lead2.id]: { comms: [], groups: [], groupMessages: {} },
    };

    render(<OrgChart />);

    // Both project tabs should be visible
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(2);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('switches to another project when tab is clicked', () => {
    const lead1 = makeAgent({ projectName: 'Alpha' });
    const lead2 = makeAgent({
      id: 'lead-22222222',
      role: { id: 'lead', name: 'Lead Beta', icon: '🎯' },
      projectName: 'Beta',
      projectId: 'p2',
    });
    const dev2 = makeAgent({
      id: 'dev-for-lead2',
      role: { id: 'developer', name: 'Beta Dev', icon: '💻' },
      parentId: lead2.id,
    });
    mockAgents = [lead1, lead2, dev2];
    mockProjects = {
      [lead1.id]: { comms: [], groups: [], groupMessages: {} },
      [lead2.id]: { comms: [], groups: [], groupMessages: {} },
    };

    render(<OrgChart />);

    // Click on Beta tab
    fireEvent.click(screen.getByText('Beta'));

    // Should show Lead Beta agent (belongs to lead2 team)
    expect(screen.getByText('Lead Beta')).toBeInTheDocument();
    expect(screen.getByText('Beta Dev')).toBeInTheDocument();
  });

  /* ── Agent count shown ────────────────────────────────────────── */

  it('shows agent count in hierarchy section header', () => {
    const lead = makeAgent();
    const dev = makeAgent({
      id: 'dev-11111111',
      role: { id: 'developer', name: 'Developer', icon: '💻' },
      parentId: lead.id,
    });
    mockAgents = [lead, dev];
    mockProjects = { [lead.id]: { comms: [], groups: [], groupMessages: {} } };

    render(<OrgChart />);
    expect(screen.getByText('2 agents')).toBeInTheDocument();
  });

  /* ── Page title always renders ────────────────────────────────── */

  it('always renders the page title "Org Chart"', () => {
    mockAgents = [];
    render(<OrgChart />);
    expect(screen.getByText('Org Chart')).toBeInTheDocument();
  });

  /* ── Grandchild agents included in team ───────────────────────── */

  it('includes grandchild agents in team hierarchy', () => {
    const lead = makeAgent();
    const mid = makeAgent({
      id: 'mid-11111111',
      role: { id: 'manager', name: 'Manager', icon: '📋' },
      parentId: lead.id,
    });
    const grandchild = makeAgent({
      id: 'gc-222222222',
      role: { id: 'developer', name: 'Grandchild Dev', icon: '💻' },
      parentId: mid.id,
    });
    mockAgents = [lead, mid, grandchild];
    mockProjects = { [lead.id]: { comms: [], groups: [], groupMessages: {} } };

    render(<OrgChart />);

    expect(screen.getByText('Project Lead')).toBeInTheDocument();
    expect(screen.getByText('Manager')).toBeInTheDocument();
    expect(screen.getByText('Grandchild Dev')).toBeInTheDocument();
    expect(screen.getByText('3 agents')).toBeInTheDocument();
  });
});
