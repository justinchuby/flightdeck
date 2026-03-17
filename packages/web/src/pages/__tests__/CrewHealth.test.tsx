import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { CrewHealth, type CrewHealthData, type AgentHealthInfo } from '../CrewHealth';

const mockApiFetch = vi.fn();
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../../components/AgentLifecycle', () => ({
  AgentLifecycle: ({ agentId }: { agentId: string }) => (
    <div data-testid={`lifecycle-${agentId}`}>Lifecycle</div>
  ),
}));

function makeHealth(overrides: Partial<CrewHealthData> = {}): CrewHealthData {
  return {
    crewId: 'default',
    totalAgents: 3,
    statusCounts: { running: 2, idle: 1 },
    massFailurePaused: false,
    agents: [
      { agentId: 'agent-1', role: 'Developer', model: 'gpt-4', status: 'running', uptimeMs: 60000 },
      { agentId: 'agent-2', role: 'Architect', model: 'claude', status: 'running', uptimeMs: 120000 },
      { agentId: 'agent-3', role: 'QA', model: 'gpt-4', status: 'idle', uptimeMs: 30000 },
    ],
    ...overrides,
  };
}

describe('CrewHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows loading spinner initially', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<CrewHealth />);
    expect(screen.getByTestId('crew-health-loading')).toBeInTheDocument();
  });

  it('renders dashboard after successful fetch', async () => {
    mockApiFetch.mockResolvedValue(makeHealth());
    render(<CrewHealth />);
    await waitFor(() => {
      expect(screen.getByTestId('crew-health-dashboard')).toBeInTheDocument();
    });
    expect(screen.getByText(/Crew Health/)).toBeInTheDocument();
  });

  it('shows agent list with roles', async () => {
    mockApiFetch.mockResolvedValue(makeHealth());
    render(<CrewHealth />);
    await waitFor(() => {
      expect(screen.getByText('Developer')).toBeInTheDocument();
      expect(screen.getByText('Architect')).toBeInTheDocument();
    });
  });

  it('shows friendly empty state for 404 errors', async () => {
    mockApiFetch.mockRejectedValue(new Error('404 not found'));
    render(<CrewHealth />);
    await waitFor(() => {
      expect(screen.getByTestId('crew-health-empty')).toBeInTheDocument();
      expect(screen.getByText('No crew found')).toBeInTheDocument();
    });
  });

  it('shows error state for generic errors', async () => {
    mockApiFetch.mockRejectedValue(new Error('Server error'));
    render(<CrewHealth />);
    await waitFor(() => {
      expect(screen.getByTestId('crew-health-error')).toBeInTheDocument();
      expect(screen.getByText('Unable to load health data')).toBeInTheDocument();
    });
  });

  it('shows mass failure alert when massFailurePaused is true', async () => {
    mockApiFetch.mockResolvedValue(makeHealth({ massFailurePaused: true }));
    render(<CrewHealth />);
    await waitFor(() => {
      expect(screen.getByTestId('mass-failure-alert')).toBeInTheDocument();
      expect(screen.getByText(/Mass failure detected/)).toBeInTheDocument();
    });
  });

  it('passes crewId prop to API call', async () => {
    mockApiFetch.mockResolvedValue(makeHealth({ crewId: 'my-crew' }));
    render(<CrewHealth crewId="my-crew" />);
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/crews/my-crew/health');
    });
  });

  it('shows status cards', async () => {
    mockApiFetch.mockResolvedValue(makeHealth());
    render(<CrewHealth />);
    await waitFor(() => {
      expect(screen.getByTestId('status-cards')).toBeInTheDocument();
    });
  });

  it('refresh button triggers re-fetch', async () => {
    mockApiFetch.mockResolvedValue(makeHealth());
    render(<CrewHealth />);
    await waitFor(() => {
      expect(screen.getByText('Refresh')).toBeInTheDocument();
    });
    mockApiFetch.mockClear();
    fireEvent.click(screen.getByText('Refresh'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalled();
    });
  });

  it('shows clone indicator for cloned agents', async () => {
    const agents: AgentHealthInfo[] = [
      { agentId: 'agent-1', role: 'Developer', model: 'gpt-4', status: 'running', uptimeMs: 60000, clonedFromId: 'original-1' },
    ];
    mockApiFetch.mockResolvedValue(makeHealth({ agents }));
    render(<CrewHealth />);
    await waitFor(() => {
      expect(screen.getByText('🧬')).toBeInTheDocument();
    });
  });

  it('shows healthy connection status when not paused', async () => {
    mockApiFetch.mockResolvedValue(makeHealth({ massFailurePaused: false }));
    render(<CrewHealth />);
    await waitFor(() => {
      expect(screen.getByTestId('connection-status')).toBeInTheDocument();
    });
    expect(screen.getByText('Agent server healthy')).toBeInTheDocument();
  });

  it('shows paused connection status when mass failure detected', async () => {
    mockApiFetch.mockResolvedValue(makeHealth({ massFailurePaused: true }));
    render(<CrewHealth />);
    await waitFor(() => {
      expect(screen.getByTestId('connection-status')).toBeInTheDocument();
    });
    expect(screen.getByText('Spawning paused')).toBeInTheDocument();
  });

  it('refreshes on ws-message team:agent_cloned event', async () => {
    mockApiFetch.mockResolvedValue(makeHealth());
    render(<CrewHealth />);
    await waitFor(() => {
      expect(screen.getByTestId('crew-health-dashboard')).toBeInTheDocument();
    });
    const callCount = mockApiFetch.mock.calls.length;
    act(() => {
      window.dispatchEvent(new MessageEvent('ws-message', {
        data: JSON.stringify({ type: 'team:agent_cloned' }),
      }));
    });
    await waitFor(() => {
      expect(mockApiFetch.mock.calls.length).toBeGreaterThan(callCount);
    });
  });

  it('shows "no crew" error as friendly empty state', async () => {
    mockApiFetch.mockRejectedValue(new Error('no crew exists'));
    render(<CrewHealth />);
    await waitFor(() => {
      expect(screen.getByTestId('crew-health-empty')).toBeInTheDocument();
    });
  });

  it('renders terminated and failed agent statuses', async () => {
    mockApiFetch.mockResolvedValue(makeHealth({
      agents: [
        { agentId: 'a1', role: 'Dev', model: 'gpt-4', status: 'terminated', uptimeMs: 100_000_000 },
        { agentId: 'a2', role: 'QA', model: 'gpt-4', status: 'failed', uptimeMs: 5000 },
        { agentId: 'a3', role: 'Arch', model: 'gpt-4', status: 'unknown', uptimeMs: 7200000 },
      ],
    }));
    render(<CrewHealth />);
    await waitFor(() => {
      expect(screen.getByText('Terminated')).toBeInTheDocument();
      expect(screen.getByText('Failed')).toBeInTheDocument();
      expect(screen.getByText('unknown')).toBeInTheDocument();
      // days format
      expect(screen.getByText('1.2d')).toBeInTheDocument();
    });
  });

  it('opens AgentLifecycle when Manage button is clicked', async () => {
    mockApiFetch.mockResolvedValue(makeHealth());
    render(<CrewHealth />);
    await waitFor(() => {
      expect(screen.getByText('Developer')).toBeInTheDocument();
    });
    const manageBtn = screen.getByTestId('manage-agent-1');
    fireEvent.click(manageBtn);
    await waitFor(() => {
      expect(screen.getByTestId('lifecycle-agent-1')).toBeInTheDocument();
    });
  });
});
