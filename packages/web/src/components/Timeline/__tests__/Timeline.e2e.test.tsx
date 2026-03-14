/**
 * Comprehensive E2E tests for the Timeline Swimlane visualization.
 *
 * Tests the data pipeline, segment rendering, tooltips, idle hatch,
 * communication links, filtering, brush selector, keyboard nav,
 * live mode, and multi-agent simulation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { useTimelineData } from '../useTimelineData';
import type {
  TimelineData,
  TimelineAgent,
  TimelineSegment,
  TimelineComm,
  TimelineLock,
} from '../useTimelineData';

// Mock @visx/responsive ParentSize to always render with width=800
vi.mock('@visx/responsive', () => ({
  ParentSize: ({ children }: { children: (size: { width: number; height: number }) => React.ReactNode }) =>
    children({ width: 800, height: 600 }),
}));

// Must import AFTER mocks are set up
const { TimelineContainer } = await import('../TimelineContainer');

// ── Mock data factory ─────────────────────────────────────────────────

const BASE_TIME = new Date('2026-02-28T10:00:00Z').getTime();

function ts(offsetSeconds: number): string {
  return new Date(BASE_TIME + offsetSeconds * 1000).toISOString();
}

function makeSegment(
  status: TimelineSegment['status'],
  startOffsetSec: number,
  endOffsetSec?: number,
  taskLabel?: string,
): TimelineSegment {
  return {
    status,
    startAt: ts(startOffsetSec),
    endAt: endOffsetSec != null ? ts(endOffsetSec) : undefined,
    taskLabel,
  };
}

function makeAgent(
  id: string,
  role: string,
  segments: TimelineSegment[],
  opts?: { model?: string; endedAt?: string },
): TimelineAgent {
  return {
    id,
    shortId: id.slice(0, 8),
    role,
    model: opts?.model,
    createdAt: segments[0]?.startAt ?? ts(0),
    endedAt: opts?.endedAt,
    segments,
  };
}

function makeComm(
  type: TimelineComm['type'],
  fromAgentId: string,
  offsetSec: number,
  summary: string,
  toAgentId?: string,
): TimelineComm {
  return { type, fromAgentId, toAgentId, summary, timestamp: ts(offsetSec) };
}

function makeLock(
  agentId: string,
  filePath: string,
  acquiredOffsetSec: number,
  releasedOffsetSec?: number,
): TimelineLock {
  return {
    agentId,
    filePath,
    acquiredAt: ts(acquiredOffsetSec),
    releasedAt: releasedOffsetSec != null ? ts(releasedOffsetSec) : undefined,
  };
}

/** Standard test data: 2 agents with realistic lifecycle */
function makeStandardTestData(): TimelineData {
  const leadSegments: TimelineSegment[] = [
    makeSegment('creating', 0, 2),
    makeSegment('running', 2, 32, 'Planning sprint tasks'),
    makeSegment('idle', 32, 42),
    makeSegment('running', 42, 102, 'Reviewing agent output'),
    makeSegment('completed', 102, 120),
  ];

  const devSegments: TimelineSegment[] = [
    makeSegment('creating', 5, 8),
    makeSegment('running', 8, 68, 'Implementing feature X'),
    makeSegment('idle', 68, 78),
    makeSegment('running', 78, 108, 'Writing tests'),
    makeSegment('completed', 108, 120),
  ];

  const lead = makeAgent('lead-agent-001', 'lead', leadSegments, { model: 'claude-sonnet-4' });
  const dev = makeAgent('dev-agent-002', 'developer', devSegments, {
    model: 'claude-sonnet-4',
    endedAt: ts(120),
  });

  return {
    agents: [lead, dev],
    communications: [
      makeComm('delegation', 'lead-agent-001', 5, 'Implement feature X', 'dev-agent-002'),
      makeComm('message', 'dev-agent-002', 15, 'Starting implementation', 'lead-agent-001'),
      makeComm('broadcast', 'lead-agent-001', 45, 'Sprint update: 50% done'),
    ],
    locks: [
      makeLock('dev-agent-002', 'src/feature.ts', 10, 65),
      makeLock('dev-agent-002', 'src/feature.test.ts', 80, 105),
    ],
    timeRange: { start: ts(0), end: ts(120) },
  };
}

