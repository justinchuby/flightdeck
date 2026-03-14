// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────

let mockAgents: any[] = [];
const _mockLeadComms: any[] = [];
const _mockLeadGroups: any[] = [];

vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (selector: any) => selector({ agents: mockAgents }),
    { getState: () => ({ agents: mockAgents }) },
  ),
}));

vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: (selector: any) =>
    selector({
      projects: new Map(),
      comms: new Map(),
      groups: [],
    }),
}));

vi.mock('../../../contexts/ProjectContext', () => ({
  useOptionalProjectId: () => null,
}));

// Stub heavy sub-components to keep tests fast and focused
vi.mock('../../FleetOverview/CommHeatmap', () => ({
  CommHeatmap: () => <div data-testid="comm-heatmap" />,
}));

vi.mock('../../CommFlow/CommFlowGraph', () => ({
  CommFlowGraph: () => <div data-testid="comm-flow-graph" />,
}));

// Mock AgentDetailPanel to verify it receives correct props
const mockDetailPanel = vi.fn().mockReturnValue(<div data-testid="agent-detail-modal" />);
vi.mock('../../AgentDetailPanel', () => ({
  AgentDetailPanel: (props: any) => mockDetailPanel(props),
}));

// Mock apiFetch and Toast used by AgentDetailModal
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../Toast', () => ({
  useToastStore: Object.assign(
    (selector: any) => selector({ add: vi.fn() }),
    { getState: () => ({ add: vi.fn() }) },
  ),
}));

// ── Import component after mocks ──────────────────────────────
import { OrgChart } from '../OrgChart';

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    role: { id: 'lead', name: 'Project Lead', icon: '🎯' },
    status: 'running',
    task: 'Coordinate team',
    childIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    outputPreview: '',
    model: 'claude-sonnet-4',
    provider: 'copilot',
    sessionId: 'sess-1234-5678',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...overrides,
  };
}

describe('OrgChart clickable agent nodes', () => {
  beforeEach(() => {
    mockDetailPanel.mockClear();
    mockAgents = [];
  });

  afterEach(cleanup);

  it('renders agent nodes with button role for clickability', () => {
    const lead = makeAgent();
    mockAgents = [lead];

    render(<OrgChart api="" ws="" />);

    const node = screen.getByRole('button', { name: /Project Lead/i });
    expect(node).toBeInTheDocument();
    expect(node).toHaveClass('cursor-pointer');
  });

  it('opens AgentDetailModal when an agent node is clicked', () => {
    const lead = makeAgent();
    mockAgents = [lead];

    render(<OrgChart api="" ws="" />);

    // No modal initially
    expect(screen.queryByTestId('agent-detail-modal')).not.toBeInTheDocument();

    // Click the agent node
    fireEvent.click(screen.getByRole('button', { name: /Project Lead/i }));

    // Modal should appear with the correct agentId
    expect(screen.getByTestId('agent-detail-modal')).toBeInTheDocument();
    expect(mockDetailPanel).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: lead.id }),
    );
  });

  it('closes AgentDetailModal when onClose is called', () => {
    const lead = makeAgent();
    mockAgents = [lead];

    render(<OrgChart api="" ws="" />);

    // Open modal
    fireEvent.click(screen.getByRole('button', { name: /Project Lead/i }));
    expect(screen.getByTestId('agent-detail-modal')).toBeInTheDocument();

    // Invoke the onClose callback that was passed to AgentDetailModal
    const lastCall = mockDetailPanel.mock.calls[mockDetailPanel.mock.calls.length - 1];
    act(() => { lastCall[0].onClose(); });

    // Modal should disappear after re-render
    expect(screen.queryByTestId('agent-detail-modal')).not.toBeInTheDocument();
  });

  it('opens modal for child agents too', () => {
    const lead = makeAgent();
    const dev = makeAgent({
      id: 'bbbbbbbb-1111-2222-3333-444444444444',
      role: { id: 'developer', name: 'Developer', icon: '👨‍💻' },
      parentId: lead.id,
    });
    mockAgents = [lead, dev];

    render(<OrgChart api="" ws="" />);

    // Click the child developer node
    fireEvent.click(screen.getByRole('button', { name: /Developer/i }));

    expect(mockDetailPanel).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: dev.id }),
    );
  });

  it('supports keyboard activation with Enter key', () => {
    const lead = makeAgent();
    mockAgents = [lead];

    render(<OrgChart api="" ws="" />);

    const node = screen.getByRole('button', { name: /Project Lead/i });
    fireEvent.keyDown(node, { key: 'Enter' });

    expect(screen.getByTestId('agent-detail-modal')).toBeInTheDocument();
  });

  it('supports keyboard activation with Space key', () => {
    const lead = makeAgent();
    mockAgents = [lead];

    render(<OrgChart api="" ws="" />);

    const node = screen.getByRole('button', { name: /Project Lead/i });
    fireEvent.keyDown(node, { key: ' ' });

    expect(screen.getByTestId('agent-detail-modal')).toBeInTheDocument();
  });
});
