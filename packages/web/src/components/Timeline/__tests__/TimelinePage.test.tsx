import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CommType, TimelineStatus } from '../useTimelineData';

// ── CSS mock ──────────────────────────────────────────────────────────
vi.mock('../timeline-a11y.css', () => ({}));

// ── Module-level mock state ───────────────────────────────────────────

let mockTimelineData: any = null;
let mockLoading = false;
let mockError: string | null = null;
const mockRefetch = vi.fn();

vi.mock('../useTimelineData', () => ({
  useTimelineData: () => ({
    data: mockTimelineData,
    loading: mockLoading,
    error: mockError,
    refetch: mockRefetch,
    connectionHealth: { status: 'connected' },
  }),
}));

let mockStoreAgents: any[] = [];
vi.mock('../../../stores/appStore', () => ({
  useAppStore: (sel: any) => sel({ agents: mockStoreAgents }),
}));

let mockTimelineStoreState: any = {};
vi.mock('../../../stores/timelineStore', () => ({
  useTimelineStore: (sel: any) => sel(mockTimelineStoreState),
}));

vi.mock('../../../hooks/useSessionReplay', () => ({
  useSessionReplay: () => ({
    keyframes: [],
    worldState: null,
    playing: false,
    currentTime: 0,
    duration: 0,
    loading: false,
    error: null,
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    setSpeed: vi.fn(),
    speed: 1,
  }),
}));

vi.mock('../../../hooks/useProjects', () => ({
  useProjects: () => ({ projects: [], loading: false }),
}));

let mockContextProjectId: string | null = null;
vi.mock('../../../contexts/ProjectContext', () => ({
  useOptionalProjectId: () => mockContextProjectId,
}));

vi.mock('../useSinceLastVisit', () => ({
  useSinceLastVisit: () => ({ newEventCount: 0, markAsSeen: vi.fn() }),
}));

vi.mock('../useAccessibilityAnnouncements', () => ({
  useAccessibilityAnnouncements: () => ({
    announceError: vi.fn(),
    announceNewEvents: vi.fn(),
  }),
}));

// ── Mock child components ─────────────────────────────────────────────

vi.mock('../TimelineContainer', () => ({
  TimelineContainer: (props: any) => (
    <div data-testid="timeline-container" data-live={props.liveMode} />
  ),
}));

vi.mock('../StatusBar', () => ({
  StatusBar: () => <div data-testid="status-bar" />,
}));

vi.mock('../ErrorBanner', () => ({
  ErrorBanner: ({ errors }: any) =>
    errors?.length ? (
      <div data-testid="error-banner">{errors.length} errors</div>
    ) : null,
}));

vi.mock('../EmptyState', () => ({
  EmptyState: ({ title }: any) => (
    <div data-testid="empty-state">{title ?? 'No timeline data'}</div>
  ),
}));

vi.mock('../AccessibilityAnnouncer', () => ({
  AccessibilityAnnouncer: () => <div data-testid="a11y-announcer" />,
}));

vi.mock('../../SessionReplay', () => ({
  ReplayScrubber: () => <div data-testid="replay-scrubber" />,
}));

vi.mock('../../ProjectTabs', () => ({
  ProjectTabs: () => <div data-testid="project-tabs" />,
}));

// ── Helpers ───────────────────────────────────────────────────────────

const ALL_ROLES = [
  'lead', 'architect', 'developer', 'code-reviewer',
  'critical-reviewer', 'designer', 'secretary', 'qa-tester',
] as const;
const ALL_COMM_TYPES: CommType[] = ['delegation', 'message', 'group_message', 'broadcast'];

function defaultTimelineStoreState() {
  return {
    selectedLeadId: 'lead-1',
    setSelectedLeadId: vi.fn(),
    liveMode: true,
    setLiveMode: vi.fn(),
    showFilters: false,
    setShowFilters: vi.fn(),
    roleFilter: new Set<string>(ALL_ROLES),
    setRoleFilter: vi.fn(),
    commFilter: new Set<CommType>(ALL_COMM_TYPES),
    setCommFilter: vi.fn(),
    hiddenStatuses: new Set<TimelineStatus>(),
    setHiddenStatuses: vi.fn(),
    setCachedData: vi.fn(),
    getCachedData: () => null,
    clearCachedData: vi.fn(),
  };
}