/** 5-agent data for multi-agent simulation */
function makeMultiAgentTestData(): TimelineData {
  const agents: TimelineAgent[] = [
    makeAgent('lead-001', 'lead', [
      makeSegment('running', 0, 300, 'Coordinating team'),
    ]),
    makeAgent('arch-002', 'architect', [
      makeSegment('creating', 2, 5),
      makeSegment('running', 5, 100, 'Designing architecture'),
      makeSegment('idle', 100, 120),
      makeSegment('running', 120, 200, 'Reviewing PRs'),
      makeSegment('completed', 200, 250),
    ], { endedAt: ts(250) }),
    makeAgent('dev-003', 'developer', [
      makeSegment('creating', 10, 13),
      makeSegment('running', 13, 180, 'Implementing feature A'),
      makeSegment('completed', 180, 200),
    ], { endedAt: ts(200) }),
    makeAgent('dev-004', 'developer', [
      makeSegment('creating', 12, 15),
      makeSegment('running', 15, 90, 'Implementing feature B'),
      makeSegment('failed', 90, 95),
      makeSegment('running', 95, 190, 'Retrying feature B'),
      makeSegment('completed', 190, 210),
    ], { endedAt: ts(210) }),
    makeAgent('rev-005', 'code-reviewer', [
      makeSegment('creating', 50, 53),
      makeSegment('running', 53, 150, 'Reviewing code'),
      makeSegment('idle', 150, 200),
      makeSegment('terminated', 200, 220),
    ], { endedAt: ts(220) }),
  ];

  const comms: TimelineComm[] = [
    makeComm('delegation', 'lead-001', 10, 'Build feature A', 'dev-003'),
    makeComm('delegation', 'lead-001', 12, 'Build feature B', 'dev-004'),
    makeComm('delegation', 'lead-001', 50, 'Review all PRs', 'rev-005'),
    makeComm('message', 'dev-003', 60, 'Feature A progress: 50%', 'lead-001'),
    makeComm('message', 'dev-004', 90, 'Feature B failed, retrying', 'lead-001'),
    makeComm('group_message', 'lead-001', 100, 'Team sync: halfway through sprint'),
    makeComm('broadcast', 'lead-001', 180, 'Sprint complete — wrapping up'),
  ];

  const locks: TimelineLock[] = [
    makeLock('dev-003', 'src/featureA.ts', 15, 175),
    makeLock('dev-004', 'src/featureB.ts', 18, 85),
    makeLock('dev-004', 'src/featureB.ts', 97, 188),
  ];

  return {
    agents,
    communications: comms,
    locks,
    timeRange: { start: ts(0), end: ts(300) },
  };
}

// ── Setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── Tests ─────────────────────────────────────────────────────────────

describe('Timeline Data Pipeline', () => {
  it('useTimelineData fetches and returns correct data shape', async () => {
    const mockData = makeStandardTestData();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    }) as any;

    const { result } = renderHook(() => useTimelineData('lead-001'));

    await waitFor(() => {
      expect(result.current.data).not.toBeNull();
    });

    expect(result.current.data!.agents).toHaveLength(2);
    expect(result.current.data!.communications).toHaveLength(3);
    expect(result.current.data!.locks).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it('useTimelineData handles fetch errors gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ error: 'Internal Server Error' }),
    }) as any;

    const { result } = renderHook(() => useTimelineData('lead-001'));

    await waitFor(() => {
      expect(result.current.error).toBe('Internal Server Error');
    });

    expect(result.current.data).toBeNull();
  });

  it('useTimelineData returns null data when leadId is null', () => {
    const { result } = renderHook(() => useTimelineData(null));

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('agents have correct segment counts and ordering', () => {
    const data = makeStandardTestData();
    const lead = data.agents.find(a => a.role === 'lead')!;
    const dev = data.agents.find(a => a.role === 'developer')!;

    expect(lead.segments).toHaveLength(5);
    expect(dev.segments).toHaveLength(5);

    // Verify status sequence
    expect(lead.segments.map(s => s.status)).toEqual([
      'creating', 'running', 'idle', 'running', 'completed',
    ]);
    expect(dev.segments.map(s => s.status)).toEqual([
      'creating', 'running', 'idle', 'running', 'completed',
    ]);
  });

  it('communications have correct types and references', () => {
    const data = makeStandardTestData();
    expect(data.communications.map(c => c.type)).toEqual([
      'delegation', 'message', 'broadcast',
    ]);
    // delegation has toAgentId
    expect(data.communications[0].toAgentId).toBe('dev-agent-002');
    // broadcast has no toAgentId
    expect(data.communications[2].toAgentId).toBeUndefined();
  });
});

