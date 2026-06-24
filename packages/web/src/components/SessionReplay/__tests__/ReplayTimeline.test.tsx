import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReplayTimeline } from '../ReplayTimeline';
import type { ReplayKeyframe } from '../../../hooks/useSessionReplay';

// ── Fixtures ──────────────────────────────────────────────────────────────

const BASE_TIME = new Date('2026-03-20T12:00:00Z').getTime();

function kf(type: ReplayKeyframe['type'], offsetMs: number, agentId?: string, label = ''): ReplayKeyframe {
  return {
    type,
    timestamp: new Date(BASE_TIME + offsetMs).toISOString(),
    agentId,
    label: label || type,
  };
}

const KEYFRAMES: ReplayKeyframe[] = [
  kf('spawn', 0, 'lead-1111', 'Spawned lead'),
  kf('spawn', 1000, 'dev-2222', 'Spawned developer'),
  kf('progress', 5000, 'dev-2222', 'Progress update'),
  kf('agent_exit', 8000, 'dev-2222', 'Developer exited'),
  kf('agent_exit', 10000, 'lead-1111', 'Lead exited'),
];

const DURATION = 10000;

// ── Tests ─────────────────────────────────────────────────────────────────

describe('ReplayTimeline', () => {
  it('renders nothing when keyframes are empty', () => {
    const { container } = render(
      <ReplayTimeline keyframes={[]} duration={0} currentTime={0} onSeek={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a swim lane per agent', () => {
    render(
      <ReplayTimeline keyframes={KEYFRAMES} duration={DURATION} currentTime={0} onSeek={() => {}} />
    );
    expect(screen.getByTestId('replay-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('agent-bar-lead-111')).toBeInTheDocument();
    expect(screen.getByTestId('agent-bar-dev-2222')).toBeInTheDocument();
  });

  it('shows role labels', () => {
    render(
      <ReplayTimeline keyframes={KEYFRAMES} duration={DURATION} currentTime={0} onSeek={() => {}} />
    );
    expect(screen.getByText(/lead/i)).toBeInTheDocument();
    expect(screen.getByText(/developer/i)).toBeInTheDocument();
  });

  it('calls onSeek when clicking on a bar track', () => {
    const onSeek = vi.fn();
    render(
      <ReplayTimeline keyframes={KEYFRAMES} duration={DURATION} currentTime={0} onSeek={onSeek} />
    );
    // Click on the first bar track container
    const bars = screen.getByTestId('agent-bar-lead-111').parentElement!;
    fireEvent.click(bars, { clientX: 50 });
    expect(onSeek).toHaveBeenCalled();
  });

  it('developer bar does not span the full duration', () => {
    render(
      <ReplayTimeline keyframes={KEYFRAMES} duration={DURATION} currentTime={0} onSeek={() => {}} />
    );
    const devBar = screen.getByTestId('agent-bar-dev-2222');
    const style = devBar.style;
    // Developer spawns at 1000ms (10%) and exits at 8000ms (80%) → width ~70%
    expect(parseFloat(style.left)).toBeCloseTo(10, 0);
    expect(parseFloat(style.width)).toBeCloseTo(70, 0);
  });

  it('lead bar spans the full duration', () => {
    render(
      <ReplayTimeline keyframes={KEYFRAMES} duration={DURATION} currentTime={0} onSeek={() => {}} />
    );
    const leadBar = screen.getByTestId('agent-bar-lead-111');
    // Lead spawns at 0 (0%) and exits at 10000ms (100%) → width 100%
    expect(parseFloat(leadBar.style.left)).toBeCloseTo(0, 0);
    expect(parseFloat(leadBar.style.width)).toBeCloseTo(100, 0);
  });

  it('handles agents without exit keyframe (still running)', () => {
    const keyframes: ReplayKeyframe[] = [
      kf('spawn', 0, 'lead-1111', 'Spawned lead'),
      kf('spawn', 2000, 'dev-2222', 'Spawned developer'),
    ];
    render(
      <ReplayTimeline keyframes={keyframes} duration={10000} currentTime={5000} onSeek={() => {}} />
    );
    // Both should render — dev bar extends to full duration since no exit
    expect(screen.getByTestId('agent-bar-lead-111')).toBeInTheDocument();
    expect(screen.getByTestId('agent-bar-dev-2222')).toBeInTheDocument();
    const devBar = screen.getByTestId('agent-bar-dev-2222');
    expect(parseFloat(devBar.style.width)).toBeCloseTo(80, 0);
  });
});