function makeTimelineData(agentCount = 2) {
  return {
    agents: Array.from({ length: agentCount }, (_, i) => ({
      id: `agent-${i}`,
      shortId: `a${i}`,
      role: i === 0 ? 'lead' : 'developer',
      model: 'gpt-4',
      createdAt: '2024-01-01T00:00:00Z',
      segments: [
        {
          startAt: '2024-01-01T00:00:00Z',
          endAt: null,
          status: 'running',
          taskLabel: 'Task',
        },
      ],
    })),
    communications: [
      {
        type: 'delegation' as CommType,
        fromAgentId: 'agent-0',
        toAgentId: 'agent-1',
        summary: 'Do X',
        timestamp: '2024-01-01T00:01:00Z',
      },
    ],
    locks: [],
    timeRange: {
      start: '2024-01-01T00:00:00Z',
      end: '2024-01-01T01:00:00Z',
    },
  };
}

// ── Setup ─────────────────────────────────────────────────────────────

// Lazy-import the component so mocks are registered first
let TimelinePage: typeof import('../TimelinePage').TimelinePage;

beforeEach(async () => {
  vi.clearAllMocks();

  // Reset all mock state
  mockTimelineData = null;
  mockLoading = false;
  mockError = null;
  mockStoreAgents = [];
  mockContextProjectId = null;
  mockTimelineStoreState = defaultTimelineStoreState();

  // Dynamic import to ensure fresh module with mocks applied
  const mod = await import('../TimelinePage');
  TimelinePage = mod.TimelinePage;
});

// ── Tests ─────────────────────────────────────────────────────────────

