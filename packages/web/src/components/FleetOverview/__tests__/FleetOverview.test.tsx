// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../../../hooks/useTimelineData', () => ({
  useTimelineData: () => ({ messages: [] }),
}));

// Mock child components
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
  FileLockPanel: () => <div data-testid="file-lock-panel" />,
}));
vi.mock('../CommHeatmap', () => ({
  CommHeatmap: () => <div data-testid="comm-heatmap" />,
}));

const storeState: Record<string, unknown> = {
  agents: [],
  selectedLeadId: null,
  projects: {},
};

vi.mock('../../../stores/appStore', () => ({
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) =>
    typeof sel === 'function' ? sel(storeState) : storeState,
}));

vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: (sel: (s: Record<string, unknown>) => unknown) =>
    typeof sel === 'function' ? sel(storeState) : storeState,
}));

import { FleetOverview } from '../FleetOverview';

describe('FleetOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue({ locks: [], recentActivity: [] });
    storeState.agents = [];
    storeState.selectedLeadId = null;
    storeState.projects = {};
  });

  it('renders fleet stats component', async () => {
    render(<FleetOverview />);
    await waitFor(() => {
      expect(screen.getByTestId('fleet-stats')).toBeInTheDocument();
    });
  });

  it('renders agent activity table', async () => {
    render(<FleetOverview />);
    await waitFor(() => {
      expect(screen.getByTestId('agent-table')).toBeInTheDocument();
    });
  });

  it('renders activity feed', async () => {
    render(<FleetOverview />);
    await waitFor(() => {
      expect(screen.getByTestId('activity-feed')).toBeInTheDocument();
    });
  });

  it('fetches coordination status', async () => {
    render(<FleetOverview />);
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalled();
    });
  });

  it('renders with agents', async () => {
    storeState.agents = [
      { id: 'a1', role: { name: 'Dev' }, status: 'running', projectId: 'p1', childIds: [] },
    ];
    render(<FleetOverview />);
    await waitFor(() => {
      expect(screen.getByTestId('fleet-stats')).toBeInTheDocument();
    });
  });

  it('handles fetch error gracefully', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    const { container } = render(<FleetOverview />);
    await waitFor(() => {
      expect(container).toBeTruthy();
    });
  });
});
