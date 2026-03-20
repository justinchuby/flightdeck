import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ShareableReplay } from '../types';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockPlay = vi.fn();
const mockPause = vi.fn();
const mockSeek = vi.fn();
const mockSetSpeed = vi.fn();

let mockHookReturn: Record<string, unknown> = {};

vi.mock('../../../hooks/useSharedReplay', () => ({
  useSharedReplay: () => mockHookReturn,
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ token: 'abc-123' }),
  useSearchParams: () => [new URLSearchParams()],
}));

vi.mock('../AnnotationPin', () => ({
  AnnotationPin: ({ annotation, onClick }: { annotation: { id: string; text: string }; onClick: () => void }) => (
    <div data-testid={`annotation-${annotation.id}`} onClick={onClick}>
      {annotation.text}
    </div>
  ),
}));

vi.mock('../ReplayContent', () => ({
  ReplayContent: ({ worldState, loading }: { worldState: unknown; loading?: boolean }) => (
    <div data-testid="replay-content-mock">
      {loading ? 'loading' : worldState ? 'content' : 'empty'}
    </div>
  ),
}));

import { SharedReplayViewer } from '../SharedReplayViewer';

// ── Fixtures ──────────────────────────────────────────────────────────────

const baseSharedData = {
  leadId: 'lead-1',
  label: 'Test label',
  expiresAt: '2026-12-31T00:00:00Z',
  keyframes: [
    { timestamp: '2024-01-01T00:00:00Z', label: 'Start', type: 'spawn' },
    { timestamp: '2024-01-01T00:10:00Z', label: 'End', type: 'milestone' },
  ],
  // ShareableReplay fields for metadata display
  title: 'Test Session Replay',
  createdAt: '2024-01-01T00:00:00Z',
  createdBy: 'alice',
  annotations: [] as ShareableReplay['annotations'],
  highlights: [],
  stats: { duration: 600, agentCount: 3, taskCount: 12, totalCost: 1.5 },
};

const sharedDataWithAnnotations = {
  ...baseSharedData,
  annotations: [
    { id: 'ann-1', timestamp: '2024-01-01T00:03:00Z', author: 'bob', text: 'Key decision here', type: 'comment' as const },
    { id: 'ann-2', timestamp: '2024-01-01T00:07:00Z', author: 'alice', text: 'Bug found', type: 'flag' as const },
  ],
};

function makeHookReturn(overrides: Record<string, unknown> = {}) {
  return {
    keyframes: baseSharedData.keyframes,
    worldState: null,
    playing: false,
    currentTime: 0,
    duration: 600_000, // 10 min in ms
    loading: false,
    error: null,
    play: mockPlay,
    pause: mockPause,
    seek: mockSeek,
    setSpeed: mockSetSpeed,
    speed: 4,
    sharedData: baseSharedData,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('SharedReplayViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHookReturn = makeHookReturn();
  });

  it('shows loading state when hook is loading', () => {
    mockHookReturn = makeHookReturn({ loading: true, sharedData: null });
    render(<SharedReplayViewer />);
    expect(screen.getByText('Loading shared replay...')).toBeInTheDocument();
  });

  it('renders replay viewer after data loads', () => {
    render(<SharedReplayViewer />);
    expect(screen.getByTestId('shared-replay-viewer')).toBeInTheDocument();
  });

  it('displays replay title in header', () => {
    render(<SharedReplayViewer />);
    expect(screen.getByText(/Test Session Replay/)).toBeInTheDocument();
  });

  it('displays shared-by info', () => {
    render(<SharedReplayViewer />);
    expect(screen.getByText(/Shared by alice/)).toBeInTheDocument();
  });

  it('displays duration in minutes', () => {
    render(<SharedReplayViewer />);
    expect(screen.getByText(/10 min/)).toBeInTheDocument();
  });

  it('displays agent count', () => {
    render(<SharedReplayViewer />);
    expect(screen.getByText(/3 agents/)).toBeInTheDocument();
  });

  it('renders ReplayContent component', () => {
    render(<SharedReplayViewer />);
    expect(screen.getByTestId('replay-content-mock')).toBeInTheDocument();
  });

  it('shows error state on token error', () => {
    mockHookReturn = makeHookReturn({
      error: 'Share link has expired or been revoked',
      sharedData: null,
    });
    render(<SharedReplayViewer />);
    expect(screen.getByTestId('shared-replay-error')).toBeInTheDocument();
    expect(screen.getByText('Share link has expired or been revoked')).toBeInTheDocument();
  });

  it('shows error state when sharedData is null', () => {
    mockHookReturn = makeHookReturn({ sharedData: null });
    render(<SharedReplayViewer />);
    expect(screen.getByTestId('shared-replay-error')).toBeInTheDocument();
  });

  it('shows expiry hint on error', () => {
    mockHookReturn = makeHookReturn({ error: 'expired', sharedData: null });
    render(<SharedReplayViewer />);
    expect(screen.getByText(/may have expired/)).toBeInTheDocument();
  });

  it('renders play/pause buttons', () => {
    render(<SharedReplayViewer />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });

  it('shows initial time as 0:00', () => {
    render(<SharedReplayViewer />);
    expect(screen.getByText('0:00')).toBeInTheDocument();
  });

  it('shows total duration formatted', () => {
    render(<SharedReplayViewer />);
    expect(screen.getByText('10:00')).toBeInTheDocument();
  });

  it('renders annotation pins when present', () => {
    mockHookReturn = makeHookReturn({ sharedData: sharedDataWithAnnotations });
    render(<SharedReplayViewer />);
    expect(screen.getByTestId('annotation-ann-1')).toBeInTheDocument();
    expect(screen.getByTestId('annotation-ann-2')).toBeInTheDocument();
  });

  it('shows annotation count button', () => {
    mockHookReturn = makeHookReturn({ sharedData: sharedDataWithAnnotations });
    render(<SharedReplayViewer />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('does not show annotation button when no annotations', () => {
    render(<SharedReplayViewer />);
    expect(screen.queryByText(/annotations/i)).not.toBeInTheDocument();
  });

  it('calls seek on skip-forward click', () => {
    render(<SharedReplayViewer />);
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[2]); // skip-forward
    expect(mockSeek).toHaveBeenCalledWith(5000); // currentTime(0) + 5000
  });

  it('calls play on play button click', () => {
    render(<SharedReplayViewer />);
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[1]); // play/pause
    expect(mockPlay).toHaveBeenCalled();
  });

  it('calls pause when playing and button clicked', () => {
    mockHookReturn = makeHookReturn({ playing: true });
    render(<SharedReplayViewer />);
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[1]); // play/pause
    expect(mockPause).toHaveBeenCalled();
  });
});
