// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { UseSessionReplayResult, ReplayKeyframe } from '../../../hooks/useSessionReplay';

/* ------------------------------------------------------------------ */
/*  Mocks                                                             */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Import after mocks                                                */
/* ------------------------------------------------------------------ */
import { ReplayScrubber } from '../ReplayScrubber';

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('ReplayScrubber', () => {
  /* 1 ─ Loading state */
  it('shows loading spinner when loading', () => {
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{ ...baseReplay, loading: true }}
      />,
    );
    expect(screen.getByText(/Loading session replay/)).toBeDefined();
  });

  /* 2 ─ Error state */
  it('shows error message when error occurs', () => {
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{ ...baseReplay, error: 'Network failure' }}
      />,
    );
    expect(screen.getByText(/Replay unavailable: Network failure/)).toBeDefined();
  });

  /* 3 ─ Empty keyframes */
  it('shows empty state when no keyframes', () => {
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{ ...baseReplay, keyframes: [] }}
      />,
    );
    expect(screen.getByText(/No replay data available/)).toBeDefined();
  });

  /* 4 ─ Normal render with keyframes */
  it('renders scrubber controls with keyframes', () => {
    const keyframes: ReplayKeyframe[] = [
      { timestamp: '2026-01-01T00:00:00Z', label: 'Start', type: 'spawn' },
      { timestamp: '2026-01-01T00:05:00Z', label: 'Task done', type: 'task' },
    ];
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{
          ...baseReplay,
          keyframes,
          duration: 300000,
          currentTime: 60000,
        }}
      />,
    );

    expect(screen.getByTestId('replay-scrubber')).toBeDefined();
    // Time display: 1:00 / 5:00
    expect(screen.getByText('1:00')).toBeDefined();
    expect(screen.getByText('5:00')).toBeDefined();
    // Play/Pause button
    expect(screen.getByTitle('Play')).toBeDefined();
    // Skip buttons
    expect(screen.getByTitle('Back 5s')).toBeDefined();
    expect(screen.getByTitle('Forward 5s')).toBeDefined();
  });

  /* 5 ─ Play button calls play() */
  it('calls play when play button is clicked', () => {
    const keyframes: ReplayKeyframe[] = [
      { timestamp: '2026-01-01T00:00:00Z', label: 'Start', type: 'spawn' },
      { timestamp: '2026-01-01T00:05:00Z', label: 'End', type: 'task' },
    ];
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{ ...baseReplay, keyframes, duration: 300000 }}
      />,
    );

    fireEvent.click(screen.getByTitle('Play'));
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });

  /* 6 ─ Pause button when playing */
  it('calls pause when pause button is clicked while playing', () => {
    const keyframes: ReplayKeyframe[] = [
      { timestamp: '2026-01-01T00:00:00Z', label: 'Start', type: 'spawn' },
      { timestamp: '2026-01-01T00:05:00Z', label: 'End', type: 'task' },
    ];
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{ ...baseReplay, keyframes, duration: 300000, playing: true }}
      />,
    );

    expect(screen.getByTitle('Pause')).toBeDefined();
    fireEvent.click(screen.getByTitle('Pause'));
    expect(mockPause).toHaveBeenCalledTimes(1);
  });

  /* 7 ─ Skip back calls seek */
  it('calls seek with reduced time on skip back', () => {
    const keyframes: ReplayKeyframe[] = [
      { timestamp: '2026-01-01T00:00:00Z', label: 'Start', type: 'spawn' },
      { timestamp: '2026-01-01T00:05:00Z', label: 'End', type: 'task' },
    ];
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{
          ...baseReplay,
          keyframes,
          duration: 300000,
          currentTime: 10000,
        }}
      />,
    );

    fireEvent.click(screen.getByTitle('Back 5s'));
    expect(mockSeek).toHaveBeenCalledWith(5000); // 10000 - 5000
  });

  /* 8 ─ Skip forward calls seek */
  it('calls seek with increased time on skip forward', () => {
    const keyframes: ReplayKeyframe[] = [
      { timestamp: '2026-01-01T00:00:00Z', label: 'Start', type: 'spawn' },
      { timestamp: '2026-01-01T00:05:00Z', label: 'End', type: 'task' },
    ];
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{
          ...baseReplay,
          keyframes,
          duration: 300000,
          currentTime: 10000,
        }}
      />,
    );

    fireEvent.click(screen.getByTitle('Forward 5s'));
    expect(mockSeek).toHaveBeenCalledWith(15000); // 10000 + 5000
  });

  /* 9 ─ Speed selector */
  it('renders speed options and clicking sets speed', () => {
    const keyframes: ReplayKeyframe[] = [
      { timestamp: '2026-01-01T00:00:00Z', label: 'Start', type: 'spawn' },
      { timestamp: '2026-01-01T00:05:00Z', label: 'End', type: 'task' },
    ];
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{ ...baseReplay, keyframes, duration: 300000 }}
      />,
    );

    // Speed options: 4, 8, 16, 32, 64, 120, 240, 720
    const btn16 = screen.getByText('16×');
    expect(btn16).toBeDefined();
    fireEvent.click(btn16);
    expect(mockSetSpeed).toHaveBeenCalledWith(16);
  });

  /* 10 ─ World state summary */
  it('renders world state summary when provided', () => {
    const keyframes: ReplayKeyframe[] = [
      { timestamp: '2026-01-01T00:00:00Z', label: 'Start', type: 'spawn' },
      { timestamp: '2026-01-01T00:05:00Z', label: 'End', type: 'task' },
    ];
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{
          ...baseReplay,
          keyframes,
          duration: 300000,
          worldState: {
            timestamp: '2026-01-01T00:02:00Z',
            agents: [
              { id: 'a1', role: 'dev', status: 'running' },
              { id: 'a2', role: 'arch', status: 'idle' },
            ],
            pendingDecisions: 1,
            completedTasks: 3,
            totalTasks: 5,
          },
        }}
      />,
    );

    expect(screen.getByText('2 agents')).toBeDefined();
    expect(screen.getByText('1 running')).toBeDefined();
    expect(screen.getByText('3/5 tasks')).toBeDefined();
    expect(screen.getByText('1 pending')).toBeDefined();
  });

  /* 11 ─ Live mode */
  it('shows LIVE indicator in live mode', () => {
    const keyframes: ReplayKeyframe[] = [
      { timestamp: '2026-01-01T00:00:00Z', label: 'Start', type: 'spawn' },
      { timestamp: '2026-01-01T00:05:00Z', label: 'End', type: 'task' },
    ];
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{ ...baseReplay, keyframes, duration: 300000 }}
        liveMode
      />,
    );

    expect(screen.getByText('LIVE')).toBeDefined();
    expect(screen.getByText(/Click timeline to replay/)).toBeDefined();
  });

  /* 12 ─ Slider aria attributes */
  it('renders slider with correct aria attributes', () => {
    const keyframes: ReplayKeyframe[] = [
      { timestamp: '2026-01-01T00:00:00Z', label: 'Start', type: 'spawn' },
      { timestamp: '2026-01-01T00:05:00Z', label: 'End', type: 'task' },
    ];
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{
          ...baseReplay,
          keyframes,
          duration: 300000,
          currentTime: 60000,
        }}
      />,
    );

    const slider = screen.getByRole('slider');
    expect(slider).toBeDefined();
    expect(slider.getAttribute('aria-label')).toBe('Session timeline scrubber');
    expect(slider.getAttribute('aria-valuemin')).toBe('0');
    expect(slider.getAttribute('aria-valuemax')).toBe('300000');
    expect(slider.getAttribute('aria-valuenow')).toBe('60000');
  });

  /* 13 ─ Go Live button */
  it('shows Go Live button in replay mode with onGoLive prop', () => {
    const onGoLive = vi.fn();
    const keyframes: ReplayKeyframe[] = [
      { timestamp: '2026-01-01T00:00:00Z', label: 'Start', type: 'spawn' },
      { timestamp: '2026-01-01T00:05:00Z', label: 'End', type: 'task' },
    ];
    render(
      <ReplayScrubber
        leadId="lead-1"
        replay={{ ...baseReplay, keyframes, duration: 300000 }}
        onGoLive={onGoLive}
      />,
    );

    const liveBtn = screen.getByTitle('Return to live view');
    expect(liveBtn).toBeDefined();
    fireEvent.click(liveBtn);
    expect(mockPause).toHaveBeenCalled();
    expect(onGoLive).toHaveBeenCalled();
  });
});
