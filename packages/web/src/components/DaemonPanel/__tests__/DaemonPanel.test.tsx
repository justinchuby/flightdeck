// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DaemonPanel } from '../DaemonPanel';

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
      <DaemonPanel />
    </MemoryRouter>,
  );
}

// ── Fixtures ──────────────────────────────────────────────

const daemonStatus = {
  running: true,
  mode: 'development',
  agentCount: 3,
  pid: 48291,
  uptimeMs: 8100000,
  uptimeFormatted: '2h 15m',
  spawningPaused: false,
  transport: { platform: 'darwin', socketPath: '/tmp/flightdeck.sock' },
};

const daemonAgents = [
  {
    agentId: 'cc29bb0d-1234-5678-abcd-000000000001',
    pid: 12345,
    role: 'architect',
    model: 'claude-sonnet-4-6',
    status: 'running',
    sessionId: 'sess-001',
    taskSummary: 'Designing auth module',
    spawnedAt: '2026-03-07T14:52:00Z',
    lastEventId: 'evt-100',
  },
  {
    agentId: 'dd40cc1e-1234-5678-abcd-000000000002',
    pid: 12346,
    role: 'developer',
    model: 'claude-sonnet-4-6',
    status: 'idle',
    sessionId: 'sess-002',
    taskSummary: null,
    spawnedAt: '2026-03-07T14:48:00Z',
    lastEventId: 'evt-99',
  },
];

const reconnectState = {
  state: 'connected',
  expectedAgentCount: 3,
};

const massFailureState = {
  available: true,
  isPaused: false,
};

function setupMocks(overrides: Partial<{
  status: any;
  agents: any;
  reconnect: any;
  massFailure: any;
}> = {}) {
  mockApiFetch.mockImplementation((path: string) => {
    if (path === '/daemon/status') return Promise.resolve(overrides.status ?? daemonStatus);
    if (path === '/daemon/agents') return Promise.resolve(overrides.agents ?? daemonAgents);
    if (path === '/daemon/reconnect') return Promise.resolve(overrides.reconnect ?? reconnectState);
    if (path === '/daemon/mass-failure') return Promise.resolve(overrides.massFailure ?? massFailureState);
    if (path.includes('/terminate')) return Promise.resolve({ terminated: true });
    if (path === '/daemon/stop') return Promise.resolve({ acknowledged: true });
    if (path === '/daemon/mode') return Promise.resolve({ mode: 'production' });
    if (path === '/daemon/resume-spawning') return Promise.resolve({ resumed: true });
    return Promise.resolve({});
  });
}

// ── Tests ─────────────────────────────────────────────────

describe('DaemonPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockApiFetch.mockImplementation(() => new Promise(() => {})); // never resolves
    renderPanel();
    expect(screen.getByText(/loading daemon status/i)).toBeInTheDocument();
  });

  it('shows error state on API failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });

  it('renders daemon status card with correct info', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Agent Host Daemon')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Running').length).toBeGreaterThan(0);
    expect(screen.getByText('2h 15m')).toBeInTheDocument();
    expect(screen.getByText('48291')).toBeInTheDocument();
  });

  it('renders transport info with platform label', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Transport')).toBeInTheDocument();
    });
    expect(screen.getByText('macOS (Unix Domain Socket)')).toBeInTheDocument();
  });

  it('renders reconnect status', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Connection')).toBeInTheDocument();
    });
    expect(screen.getByText('Connected')).toBeInTheDocument();
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
    expect(screen.getByText('12345')).toBeInTheDocument();
  });

  it('shows empty state when no agents', async () => {
    setupMocks({ agents: [] });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/no agents currently managed/i)).toBeInTheDocument();
    });
  });

  it('shows stopped state when daemon is not running', async () => {
    setupMocks({
      status: { ...daemonStatus, running: false, mode: 'unavailable', agentCount: 0, pid: null, uptimeFormatted: null },
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Stopped')).toBeInTheDocument();
    });
  });

  it('shows spawning paused warning when mass failure detected', async () => {
    setupMocks({
      status: { ...daemonStatus, spawningPaused: true },
      massFailure: { available: true, isPaused: true },
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/spawning is paused/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Spawning Paused')).toBeInTheDocument();
    expect(screen.getByText('Resume Spawning')).toBeInTheDocument();
  });

  it('shows lifecycle controls with mode toggle', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Controls')).toBeInTheDocument();
    });
    expect(screen.getByText('Development')).toBeInTheDocument();
    expect(screen.getByText('Stop Daemon')).toBeInTheDocument();
  });

  it('shows stop confirmation dialog', async () => {
    setupMocks();
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Stop Daemon')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Stop Daemon'));
    await waitFor(() => {
      expect(screen.getByText(/stop daemon\? agents will be preserved/i)).toBeInTheDocument();
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

  it('renders reconnecting state correctly', async () => {
    setupMocks({
      reconnect: { state: 'reconnecting', expectedAgentCount: 5 },
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Reconnecting')).toBeInTheDocument();
    });
  });

  it('renders Linux transport platform label', async () => {
    setupMocks({
      status: { ...daemonStatus, transport: { platform: 'linux', socketPath: '/run/flightdeck.sock' } },
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Linux (Unix Domain Socket)')).toBeInTheDocument();
    });
  });

  it('renders Windows transport platform label', async () => {
    setupMocks({
      status: { ...daemonStatus, transport: { platform: 'win32', socketPath: null } },
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Windows (Named Pipe)')).toBeInTheDocument();
    });
  });
});
