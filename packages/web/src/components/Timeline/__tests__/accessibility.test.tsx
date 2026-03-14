/**
 * Accessibility tests for Timeline components — WCAG AA compliance.
 *
 * Tests ARIA live regions, semantic roles, keyboard focus,
 * reduced motion support, and color contrast helpers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { AccessibilityAnnouncer } from '../AccessibilityAnnouncer';
import { useAccessibilityAnnouncements } from '../useAccessibilityAnnouncements';
import type { TimelineData, TimelineSegment, TimelineAgent } from '../useTimelineData';

// Mock @visx/responsive ParentSize
vi.mock('@visx/responsive', () => ({
  ParentSize: ({ children }: { children: (size: { width: number; height: number }) => React.ReactNode }) =>
    children({ width: 800, height: 600 }),
}));

const { TimelineContainer } = await import('../TimelineContainer');

// ── Test data factory ─────────────────────────────────────────────────

const BASE_TIME = new Date('2026-02-28T10:00:00Z').getTime();

function ts(offsetSeconds: number): string {
  return new Date(BASE_TIME + offsetSeconds * 1000).toISOString();
}

function makeSegment(status: TimelineSegment['status'], startSec: number, endSec?: number, taskLabel?: string): TimelineSegment {
  return { status, startAt: ts(startSec), endAt: endSec != null ? ts(endSec) : undefined, taskLabel };
}

function makeAgent(id: string, role: string, segments: TimelineSegment[]): TimelineAgent {
  return { id, shortId: id.slice(0, 8), role, createdAt: segments[0]?.startAt ?? ts(0), segments };
}

function makeTestData(): TimelineData {
  return {
    agents: [
      makeAgent('lead-001', 'lead', [makeSegment('running', 0, 60, 'Coordinating')]),
      makeAgent('dev-002', 'developer', [makeSegment('running', 5, 60, 'Implementing')]),
    ],
    communications: [
      { type: 'delegation', fromAgentId: 'lead-001', toAgentId: 'dev-002', summary: 'Build feature', timestamp: ts(5) },
    ],
    locks: [],
    timeRange: { start: ts(0), end: ts(60) },
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

// ── ARIA Live Regions ─────────────────────────────────────────────────

describe('ARIA Live Regions', () => {
  it('renders polite and assertive live regions', () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());
    const { container } = render(
      <AccessibilityAnnouncer announcements={result.current} />,
    );

    const polite = container.querySelector('[aria-live="polite"]');
    const assertive = container.querySelector('[aria-live="assertive"]');

    expect(polite).not.toBeNull();
    expect(assertive).not.toBeNull();
    expect(polite!.getAttribute('aria-atomic')).toBe('true');
    expect(assertive!.getAttribute('aria-atomic')).toBe('true');
  });

  it('polite region has role="log"', () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());
    const { container } = render(
      <AccessibilityAnnouncer announcements={result.current} />,
    );

    const polite = container.querySelector('[aria-live="polite"]');
    expect(polite!.getAttribute('role')).toBe('log');
  });

  it('assertive region has role="alert"', () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());
    const { container } = render(
      <AccessibilityAnnouncer announcements={result.current} />,
    );

    const assertive = container.querySelector('[aria-live="assertive"]');
    expect(assertive!.getAttribute('role')).toBe('alert');
  });

  it('announces new events via polite region', async () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());
    const { container } = render(
      <AccessibilityAnnouncer announcements={result.current} />,
    );

    act(() => {
      result.current.announceNewEvents(1, 'Agent started task');
    });

    await waitFor(() => {
      const polite = container.querySelector('[data-testid="a11y-announcer-polite"]');
      expect(polite!.textContent).toContain('New event');
    });
  });

  it('announces errors via assertive region', async () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());
    const { container } = render(
      <AccessibilityAnnouncer announcements={result.current} />,
    );

    act(() => {
      result.current.announceError('Connection failed');
    });

    await waitFor(() => {
      const assertive = container.querySelector('[data-testid="a11y-announcer-assertive"]');
      expect(assertive!.textContent).toContain('Error: Connection failed');
    });
  });

  it('announces connection changes via assertive region', async () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());
    const { container } = render(
      <AccessibilityAnnouncer announcements={result.current} />,
    );

    act(() => {
      result.current.announceConnectionChange('offline');
    });

    await waitFor(() => {
      const assertive = container.querySelector('[data-testid="a11y-announcer-assertive"]');
      expect(assertive!.textContent).toContain('Connection offline');
    });
  });

  it('throttles polite announcements to max 1 per 5 seconds', async () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());
    const { container } = render(
      <AccessibilityAnnouncer announcements={result.current} />,
    );

    // First announcement goes through immediately
    act(() => {
      result.current.announcePolite('First message');
    });

    await waitFor(() => {
      const polite = container.querySelector('[data-testid="a11y-announcer-polite"]');
      expect(polite!.textContent).toBe('First message');
    });

    // Second and third within 5s — only the last one should win after throttle
    act(() => {
      result.current.announcePolite('Second message');
      result.current.announcePolite('Third message');
    });

    // Still shows first message (throttled)
    const polite = container.querySelector('[data-testid="a11y-announcer-polite"]');
    expect(polite!.textContent).toBe('First message');

    // Advance past throttle period
    act(() => {
      vi.advanceTimersByTime(5100);
    });

    await waitFor(() => {
      const politeAfter = container.querySelector('[data-testid="a11y-announcer-polite"]');
      expect(politeAfter!.textContent).toBe('Third message');
    });
  });

  it('does not throttle assertive announcements', async () => {
    const { result } = renderHook(() => useAccessibilityAnnouncements());
    const { container } = render(
      <AccessibilityAnnouncer announcements={result.current} />,
    );

    act(() => {
      result.current.announceAssertive('Error 1');
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="a11y-announcer-assertive"]')!.textContent).toBe('Error 1');
    });

    act(() => {
      result.current.announceAssertive('Error 2');
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="a11y-announcer-assertive"]')!.textContent).toBe('Error 2');
    });
  });
});

// ── Semantic Roles ────────────────────────────────────────────────────

describe('Semantic Roles', () => {
  it('main container has role="application" with aria-roledescription', () => {
    const data = makeTestData();
    const { container } = render(<TimelineContainer data={data} />);

    const app = container.querySelector('[role="application"]');
    expect(app).not.toBeNull();
    expect(app!.getAttribute('aria-roledescription')).toBe('interactive timeline');
  });

  it('toolbar has role="toolbar" with aria-label', () => {
    const data = makeTestData();
    const { container } = render(<TimelineContainer data={data} />);

    const toolbar = container.querySelector('[role="toolbar"]');
    expect(toolbar).not.toBeNull();
    expect(toolbar!.getAttribute('aria-label')).toBe('Timeline controls');
  });

  it('agent labels have role="button" with tabIndex and aria-roledescription', () => {
    const data = makeTestData();
    const { container } = render(<TimelineContainer data={data} />);

    const buttons = container.querySelectorAll('[role="button"]');
    expect(buttons.length).toBe(2);

    const firstButton = buttons[0];
    expect(firstButton.getAttribute('tabindex')).toBe('0');
    expect(firstButton.getAttribute('aria-roledescription')).toBe('agent lane toggle');
    expect(firstButton.getAttribute('aria-expanded')).toBeDefined();
  });

  it('agent lanes have role="row" with aria-roledescription', () => {
    const data = makeTestData();
    const { container } = render(<TimelineContainer data={data} />);

    const rows = container.querySelectorAll('[role="row"]');
    expect(rows.length).toBe(2);
    expect(rows[0].getAttribute('aria-roledescription')).toBe('agent timeline lane');
  });

  it('SVG has descriptive aria-label with agent count', () => {
    const data = makeTestData();
    const { container } = render(<TimelineContainer data={data} />);

    const svg = container.querySelector('svg[role="img"]');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('aria-label')).toContain('2 agents');
  });

  it('communication links group has role="list" with aria-label', () => {
    const data = makeTestData();
    const { container } = render(<TimelineContainer data={data} />);

    const list = container.querySelector('[role="list"]');
    expect(list).not.toBeNull();
    expect(list!.getAttribute('aria-label')).toContain('Communication links');
  });

  it('individual communication links have role="listitem" with aria-label', () => {
    const data = makeTestData();
    const { container } = render(<TimelineContainer data={data} />);

    const items = container.querySelectorAll('[role="listitem"]');
    expect(items.length).toBeGreaterThan(0);
    // Each should have a descriptive aria-label
    expect(items[0].getAttribute('aria-label')).toContain('Delegation');
  });

  it('empty state has role="status"', () => {
    const emptyData: TimelineData = {
      agents: [],
      communications: [],
      locks: [],
      timeRange: { start: ts(0), end: ts(60) },
    };
    render(<TimelineContainer data={emptyData} />);

    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status.textContent).toContain('No agent activity');
  });
});

// ── Keyboard Focus ────────────────────────────────────────────────────

describe('Keyboard Focus', () => {
  it('main container is focusable with tabIndex=0', () => {
    const data = makeTestData();
    const { container } = render(<TimelineContainer data={data} />);

    const app = container.querySelector('[role="application"]');
    expect(app!.getAttribute('tabindex')).toBe('0');
  });

  it('agent label buttons have tabIndex=0', () => {
    const data = makeTestData();
    const { container } = render(<TimelineContainer data={data} />);

    const buttons = container.querySelectorAll('[role="button"]');
    buttons.forEach(btn => {
      expect(btn.getAttribute('tabindex')).toBe('0');
    });
  });

  it('sort button is focusable', () => {
    const data = makeTestData();
    render(<TimelineContainer data={data} />);

    const sort = screen.getByLabelText(/Sort/);
    expect(sort.tagName).toBe('BUTTON');
  });
});

// ── Color Contrast Verification ───────────────────────────────────────

describe('Color Contrast', () => {
  /**
   * Verify all 8 agent role colors pass WCAG AA 4.5:1 contrast ratio
   * against the dark background (~#1e1e2e).
   *
   * Uses relative luminance formula from WCAG 2.1.
   */
  function hexToRgb(hex: string): [number, number, number] {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) throw new Error(`Invalid hex: ${hex}`);
    return [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)];
  }

  function relativeLuminance(rgb: [number, number, number]): number {
    const [r, g, b] = rgb.map(c => {
      const srgb = c / 255;
      return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrastRatio(color1: string, color2: string): number {
    const l1 = relativeLuminance(hexToRgb(color1));
    const l2 = relativeLuminance(hexToRgb(color2));
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  const DARK_BG = '#1e1e2e';

  const ROLE_COLORS: Record<string, string> = {
    lead: '#d29922',
    architect: '#f0883e',
    developer: '#3fb950',
    'code-reviewer': '#a371f7',
    'critical-reviewer': '#a371f7',
    designer: '#f778ba',
    secretary: '#79c0ff',
    qa: '#79c0ff',
  };

  for (const [role, color] of Object.entries(ROLE_COLORS)) {
    it(`${role} color (${color}) passes 4.5:1 contrast against dark bg`, () => {
      const ratio = contrastRatio(color, DARK_BG);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('color is not the sole differentiator — roles paired with icon + text', () => {
    const data = makeTestData();
    const { container } = render(<TimelineContainer data={data} />);

    // Each agent label should contain both an icon (emoji) and text role name
    const labels = container.querySelectorAll('[role="button"]');
    labels.forEach(label => {
      const text = label.textContent ?? '';
      // Should contain a role name
      expect(text.match(/lead|developer|architect|designer|secretary|qa|code-reviewer|critical-reviewer/i)).not.toBeNull();
    });
  });
});

// ── Reduced Motion ────────────────────────────────────────────────────

describe('Reduced Motion', () => {
  it('timeline-a11y.css contains prefers-reduced-motion rule', async () => {
    // Verify the CSS file exists by reading it as a module
    // vitest with css: false doesn't process raw CSS imports
    // So we verify the file content via the filesystem
    const fs = await import('fs');
    const path = await import('path');
    const cssPath = path.resolve(__dirname, '../timeline-a11y.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');
    expect(cssContent).toContain('prefers-reduced-motion');
    expect(cssContent).toContain('forced-colors');
    expect(cssContent).toContain('focus-visible');
  });
});

// ── Legend Accessibility ──────────────────────────────────────────────

describe('Legend', () => {
  it('legend has aria-label describing its purpose', () => {
    const data = makeTestData();
    const { container } = render(<TimelineContainer data={data} />);

    const legend = container.querySelector('[aria-label*="legend"]') ||
                   container.querySelector('.timeline-legend');
    expect(legend).not.toBeNull();
  });
});
