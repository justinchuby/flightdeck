import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// ── Mock all heavy dependencies before importing App ──────────

const mockApiFetch = vi.fn();
vi.mock('../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  useApi: () => ({ apiFetch: mockApiFetch }),
  useApiContext: () => ({ apiFetch: mockApiFetch }),
}));

vi.mock('../contexts/ApiContext', () => ({
  ApiProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useApiContext: () => ({ apiFetch: mockApiFetch }),
}));

vi.mock('../contexts/WebSocketContext', () => ({
  WebSocketProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useWebSocketContext: () => ({ ws: null, connected: false }),
}));

vi.mock('../contexts/ProjectContext', () => ({
  useProjectId: () => null,
  ProjectProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock ProjectLayout to render its nested <Outlet /> so project-scoped routes render
vi.mock('../layouts/ProjectLayout', () => ({
  ProjectLayout: function MockProjectLayout() {
    const { Outlet } = require('react-router-dom');
    return <div data-testid="project-layout"><Outlet /></div>;
  },
}));

// ── Mock lazy-loaded route components ────────────────────────

function mockComp(name: string) {
  const C = () => <div data-testid={`mock-${name}`}>{name}</div>;
  return { [name]: C, default: C };
}

vi.mock('../components/TaskQueue/TaskQueuePanel', () => mockComp('TaskQueuePanel'));
vi.mock('../components/Settings/SettingsPanel', () => mockComp('SettingsPanel'));
vi.mock('../components/OrgChart/OrgChart', () => mockComp('OrgChart'));
vi.mock('../components/OverviewPage/OverviewPage', () => mockComp('OverviewPage'));
vi.mock('../components/GroupChat/GroupChat', () => mockComp('GroupChat'));
vi.mock('../components/Timeline', () => mockComp('TimelinePage'));
vi.mock('../components/Canvas', () => mockComp('CanvasPage'));
vi.mock('../components/Analytics', () => mockComp('AnalyticsPage'));
vi.mock('../components/AnalysisPage', () => mockComp('AnalysisPage'));
vi.mock('../components/SessionReplay', () => mockComp('SharedReplayViewer'));
vi.mock('../components/ProjectsPanel', () => mockComp('ProjectsPanel'));
vi.mock('../components/KnowledgePanel', () => mockComp('KnowledgePanel'));
vi.mock('../components/ArtifactsPanel', () => mockComp('ArtifactsPanel'));
vi.mock('../components/HomeDashboard', () => mockComp('HomeDashboard'));
vi.mock('../pages/CrewPage', () => mockComp('CrewPage'));
vi.mock('../components/CrewRoster/CrewRoster', () => mockComp('CrewRoster'));
vi.mock('../components/CrewRoster/UnifiedCrewPage', () => mockComp('UnifiedCrewPage'));

vi.mock('../components/ChatPanel/ChatPanel', () => ({
  ChatPanel: ({ agentId }: { agentId: string }) => <div data-testid="chat-panel">{agentId}</div>,
}));

vi.mock('../components/LeadDashboard', () => ({
  LeadDashboard: () => <div data-testid="mock-LeadDashboard">LeadDashboard</div>,
  ReadOnlySession: () => <div data-testid="mock-ReadOnlySession">ReadOnlySession</div>,
}));

vi.mock('../components/SearchDialog/SearchDialog', () => ({
  SearchDialog: () => null,
}));

vi.mock('../components/Sidebar', () => ({
  Sidebar: () => <nav data-testid="sidebar">Sidebar</nav>,
}));

const mockAddToast = vi.fn();
vi.mock('../components/Toast', () => ({
  ToastContainer: () => null,
  useToastStore: (selector: (s: { add: typeof mockAddToast }) => unknown) => selector({ add: mockAddToast }),
}));

vi.mock('../components/CommandPalette/CommandPalette', () => ({
  CommandPalette: () => null,
}));

vi.mock('../components/Onboarding', () => ({
  ContextualCoach: () => null,
}));

vi.mock('../components/Onboarding/OnboardingWizard', () => ({
  OnboardingWizard: () => null,
  useOnboarding: () => ({ shouldShow: false }),
}));

vi.mock('../components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/SectionErrorBoundary', () => ({
  SectionErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  RouteErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/ProvideFeedback', () => ({
  buildFeedbackUrl: () => 'https://example.com',
}));

vi.mock('../components/VersionBadge', () => ({
  VersionBadge: () => null,
}));

vi.mock('../components/Pulse', () => ({
  PulseStrip: () => null,
}));

vi.mock('../components/AttentionBar', () => ({
  AttentionBar: () => null,
}));

vi.mock('../components/ApprovalQueue', () => ({
  ApprovalBadge: () => null,
  ApprovalSlideOver: () => null,
}));

vi.mock('../components/CatchUp', () => ({
  CatchUpBanner: () => null,
}));

vi.mock('../components/StatusPopover/StatusPopover', () => ({
  StatusPopover: () => null,
}));

vi.mock('../components/SetupWizard', () => ({
  SetupWizard: () => null,
  shouldShowSetupWizard: () => false,
}));

vi.mock('../hooks/useCommandPalette', () => ({
  useCommandPalette: () => ({ isOpen: false, open: vi.fn(), close: vi.fn() }),
}));

vi.mock('../utils/notificationSound', () => ({
  playCompletionSound: vi.fn(),
}));

let mockSoundEnabled = false;
vi.mock('../stores/settingsStore', () => ({
  useSettingsStore: (sel: (s: { soundEnabled: boolean }) => unknown) => sel({ soundEnabled: mockSoundEnabled }),
  shouldNotify: () => true,
}));

let mockSelectedLeadId: string | null = null;
vi.mock('../stores/leadStore', () => ({
  useLeadStore: Object.assign(
    (sel: (s: { selectedLeadId: string | null }) => unknown) => sel({ selectedLeadId: mockSelectedLeadId }),
    {
      getState: () => ({
        selectedLeadId: mockSelectedLeadId,
        addProject: vi.fn(),
        selectLead: vi.fn(),
        projects: {},
      }),
    },
  ),
}));

// ── Now import the component under test ──────────────────────

import { App } from '../App';
import { useAppStore } from '../stores/appStore';
import { playCompletionSound } from '../utils/notificationSound';

// ── Helpers ──────────────────────────────────────────────────

function renderApp(route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  );
}

// ── Tests ────────────────────────────────────────────────────

describe('AppRoutes – project-scoped routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue([]);
    mockSelectedLeadId = null;
    mockSoundEnabled = false;
    useAppStore.setState({
      agents: [],
      selectedAgentId: null,
      systemPaused: false,
      connected: true,
      loading: false,
    });
  });

  it('/projects/p1 redirects to /projects/p1/overview', async () => {
    renderApp('/projects/p1');
    await waitFor(() => {
      expect(screen.getByTestId('project-layout')).toBeInTheDocument();
      expect(screen.getByTestId('mock-OverviewPage')).toBeInTheDocument();
    });
  });

  it('/projects/p1/overview renders OverviewPage', async () => {
    renderApp('/projects/p1/overview');
    await waitFor(() => {
      expect(screen.getByTestId('mock-OverviewPage')).toBeInTheDocument();
    });
  });

  it('/projects/p1/session renders LeadDashboard', async () => {
    renderApp('/projects/p1/session');
    await waitFor(() => {
      expect(screen.getByTestId('mock-LeadDashboard')).toBeInTheDocument();
    });
  });

  it('/projects/p1/sessions/:leadId renders ReadOnlySession', async () => {
    renderApp('/projects/p1/sessions/lead-abc');
    await waitFor(() => {
      expect(screen.getByTestId('mock-ReadOnlySession')).toBeInTheDocument();
    });
  });

  it('/projects/p1/tasks renders TaskQueuePanel', async () => {
    renderApp('/projects/p1/tasks');
    await waitFor(() => {
      expect(screen.getByTestId('mock-TaskQueuePanel')).toBeInTheDocument();
    });
  });

  it('/projects/p1/crew renders UnifiedCrewPage', async () => {
    renderApp('/projects/p1/crew');
    await waitFor(() => {
      expect(screen.getByTestId('mock-UnifiedCrewPage')).toBeInTheDocument();
    });
  });

  it('/projects/p1/agents redirects to ../crew', async () => {
    renderApp('/projects/p1/agents');
    await waitFor(() => {
      expect(screen.getByTestId('mock-UnifiedCrewPage')).toBeInTheDocument();
    });
  });

  it('/projects/p1/knowledge renders KnowledgePanel', async () => {
    renderApp('/projects/p1/knowledge');
    await waitFor(() => {
      expect(screen.getByTestId('mock-KnowledgePanel')).toBeInTheDocument();
    });
  });

  it('/projects/p1/artifacts renders ArtifactsPanel', async () => {
    renderApp('/projects/p1/artifacts');
    await waitFor(() => {
      expect(screen.getByTestId('mock-ArtifactsPanel')).toBeInTheDocument();
    });
  });

  it('/projects/p1/timeline renders TimelinePage', async () => {
    renderApp('/projects/p1/timeline');
    await waitFor(() => {
      expect(screen.getByTestId('mock-TimelinePage')).toBeInTheDocument();
    });
  });

  it('/projects/p1/groups renders GroupChat', async () => {
    renderApp('/projects/p1/groups');
    await waitFor(() => {
      expect(screen.getByTestId('mock-GroupChat')).toBeInTheDocument();
    });
  });

  it('/projects/p1/org-chart renders OrgChart', async () => {
    renderApp('/projects/p1/org-chart');
    await waitFor(() => {
      expect(screen.getByTestId('mock-OrgChart')).toBeInTheDocument();
    });
  });

  it('/projects/p1/analytics renders AnalyticsPage', async () => {
    renderApp('/projects/p1/analytics');
    await waitFor(() => {
      expect(screen.getByTestId('mock-AnalyticsPage')).toBeInTheDocument();
    });
  });

  it('/projects/p1/analysis renders AnalysisPage', async () => {
    renderApp('/projects/p1/analysis');
    await waitFor(() => {
      expect(screen.getByTestId('mock-AnalysisPage')).toBeInTheDocument();
    });
  });

  it('/projects/p1/canvas renders CanvasPage', async () => {
    renderApp('/projects/p1/canvas');
    await waitFor(() => {
      expect(screen.getByTestId('mock-CanvasPage')).toBeInTheDocument();
    });
  });
});