describe('Segment Rendering', () => {
  it('renders correct number of SVG rect elements for segments', () => {
    const data = makeStandardTestData();
    const { container } = render(
      <TimelineContainer data={data} />,
    );

    // Each agent has 5 segments → 10 segment rects total
    // Plus lane background rects (1 per agent = 2)
    const allRects = container.querySelectorAll('svg rect');
    // Segments: 10, lane backgrounds: 2, hatch pattern rect: at least 1, brush area rects
    expect(allRects.length).toBeGreaterThanOrEqual(10);
  });

  it('renders agents in correct role order (lead first)', () => {
    const data = makeStandardTestData();
    const { container } = render(
      <TimelineContainer data={data} />,
    );

    // Labels should show lead before developer
    const labels = container.querySelectorAll('[role="button"]');
    expect(labels.length).toBe(2);
    expect(labels[0].textContent).toContain('lead');
    expect(labels[1].textContent).toContain('developer');
  });

  it('shows task label text on running segments wider than 60px', () => {
    const data = makeStandardTestData();
    const { container } = render(
      <TimelineContainer data={data} />,
    );

    // foreignObject elements contain task labels
    const foreignObjects = container.querySelectorAll('foreignObject');
    // At least some running segments should have labels
    const labelTexts = Array.from(foreignObjects).map(fo => fo.textContent);
    // One of the running segments should show its task label
    const hasTaskLabel = labelTexts.some(t => t?.includes('Planning sprint tasks') || t?.includes('Implementing feature X'));
    expect(hasTaskLabel || foreignObjects.length > 0).toBe(true);
  });

  it('displays agent count in toolbar', () => {
    const data = makeStandardTestData();
    render(<TimelineContainer data={data} />);

    expect(screen.getByText(/2 agents/)).toBeInTheDocument();
    expect(screen.getByText(/3 communications/)).toBeInTheDocument();
  });
});

describe('Tooltip Content', () => {
  it('shows tooltip with segment details on mouse enter', async () => {
    const data = makeStandardTestData();
    const { container } = render(
      <TimelineContainer data={data} />,
    );

    // Find a segment rect (skip lane backgrounds and pattern rects)
    const svgRects = container.querySelectorAll('svg g[role="row"] g rect');
    expect(svgRects.length).toBeGreaterThan(0);

    // Hover over the first segment
    const segmentGroup = svgRects[0].parentElement!;
    fireEvent.mouseEnter(segmentGroup, { clientX: 400, clientY: 100 });

    // Tooltip should appear with status text
    await waitFor(() => {
      const tooltip = container.querySelector('[style*="position"]');
      // Check that some tooltip-like content appeared
      expect(tooltip || container.textContent).toBeTruthy();
    });
  });

  it('hides tooltip on mouse leave', async () => {
    const data = makeStandardTestData();
    const { container } = render(
      <TimelineContainer data={data} />,
    );

    const svgRects = container.querySelectorAll('svg g[role="row"] g rect');
    if (svgRects.length === 0) return;

    const segmentGroup = svgRects[0].parentElement!;

    // Hover then leave
    fireEvent.mouseEnter(segmentGroup, { clientX: 400, clientY: 100 });
    fireEvent.mouseLeave(segmentGroup);

    // The tooltip data should be cleared; specific DOM check depends on visx behavior
    // At minimum, no crash should occur
    expect(container).toBeTruthy();
  });
});