describe('TimelinePage', () => {
  // ── Loading / Empty / Error states ────────────────────────────────

  it('shows loading spinner when loading and no data', () => {
    mockLoading = true;
    mockTimelineStoreState = {
      ...defaultTimelineStoreState(),
      selectedLeadId: 'lead-1',
    };

    render(<TimelinePage />);

    const loading = screen.getByRole('status', { name: /loading timeline/i });
    expect(loading).toBeInTheDocument();
    expect(screen.getByText('Loading timeline data…')).toBeInTheDocument();
  });

  it('shows error message when error is set', () => {
    mockError = 'Connection lost';
    mockTimelineStoreState = defaultTimelineStoreState();

    render(<TimelinePage />);

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText(/Connection lost/)).toBeInTheDocument();
  });

  it('shows empty state when no effectiveLeadId', () => {
    mockTimelineStoreState = {
      ...defaultTimelineStoreState(),
      selectedLeadId: null,
    };
    mockStoreAgents = [];

    render(<TimelinePage />);

    const empty = screen.getByTestId('empty-state');
    expect(empty).toBeInTheDocument();
    expect(empty).toHaveTextContent('No active projects');
  });

  it('shows empty state when data has 0 agents', () => {
    mockTimelineData = makeTimelineData(0);
    mockTimelineStoreState = defaultTimelineStoreState();

    render(<TimelinePage />);

    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
  });

  // ── Rendering main content ────────────────────────────────────────

  it('renders TimelineContainer when data has agents', () => {
    mockTimelineData = makeTimelineData(3);
    mockTimelineStoreState = defaultTimelineStoreState();

    render(<TimelinePage />);

    expect(screen.getByTestId('timeline-container')).toBeInTheDocument();
  });

  it('renders StatusBar always', () => {
    mockTimelineStoreState = defaultTimelineStoreState();

    render(<TimelinePage />);

    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
  });

  it('renders AccessibilityAnnouncer', () => {
    mockTimelineStoreState = defaultTimelineStoreState();

    render(<TimelinePage />);

    expect(screen.getByTestId('a11y-announcer')).toBeInTheDocument();
  });

  it('renders ReplayScrubber when effectiveLeadId is set', () => {
    mockTimelineStoreState = defaultTimelineStoreState();

    render(<TimelinePage />);

    expect(screen.getByTestId('replay-scrubber')).toBeInTheDocument();
  });

  // ── Header / Toolbar ──────────────────────────────────────────────

  it('renders title "Crew Collaboration Timeline"', () => {
    mockTimelineStoreState = defaultTimelineStoreState();

    render(<TimelinePage />);

    expect(
      screen.getByRole('heading', { name: /Crew Collaboration Timeline/i }),
    ).toBeInTheDocument();
  });

  it('renders Filter, Live, Refresh, Clear buttons', () => {
    mockTimelineStoreState = defaultTimelineStoreState();

    render(<TimelinePage />);

    const toolbar = screen.getByRole('toolbar', { name: /timeline page controls/i });
    expect(toolbar).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /filter/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /live/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
  });

  it('Live button toggles live mode', () => {
    const setLiveMode = vi.fn();
    mockTimelineStoreState = {
      ...defaultTimelineStoreState(),
      liveMode: true,
      setLiveMode,
    };

    render(<TimelinePage />);

    const liveBtn = screen.getByRole('button', { name: /disable live updates/i });
    fireEvent.click(liveBtn);
    expect(setLiveMode).toHaveBeenCalledWith(false);
  });

  it('Refresh button calls refetch', () => {
    mockTimelineStoreState = defaultTimelineStoreState();

    render(<TimelinePage />);

    const refreshBtn = screen.getByRole('button', { name: /refresh timeline/i });
    fireEvent.click(refreshBtn);
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('Filter button toggles filter panel visibility', () => {
    const setShowFilters = vi.fn();
    mockTimelineStoreState = {
      ...defaultTimelineStoreState(),
      showFilters: false,
      setShowFilters,
    };

    render(<TimelinePage />);

    const filterBtn = screen.getByRole('button', { name: /show filters/i });
    fireEvent.click(filterBtn);
    expect(setShowFilters).toHaveBeenCalledWith(true);
  });

  // ── Filter panel ──────────────────────────────────────────────────

  it('shows filter panel when showFilters is true', () => {
    mockTimelineStoreState = {
      ...defaultTimelineStoreState(),
      showFilters: true,
    };

    render(<TimelinePage />);

    expect(
      screen.getByRole('region', { name: /timeline filters/i }),
    ).toBeInTheDocument();
  });

  it('filter panel has role chips, comm type chips, and hide-agents chips', () => {
    mockTimelineStoreState = {
      ...defaultTimelineStoreState(),
      showFilters: true,
    };

    render(<TimelinePage />);

    // Role chips — check a subset of known labels
    expect(screen.getByRole('button', { name: 'Lead' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Architect' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Developer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'QA' })).toBeInTheDocument();

    // Comm type chips
    expect(screen.getByRole('button', { name: 'Delegation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Group' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Broadcast' })).toBeInTheDocument();

    // Hidden status chips
    expect(screen.getByRole('button', { name: 'completed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'terminated' })).toBeInTheDocument();
  });

  it('"Reset all" button appears when filters are active', () => {
    mockTimelineStoreState = {
      ...defaultTimelineStoreState(),
      showFilters: true,
      // Remove one role to make activeFilterCount > 0
      roleFilter: new Set(['lead', 'developer']),
    };

    render(<TimelinePage />);

    expect(screen.getByRole('button', { name: /reset all/i })).toBeInTheDocument();
  });

  it('does not show "Reset all" when all filters are default', () => {
    mockTimelineStoreState = {
      ...defaultTimelineStoreState(),
      showFilters: true,
    };

    render(<TimelinePage />);

    expect(screen.queryByRole('button', { name: /reset all/i })).not.toBeInTheDocument();
  });

  // ── ProjectTabs ───────────────────────────────────────────────────

  it('shows ProjectTabs when no contextProjectId', () => {
    mockContextProjectId = null;
    mockTimelineStoreState = defaultTimelineStoreState();

    render(<TimelinePage />);

    expect(screen.getByTestId('project-tabs')).toBeInTheDocument();
  });

  it('does NOT show ProjectTabs when contextProjectId is set', () => {
    mockContextProjectId = 'proj-42';
    mockTimelineStoreState = defaultTimelineStoreState();

    render(<TimelinePage />);

    expect(screen.queryByTestId('project-tabs')).not.toBeInTheDocument();
  });

  // ── Accessibility ─────────────────────────────────────────────────

  it('renders skip link for keyboard users', () => {
    mockTimelineStoreState = defaultTimelineStoreState();

    render(<TimelinePage />);

    const skipLink = screen.getByText('Skip to timeline');
    expect(skipLink).toBeInTheDocument();
    expect(skipLink.tagName).toBe('A');
    expect(skipLink).toHaveAttribute('href', '#timeline-main');
  });

  it('timeline region has appropriate aria-label', () => {
    mockTimelineStoreState = defaultTimelineStoreState();

    render(<TimelinePage />);

    expect(
      screen.getByRole('region', { name: /Crew Collaboration Timeline/i }),
    ).toBeInTheDocument();
  });
});
