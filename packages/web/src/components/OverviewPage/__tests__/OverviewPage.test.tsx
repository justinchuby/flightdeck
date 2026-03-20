import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useAppStore } from '../../../stores/appStore';
import { useLeadStore } from '../../../stores/leadStore';
import type { AgentInfo, Decision } from '../../../types';

// ── Mocks ───────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

let mockProjectId: string | null = 'proj-1';
vi.mock('../../../contexts/ProjectContext', () => ({
  useProjectId: () => mockProjectId,
}));

let mockProjects: Array<{ id: string; name: string; status: string; cwd?: string }> = [];
vi.mock('../../../hooks/useProjects', () => ({
  useProjects: () => ({ projects: mockProjects, loading: false }),
}));

const mockApiFetch = vi.fn().mockResolvedValue([]);
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

// Simplify child components to avoid deep dependency trees
vi.mock('../../SessionHistory', () => ({
  SessionHistory: ({ projectId }: { projectId: string }) => (
    <div data-testid="session-history">history-{projectId}</div>
  ),
  NewSessionDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="new-session-dialog">
      <button onClick={onClose}>close-dialog</button>
    </div>
  ),
}));

vi.mock('../TokenUsageSection', () => ({
  TokenUsageSection: ({ projectId }: { projectId: string }) => (
    <div data-testid="token-usage-section">tokens-{projectId}</div>
  ),
}));

vi.mock('../../FleetOverview/FileLockPanel', () => ({
  FileLockPanel: () => <div data-testid="file-lock-panel" />,
}));

vi.mock('../../Shared', () => ({
  DecisionFeedItem: ({ decision, onClick }: { decision: Decision; onClick: () => void }) => (
    <div data-testid="decision-feed-item" onClick={onClick}>{decision.title}</div>
  ),
  DecisionDetailModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="decision-detail-modal"><button onClick={onClose}>close</button></div>
  ),
  ActivityFeedItem: ({ entry, onClick }: { entry: { summary: string }; onClick: () => void }) => (
    <div data-testid="activity-feed-item" onClick={onClick}>{entry.summary}</div>
  ),
  ActivityDetailModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="activity-detail-modal"><button onClick={onClose}>close</button></div>
  ),
}));

vi.mock('../../SectionErrorBoundary', () => ({
  SectionErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../MissionControl/AlertsPanel', () => ({
  detectAlerts: vi.fn(() => []),
}));

// Import after mocks
import { OverviewPage } from '../OverviewPage';
import { detectAlerts } from '../../MissionControl/AlertsPanel';

// ── Helpers ─────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'agent-1',
    role: { id: 'worker', name: 'Worker', icon: '🔧', description: '' },
    status: 'running',
    childIds: [],
    createdAt: '2024-01-01T00:00:00Z',
    outputPreview: '',
    model: 'claude-sonnet',
    projectId: 'proj-1',
    ...overrides,
  } as AgentInfo;
}

function resetStores() {
  useAppStore.setState({ agents: [], connected: true, loading: false });
  useLeadStore.setState({ projects: {}, selectedLeadId: null, drafts: {} });
}