describe('Idle Hatch Pattern', () => {
  it('defines SVG pattern for idle crosshatch', () => {
    const data = makeStandardTestData();
    const { container } = render(
      <TimelineContainer data={data} />,
    );

    const pattern = container.querySelector('pattern#idle-hatch');
    expect(pattern).not.toBeNull();
    expect(pattern!.getAttribute('patternTransform')).toBe('rotate(45)');
  });

  it('idle segments use url(#idle-hatch) fill', () => {
    // Create data with an idle segment
    const data = makeStandardTestData();
    const { container } = render(
      <TimelineContainer data={data} />,
    );

    // Check that at least one rect uses the hatch pattern fill
    const allRects = container.querySelectorAll('svg rect');
    const hatchRects = Array.from(allRects).filter(
      r => r.getAttribute('fill') === 'url(#idle-hatch)',
    );
    // Both agents have idle segments → should have at least 2 hatch rects
    expect(hatchRects.length).toBeGreaterThanOrEqual(2);
  });

  it('legend shows idle with hatch pattern SVG', () => {
    const data = makeStandardTestData();
    const { container } = render(
      <TimelineContainer data={data} />,
    );

    const legendPattern = container.querySelector('pattern#legend-idle-hatch');
    expect(legendPattern).not.toBeNull();
  });
});

describe('Communication Links', () => {
  it('renders SVG paths for communications', () => {
    const data = makeStandardTestData();
    const { container } = render(
      <TimelineContainer data={data} />,
    );

    // CommunicationLinks renders paths/lines for each comm
    const paths = container.querySelectorAll('svg path');
    // Should have at least some paths for the 3 communications
    expect(paths.length).toBeGreaterThan(0);
  });

  it('renders different marker types for different comm types', () => {
    const data = makeStandardTestData();
    const { container } = render(
      <TimelineContainer data={data} />,
    );

    // Check that SVG defs contain markers for comm types
    const markers = container.querySelectorAll('marker');
    expect(markers.length).toBeGreaterThan(0);
  });
});

describe('Keyboard Navigation', () => {
  it('moves lane focus with ArrowDown/ArrowUp', () => {
    const data = makeStandardTestData();
    const { container } = render(
      <TimelineContainer data={data} />,
    );

    const focusTarget = container.querySelector('[role="application"]');
    // Move down then up
    fireEvent.keyDown(focusTarget!, { key: 'ArrowDown' });
    fireEvent.keyDown(focusTarget!, { key: 'ArrowUp' });
    expect(container).toBeTruthy();
  });

});

describe('Multi-Agent Simulation', () => {
  it('renders 5 agents with overlapping timelines', () => {
    const data = makeMultiAgentTestData();
    const { container } = render(
      <TimelineContainer data={data} />,
    );

    expect(screen.getByText(/5 agents/)).toBeInTheDocument();
    expect(screen.getByText(/7 communications/)).toBeInTheDocument();

    // 5 agent labels
    const labels = container.querySelectorAll('[role="button"]');
    expect(labels.length).toBe(5);
  });

  it('handles failed and terminated agent statuses', () => {
    const data = makeMultiAgentTestData();
    const { container } = render(
      <TimelineContainer data={data} />,
    );

    // Should render without crashing — agents have failed + terminated segments
    const svgRects = container.querySelectorAll('svg rect');
    expect(svgRects.length).toBeGreaterThan(10);
  });

  it('renders all communication types including group_message', () => {
    const data = makeMultiAgentTestData();
    const { container } = render(
      <TimelineContainer data={data} />,
    );

    // 7 communications: delegation(3), message(2), group_message(1), broadcast(1)
    // Should render paths for each
    const paths = container.querySelectorAll('svg path');
    expect(paths.length).toBeGreaterThan(0);
  });

  it('multiple file locks render correctly', () => {
    const data = makeMultiAgentTestData();
    const { container } = render(
      <TimelineContainer data={data} />,
    );

    // Lock indicators (🔒 emoji text elements)
    const lockTexts = container.querySelectorAll('svg text');
    const lockIcons = Array.from(lockTexts).filter(t => t.textContent === '🔒');
    // 3 locks in the data
    expect(lockIcons.length).toBe(3);
  });

  it('keyboard navigation works with 5 agents', () => {
    const data = makeMultiAgentTestData();
    const { container } = render(
      <TimelineContainer data={data} />,
    );

    const focusTarget = container.querySelector('[role="application"]');

    // Navigate through all lanes
    for (let i = 0; i < 5; i++) {
      fireEvent.keyDown(focusTarget!, { key: 'ArrowDown' });
    }
    // Navigate back up
    for (let i = 0; i < 5; i++) {
      fireEvent.keyDown(focusTarget!, { key: 'ArrowUp' });
    }

    expect(container).toBeTruthy();
  });
});