describe('AppRoutes – backward-compat redirects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue([]);
    mockSelectedLeadId = null;
    useAppStore.setState({
      agents: [],
      selectedAgentId: null,
      systemPaused: false,
      connected: true,
      loading: false,
    });
  });

  it('/crews redirects to /agents (UnifiedCrewPage)', async () => {
    renderApp('/crews');
    await waitFor(() => {
      expect(screen.getByTestId('mock-UnifiedCrewPage')).toBeInTheDocument();
    });
  });

  it('/team redirects to /agents (UnifiedCrewPage)', async () => {
    renderApp('/team');
    await waitFor(() => {
      expect(screen.getByTestId('mock-UnifiedCrewPage')).toBeInTheDocument();
    });
  });

  it('/data redirects to /knowledge?tab=memory', async () => {
    // /data redirects to /knowledge?tab=memory via Navigate.
    // The ProjectRedirect for /knowledge resolves to /projects if no agents.
    // But /data is a direct Navigate to "/knowledge?tab=memory", not a ProjectRedirect.
    // /knowledge?tab=memory is not a defined route, so let's check what happens:
    // Actually looking at App.tsx, /data → Navigate to="/knowledge?tab=memory"
    // and /knowledge is ProjectRedirect page="knowledge"
    // Since there are no agents/lead, ProjectRedirect falls through to /projects
    renderApp('/data');
    await waitFor(() => {
      expect(screen.getByTestId('mock-ProjectsPanel')).toBeInTheDocument();
    });
  });
});

