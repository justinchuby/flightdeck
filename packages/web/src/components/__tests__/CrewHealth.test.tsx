import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { CrewHealth } from '../../pages/CrewHealth';
import type { CrewHealthData } from '../../pages/CrewHealth';

// ── Mock apiFetch ───────────────────────────────────────────────────

const mockApiFetch = vi.fn();

vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

// ── Mock AgentLifecycle ─────────────────────────────────────────────

vi.mock('../AgentLifecycle', () => ({
  AgentLifecycle: ({ agentId, onClose }: any) => (
    <div data-testid="agent-lifecycle-mock">
      <span>{agentId}</span>
      <button onClick={onClose}>close</button>
    </div>
  ),
}));

// ── Test Data ───────────────────────────────────────────────────────

const MOCK_HEALTH: CrewHealthData = {
  teamId: 'team-1',
  totalAgents: 3,
  statusCounts: { running: 2, idle: 1, terminated: 0 },
  massFailurePaused: false,
  agents: [
    { agentId: 'agent-001', role: 'developer', model: 'gpt-4', status: 'running', uptimeMs: 3_600_000 },
    { agentId: 'agent-002', role: 'architect', model: 'gpt-4', status: 'running', uptimeMs: 7_200_000 },
    { agentId: 'agent-003', role: 'reviewer', model: 'gpt-4', status: 'idle', uptimeMs: 1_800_000 },
  ],
};

// ── Tests ───────────────────────────────────────────────────────────

describe('CrewHealth', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('shows loading spinner initially', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<CrewHealth teamId="team-1" />);
    expect(screen.getByTestId('crew-health-loading')).toBeInTheDocument();
  });

  it('renders health dashboard with status cards', async () => {
    mockApiFetch.mockResolvedValue(MOCK_HEALTH);
    render(<CrewHealth teamId="team-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('crew-health-dashboard')).toBeInTheDocument();
    });

    expect(screen.getByTestId('card-total')).toHaveTextContent('3');
    expect(screen.getByTestId('card-running')).toHaveTextContent('2');
    expect(screen.getByTestId('card-idle')).toHaveTextContent('1');
  });

  it('shows agent table with all agents', async () => {
    mockApiFetch.mockResolvedValue(MOCK_HEALTH);
    render(<CrewHealth teamId="team-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-table')).toBeInTheDocument();
    });

    expect(screen.getByText('developer')).toBeInTheDocument();
    expect(screen.getByText('architect')).toBeInTheDocument();
    expect(screen.getByText('reviewer')).toBeInTheDocument();
    expect(screen.getByText('tester')).toBeInTheDocument();
  });

  it('shows mass failure alert when paused', async () => {
    mockApiFetch.mockResolvedValue({ ...MOCK_HEALTH, massFailurePaused: true });
    render(<CrewHealth teamId="team-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('mass-failure-alert')).toBeInTheDocument();
    });

    expect(screen.getByText(/mass failure detected/i)).toBeInTheDocument();
  });

  it('does not show mass failure alert when not paused', async () => {
    mockApiFetch.mockResolvedValue(MOCK_HEALTH);
    render(<CrewHealth teamId="team-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('crew-health-dashboard')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('mass-failure-alert')).not.toBeInTheDocument();
  });

  it('shows error state on API failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Server error'));
    render(<CrewHealth teamId="team-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('crew-health-error')).toBeInTheDocument();
    });

    expect(screen.getByText(/server error/i)).toBeInTheDocument();
  });

  it('shows connection healthy when not paused', async () => {
    mockApiFetch.mockResolvedValue(MOCK_HEALTH);
    render(<CrewHealth teamId="team-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('connection-status')).toBeInTheDocument();
    });

    expect(screen.getByText(/agent server healthy/i)).toBeInTheDocument();
  });

  it('shows spawning paused when mass failure detected', async () => {
    mockApiFetch.mockResolvedValue({ ...MOCK_HEALTH, massFailurePaused: true });
    render(<CrewHealth teamId="team-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('connection-status')).toBeInTheDocument();
    });

    expect(screen.getByText(/spawning paused/i)).toBeInTheDocument();
  });

  it('shows clone indicator for cloned agents', async () => {
    const healthWithClone = {
      ...MOCK_HEALTH,
      agents: [
        ...MOCK_HEALTH.agents,
        { agentId: 'clone-001', role: 'developer', model: 'gpt-4', status: 'idle', uptimeMs: 60_000, clonedFromId: 'agent-001' },
      ],
    };
    mockApiFetch.mockResolvedValue(healthWithClone);
    render(<CrewHealth teamId="team-1" />);

    await waitFor(() => {
      expect(screen.getByText('🧬')).toBeInTheDocument();
    });
  });

  it('refreshes on team WS events', async () => {
    mockApiFetch.mockResolvedValue(MOCK_HEALTH);
    render(<CrewHealth teamId="team-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('crew-health-dashboard')).toBeInTheDocument();
    });

    const callsBefore = mockApiFetch.mock.calls.length;

    act(() => {
      const event = new MessageEvent('ws-message', {
        data: JSON.stringify({ type: 'team:agent_cloned', agentId: 'agent-003' }),
      });
      window.dispatchEvent(event);
    });

    await waitFor(() => {
      expect(mockApiFetch.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('uses default teamId when not provided', async () => {
    mockApiFetch.mockResolvedValue(MOCK_HEALTH);
    render(<CrewHealth />);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/teams/default/health');
    });
  });

  it('sets up polling interval', async () => {
    mockApiFetch.mockResolvedValue(MOCK_HEALTH);
    const spy = vi.spyOn(globalThis, 'setInterval');

    render(<CrewHealth teamId="team-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('crew-health-dashboard')).toBeInTheDocument();
    });

    expect(spy).toHaveBeenCalledWith(expect.any(Function), 15_000);
    spy.mockRestore();
  });
});