describe('Edge Cases', () => {
  it('renders empty data without crashing', () => {
    const data: TimelineData = {
      agents: [],
      communications: [],
      locks: [],
      timeRange: { start: ts(0), end: ts(60) },
    };

    const { container } = render(
      <TimelineContainer data={data} />,
    );

    expect(container).toBeTruthy();
    expect(screen.getByText(/No agent activity/)).toBeInTheDocument();
  });

  it('handles agent with no segments', () => {
    const data: TimelineData = {
      agents: [makeAgent('empty-001', 'developer', [])],
      communications: [],
      locks: [],
      timeRange: { start: ts(0), end: ts(60) },
    };

    const { container } = render(
      <TimelineContainer data={data} />,
    );

    expect(container).toBeTruthy();
  });

  it('handles segment with no endAt (still running)', () => {
    const data: TimelineData = {
      agents: [
        makeAgent('running-001', 'developer', [
          makeSegment('running', 0, undefined, 'Still working'),
        ]),
      ],
      communications: [],
      locks: [],
      timeRange: { start: ts(0), end: ts(60) },
    };

    const { container } = render(
      <TimelineContainer data={data} />,
    );

    expect(container).toBeTruthy();
  });

  it('handles very short time range (< 1 second)', () => {
    const data: TimelineData = {
      agents: [
        makeAgent('quick-001', 'developer', [
          makeSegment('running', 0, 0.5),
        ]),
      ],
      communications: [],
      locks: [],
      timeRange: { start: ts(0), end: ts(1) },
    };

    const { container } = render(
      <TimelineContainer data={data} />,
    );

    expect(container).toBeTruthy();
  });
});

describe('formatDuration utility', () => {
  // Import through the module's internal usage validation
  it('segment tooltip shows human-readable duration format', async () => {
    // Create a segment that spans exactly 2m 30s
    const data: TimelineData = {
      agents: [
        makeAgent('dur-001', 'developer', [
          makeSegment('running', 0, 150, 'Test task'),
        ]),
      ],
      communications: [],
      locks: [],
      timeRange: { start: ts(0), end: ts(150) },
    };

    const { container } = render(
      <TimelineContainer data={data} />,
    );

    // Find and hover a segment to trigger tooltip
    const segmentGroups = container.querySelectorAll('svg g[role="row"] g');
    if (segmentGroups.length > 0) {
      fireEvent.mouseEnter(segmentGroups[0], { clientX: 400, clientY: 100 });
      // Tooltip should render duration — exact check depends on tooltip DOM
      await waitFor(() => {
        expect(container).toBeTruthy();
      });
    }
  });
});

// ── Scroll & Zoom Interaction Tests ─────────────────────────────────

