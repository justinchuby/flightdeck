import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderHook, waitFor } from '@testing-library/react';
import { ReplayScrubber } from '../SessionReplay/ReplayScrubber';
import { useSessionReplay } from '../../hooks/useSessionReplay';

// Mock apiFetch
const mockApiFetch = vi.fn();
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

const sampleKeyframes = {
  keyframes: [
    { timestamp: '2026-03-05T10:00:00.000Z', label: 'Session started', type: 'milestone' },
    { timestamp: '2026-03-05T10:01:00.000Z', label: 'Developer spawned', type: 'agent_spawned' },
    { timestamp: '2026-03-05T10:05:00.000Z', label: 'Build completed', type: 'milestone' },
    { timestamp: '2026-03-05T10:10:00.000Z', label: 'Session ended', type: 'milestone' },
  ],
};

describe('useSessionReplay', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('loads keyframes on mount', async () => {
    mockApiFetch.mockResolvedValue(sampleKeyframes);
    const { result } = renderHook(() => useSessionReplay('lead-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.keyframes).toHaveLength(4);
    expect(result.current.duration).toBeGreaterThan(0);
    expect(mockApiFetch).toHaveBeenCalledWith('/replay/lead-1/keyframes');
  });

  it('returns empty state when leadId is null', () => {
    const { result } = renderHook(() => useSessionReplay(null));
    expect(result.current.keyframes).toHaveLength(0);
    expect(result.current.duration).toBe(0);
  });

  it('sets error on fetch failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Not found'));
    const { result } = renderHook(() => useSessionReplay('lead-1'));
    await waitFor(() => expect(result.current.error).toBe('Not found'));
  });

  it('starts at time 0 and not playing', async () => {
    mockApiFetch.mockResolvedValue(sampleKeyframes);
    const { result } = renderHook(() => useSessionReplay('lead-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.currentTime).toBe(0);
    expect(result.current.playing).toBe(false);
  });

  it('seek clamps to valid range', async () => {
    mockApiFetch.mockResolvedValue(sampleKeyframes);
    const { result } = renderHook(() => useSessionReplay('lead-1'));
    await waitFor(() => expect(result.current.duration).toBeGreaterThan(0));
    const dur = result.current.duration;

    // Seek below 0 clamps to 0
    result.current.seek(-1000);
    await waitFor(() => expect(result.current.currentTime).toBe(0));

    // Seek above duration clamps to duration
    result.current.seek(999999999);
    await waitFor(() => expect(result.current.currentTime).toBe(dur));
  });
});

describe('ReplayScrubber', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('shows loading state', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<ReplayScrubber leadId="lead-1" />);
    expect(screen.getByText(/Loading session replay/)).toBeDefined();
  });

  it('shows error state', async () => {
    mockApiFetch.mockRejectedValue(new Error('Unavailable'));
    render(<ReplayScrubber leadId="lead-1" />);
    await waitFor(() => {
      expect(screen.getByText(/Replay unavailable/)).toBeDefined();
    });
  });

  it('shows empty state when no keyframes', async () => {
    mockApiFetch.mockResolvedValue({ keyframes: [] });
    render(<ReplayScrubber leadId="lead-1" />);
    await waitFor(() => {
      expect(screen.getByText(/No replay data available/)).toBeDefined();
    });
  });

  it('renders scrubber with controls when keyframes exist', async () => {
    mockApiFetch.mockResolvedValue(sampleKeyframes);
    render(<ReplayScrubber leadId="lead-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('replay-scrubber')).toBeDefined();
    });
    // Time display
    expect(screen.getByText('0:00')).toBeDefined();
    // Speed buttons
    expect(screen.getByText('1×')).toBeDefined();
    expect(screen.getByText('2×')).toBeDefined();
  });

  it('has speed selector buttons', async () => {
    mockApiFetch.mockResolvedValue(sampleKeyframes);
    render(<ReplayScrubber leadId="lead-1" />);
    await waitFor(() => expect(screen.getByTestId('replay-scrubber')).toBeDefined());
    expect(screen.getByText('0.5×')).toBeDefined();
    expect(screen.getByText('4×')).toBeDefined();
    expect(screen.getByText('8×')).toBeDefined();
  });
});
