// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CommType, TimelineStatus } from '../useTimelineData';

vi.mock('../timeline-a11y.css', () => ({}));

let mockTimelineData: any = null;
let mockLoading = false;
let mockError: string | null = null;
const mockRefetch = vi.fn();

vi.mock('../useTimelineData', () => ({
  useTimelineData: () => ({
    data: mockTimelineData, loading: mockLoading, error: mockError,
    refetch: mockRefetch, connectionHealth: { status: 'connected' },
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
    keyframes: [], worldState: null, playing: false, currentTime: 0,
    duration: 0, loading: false, error: null, play: vi.fn(), pause: vi.fn(),
    seek: vi.fn(), setSpeed: vi.fn(), speed: 1,
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
    announceError: vi.fn(), announceNewEvents: vi.fn(),
  }),
}));

vi.mock('../TimelineContainer', () => ({
  TimelineContainer: (props: any) => <div data-testid="timeline-container" data-live={props.liveMode} />,
}));
vi.mock('../StatusBar', () => ({
  StatusBar: (props: any) => (
    <div data-testid="status-bar">
      <button data-testid="error-click" onClick={props.onErrorClick}>Errors</button>
    </div>
  ),
}));
vi.mock('../ErrorBanner', () => ({
  ErrorBanner: ({ errors, onScrollToError }: any) =>
    errors?.length ? (
      <div data-testid="error-banner">
        {errors.map((e: any) => (
          <button key={e.id} data-testid={`scroll-${e.id}`} onClick={() => onScrollToError(e.id)}>
            {e.message}
          </button>
        ))}
      </div>
    ) : null,
}));
vi.mock('../EmptyState', () => ({
  EmptyState: ({ title }: any) => <div data-testid="empty-state">{title ?? 'No timeline data'}</div>,
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

const ALL_ROLES = ['lead', 'architect', 'developer', 'code-reviewer', 'critical-reviewer', 'designer', 'secretary', 'qa-tester'] as const;
const ALL_COMM_TYPES: CommType[] = ['delegation', 'message', 'group_message', 'broadcast'];

function defaultState() {
  return {
    selectedLeadId: 'lead-1', setSelectedLeadId: vi.fn(),
    liveMode: true, setLiveMode: vi.fn(),
    showFilters: false, setShowFilters: vi.fn(),
    roleFilter: new Set<string>(ALL_ROLES), setRoleFilter: vi.fn(),
    commFilter: new Set<CommType>(ALL_COMM_TYPES), setCommFilter: vi.fn(),
    hiddenStatuses: new Set<TimelineStatus>(), setHiddenStatuses: vi.fn(),
    setCachedData: vi.fn(), getCachedData: () => null, clearCachedData: vi.fn(),
  };
}

function makeTimelineData(agentCount = 2) {
  return {
    agents: Array.from({ length: agentCount }, (_, i) => ({
      id: `agent-${i}`, shortId: `a${i}`,
      role: i === 0 ? 'lead' : 'developer', model: 'gpt-4',
      createdAt: '2024-01-01T00:00:00Z',
      segments: [{ startAt: '2024-01-01T00:00:00Z', endAt: null, status: i === 0 ? 'running' : 'failed', taskLabel: 'Task' }],
    })),
    communications: [],
    locks: [],
    timeRange: { start: '2024-01-01T00:00:00Z', end: '2024-01-01T01:00:00Z' },
  };
}

let TimelinePage: any;

beforeEach(async () => {
  vi.clearAllMocks();
  mockTimelineData = null;
  mockLoading = false;
  mockError = null;
  mockStoreAgents = [];
  mockContextProjectId = null;
  mockTimelineStoreState = defaultState();
  const mod = await import('../TimelinePage');
  TimelinePage = mod.TimelinePage;
});

describe('TimelinePage – extra coverage', () => {
  it('hidden status toggle calls setHiddenStatuses', () => {
    const setHiddenStatuses = vi.fn();
    mockTimelineStoreState = {
      ...defaultState(),
      showFilters: true,
      setHiddenStatuses,
    };
    render(<TimelinePage />);
    // Click "completed" status toggle
    const completedBtn = screen.getByRole('button', { name: 'completed' });
    fireEvent.click(completedBtn);
    expect(setHiddenStatuses).toHaveBeenCalled();
  });

  it('reset all button resets all filters', () => {
    const setRoleFilter = vi.fn();
    const setCommFilter = vi.fn();
    const setHiddenStatuses = vi.fn();
    mockTimelineStoreState = {
      ...defaultState(),
      showFilters: true,
      roleFilter: new Set(['lead']),
      setRoleFilter,
      setCommFilter,
      setHiddenStatuses,
    };
    render(<TimelinePage />);
    
    const resetBtn = screen.getByRole('button', { name: /reset all/i });
    fireEvent.click(resetBtn);
    expect(setRoleFilter).toHaveBeenCalled();
    expect(setCommFilter).toHaveBeenCalled();
    expect(setHiddenStatuses).toHaveBeenCalled();
  });

  it('renders ErrorBanner for failed agents', () => {
    mockTimelineData = makeTimelineData(2);
    mockTimelineStoreState = defaultState();
    render(<TimelinePage />);
    // Agent 1 has 'failed' status, so error banner should appear
    expect(screen.getByTestId('error-banner')).toBeInTheDocument();
  });

  it('clear button calls clearCachedData', () => {
    const clearCachedData = vi.fn();
    mockTimelineStoreState = { ...defaultState(), clearCachedData };
    render(<TimelinePage />);
    const clearBtn = screen.getByRole('button', { name: /clear/i });
    fireEvent.click(clearBtn);
    expect(clearCachedData).toHaveBeenCalled();
  });
});
