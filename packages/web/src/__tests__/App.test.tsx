import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';

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

vi.mock('../layouts/ProjectLayout', () => ({
  ProjectLayout: () => <div data-testid="project-layout">Project Layout</div>,
}));

// Mock lazy-loaded route components individually (vi.mock is hoisted — no loops)
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

vi.mock('../components/Toast', () => ({
  ToastContainer: () => null,
  useToastStore: (selector: (s: { add: () => void }) => unknown) => selector({ add: vi.fn() }),
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

// Now import the component under test
import { App } from '../App';
import { useAppStore } from '../stores/appStore';

function _createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
    },
  });
}

function renderApp(route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  );
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue([]);
    useAppStore.setState({
      agents: [],
      selectedAgentId: null,
      systemPaused: false,
      connected: true,
      loading: false,
    });
  });

  it('renders the sidebar', async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    });
  });

  it('renders the Flightdeck header', async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByText('Flightdeck')).toBeInTheDocument();
    });
  });

  it('shows agent count in header', async () => {
    useAppStore.setState({ agents: [{ id: 'a1' }, { id: 'a2' }] as any });
    renderApp();
    await waitFor(() => {
      expect(screen.getByText('2 agents')).toBeInTheDocument();
    });
  });

  it('shows pause/resume button', async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByText('Pause')).toBeInTheDocument();
    });
  });

  it('shows "Resume" when system is paused', async () => {
    useAppStore.setState({ systemPaused: true });
    renderApp();
    await waitFor(() => {
      expect(screen.getByText('Resume')).toBeInTheDocument();
    });
  });

  it('renders 404 page for unknown routes', async () => {
    renderApp('/some/unknown/path');
    await waitFor(() => {
      expect(screen.getByTestId('not-found')).toBeInTheDocument();
      expect(screen.getByText('404')).toBeInTheDocument();
    });
  });

  it('renders HomeDashboard at root route', async () => {
    renderApp('/');
    await waitFor(() => {
      expect(screen.getByTestId('mock-HomeDashboard')).toBeInTheDocument();
    });
  });

  it('renders settings page', async () => {
    renderApp('/settings');
    await waitFor(() => {
      expect(screen.getByTestId('mock-SettingsPanel')).toBeInTheDocument();
    });
  });

  it('renders projects page', async () => {
    renderApp('/projects');
    await waitFor(() => {
      expect(screen.getByTestId('mock-ProjectsPanel')).toBeInTheDocument();
    });
  });

  it('renders agents page', async () => {
    renderApp('/agents');
    await waitFor(() => {
      expect(screen.getByTestId('mock-UnifiedCrewPage')).toBeInTheDocument();
    });
  });

  it('shows ChatPanel when an agent is selected', async () => {
    useAppStore.setState({ selectedAgentId: 'agent-42' });
    renderApp();
    await waitFor(() => {
      expect(screen.getByTestId('chat-panel')).toHaveTextContent('agent-42');
    });
  });

  it('does not show ChatPanel when no agent selected', async () => {
    useAppStore.setState({ selectedAgentId: null });
    renderApp();
    await waitFor(() => {
      expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
    });
  });

  it('has skip-to-content link for accessibility', async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByText('Skip to content')).toBeInTheDocument();
    });
  });

  it('shows Commands button', async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByText('Commands')).toBeInTheDocument();
    });
  });
});