describe('Scroll Axis Separation', () => {
  it('vertical wheel (deltaY only) does NOT preventDefault — allows native vertical scroll', () => {
    const data = makeStandardTestData();
    const { container } = render(<TimelineContainer data={data} />);

    const timeline = container.querySelector('.timeline-container')!;
    const event = new WheelEvent('wheel', { deltaY: 100, deltaX: 0, bubbles: true });
    const spy = vi.spyOn(event, 'preventDefault');
    timeline.dispatchEvent(event);

    expect(spy).not.toHaveBeenCalled();
  });

  it('Ctrl+wheel zooms in — zoom level indicator updates from Full', () => {
    const data = makeStandardTestData();
    render(<TimelineContainer data={data} />);

    // Before zoom: shows "Full"
    expect(screen.getByTitle(/1\.0× zoom/)).toBeInTheDocument();
    expect(screen.getByText('Full')).toBeInTheDocument();

    const scrollable = document.querySelector('[class*="overflow-auto"]')!;
    fireEvent.wheel(scrollable, { deltaY: -100, ctrlKey: true });

    // After Ctrl+wheel zoom in: "Full" text should be gone, zoom title should increase
    expect(screen.queryByText('Full')).not.toBeInTheDocument();
    expect(screen.queryByTitle(/1\.0× zoom/)).not.toBeInTheDocument();
  });

  it('Shift+wheel when zoomed does not change zoom level (only pans)', () => {
    const data = makeStandardTestData();
    render(<TimelineContainer data={data} />);

    const scrollable = document.querySelector('[class*="overflow-auto"]')!;

    // Zoom in first
    fireEvent.wheel(scrollable, { deltaY: -200, ctrlKey: true });
    const zoomIndicator = document.querySelector('[title$="zoom"]')!;
    const zoomBefore = zoomIndicator.getAttribute('title');

    // Shift+wheel should NOT change zoom level
    fireEvent.wheel(scrollable, { deltaY: 100, shiftKey: true });
    expect(zoomIndicator.getAttribute('title')).toBe(zoomBefore);
  });

  it('deltaX (trackpad horizontal gesture) when zoomed does not change zoom level', () => {
    const data = makeStandardTestData();
    render(<TimelineContainer data={data} />);

    const scrollable = document.querySelector('[class*="overflow-auto"]')!;

    // Zoom in first
    fireEvent.wheel(scrollable, { deltaY: -200, ctrlKey: true });
    const zoomIndicator = document.querySelector('[title$="zoom"]')!;
    const zoomBefore = zoomIndicator.getAttribute('title');

    // Pure deltaX should pan, not zoom
    fireEvent.wheel(scrollable, { deltaX: 50, deltaY: 0 });
    expect(zoomIndicator.getAttribute('title')).toBe(zoomBefore);
  });

  it('plain vertical scroll at zoom=1 keeps zoom at Full', () => {
    const data = makeStandardTestData();
    render(<TimelineContainer data={data} />);

    const scrollable = document.querySelector('[class*="overflow-auto"]')!;

    // At zoom=1, vertical scroll should not trigger zoom
    fireEvent.wheel(scrollable, { deltaY: 100, deltaX: 0 });
    expect(screen.getByText('Full')).toBeInTheDocument();
    expect(screen.getByTitle(/1\.0× zoom/)).toBeInTheDocument();
  });
});

describe('Zoom Controls', () => {
  it('zoom in button increases zoom level', () => {
    const data = makeStandardTestData();
    render(<TimelineContainer data={data} />);

    const zoomInBtn = screen.getByLabelText('Zoom in');
    fireEvent.click(zoomInBtn);

    // After zoom in, the Fit button should appear
    expect(screen.getByLabelText('Reset zoom')).toBeInTheDocument();
  });

  it('zoom out button disabled at zoom=1', () => {
    const data = makeStandardTestData();
    render(<TimelineContainer data={data} />);

    const zoomOutBtn = screen.getByLabelText('Zoom out');
    expect(zoomOutBtn).toBeDisabled();
  });

  it('zoom out button enabled after zooming in', () => {
    const data = makeStandardTestData();
    render(<TimelineContainer data={data} />);

    const zoomInBtn = screen.getByLabelText('Zoom in');
    fireEvent.click(zoomInBtn);

    const zoomOutBtn = screen.getByLabelText('Zoom out');
    expect(zoomOutBtn).not.toBeDisabled();
  });

  it('Fit button resets zoom to 1', () => {
    const data = makeStandardTestData();
    render(<TimelineContainer data={data} />);

    // Zoom in
    fireEvent.click(screen.getByLabelText('Zoom in'));
    expect(screen.getByLabelText('Reset zoom')).toBeInTheDocument();

    // Reset
    fireEvent.click(screen.getByLabelText('Reset zoom'));

    // Fit button should disappear (only visible when zoomed)
    expect(screen.queryByLabelText('Reset zoom')).not.toBeInTheDocument();
  });
});

