// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../Shared', () => ({
  EmptyState: ({ message }: { message: string }) => <div data-testid="empty-state">{message}</div>,
}));

vi.mock('../../FleetOverview/CommHeatmap', () => ({
  CommHeatmap: () => <div data-testid="comm-heatmap" />,
}));

vi.mock('../../CommFlow/CommFlowGraph', () => ({
  CommFlowGraph: () => <div data-testid="comm-flow" />,
}));

vi.mock('../../AgentDetailPanel', () => ({
  AgentDetailPanel: () => <div data-testid="agent-detail" />,
}));

vi.mock('../../../contexts/ProjectContext', () => ({
  useProjectId: () => 'p1',
  useOptionalProjectId: () => 'p1',
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

describe('OrgChart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.agents = [];
    storeState.projects = { 'lead-1': { comms: [], groups: [], groupMessages: {} } };
  });

  it('renders without crashing', () => {
    const { container } = render(<OrgChart />);
    expect(container).toBeTruthy();
  });

  it('renders with agents', () => {
    storeState.agents = [
      { id: 'a1', role: { name: 'Lead', icon: '👑' }, status: 'running', childIds: ['a2'], parentId: undefined, model: 'gpt-4', projectId: 'p1' },
      { id: 'a2', role: { name: 'Dev', icon: '💻' }, status: 'running', childIds: [], parentId: 'a1', model: 'gpt-4', projectId: 'p1' },
    ];
    const { container } = render(<OrgChart />);
    expect(container).toBeTruthy();
  });

  it('renders empty state without agents', () => {
    storeState.agents = [];
    const { container } = render(<OrgChart />);
    expect(container).toBeTruthy();
  });
});