describe('AppRoutes – ProjectRedirect behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue([]);
    mockSelectedLeadId = null;
    useAppStore.setState({
      agents: [],
      selectedAgentId: null,
      systemPaused: false,
      connected: true,
      loading: false,
    });
  });

  it('/lead with no agents/lead redirects to /projects', async () => {
    renderApp('/lead');
    await waitFor(() => {
      expect(screen.getByTestId('mock-ProjectsPanel')).toBeInTheDocument();
    });
  });

  it('/lead with a selected lead ID redirects to project session', async () => {
    mockSelectedLeadId = 'project:proj-42';

    renderApp('/lead');
    await waitFor(() => {
      // ProjectRedirect extracts "proj-42" from "project:proj-42"
      // and redirects to /projects/proj-42/session
      expect(screen.getByTestId('project-layout')).toBeInTheDocument();
      expect(screen.getByTestId('mock-LeadDashboard')).toBeInTheDocument();
    });
  });

  it('/lead falls back to first live lead agent if no selectedLeadId', async () => {
    mockSelectedLeadId = null;

    useAppStore.setState({
      agents: [
        { id: 'worker-1', role: { id: 'coder' }, parentId: null, status: 'running', projectId: 'proj-99' },
        { id: 'lead-1', role: { id: 'lead' }, parentId: undefined, status: 'running', projectId: 'proj-99' },
      ] as any,
      selectedAgentId: null,
      systemPaused: false,
      connected: true,
      loading: false,
    });

    renderApp('/lead');
    await waitFor(() => {
      // Falls back to first lead's projectId: proj-99
      expect(screen.getByTestId('project-layout')).toBeInTheDocument();
      expect(screen.getByTestId('mock-LeadDashboard')).toBeInTheDocument();
    });
  });

  it('/overview redirects using ProjectRedirect', async () => {
    mockSelectedLeadId = 'project:my-proj';

    renderApp('/overview');
    await waitFor(() => {
      expect(screen.getByTestId('mock-OverviewPage')).toBeInTheDocument();
    });
  });

  it('/tasks redirects to project tasks via ProjectRedirect', async () => {
    mockSelectedLeadId = 'project:proj-1';

    renderApp('/tasks');
    await waitFor(() => {
      expect(screen.getByTestId('mock-TaskQueuePanel')).toBeInTheDocument();
    });
  });

  it('/lead with plain agent ID uses agent projectId', async () => {
    mockSelectedLeadId = 'agent-lead-7';

    useAppStore.setState({
      agents: [
        { id: 'agent-lead-7', role: { id: 'lead' }, status: 'running', projectId: 'proj-from-agent' },
      ] as any,
      selectedAgentId: null,
      systemPaused: false,
      connected: true,
      loading: false,
    });

    renderApp('/lead');
    await waitFor(() => {
      expect(screen.getByTestId('project-layout')).toBeInTheDocument();
      expect(screen.getByTestId('mock-LeadDashboard')).toBeInTheDocument();
    });
  });
});