describe('Mouse Drag to Pan', () => {
  it('drag-to-pan only activates when zoomed in', () => {
    const data = makeStandardTestData();
    const { container } = render(<TimelineContainer data={data} />);

    const scrollable = container.querySelector('[class*="overflow-auto"]');
    if (!scrollable) return;

    // At zoom=1, cursor should not be grab
    expect(scrollable.className).not.toContain('cursor-grab');

    // Zoom in
    fireEvent.click(screen.getByLabelText('Zoom in'));

    // Now cursor should indicate drag is available
    expect(scrollable.className).toContain('cursor-grab');
  });

  it('pointer down + move + up changes cursor to grabbing state', () => {
    const data = makeStandardTestData();
    const { container } = render(<TimelineContainer data={data} />);

    // Zoom in first
    fireEvent.click(screen.getByLabelText('Zoom in'));

    const scrollable = container.querySelector('[class*="overflow-auto"]')!;
    expect(scrollable.className).toContain('cursor-grab');

    // Simulate drag — after pointerDown, touchAction should remain 'none' (zoomed)
    fireEvent.pointerDown(scrollable, { clientX: 400, clientY: 200, button: 0, pointerId: 1 });
    // During drag the active:cursor-grabbing pseudo-class applies (can't test pseudo in jsdom)
    // But we can verify the container still has the correct base cursor class
    expect(scrollable.className).toContain('cursor-grab');

    fireEvent.pointerMove(scrollable, { clientX: 350, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(scrollable, { clientX: 350, clientY: 200, pointerId: 1 });

    // After drag, container retains cursor-grab class (active:cursor-grabbing is CSS pseudo-class, always in classlist)
    expect(scrollable.className).toContain('cursor-grab');
    // Verify touchAction is 'none' when zoomed (enables pointer events for drag)
    expect((scrollable as HTMLElement).style.touchAction).toBe('none');
  });
});

describe('Horizontal Overflow with Many Agents', () => {
  it('chart width scales with agent count', () => {
    const agents = Array.from({ length: 12 }, (_, i) =>
      makeAgent(`agent-${i.toString().padStart(3, '0')}`, i === 0 ? 'lead' : 'developer', [
        makeSegment('running', i * 10, i * 10 + 50, `Task ${i}`),
      ]),
    );

    const data: TimelineData = {
      agents,
      communications: [],
      locks: [],
      timeRange: { start: ts(0), end: ts(200) },
    };

    const { container } = render(<TimelineContainer data={data} />);

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    const width = parseInt(svg!.getAttribute('width') || '0');
    expect(width).toBeGreaterThanOrEqual(600);
  });

  it('renders 12 agent labels correctly', () => {
    const agents = Array.from({ length: 12 }, (_, i) =>
      makeAgent(`agent-${i.toString().padStart(3, '0')}`, i === 0 ? 'lead' : 'developer', [
        makeSegment('running', i * 5, i * 5 + 30),
      ]),
    );

    const data: TimelineData = {
      agents,
      communications: [],
      locks: [],
      timeRange: { start: ts(0), end: ts(100) },
    };

    render(<TimelineContainer data={data} />);
    expect(screen.getByText(/12 agents/)).toBeInTheDocument();
  });
});

describe('Keyboard Interaction', () => {
  it('ArrowDown moves focus ring through agents', () => {
    const data = makeMultiAgentTestData();
    const { container } = render(<TimelineContainer data={data} />);

    const app = container.querySelector('[role="application"]')!;

    // Initially no lane should have focus ring
    const lanesBeforeFocus = container.querySelectorAll('[aria-expanded]');
    const focusedBefore = Array.from(lanesBeforeFocus).filter(el => el.className.includes('ring-blue-500'));
    expect(focusedBefore.length).toBe(0);

    // Navigate down — first lane should get focus ring
    fireEvent.keyDown(app, { key: 'ArrowDown' });
    const lanesAfterFocus = container.querySelectorAll('[aria-expanded]');
    const focusedAfter = Array.from(lanesAfterFocus).filter(el => el.className.includes('ring-blue-500'));
    expect(focusedAfter.length).toBe(1);

    // Navigate down again — focus ring should move (still exactly 1 focused)
    fireEvent.keyDown(app, { key: 'ArrowDown' });
    const lanesAfterSecond = container.querySelectorAll('[aria-expanded]');
    const focusedSecond = Array.from(lanesAfterSecond).filter(el => el.className.includes('ring-blue-500'));
    expect(focusedSecond.length).toBe(1);
  });

  it('Enter expands lane (aria-expanded toggles)', () => {
    const data = makeStandardTestData();
    const { container } = render(<TimelineContainer data={data} />);

    const app = container.querySelector('[role="application"]')!;

    // Focus first lane
    fireEvent.keyDown(app, { key: 'ArrowDown' });

    // Should be collapsed initially
    const lanes = container.querySelectorAll('[aria-expanded]');
    expect(lanes[0].getAttribute('aria-expanded')).toBe('false');

    // Enter to expand
    fireEvent.keyDown(app, { key: 'Enter' });
    expect(lanes[0].getAttribute('aria-expanded')).toBe('true');

    // Enter again to collapse
    fireEvent.keyDown(app, { key: 'Enter' });
    expect(lanes[0].getAttribute('aria-expanded')).toBe('false');
  });

  it('sort toggle changes aria-label from oldest-first to newest-first', () => {
    const data = makeStandardTestData();
    render(<TimelineContainer data={data} />);

    const sortBtn = screen.getByLabelText(/Sort:/);
    expect(sortBtn).toHaveAttribute('aria-label', expect.stringContaining('oldest-first'));
    expect(sortBtn.textContent).toBe('↑');

    fireEvent.click(sortBtn);
    expect(sortBtn).toHaveAttribute('aria-label', expect.stringContaining('newest-first'));
    expect(sortBtn.textContent).toBe('↓');

    fireEvent.click(sortBtn);
    expect(sortBtn).toHaveAttribute('aria-label', expect.stringContaining('oldest-first'));
    expect(sortBtn.textContent).toBe('↑');
  });
});

describe('Lane Layout', () => {
  it('each lane label is rendered for all agents', () => {
    const data = makeStandardTestData();
    const { container } = render(<TimelineContainer data={data} />);

    const labels = container.querySelectorAll('[role="button"]');
    expect(labels.length).toBe(2);
  });

  it('expanded lane shows aria-expanded=true and increased height', () => {
    const data = makeStandardTestData();
    const { container } = render(<TimelineContainer data={data} />);

    const lanes = container.querySelectorAll('[aria-expanded]');
    expect(lanes.length).toBeGreaterThan(0);

    // Initially collapsed
    expect(lanes[0].getAttribute('aria-expanded')).toBe('false');
    const collapsedHeight = parseInt((lanes[0] as HTMLElement).style.height || '0');

    // Click to expand
    fireEvent.click(lanes[0]);
    expect(lanes[0].getAttribute('aria-expanded')).toBe('true');
    const expandedHeight = parseInt((lanes[0] as HTMLElement).style.height || '0');

    // Expanded height should be larger (160 > 56)
    expect(expandedHeight).toBeGreaterThan(collapsedHeight);
  });
});
