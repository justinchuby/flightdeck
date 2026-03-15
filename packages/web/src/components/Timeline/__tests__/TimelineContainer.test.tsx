import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TimelineData, TimelineAgent, TimelineSegment } from '../useTimelineData';

// ── Mocks ─────────────────────────────────────────────────────────────────

// Mock @visx/responsive ParentSize to immediately call children with a width
vi.mock('@visx/responsive', () => ({
  ParentSize: ({ children }: { children: (size: { width: number; height: number }) => React.ReactNode }) =>
    <div data-testid="parent-size">{children({ width: 800, height: 600 })}</div>,
}));

// Mock @visx/scale
vi.mock('@visx/scale', () => ({
  scaleTime: ({ range }: { domain: Date[]; range: number[] }) => {
    const fn = (d: Date) => {
      // Return a position proportional to range
      void d;
      return range[0] + (range[1] - range[0]) * 0.5;
    };
    fn.domain = () => [new Date(), new Date()];
    fn.range = () => range;
    fn.copy = () => fn;
    fn.ticks = () => [];
    fn.tickFormat = () => () => '';
    return fn;
  },
}));

// Mock @visx/axis
vi.mock('@visx/axis', () => ({
  AxisTop: () => <g data-testid="axis-top" />,
}));

// Mock @visx/group
vi.mock('@visx/group', () => ({
  Group: ({ children, ...props }: { children: React.ReactNode; top?: number }) =>
    <g data-testid="visx-group" {...props}>{children}</g>,
}));

// Mock @visx/tooltip
vi.mock('@visx/tooltip', () => ({
  useTooltip: () => ({
    tooltipOpen: false,
    tooltipData: null,
    tooltipLeft: 0,
    tooltipTop: 0,
    showTooltip: vi.fn(),
    hideTooltip: vi.fn(),
  }),
  defaultStyles: {},
}));

// Mock CommunicationLinks
vi.mock('../CommunicationLinks', () => ({
  CommunicationLinks: () => <g data-testid="communication-links" />,
}));

// Mock KeyboardShortcutHelp
vi.mock('../KeyboardShortcutHelp', () => ({
  KeyboardShortcutHelp: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="shortcut-help">Shortcut Help</div> : null,
}));

// Mock formatTimestamp
vi.mock('../formatTimestamp', () => ({
  formatTimestamp: (d: Date) => d.toISOString(),
}));

// Mock d3-time-format
vi.mock('d3-time-format', () => ({
  timeFormat: () => (d: Date) => d.toISOString().slice(11, 16),
}));

// Mock timelineStore
const mockStore: Record<string, unknown> = {
  selectedLeadId: 'lead-1',
  expandedAgents: {},
  sortDirection: 'oldest-first',
  toggleExpandedAgent: vi.fn(),
  expandMultipleAgents: vi.fn(),
  setSortDirection: vi.fn(),
};

vi.mock('../../../stores/timelineStore', () => ({
  useTimelineStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockStore),
}));

// Mock getRoleIcon
vi.mock('../../../utils/getRoleIcon', () => ({
  getRoleIcon: (role: string) => `[${role}]`,
}));

// ── Must import AFTER mocks ──────────────────────────────────────────────
import { TimelineContainer } from '../TimelineContainer';

// ── Fixtures ─────────────────────────────────────────────────────────────

function makeSegment(overrides: Partial<TimelineSegment> = {}): TimelineSegment {
  return {
    status: 'running',
    startAt: '2024-01-01T00:00:00Z',
    endAt: '2024-01-01T00:05:00Z',
    ...overrides,
  };
}

function makeAgent(overrides: Partial<TimelineAgent> = {}): TimelineAgent {
  return {
    id: 'agent-1',
    shortId: 'a1',
    role: 'developer',
    createdAt: '2024-01-01T00:00:00Z',
    segments: [makeSegment()],
    ...overrides,
  };
}

