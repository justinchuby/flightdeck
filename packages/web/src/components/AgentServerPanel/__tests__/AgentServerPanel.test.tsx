// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AgentServerPanel } from '../AgentServerPanel';

// ── Mocks ─────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

vi.mock('../../Toast', () => ({
  useToastStore: () => vi.fn(),
}));

function renderPanel() {
  return render(
    <MemoryRouter>
      <AgentServerPanel />
    </MemoryRouter>,
  );
}

// ── Fixtures ──────────────────────────────────────────────

const daemonStatus = {
  running: true,
  connected: true,
  state: 'connected',
  agentCount: 3,
  latencyMs: 5,
  pendingRequests: 0,
  trackedAgents: 3,
};

const daemonAgents = [
  {
    agentId: 'cc29bb0d-1234-5678-abcd-000000000001',
    role: 'architect',
    model: 'claude-sonnet-4-6',
    status: 'running',
    task: 'Designing auth module',
    spawnedAt: '2026-03-07T14:52:00Z',
  },
  {
    agentId: 'dd40cc1e-1234-5678-abcd-000000000002',
    role: 'developer',
    model: 'claude-sonnet-4-6',
    status: 'idle',
    task: null,
    spawnedAt: '2026-03-07T14:48:00Z',
  },
];

function setupMocks(overrides: Partial<{
  status: any;
  agents: any;
}> = {}) {
  mockApiFetch.mockImplementation((path: string) => {
    if (path === '/agent-server/status') return Promise.resolve(overrides.status ?? daemonStatus);
    if (path === '/agent-server/agents') return Promise.resolve(overrides.agents ?? daemonAgents);
    if (path.includes('/terminate')) return Promise.resolve({ terminated: true });
    if (path === '/agent-server/stop') return Promise.resolve({ acknowledged: true, message: 'stopped', terminatedCount: 2 });
    return Promise.resolve({});
  });
}

// ── Tests ─────────────────────────────────────────────────

describe('AgentServerPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockApiFetch.mockImplementation(() => new Promise(() => {})); // never resolves
    renderPanel();
    expect(screen.getByText(/loading agent server status/i)).toBeInTheDocument();
  });

  it('shows error state on API failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });

  it('renders status card with correct info', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getAllByText('Agent Server').length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getAllByText('Running').length).toBeGreaterThan(0);
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('5ms')).toBeInTheDocument();
  });

  it('renders connection state inline in status card', async () => {
    setupMocks({ status: { ...daemonStatus, connected: false, state: 'disconnected' } });
    renderPanel();
    await waitFor(() => {
      expect(screen.getAllByText('Disconnected').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders agent list with expand/collapse', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('cc29bb0d')).toBeInTheDocument();
    });
    expect(screen.getByText('dd40cc1e')).toBeInTheDocument();
    expect(screen.getByText('architect')).toBeInTheDocument();
    expect(screen.getByText('developer')).toBeInTheDocument();

    // Expand first agent
    fireEvent.click(screen.getByText('cc29bb0d'));
    await waitFor(() => {
      expect(screen.getByText('Designing auth module')).toBeInTheDocument();
    });
  });

  it('shows empty state when no agents', async () => {
    setupMocks({ agents: [] });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/no agents currently managed/i)).toBeInTheDocument();
    });
  });

  it('shows stopped state when server is not running', async () => {
    setupMocks({
      status: { ...daemonStatus, running: false, connected: false, state: 'disconnected', agentCount: 0 },
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Stopped')).toBeInTheDocument();
    });
  });

  it('shows lifecycle controls with stop button', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Controls')).toBeInTheDocument();
    });
    expect(screen.getByText('Stop Server')).toBeInTheDocument();
  });

  it('shows stop confirmation dialog', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Stop Server')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Stop Server'));
    await waitFor(() => {
      expect(screen.getByText(/stop agent server\? all agents will be terminated/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Confirm Stop')).toBeInTheDocument();
  });

  it('shows terminate confirmation on agent', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('cc29bb0d')).toBeInTheDocument();
    });

    // Expand agent
    fireEvent.click(screen.getByText('cc29bb0d'));
    await waitFor(() => {
      expect(screen.getByText('Terminate')).toBeInTheDocument();
    });

    // Click terminate
    fireEvent.click(screen.getByText('Terminate'));
    await waitFor(() => {
      expect(screen.getByText(/terminate agent cc29bb0d/i)).toBeInTheDocument();
    });
  });

  it('renders reconnecting state in status card', async () => {
    setupMocks({
      status: { ...daemonStatus, state: 'reconnecting', connected: false },
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getAllByText('Reconnecting').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('calls /agent-server/stop on confirm', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Stop Server')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Stop Server'));
    await waitFor(() => {
      expect(screen.getByText('Confirm Stop')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Confirm Stop'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/agent-server/stop', expect.objectContaining({ method: 'POST' }));
    });
  });

  it('calls /agent-server/terminate/:id on agent terminate confirm', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('cc29bb0d')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('cc29bb0d'));
    await waitFor(() => {
      expect(screen.getByText('Terminate')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Terminate'));
    await waitFor(() => {
      expect(screen.getByText('Confirm')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/agent-server/terminate/cc29bb0d-1234-5678-abcd-000000000001',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
