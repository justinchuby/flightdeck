// @vitest-environment jsdom
/**
 * Coverage tests for FleetOverview — agent filtering, heatmap toggle,
 * coordination data, WebSocket event handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockAppState = {
  agents: [] as any[],
};
vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (sel: any) => sel(mockAppState),
    { getState: () => mockAppState },
  ),
}));

vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: Object.assign(
    (sel: any) => sel({ selectedLeadId: null, projects: {} }),
    { getState: () => ({ selectedLeadId: null, projects: {} }) },
  ),
}));

vi.mock('../../Timeline/useTimelineData', () => ({
  useTimelineData: () => ({ data: null }),
}));

vi.mock('../FleetStats', () => ({
  FleetStats: () => <div data-testid="fleet-stats" />,
}));

vi.mock('../AgentActivityTable', () => ({
  AgentActivityTable: () => <div data-testid="agent-table" />,
}));

vi.mock('../ActivityFeed', () => ({
  ActivityFeed: () => <div data-testid="activity-feed" />,
}));

vi.mock('../FileLockPanel', () => ({
  FileLockPanel: () => <div data-testid="file-locks" />,
}));

vi.mock('../CommHeatmap', () => ({
  CommHeatmap: () => <div data-testid="comm-heatmap" />,
}));

vi.mock('../../ProjectTabs', () => ({
  ProjectTabs: () => <div data-testid="project-tabs" />,
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

import { FleetOverview } from '../FleetOverview';

describe('FleetOverview — coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue({ locks: [], recentActivity: [] });
    mockAppState.agents = [];
  });

  afterEach(cleanup);

  it('renders basic structure with no agents', async () => {
    render(<FleetOverview />);
    await act(async () => {});
    expect(screen.getByText('Fleet Overview')).toBeInTheDocument();
    expect(screen.getByTestId('fleet-stats')).toBeInTheDocument();
    expect(screen.getByTestId('agent-table')).toBeInTheDocument();
  });

  it('renders agent filter dropdown when agents exist', async () => {
    mockAppState.agents = [
      { id: 'a1', role: { id: 'dev', name: 'Developer', icon: '💻' }, status: 'running' },
    ];
    render(<FleetOverview />);
    await act(async () => {});
    expect(screen.getByText('All agents')).toBeInTheDocument();
  });

  it('shows heatmap section when >= 2 agents', async () => {
    mockAppState.agents = [
      { id: 'a1', role: { id: 'dev', name: 'Developer', icon: '💻' }, status: 'running' },
      { id: 'a2', role: { id: 'arch', name: 'Architect', icon: '📐' }, status: 'running' },
    ];
    render(<FleetOverview />);
    await act(async () => {});
    expect(screen.getByText('Communication Heatmap')).toBeInTheDocument();
  });

  it('toggles heatmap visibility', async () => {
    mockAppState.agents = [
      { id: 'a1', role: { id: 'dev', name: 'Developer', icon: '💻' }, status: 'running' },
      { id: 'a2', role: { id: 'arch', name: 'Architect', icon: '📐' }, status: 'running' },
    ];
    render(<FleetOverview />);
    await act(async () => {});

    expect(screen.queryByTestId('comm-heatmap')).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText('Communication Heatmap')); });
    expect(screen.getByTestId('comm-heatmap')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText('Communication Heatmap')); });
    expect(screen.queryByTestId('comm-heatmap')).not.toBeInTheDocument();
  });

  it('does not show heatmap section with < 2 agents', async () => {
    mockAppState.agents = [
      { id: 'a1', role: { id: 'dev', name: 'Developer', icon: '💻' }, status: 'running' },
    ];
    render(<FleetOverview />);
    await act(async () => {});
    expect(screen.queryByText('Communication Heatmap')).not.toBeInTheDocument();
  });

  it('fetches coordination status on mount', async () => {
    render(<FleetOverview />);
    await act(async () => {});
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/coordination/status');
    });
  });

  it('handles coordination fetch failure silently', async () => {
    mockApiFetch.mockRejectedValue(new Error('fail'));
    render(<FleetOverview />);
    await act(async () => {});
    // Should not throw — silently handles error
    await waitFor(() => {
      expect(screen.getByText('Fleet Overview')).toBeInTheDocument();
    });
  });
});
