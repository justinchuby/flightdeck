import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ShareableReplay } from '../types';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ token: 'abc-123' }),
  useSearchParams: () => [new URLSearchParams()],
}));

// Mock AnnotationPin to simplify testing
vi.mock('../AnnotationPin', () => ({
  AnnotationPin: ({ annotation, onClick }: { annotation: { id: string; text: string }; onClick: () => void }) => (
    <div data-testid={`annotation-${annotation.id}`} onClick={onClick}>
      {annotation.text}
    </div>
  ),
}));

// Mock useSessionReplay hook
const mockSeek = vi.fn();
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
    seek: mockSeek,
    setSpeed: vi.fn(),
    speed: 4,
  }),
}));

// Mock ReplayContent to simplify testing
vi.mock('../ReplayContent', () => ({
  ReplayContent: ({ worldState, loading }: { worldState: unknown; loading?: boolean }) => (
    <div data-testid="replay-content-mock">
      {loading ? 'loading' : worldState ? 'content' : 'empty'}
    </div>
  ),
}));

import { SharedReplayViewer } from '../SharedReplayViewer';

// ── Fixtures ──────────────────────────────────────────────────────────────

const baseReplay: ShareableReplay = {
  id: 'replay-1',
  sessionId: 'session-1',
  leadId: 'lead-1',
  title: 'Test Session Replay',
  createdAt: '2024-01-01T00:00:00Z',
  createdBy: 'alice',
  format: 'link',
  annotations: [],
  highlights: [],
  stats: {
    duration: 600, // 10 minutes in seconds
    agentCount: 3,
    taskCount: 12,
    totalCost: 1.5,
  },
};

const replayWithAnnotations: ShareableReplay = {
  ...baseReplay,
  annotations: [
    { id: 'ann-1', timestamp: '2024-01-01T00:03:00Z', author: 'bob', text: 'Key decision here', type: 'comment' },
    { id: 'ann-2', timestamp: '2024-01-01T00:07:00Z', author: 'alice', text: 'Bug found', type: 'flag' },
  ],
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('SharedReplayViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockReset();
  });

  it('shows loading state initially', async () => {
    mockApiFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<SharedReplayViewer />);
    await act(async () => {});
    expect(screen.getByText('Loading shared replay...')).toBeInTheDocument();
  });

  it('fetches replay data with the token', async () => {
    mockApiFetch.mockResolvedValue(baseReplay);
    render(<SharedReplayViewer />);
    await act(async () => {});
    expect(mockApiFetch).toHaveBeenCalledWith('/shared/abc-123');
  });

  it('renders replay viewer after successful fetch', async () => {
    mockApiFetch.mockResolvedValue(baseReplay);
    render(<SharedReplayViewer />);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('shared-replay-viewer')).toBeInTheDocument();
    });
  });

  it('displays replay title in header', async () => {
    mockApiFetch.mockResolvedValue(baseReplay);
    render(<SharedReplayViewer />);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByText(/Test Session Replay/)).toBeInTheDocument();
    });
  });

  it('displays shared-by info', async () => {
    mockApiFetch.mockResolvedValue(baseReplay);
    render(<SharedReplayViewer />);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByText(/Shared by alice/)).toBeInTheDocument();
    });
  });

  it('displays duration in minutes', async () => {
    mockApiFetch.mockResolvedValue(baseReplay);
    render(<SharedReplayViewer />);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByText(/10 min/)).toBeInTheDocument();
    });
  });

  it('displays agent count', async () => {
    mockApiFetch.mockResolvedValue(baseReplay);
    render(<SharedReplayViewer />);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByText(/3 agents/)).toBeInTheDocument();
    });
  });

  it('renders ReplayContent component', async () => {
    mockApiFetch.mockResolvedValue(baseReplay);
    render(<SharedReplayViewer />);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('replay-content-mock')).toBeInTheDocument();
    });
  });

  it('shows error state on 404', async () => {
    mockApiFetch.mockRejectedValue(new Error('404 Not Found'));
    render(<SharedReplayViewer />);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('shared-replay-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Replay not found or link expired')).toBeInTheDocument();
  });

  it('shows generic error message on non-404 failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Server error'));
    render(<SharedReplayViewer />);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('shared-replay-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Server error')).toBeInTheDocument();
  });

  it('shows expiry hint on error', async () => {
    mockApiFetch.mockRejectedValue(new Error('404'));
    render(<SharedReplayViewer />);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByText(/may have expired/)).toBeInTheDocument();
    });
  });

  it('renders play/pause toggle', async () => {
    mockApiFetch.mockResolvedValue(baseReplay);
    render(<SharedReplayViewer />);
    await act(async () => {});
    await waitFor(() => screen.getByTestId('shared-replay-viewer'));
    // Initially not playing — Play icon is an SVG, check container button exists
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(3); // skip-back, play/pause, skip-forward
  });

  it('shows initial time as 0:00', async () => {
    mockApiFetch.mockResolvedValue(baseReplay);
    render(<SharedReplayViewer />);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByText('0:00')).toBeInTheDocument();
    });
  });

  it('shows total duration formatted', async () => {
    mockApiFetch.mockResolvedValue(baseReplay);
    render(<SharedReplayViewer />);
    await act(async () => {});
    await waitFor(() => {
      // 600 seconds = 10:00
      expect(screen.getByText('10:00')).toBeInTheDocument();
    });
  });

  it('renders annotation pins when present', async () => {
    mockApiFetch.mockResolvedValue(replayWithAnnotations);
    render(<SharedReplayViewer />);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('annotation-ann-1')).toBeInTheDocument();
      expect(screen.getByTestId('annotation-ann-2')).toBeInTheDocument();
    });
  });

  it('shows annotation count button', async () => {
    mockApiFetch.mockResolvedValue(replayWithAnnotations);
    render(<SharedReplayViewer />);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  it('does not show annotation button when no annotations', async () => {
    mockApiFetch.mockResolvedValue(baseReplay);
    render(<SharedReplayViewer />);
    await act(async () => {});
    await waitFor(() => screen.getByTestId('shared-replay-viewer'));
    // No annotation count button
    expect(screen.queryByText(/annotations/i)).not.toBeInTheDocument();
  });

  it('advances time on skip-forward click', async () => {
    mockApiFetch.mockResolvedValue(baseReplay);
    render(<SharedReplayViewer />);
    await act(async () => {});
    await waitFor(() => screen.getByTestId('shared-replay-viewer'));

    // Find skip-forward button (third transport button)
    const buttons = screen.getAllByRole('button');
    // Skip-forward is after play/pause
    const skipForward = buttons[2];
    await act(async () => {
      fireEvent.click(skipForward);
    });

    // Time should advance by 5 seconds -> 0:05
    await waitFor(() => {
      expect(screen.getByText('0:05')).toBeInTheDocument();
    });
  });
});