describe('AppRoutes – shared replay route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue([]);
    mockSelectedLeadId = null;
    useAppStore.setState({
      agents: [],
      selectedAgentId: null,
      systemPaused: false,
      connected: true,
      loading: false,
    });
  });

  it('/shared/:token renders SharedReplayViewer', async () => {
    renderApp('/shared/abc-token-123');
    await waitFor(() => {
      expect(screen.getByTestId('mock-SharedReplayViewer')).toBeInTheDocument();
    });
  });
});

describe('AppRoutes – togglePause', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue([]);
    mockSelectedLeadId = null;
    useAppStore.setState({
      agents: [],
      selectedAgentId: null,
      systemPaused: false,
      connected: true,
      loading: false,
    });
  });

  it('clicking Pause calls /system/pause API', async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByText('Pause')).toBeInTheDocument();
    });

    await act(async () => { fireEvent.click(screen.getByText('Pause')); });

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/system/pause', { method: 'POST' });
    });
  });

  it('clicking Resume calls /system/resume API', async () => {
    useAppStore.setState({ systemPaused: true });
    renderApp();
    await waitFor(() => {
      expect(screen.getByText('Resume')).toBeInTheDocument();
    });

    await act(async () => { fireEvent.click(screen.getByText('Resume')); });

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/system/resume', { method: 'POST' });
    });
  });

  it('shows error toast when pause API fails', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Network down'));

    renderApp();
    await waitFor(() => {
      expect(screen.getByText('Pause')).toBeInTheDocument();
    });

    await act(async () => { fireEvent.click(screen.getByText('Pause')); });

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('error', expect.stringContaining('Network down'));
    });
  });
});