async function renderPage() {
  await act(async () => {
    render(<OverviewPage />);
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe('OverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    mockProjectId = 'proj-1';
    mockProjects = [{ id: 'proj-1', name: 'Test Project', status: 'active' }];
    mockApiFetch.mockResolvedValue([]);
  });

  it('renders empty state when no projects and no effectiveId', async () => {
    mockProjectId = '';
    mockProjects = [];
    useAppStore.setState({ agents: [] });

    await renderPage();
    expect(screen.getByText(/No session data yet/i)).toBeInTheDocument();
  });

  it('renders overview page with quick status bar', async () => {
    useAppStore.setState({
      agents: [
        makeAgent({ id: 'lead-1', role: { id: 'lead', name: 'Lead', icon: '👑', description: '' }, status: 'running' }),
        makeAgent({ id: 'worker-1' }),
      ],
    });

    await renderPage();
    expect(screen.getByTestId('overview-page')).toBeInTheDocument();
    expect(screen.getByTestId('quick-status-bar')).toBeInTheDocument();
    expect(screen.getByText('● Running')).toBeInTheDocument();
    // "2 agents" appears in both status bar and session banner; verify at least one
    expect(screen.getAllByText(/2 agents/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows "Stopped" when no active agents', async () => {
    useAppStore.setState({ agents: [] });
    await renderPage();
    expect(screen.getByText('● Stopped')).toBeInTheDocument();
    expect(screen.getByText(/0 agents/)).toBeInTheDocument();
  });

  it('shows active session banner with stop button when lead is running', async () => {
    const lead = makeAgent({
      id: 'lead-1',
      role: { id: 'lead', name: 'Lead', icon: '👑', description: '' },
      status: 'running',
      task: 'Build something cool',
    });
    useAppStore.setState({ agents: [lead] });

    await renderPage();
    expect(screen.getByTestId('active-session-banner')).toBeInTheDocument();
    expect(screen.getByText('Active Session')).toBeInTheDocument();
    expect(screen.getByTestId('stop-session-btn')).toBeInTheDocument();
  });

  it('shows "New Session" button when no active lead', async () => {
    useAppStore.setState({ agents: [] });
    await renderPage();
    expect(screen.getByTestId('no-session-controls')).toBeInTheDocument();
    expect(screen.getByTestId('new-session-btn')).toBeInTheDocument();
  });

  it('opens new session dialog on button click', async () => {
    useAppStore.setState({ agents: [] });
    await renderPage();
    fireEvent.click(screen.getByTestId('new-session-btn'));
    expect(screen.getByTestId('new-session-dialog')).toBeInTheDocument();
  });

  it('shows task progress in status bar', async () => {
    const lead = makeAgent({
      id: 'lead-1',
      role: { id: 'lead', name: 'Lead', icon: '👑', description: '' },
      status: 'running',
    });
    useAppStore.setState({ agents: [lead] });
    useLeadStore.setState({
      projects: {
        'proj-1': {
          dagStatus: {
            tasks: [],
            fileLockMap: {},
            summary: { pending: 1, ready: 0, running: 2, done: 3, failed: 0, blocked: 0, paused: 0, skipped: 0 },
          },
          decisions: [],
          messages: [],
          progress: null,
          progressSummary: null,
          progressHistory: [],
          agentReports: [],
          toolCalls: [],
          activity: [],
          comms: [],
          groups: [],
          groupMessages: {},
          lastTextAt: 0,
          pendingNewline: false,
        },
      },
    });

    await renderPage();
    expect(screen.getByText('3/6 tasks')).toBeInTheDocument();
  });

  it('displays decisions feed section', async () => {
    await renderPage();
    expect(screen.getByTestId('decisions-feed')).toBeInTheDocument();
    expect(screen.getByText('Decisions')).toBeInTheDocument();
  });

  it('displays progress feed section', async () => {
    await renderPage();
    expect(screen.getByTestId('progress-feed')).toBeInTheDocument();
    expect(screen.getByText('Recent Progress')).toBeInTheDocument();
  });

  it('renders token usage section', async () => {
    await renderPage();
    expect(screen.getByTestId('token-usage-section')).toBeInTheDocument();
    expect(screen.getByText('tokens-proj-1')).toBeInTheDocument();
  });

  it('renders session history section', async () => {
    await renderPage();
    expect(screen.getByTestId('session-history')).toBeInTheDocument();
  });

  it('shows attention alerts when detectAlerts returns items', async () => {
    vi.mocked(detectAlerts).mockReturnValue([
      {
        id: 'alert-1',
        severity: 'critical' as const,
        icon: '🚨',
        title: 'Agent failed',
        detail: 'Agent worker-1 crashed',
        timestamp: Date.now(),
      },
    ]);
    useAppStore.setState({ agents: [makeAgent()] });

    await renderPage();
    expect(screen.getByTestId('attention-items')).toBeInTheDocument();
    expect(screen.getByText('Attention Required')).toBeInTheDocument();
    expect(screen.getByText(/Agent failed/)).toBeInTheDocument();
  });

  it('shows project directory when project has cwd', async () => {
    mockProjects = [{ id: 'proj-1', name: 'Test', status: 'active', cwd: '/home/user/project' }];
    await renderPage();
    expect(screen.getByTestId('project-directory')).toBeInTheDocument();
    expect(screen.getByText('/home/user/project')).toBeInTheDocument();
  });

  it('navigates to session page when clicking active session banner', async () => {
    const lead = makeAgent({
      id: 'lead-1',
      role: { id: 'lead', name: 'Lead', icon: '👑', description: '' },
      status: 'running',
    });
    useAppStore.setState({ agents: [lead] });

    await renderPage();
    fireEvent.click(screen.getByTestId('active-session-banner'));
    expect(mockNavigate).toHaveBeenCalledWith('/projects/proj-1/session');
  });

  it('calls stop session API when stop button clicked', async () => {
    const lead = makeAgent({
      id: 'lead-1',
      role: { id: 'lead', name: 'Lead', icon: '👑', description: '' },
      status: 'running',
    });
    useAppStore.setState({ agents: [lead] });

    await renderPage();
    fireEvent.click(screen.getByTestId('stop-session-btn'));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/projects/proj-1/stop',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  // ── File Locks ──────────────────────────────────────────────────

  it('renders file lock panel when locks exist', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path.includes('/coordination/status')) {
        return Promise.resolve({ locks: [{ agentId: 'a1', filePath: 'src/foo.ts', acquiredAt: '2024-01-01' }] });
      }
      return Promise.resolve([]);
    });

    await renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('file-lock-panel')).toBeInTheDocument();
    });
  });

  // ── Decisions feed with interaction ─────────────────────────────

  it('renders decision feed items from API data', async () => {
    const decisions = [
      { id: 'd1', title: 'Use TypeScript', status: 'recorded', needsConfirmation: true, agentId: 'a1', rationale: 'r', timestamp: '2024-01-01', category: 'architecture' },
      { id: 'd2', title: 'Use React', status: 'recorded', needsConfirmation: false, agentId: 'a1', rationale: 'r', timestamp: '2024-01-01', category: 'architecture' },
    ];
    mockApiFetch.mockImplementation((path: string) => {
      if (path.includes('/decisions')) return Promise.resolve(decisions);
      return Promise.resolve([]);
    });

    await renderPage();
    await waitFor(() => {
      expect(screen.getAllByTestId('decision-feed-item').length).toBeGreaterThan(0);
    });
  });

  it('opens decision detail modal on decision click', async () => {
    const decisions = [
      { id: 'd1', title: 'Use TypeScript', status: 'recorded', needsConfirmation: true, agentId: 'a1', rationale: 'r', timestamp: '2024-01-01', category: 'architecture' },
    ];
    mockApiFetch.mockImplementation((path: string) => {
      if (path.includes('/decisions')) return Promise.resolve(decisions);
      return Promise.resolve([]);
    });

    await renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('decision-feed-item')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('decision-feed-item'));
    expect(screen.getByTestId('decision-detail-modal')).toBeInTheDocument();
  });

  it('closes decision detail modal on close button', async () => {
    const decisions = [
      { id: 'd1', title: 'Use TypeScript', status: 'recorded', needsConfirmation: true, agentId: 'a1', rationale: 'r', timestamp: '2024-01-01', category: 'architecture' },
    ];
    mockApiFetch.mockImplementation((path: string) => {
      if (path.includes('/decisions')) return Promise.resolve(decisions);
      return Promise.resolve([]);
    });

    await renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('decision-feed-item')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('decision-feed-item'));
    expect(screen.getByTestId('decision-detail-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByText('close'));
    expect(screen.queryByTestId('decision-detail-modal')).not.toBeInTheDocument();
  });

  it('shows "No decisions yet" when no decisions exist', async () => {
    await renderPage();
    expect(screen.getByText('No decisions yet')).toBeInTheDocument();
  });

  it('shows "No progress events yet" when no activity exists', async () => {
    await renderPage();
    expect(screen.getByText('No progress events yet')).toBeInTheDocument();
  });

  // ── Activity feed with interaction ──────────────────────────────

  it('renders activity feed items from API data', async () => {
    const activities = [
      { id: 'a1', summary: 'Built auth module', action: 'progress_update', timestamp: '2024-01-01' },
    ];
    mockApiFetch.mockImplementation((path: string) => {
      if (path.includes('/coordination/activity')) return Promise.resolve(activities);
      return Promise.resolve([]);
    });

    await renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('activity-feed-item')).toBeInTheDocument();
    });
    expect(screen.getByText('Built auth module')).toBeInTheDocument();
  });

  it('opens activity detail modal on activity click', async () => {
    const activities = [
      { id: 'a1', summary: 'Built auth module', action: 'progress_update', timestamp: '2024-01-01' },
    ];
    mockApiFetch.mockImplementation((path: string) => {
      if (path.includes('/coordination/activity')) return Promise.resolve(activities);
      return Promise.resolve([]);
    });

    await renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('activity-feed-item')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('activity-feed-item'));
    expect(screen.getByTestId('activity-detail-modal')).toBeInTheDocument();
  });

  it('closes activity detail modal on close button', async () => {
    const activities = [
      { id: 'a1', summary: 'Built auth module', action: 'progress_update', timestamp: '2024-01-01' },
    ];
    mockApiFetch.mockImplementation((path: string) => {
      if (path.includes('/coordination/activity')) return Promise.resolve(activities);
      return Promise.resolve([]);
    });

    await renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('activity-feed-item')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('activity-feed-item'));
    expect(screen.getByTestId('activity-detail-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByText('close'));
    expect(screen.queryByTestId('activity-detail-modal')).not.toBeInTheDocument();
  });

  // ── New session dialog ──────────────────────────────────────────

  it('closes new session dialog via close button', async () => {
    useAppStore.setState({ agents: [] });
    await renderPage();
    fireEvent.click(screen.getByTestId('new-session-btn'));
    expect(screen.getByTestId('new-session-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByText('close-dialog'));
    expect(screen.queryByTestId('new-session-dialog')).not.toBeInTheDocument();
  });

  // ── Actionable decisions priority ────────────────────────────────

  it('prioritizes actionable decisions over all decisions in feed', async () => {
    const decisions = [
      { id: 'd1', title: 'Actionable', status: 'recorded', needsConfirmation: true, agentId: 'a1', rationale: 'r', timestamp: '2024-01-01', category: 'architecture' },
      { id: 'd2', title: 'Informational', status: 'recorded', needsConfirmation: false, agentId: 'a1', rationale: 'r', timestamp: '2024-01-01', category: 'architecture' },
    ];
    mockApiFetch.mockImplementation((path: string) => {
      if (path.includes('/decisions')) return Promise.resolve(decisions);
      return Promise.resolve([]);
    });

    await renderPage();
    await waitFor(() => {
      expect(screen.getByText('Actionable')).toBeInTheDocument();
    });
    // Only actionable decisions shown (not the informational one)
    expect(screen.queryByText('Informational')).not.toBeInTheDocument();
  });

  // ── LeadStore key lookup ─────────────────────────────────────────

  it('reads leadStore by activeLeadId (agent ID) not just projectId', async () => {
    const lead = makeAgent({
      id: 'lead-abc',
      role: { id: 'lead', name: 'Lead', icon: '👑', description: '' },
      status: 'running',
      projectId: 'proj-1',
    });
    useAppStore.setState({ agents: [lead] });
    // Store keyed by leadId (agent ID), NOT projectId
    useLeadStore.setState({
      projects: {
        'lead-abc': {
          dagStatus: {
            tasks: [],
            fileLockMap: {},
            summary: { pending: 0, ready: 0, running: 1, done: 7, failed: 0, blocked: 0, paused: 0, skipped: 0 },
          },
          decisions: [],
          messages: [],
          progress: null,
          progressSummary: null,
          progressHistory: [],
          agentReports: [],
          toolCalls: [],
          activity: [],
          comms: [],
          groups: [],
          groupMessages: {},
          lastTextAt: 0,
          pendingNewline: false,
        },
      },
    });

    await renderPage();
    // Should find the data via leadId key, showing "7/8 tasks"
    expect(screen.getByText('7/8 tasks')).toBeInTheDocument();
  });
});
