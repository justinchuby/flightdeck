// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { UseSessionReplayResult, ReplayKeyframe } from '../../../hooks/useSessionReplay';

// jsdom doesn't implement pointer capture
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
}

const mockPlay = vi.fn();
const mockPause = vi.fn();
const mockSeek = vi.fn();
const mockSetSpeed = vi.fn();

const baseReplay: UseSessionReplayResult = {
  keyframes: [],
  worldState: null,
  playing: false,
  currentTime: 0,
  duration: 0,
  loading: false,
  error: null,
  play: mockPlay,
  pause: mockPause,
  seek: mockSeek,
  setSpeed: mockSetSpeed,
  speed: 4,
};

vi.mock('../../../hooks/useSessionReplay', () => ({
  useSessionReplay: () => baseReplay,
}));

import { ReplayScrubber } from '../ReplayScrubber';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('ReplayScrubber – extra coverage', () => {
  it('shows error message when error is set (not live mode)', () => {
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{ ...baseReplay, error: 'Connection failed' }}
      />,
    );
    expect(screen.getByText(/Replay unavailable: Connection failed/)).toBeInTheDocument();
  });

  it('shows empty state when no keyframes and not live', () => {
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{ ...baseReplay, keyframes: [], duration: 0 }}
      />,
    );
    expect(screen.getByText(/No replay data available/)).toBeInTheDocument();
  });

  it('does NOT show error state when in live mode', () => {
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{ ...baseReplay, error: 'Connection failed' }}
        liveMode
      />,
    );
    expect(screen.queryByText(/Replay unavailable/)).not.toBeInTheDocument();
  });

  it('does NOT show empty state when in live mode', () => {
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{ ...baseReplay, keyframes: [], duration: 0 }}
        liveMode
      />,
    );
    expect(screen.queryByText(/No replay data/)).not.toBeInTheDocument();
  });

  it('renders world state summary with agents', () => {
    const worldState = {
      agents: [
        { id: 'a1', status: 'running' },
        { id: 'a2', status: 'running' },
        { id: 'a3', status: 'idle' },
      ],
      dagTasks: [
        { id: 't1', dagStatus: 'done' },
        { id: 't2', dagStatus: 'done' },
        { id: 't3', dagStatus: 'done' },
        { id: 't4', dagStatus: 'done' },
        { id: 't5', dagStatus: 'done' },
        { id: 't6', dagStatus: 'running' },
        { id: 't7', dagStatus: 'running' },
        { id: 't8', dagStatus: 'pending' },
        { id: 't9', dagStatus: 'pending' },
        { id: 't10', dagStatus: 'pending' },
      ],
      decisions: [],
    };
    const kf: ReplayKeyframe[] = [
      { type: 'spawn', timestamp: '2024-01-01T00:00:00Z', label: 'A', agentId: 'a1' },
      { type: 'spawn', timestamp: '2024-01-01T00:01:00Z', label: 'B', agentId: 'a2' },
    ];
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{ ...baseReplay, keyframes: kf, worldState: worldState as any, duration: 60000 }}
      />,
    );
    expect(screen.getByText('3 agents')).toBeInTheDocument();
    expect(screen.getByText('2 running')).toBeInTheDocument();
    expect(screen.getByText('5/10 tasks')).toBeInTheDocument();
  });

  it('renders pending decisions in world state', () => {
    const worldState = {
      agents: [{ id: 'a1', status: 'running' }],
      dagTasks: [],
      decisions: [
        { id: 'd1', title: 'D1', status: 'pending' },
        { id: 'd2', title: 'D2', status: 'pending' },
        { id: 'd3', title: 'D3', status: 'pending' },
      ],
    };
    const kf: ReplayKeyframe[] = [
      { type: 'spawn', timestamp: '2024-01-01T00:00:00Z', label: 'A', agentId: 'a1' },
      { type: 'decision', timestamp: '2024-01-01T00:01:00Z', label: 'D', agentId: 'a1' },
    ];
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{ ...baseReplay, keyframes: kf, worldState: worldState as any, duration: 60000 }}
      />,
    );
    expect(screen.getByText('3 pending')).toBeInTheDocument();
  });

  it('does not show tasks when dagTasks is empty', () => {
    const worldState = {
      agents: [{ id: 'a1', status: 'idle' }],
      dagTasks: [],
      decisions: [],
    };
    const kf: ReplayKeyframe[] = [
      { type: 'spawn', timestamp: '2024-01-01T00:00:00Z', label: 'A', agentId: 'a1' },
      { type: 'milestone', timestamp: '2024-01-01T00:01:00Z', label: 'M', agentId: 'a1' },
    ];
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{ ...baseReplay, keyframes: kf, worldState: worldState as any, duration: 60000 }}
      />,
    );
    expect(screen.queryByText(/tasks/)).not.toBeInTheDocument();
  });

  it('pointer down calls onExitLive when in live mode', () => {
    const onExitLive = vi.fn();
    const kf: ReplayKeyframe[] = [
      { type: 'spawn', timestamp: '2024-01-01T00:00:00Z', label: 'A', agentId: 'a1' },
      { type: 'spawn', timestamp: '2024-01-01T00:01:00Z', label: 'B', agentId: 'a2' },
    ];
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{ ...baseReplay, keyframes: kf, duration: 60000 }}
        liveMode
        onExitLive={onExitLive}
      />,
    );

    const slider = screen.getByRole('slider');
    fireEvent.pointerDown(slider, { clientX: 100, pointerId: 1 });
    expect(onExitLive).toHaveBeenCalled();
  });

  it('pointer down pauses playback when playing', () => {
    const kf: ReplayKeyframe[] = [
      { type: 'spawn', timestamp: '2024-01-01T00:00:00Z', label: 'A', agentId: 'a1' },
      { type: 'spawn', timestamp: '2024-01-01T00:01:00Z', label: 'B', agentId: 'a2' },
    ];
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{ ...baseReplay, keyframes: kf, duration: 60000, playing: true }}
      />,
    );

    const slider = screen.getByRole('slider');
    fireEvent.pointerDown(slider, { clientX: 100, pointerId: 1 });
    expect(mockPause).toHaveBeenCalled();
    expect(mockSeek).toHaveBeenCalled();
  });

  it('pointer move calls seek when dragging', () => {
    const kf: ReplayKeyframe[] = [
      { type: 'spawn', timestamp: '2024-01-01T00:00:00Z', label: 'A', agentId: 'a1' },
      { type: 'spawn', timestamp: '2024-01-01T00:01:00Z', label: 'B', agentId: 'a2' },
    ];
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{ ...baseReplay, keyframes: kf, duration: 60000 }}
      />,
    );

    const slider = screen.getByRole('slider');
    // Start drag
    fireEvent.pointerDown(slider, { clientX: 50, pointerId: 1 });
    mockSeek.mockClear();
    // Move
    fireEvent.pointerMove(slider, { clientX: 150 });
    expect(mockSeek).toHaveBeenCalled();
  });

  it('pointer up resumes play if was playing', () => {
    const kf: ReplayKeyframe[] = [
      { type: 'spawn', timestamp: '2024-01-01T00:00:00Z', label: 'A', agentId: 'a1' },
      { type: 'spawn', timestamp: '2024-01-01T00:01:00Z', label: 'B', agentId: 'a2' },
    ];
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{ ...baseReplay, keyframes: kf, duration: 60000, playing: true }}
      />,
    );

    const slider = screen.getByRole('slider');
    fireEvent.pointerDown(slider, { clientX: 50, pointerId: 1 });
    mockPlay.mockClear();
    fireEvent.pointerUp(slider);
    expect(mockPlay).toHaveBeenCalled();
  });

  it('pointer move without drag does nothing', () => {
    const kf: ReplayKeyframe[] = [
      { type: 'spawn', timestamp: '2024-01-01T00:00:00Z', label: 'A', agentId: 'a1' },
      { type: 'spawn', timestamp: '2024-01-01T00:01:00Z', label: 'B', agentId: 'a2' },
    ];
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{ ...baseReplay, keyframes: kf, duration: 60000 }}
      />,
    );

    const slider = screen.getByRole('slider');
    mockSeek.mockClear();
    // Move without prior down
    fireEvent.pointerMove(slider, { clientX: 150 });
    expect(mockSeek).not.toHaveBeenCalled();
  });

  it('renders live mode UI with LIVE indicator', () => {
    const kf: ReplayKeyframe[] = [
      { type: 'spawn', timestamp: '2024-01-01T00:00:00Z', label: 'A', agentId: 'a1' },
      { type: 'spawn', timestamp: '2024-01-01T00:01:00Z', label: 'B', agentId: 'a2' },
    ];
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{ ...baseReplay, keyframes: kf, duration: 60000 }}
        liveMode
      />,
    );
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.getByText(/Click timeline to replay/)).toBeInTheDocument();
  });

  it('renders Go Live button in replay mode when onGoLive provided', () => {
    const onGoLive = vi.fn();
    const kf: ReplayKeyframe[] = [
      { type: 'spawn', timestamp: '2024-01-01T00:00:00Z', label: 'A', agentId: 'a1' },
      { type: 'spawn', timestamp: '2024-01-01T00:01:00Z', label: 'B', agentId: 'a2' },
    ];
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{ ...baseReplay, keyframes: kf, duration: 60000, currentTime: 30000 }}
        onGoLive={onGoLive}
      />,
    );
    const liveBtn = screen.getByText('Live');
    fireEvent.click(liveBtn);
    expect(mockPause).toHaveBeenCalled();
    expect(onGoLive).toHaveBeenCalled();
  });
});