describe('AppRoutes – WebSocket event handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue([]);
    mockSoundEnabled = false;
    useAppStore.setState({
      agents: [],
      selectedAgentId: null,
      systemPaused: false,
      connected: true,
      loading: false,
    });
  });

  it('shows toast on agent:spawned event', async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    });

    const event = new MessageEvent('ws-message', {
      data: JSON.stringify({
        type: 'agent:spawned',
        agent: { role: { icon: '🤖', name: 'Coder' } },
      }),
    });
    window.dispatchEvent(event);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('info', '🤖 Coder agent spawned');
    });
  });

  it('shows error toast on agent:exit with non-zero code', async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    });

    const event = new MessageEvent('ws-message', {
      data: JSON.stringify({
        type: 'agent:exit',
        agentId: 'agent-abc123def',
        code: 1,
      }),
    });
    window.dispatchEvent(event);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('error', expect.stringContaining('failed'));
    });
  });

  it('shows success toast on agent:exit with code 0', async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    });

    const event = new MessageEvent('ws-message', {
      data: JSON.stringify({
        type: 'agent:exit',
        agentId: 'agent-xyz789',
        code: 0,
      }),
    });
    window.dispatchEvent(event);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('success', expect.stringContaining('completed'));
    });
  });

  it('shows toast on agent:sub_spawned event', async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    });

    const event = new MessageEvent('ws-message', {
      data: JSON.stringify({
        type: 'agent:sub_spawned',
        parentId: 'agent-parent-abc123',
        child: { role: { icon: '🔍' } },
      }),
    });
    window.dispatchEvent(event);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('info', expect.stringContaining('Sub-agent spawned'));
    });
  });

  it('shows toast on agent:context_compacted event', async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    });

    const event = new MessageEvent('ws-message', {
      data: JSON.stringify({
        type: 'agent:context_compacted',
        agentId: 'agent-compact-abc123',
        percentDrop: 42,
      }),
    });
    window.dispatchEvent(event);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('info', expect.stringContaining('Context compacted'));
      expect(mockAddToast).toHaveBeenCalledWith('info', expect.stringContaining('42% reduction'));
    });
  });

  it('plays completion sound when all agents transition to idle', async () => {
    const mockPlaySound = vi.mocked(playCompletionSound);
    mockSoundEnabled = true;

    // Start with a running agent
    useAppStore.setState({
      agents: [{ id: 'a1', status: 'running' }] as any,
      selectedAgentId: null,
      systemPaused: false,
      connected: true,
      loading: false,
    });

    const { rerender } = render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    });

    // Now transition to idle — wrap in act() since setState + rerender triggers state updates
    act(() => {
      useAppStore.setState({
        agents: [{ id: 'a1', status: 'idle' }] as any,
      });

      rerender(
        <MemoryRouter initialEntries={['/']}>
          <App />
        </MemoryRouter>,
      );
    });

    await waitFor(() => {
      expect(mockPlaySound).toHaveBeenCalled();
    });

    // Reset for other tests
    mockSoundEnabled = false;
  });
});

describe('AppRoutes – additional flat redirects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue([]);
    mockSelectedLeadId = null;
    useAppStore.setState({
      agents: [],
      selectedAgentId: null,
      systemPaused: false,
      connected: true,
      loading: false,
    });
  });

  it('/knowledge redirects via ProjectRedirect (to /projects when no lead)', async () => {
    renderApp('/knowledge');
    await waitFor(() => {
      expect(screen.getByTestId('mock-ProjectsPanel')).toBeInTheDocument();
    });
  });

  it('/timeline redirects via ProjectRedirect (to /projects when no lead)', async () => {
    renderApp('/timeline');
    await waitFor(() => {
      expect(screen.getByTestId('mock-ProjectsPanel')).toBeInTheDocument();
    });
  });

  it('/groups redirects via ProjectRedirect (to /projects when no lead)', async () => {
    renderApp('/groups');
    await waitFor(() => {
      expect(screen.getByTestId('mock-ProjectsPanel')).toBeInTheDocument();
    });
  });

  it('/org redirects via ProjectRedirect (to /projects when no lead)', async () => {
    renderApp('/org');
    await waitFor(() => {
      expect(screen.getByTestId('mock-ProjectsPanel')).toBeInTheDocument();
    });
  });

  it('/analytics redirects via ProjectRedirect (to /projects when no lead)', async () => {
    renderApp('/analytics');
    await waitFor(() => {
      expect(screen.getByTestId('mock-ProjectsPanel')).toBeInTheDocument();
    });
  });

  it('/canvas redirects via ProjectRedirect (to /projects when no lead)', async () => {
    renderApp('/canvas');
    await waitFor(() => {
      expect(screen.getByTestId('mock-ProjectsPanel')).toBeInTheDocument();
    });
  });

  it('/mission-control redirects via ProjectRedirect (to /projects when no lead)', async () => {
    renderApp('/mission-control');
    await waitFor(() => {
      expect(screen.getByTestId('mock-ProjectsPanel')).toBeInTheDocument();
    });
  });
});
