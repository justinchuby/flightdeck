import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatusBar } from '../StatusBar';
import type { ConnectionHealth } from '../StatusBar';
import type { TimelineData, TimelineSegment, TimelineAgent } from '../useTimelineData';

// ── Test helpers ──────────────────────────────────────────────────────

const BASE_TIME = new Date('2026-03-01T10:00:00Z').getTime();
function ts(offsetSec: number): string {
  return new Date(BASE_TIME + offsetSec * 1000).toISOString();
}

function makeSegment(status: TimelineSegment['status'], start: number, end?: number): TimelineSegment {
  return { status, startAt: ts(start), endAt: end != null ? ts(end) : undefined };
}

function makeAgent(id: string, role: string, segments: TimelineSegment[]): TimelineAgent {
  return {
    id,
    shortId: id.slice(0, 8),
    role,
    createdAt: segments[0]?.startAt ?? ts(0),
    segments,
  };
}

function makeData(agents: TimelineAgent[]): TimelineData {
  return {
    agents,
    communications: [],
    locks: [],
    timeRange: { start: ts(0), end: ts(300) },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('StatusBar', () => {
  it('renders with role="status" and aria-live="polite"', () => {
    render(<StatusBar data={null} />);
    const bar = screen.getByTestId('status-bar');
    expect(bar).toHaveAttribute('role', 'status');
    expect(bar).toHaveAttribute('aria-live', 'polite');
  });

  it('shows "Healthy" when all agents are running', () => {
    const data = makeData([
      makeAgent('a1', 'lead', [makeSegment('running', 0)]),
      makeAgent('a2', 'developer', [makeSegment('running', 10)]),
    ]);

    render(<StatusBar data={data} />);
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('shows "Errors detected" when agents have failed', () => {
    const data = makeData([
      makeAgent('a1', 'lead', [makeSegment('running', 0)]),
      makeAgent('a2', 'developer', [makeSegment('failed', 10, 20)]),
    ]);

    render(<StatusBar data={data} />);
    expect(screen.getByText('Errors detected')).toBeInTheDocument();
  });

  it('shows "Attention needed" when agents are terminated', () => {
    const data = makeData([
      makeAgent('a1', 'lead', [makeSegment('running', 0)]),
      makeAgent('a2', 'developer', [makeSegment('terminated', 10, 20)]),
    ]);

    render(<StatusBar data={data} />);
    expect(screen.getByText('Attention needed')).toBeInTheDocument();
  });

  it('displays correct status bucket counts', () => {
    const data = makeData([
      makeAgent('a1', 'lead', [makeSegment('running', 0)]),
      makeAgent('a2', 'developer', [makeSegment('running', 5)]),
      makeAgent('a3', 'developer', [makeSegment('idle', 10, 20)]),
      makeAgent('a4', 'code-reviewer', [makeSegment('completed', 30, 40)]),
    ]);

    render(<StatusBar data={data} />);
    expect(screen.getByText('2 Running')).toBeInTheDocument();
    expect(screen.getByText('1 Idle')).toBeInTheDocument();
    expect(screen.getByText('1 Done')).toBeInTheDocument();
  });

  it('shows error count as clickable link', () => {
    const onErrorClick = vi.fn();
    const data = makeData([
      makeAgent('a1', 'dev', [makeSegment('failed', 0, 10)]),
      makeAgent('a2', 'dev', [makeSegment('failed', 5, 15)]),
    ]);

    render(<StatusBar data={data} onErrorClick={onErrorClick} />);
    const errorBtn = screen.getByRole('button', { name: /2 errors/i });
    expect(errorBtn).toBeInTheDocument();

    fireEvent.click(errorBtn);
    expect(onErrorClick).toHaveBeenCalledTimes(1);
  });

  it('error count button has aria-live="assertive"', () => {
    const data = makeData([
      makeAgent('a1', 'dev', [makeSegment('failed', 0, 10)]),
    ]);

    render(<StatusBar data={data} />);
    const errorBtn = screen.getByRole('button', { name: /1 error/i });
    expect(errorBtn).toHaveAttribute('aria-live', 'assertive');
  });

  it('does not show error button when no errors', () => {
    const data = makeData([
      makeAgent('a1', 'lead', [makeSegment('running', 0)]),
    ]);

    render(<StatusBar data={data} />);
    expect(screen.queryByRole('button', { name: /error/i })).not.toBeInTheDocument();
  });

  describe('connection health', () => {
    const connectionStates: ConnectionHealth[] = [
      'connected',
      'connecting',
      'reconnecting',
      'degraded',
      'offline',
    ];

    it.each(connectionStates)('shows connection state: %s', (health) => {
      render(<StatusBar data={null} connectionHealth={health} />);
      const labels: Record<ConnectionHealth, string> = {
        connected: 'Connected',
        connecting: 'Connecting…',
        reconnecting: 'Reconnecting…',
        degraded: 'Degraded',
        offline: 'Offline',
      };
      expect(screen.getByText(labels[health])).toBeInTheDocument();
    });

    it('shows red health when offline', () => {
      render(<StatusBar data={null} connectionHealth="offline" />);
      expect(screen.getByText('Errors detected')).toBeInTheDocument();
    });

    it('shows yellow health when degraded', () => {
      const data = makeData([
        makeAgent('a1', 'lead', [makeSegment('running', 0)]),
      ]);
      render(<StatusBar data={data} connectionHealth="degraded" />);
      expect(screen.getByText('Attention needed')).toBeInTheDocument();
    });
  });

  describe('narrative sentence', () => {
    it('shows "All systems normal" when no errors', () => {
      const data = makeData([
        makeAgent('a1', 'lead', [makeSegment('running', 0)]),
        makeAgent('a2', 'developer', [makeSegment('running', 5)]),
      ]);

      render(<StatusBar data={data} />);
      expect(screen.getByText(/2 active agents.*All systems normal/)).toBeInTheDocument();
    });

    it('shows error count in narrative when errors exist', () => {
      const data = makeData([
        makeAgent('a1', 'lead', [makeSegment('running', 0)]),
        makeAgent('a2', 'developer', [makeSegment('failed', 5, 15)]),
      ]);

      render(<StatusBar data={data} />);
      expect(screen.getByText(/1 active agent.*1 error needs attention/)).toBeInTheDocument();
    });
  });

  describe('new event badge', () => {
    it('shows "N new" badge when newEventCount > 0', () => {
      render(<StatusBar data={null} newEventCount={5} />);
      expect(screen.getByText('5 new')).toBeInTheDocument();
    });

    it('does not show badge when newEventCount is 0', () => {
      render(<StatusBar data={null} newEventCount={0} />);
      expect(screen.queryByText(/new/)).not.toBeInTheDocument();
    });
  });

  it('handles null data gracefully', () => {
    const { container } = render(<StatusBar data={null} />);
    expect(container).toBeTruthy();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });
});
