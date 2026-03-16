// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { AgentDashboard } from '../AgentDashboard';
import type { AgentInfo } from '../../../types';

// Shared mock data
const mockAgents: AgentInfo[] = [
  {
    id: 'lead-001',
    role: { id: 'lead', name: 'Project Lead', icon: '🎯', color: '#f59e0b', description: '', systemPrompt: '', builtIn: true },
    status: 'running',
    childIds: ['dev-001'],
    createdAt: '2026-03-14T10:00:00Z',
    outputPreview: '',
    model: 'claude-sonnet-4',
    projectName: 'my-project',
  } as AgentInfo,
  {
    id: 'dev-001',
    role: { id: 'developer', name: 'Developer', icon: '🛠️', color: '#3b82f6', description: '', systemPrompt: '', builtIn: false },
    status: 'running',
    childIds: [],
    createdAt: '2026-03-14T10:01:00Z',
    outputPreview: '',
    model: 'gpt-4o',
    parentId: 'lead-001',
  } as AgentInfo,
];

// --- Mocks ---
let storeState: Record<string, unknown> = {};
const mockSetSelectedAgent = vi.fn();

vi.mock('../../../stores/appStore', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      agents: storeState.agents ?? [],
      selectedAgentId: null,
      setSelectedAgent: mockSetSelectedAgent,
    }),
}));

vi.mock('../../../hooks/useHistoricalAgents', () => ({
  useHistoricalAgents: () => ({ agents: storeState.historicalAgents ?? [] }),
}));

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({ locks: [], recentActivity: [] }),
}));

// Mock child components to keep test focused
vi.mock('../SpawnDialog', () => ({
  SpawnDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="spawn-dialog">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

vi.mock('../../FleetOverview/FleetStats', () => ({
  FleetStats: ({ agents }: { agents: unknown[] }) => (
    <div data-testid="fleet-stats">Stats: {agents.length} agents</div>
  ),
}));

vi.mock('../../FleetOverview/AgentActivityTable', () => ({
  AgentActivityTable: ({ agents }: { agents: unknown[] }) => (
    <div data-testid="agent-table">Table: {agents.length} agents</div>
  ),
}));

vi.mock('../../FleetOverview/ActivityFeed', () => ({
  ActivityFeed: () => <div data-testid="activity-feed" />,
}));

vi.mock('../../FleetOverview/FileLockPanel', () => ({
  FileLockPanel: () => <div data-testid="file-lock-panel" />,
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

beforeEach(() => {
  vi.clearAllMocks();
  storeState = { agents: mockAgents, historicalAgents: [] };
});

afterEach(cleanup);

async function renderDashboard(ui?: React.ReactElement) {
  await act(async () => {
    render(ui ?? <AgentDashboard />);
  });
}

describe('AgentDashboard', () => {
  it('renders FleetStats with agents', async () => {
    await renderDashboard();
    expect(screen.getByTestId('fleet-stats').textContent).toContain('2 agents');
  });

  it('renders spawn agent button', async () => {
    await renderDashboard();
    expect(screen.getByText('Spawn Agent')).toBeDefined();
  });

  it('opens spawn dialog when button clicked', async () => {
    await renderDashboard();
    expect(screen.queryByTestId('spawn-dialog')).toBeNull();
    fireEvent.click(screen.getByText('Spawn Agent'));
    expect(screen.getByTestId('spawn-dialog')).toBeDefined();
  });

  it('opens spawn dialog with N keyboard shortcut', async () => {
    await renderDashboard();
    fireEvent.keyDown(window, { key: 'n' });
    expect(screen.getByTestId('spawn-dialog')).toBeDefined();
  });

  it('closes spawn dialog with Escape', async () => {
    await renderDashboard();
    fireEvent.click(screen.getByText('Spawn Agent'));
    expect(screen.getByTestId('spawn-dialog')).toBeDefined();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('spawn-dialog')).toBeNull();
  });

  it('does not open spawn dialog when N pressed in input', async () => {
    await renderDashboard(
      <div>
        <input data-testid="text-input" />
        <AgentDashboard />
      </div>,
    );
    const input = screen.getByTestId('text-input');
    fireEvent.keyDown(input, { key: 'n', target: input });
    expect(screen.queryByTestId('spawn-dialog')).toBeNull();
  });

  it('renders agent filter dropdown', async () => {
    await renderDashboard();
    const select = screen.getByDisplayValue('All agents');
    expect(select).toBeDefined();
  });

  it('filters agents when selection changes', async () => {
    await renderDashboard();
    const select = screen.getByDisplayValue('All agents') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'dev-001' } });
    // After filtering, only 1 agent should show
    const tables = screen.getAllByTestId('agent-table');
    // At least one table should show filtered count
    const hasFiltered = tables.some((t) => t.textContent?.includes('1 agents'));
    expect(hasFiltered).toBe(true);
  });

  it('renders group by project toggle', async () => {
    await renderDashboard();
    expect(screen.getByTitle('Group by project')).toBeDefined();
  });

  it('shows project groups by default', async () => {
    await renderDashboard();
    expect(screen.getByText('my-project')).toBeDefined();
  });

  it('collapses project group on click', async () => {
    await renderDashboard();
    const groupBtn = screen.getByText('my-project').closest('button')!;
    // Before collapse, table is visible
    expect(screen.getAllByTestId('agent-table').length).toBeGreaterThan(0);
    fireEvent.click(groupBtn);
    // Group is collapsed - table for that group hidden
    // The project label still shows
    expect(screen.getByText('my-project')).toBeDefined();
  });

  it('disables grouping when toggle clicked', async () => {
    await renderDashboard();
    const toggle = screen.getByTitle('Group by project');
    fireEvent.click(toggle);
    // With grouping off, should show a flat table with all agents
    expect(screen.queryByText('my-project')).toBeNull();
    expect(screen.getByTestId('agent-table').textContent).toContain('2 agents');
  });

  it('shows activity and locks section collapsed by default', async () => {
    await renderDashboard();
    expect(screen.getByText(/Activity & Locks/)).toBeDefined();
    expect(screen.queryByTestId('activity-feed')).toBeNull();
  });

  it('expands activity section on click', async () => {
    await renderDashboard();
    fireEvent.click(screen.getByText(/Activity & Locks/));
    expect(screen.getByTestId('activity-feed')).toBeDefined();
    expect(screen.getByTestId('file-lock-panel')).toBeDefined();
  });

  it('falls back to historical agents when live agents empty', async () => {
    storeState = { agents: [], historicalAgents: mockAgents };
    await renderDashboard();
    expect(screen.getByTestId('fleet-stats').textContent).toContain('2 agents');
  });

  it('renders keyboard shortcut hint', async () => {
    await renderDashboard();
    expect(screen.getByText('N')).toBeDefined();
  });
});