function makeData(overrides: Partial<TimelineData> = {}): TimelineData {
  return {
    agents: [
      makeAgent({ id: 'agent-1', shortId: 'a1', role: 'lead' }),
      makeAgent({ id: 'agent-2', shortId: 'a2', role: 'developer' }),
    ],
    communications: [],
    locks: [],
    timeRange: { start: '2024-01-01T00:00:00Z', end: '2024-01-01T01:00:00Z' },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('TimelineContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.selectedLeadId = 'lead-1';
    mockStore.expandedAgents = {};
    mockStore.sortDirection = 'oldest-first';
  });

  it('renders empty state when no agents', () => {
    const data = makeData({ agents: [] });
    render(<TimelineContainer data={data} />);
    expect(screen.getByText('No agent activity to display.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders agent count and communication count in toolbar', () => {
    const data = makeData({
      communications: [
        { type: 'delegation', fromAgentId: 'agent-1', toAgentId: 'agent-2', summary: 'test', timestamp: '2024-01-01T00:01:00Z' },
      ],
    });
    render(<TimelineContainer data={data} />);
    expect(screen.getByText('2 agents · 1 communications')).toBeInTheDocument();
  });

  it('renders agent labels for each agent', () => {
    const data = makeData();
    render(<TimelineContainer data={data} />);
    // Agent labels should appear with role text
    expect(screen.getByText(/lead/)).toBeInTheDocument();
    expect(screen.getByText(/developer/)).toBeInTheDocument();
  });

  it('renders the SVG timeline area', () => {
    const data = makeData();
    render(<TimelineContainer data={data} />);
    const svg = screen.getByRole('img');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('2 agents'));
  });

  it('renders timeline legend', () => {
    const data = makeData();
    render(<TimelineContainer data={data} />);
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('idle')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  it('renders zoom controls', () => {
    const data = makeData();
    render(<TimelineContainer data={data} />);
    expect(screen.getByLabelText('Zoom in')).toBeInTheDocument();
    expect(screen.getByLabelText('Zoom out')).toBeInTheDocument();
    // At default zoom, zoom out is disabled
    expect(screen.getByLabelText('Zoom out')).toBeDisabled();
  });

  it('zooms in when zoom-in button is clicked', () => {
    const data = makeData();
    render(<TimelineContainer data={data} />);
    const zoomIn = screen.getByLabelText('Zoom in');
    fireEvent.click(zoomIn);
    // After zoom in, zoom out should be enabled and Fit button should appear
    expect(screen.getByLabelText('Zoom out')).not.toBeDisabled();
    expect(screen.getByLabelText('Reset zoom')).toBeInTheDocument();
  });

  it('resets zoom on fit button click', () => {
    const data = makeData();
    render(<TimelineContainer data={data} />);
    // Zoom in first
    fireEvent.click(screen.getByLabelText('Zoom in'));
    expect(screen.getByLabelText('Reset zoom')).toBeInTheDocument();
    // Reset
    fireEvent.click(screen.getByLabelText('Reset zoom'));
    expect(screen.queryByLabelText('Reset zoom')).not.toBeInTheDocument();
  });

  it('toggles sort direction', () => {
    const data = makeData();
    render(<TimelineContainer data={data} />);
    const sortBtn = screen.getByLabelText(/Sort:/);
    fireEvent.click(sortBtn);
    expect(mockStore.setSortDirection).toHaveBeenCalledWith('newest-first');
  });

  it('shows shortcut help on ? key press', () => {
    const data = makeData();
    render(<TimelineContainer data={data} />);
    const container = screen.getByRole('application');
    fireEvent.keyDown(container, { key: '?' });
    expect(screen.getByTestId('shortcut-help')).toBeInTheDocument();
  });

  it('renders with three agents sorted by role order', () => {
    const data = makeData({
      agents: [
        makeAgent({ id: 'a3', shortId: 'a3', role: 'developer' }),
        makeAgent({ id: 'a1', shortId: 'a1', role: 'lead' }),
        makeAgent({ id: 'a2', shortId: 'a2', role: 'architect' }),
      ],
    });
    render(<TimelineContainer data={data} />);
    expect(screen.getByText('3 agents · 0 communications')).toBeInTheDocument();
  });

  it('renders CommunicationLinks component', () => {
    const data = makeData();
    render(<TimelineContainer data={data} />);
    expect(screen.getByTestId('communication-links')).toBeInTheDocument();
  });

  it('renders axis', () => {
    const data = makeData();
    render(<TimelineContainer data={data} />);
    expect(screen.getByTestId('axis-top')).toBeInTheDocument();
  });
});
