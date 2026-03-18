import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReplayScrubber } from '../SessionReplay/ReplayScrubber';
import { useSessionReplay } from '../../hooks/useSessionReplay';

// Mock apiFetch
const mockApiFetch = vi.fn();
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

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
    const { result } = renderHook(() => useSessionReplay('lead-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.keyframes).toHaveLength(4);
    expect(result.current.duration).toBeGreaterThan(0);
    expect(mockApiFetch).toHaveBeenCalledWith('/replay/lead-1/keyframes', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('returns empty state when leadId is null', () => {
    const { result } = renderHook(() => useSessionReplay(null), { wrapper: createWrapper() });
    expect(result.current.keyframes).toHaveLength(0);
    expect(result.current.duration).toBe(0);
  });

  it('sets error on fetch failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Not found'));
    const { result } = renderHook(() => useSessionReplay('lead-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.error).toBe('Not found'));
  });

  it('starts at time 0 and not playing', async () => {
    mockApiFetch.mockResolvedValue(sampleKeyframes);
    const { result } = renderHook(() => useSessionReplay('lead-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.currentTime).toBe(0);
    expect(result.current.playing).toBe(false);
  });

  it('seek clamps to valid range', async () => {
    mockApiFetch.mockResolvedValue(sampleKeyframes);
    const { result } = renderHook(() => useSessionReplay('lead-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.duration).toBeGreaterThan(0));
    const dur = result.current.duration;

    // Seek below 0 clamps to 0
    act(() => { result.current.seek(-1000); });
    await waitFor(() => expect(result.current.currentTime).toBe(0));

    // Seek above duration clamps to duration
    act(() => { result.current.seek(999999999); });
    await waitFor(() => expect(result.current.currentTime).toBe(dur));
  });

  it('play() resets currentTime to 0 when at end of duration', async () => {
    mockApiFetch.mockResolvedValue(sampleKeyframes);
    const { result } = renderHook(() => useSessionReplay('lead-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.duration).toBeGreaterThan(0));
    const dur = result.current.duration;

    // Seek to end
    act(() => { result.current.seek(dur); });
    await waitFor(() => expect(result.current.currentTime).toBe(dur));

    // Play should reset to 0
    act(() => { result.current.play(); });

    await waitFor(() => expect(result.current.playing).toBe(true));
    expect(result.current.currentTime).toBeLessThan(dur);
  });

  it('fetchStateAt silently catches errors', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/keyframes')) return Promise.resolve(sampleKeyframes);
      if (url.includes('/state')) return Promise.reject(new Error('Server down'));
      return Promise.resolve({});
    });
    const { result } = renderHook(() => useSessionReplay('lead-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.duration).toBeGreaterThan(0));
    act(() => { result.current.seek(5000); });
    await waitFor(() => expect(result.current.currentTime).toBe(5000));
    expect(result.current.worldState).toBeNull();
  });

  it('uses MIN_SESSION_DURATION_MS for very short sessions', async () => {
    mockApiFetch.mockResolvedValue({
      keyframes: [
        { timestamp: '2026-03-05T10:00:00.000Z', label: 'Start', type: 'milestone' },
        { timestamp: '2026-03-05T10:00:00.100Z', label: 'End', type: 'milestone' },
      ],
    });
    const { result } = renderHook(() => useSessionReplay('lead-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.duration).toBe(1000);
  });

  it('converts non-Error query errors to string', async () => {
    mockApiFetch.mockRejectedValue('raw string error');
    const { result } = renderHook(() => useSessionReplay('lead-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.error).toBe('raw string error'));
  });

  it('resets currentTime and playing when leadId changes', async () => {
    mockApiFetch.mockResolvedValue(sampleKeyframes);
    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ id }) => useSessionReplay(id),
      { initialProps: { id: 'lead-1' as string | null }, wrapper },
    );
    await waitFor(() => expect(result.current.duration).toBeGreaterThan(0));

    // Seek forward and start playing
    act(() => { result.current.seek(5000); });
    await waitFor(() => expect(result.current.currentTime).toBe(5000));

    // Switch to a different project
    mockApiFetch.mockResolvedValue({ keyframes: [
      { timestamp: '2026-03-06T12:00:00.000Z', label: 'Start', type: 'milestone' },
      { timestamp: '2026-03-06T12:05:00.000Z', label: 'End', type: 'milestone' },
    ] });
    act(() => { rerender({ id: 'lead-2' }); });

    // State should reset immediately
    await waitFor(() => expect(result.current.currentTime).toBe(0));
    expect(result.current.playing).toBe(false);
  });
});

describe('ReplayScrubber', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('shows loading state', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<ReplayScrubber leadId="lead-1" />, { wrapper: createWrapper() });
    expect(screen.getByText(/Loading session replay/)).toBeDefined();
  });

  it('shows error state', async () => {
    mockApiFetch.mockRejectedValue(new Error('Unavailable'));
    render(<ReplayScrubber leadId="lead-1" />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText(/Replay unavailable/)).toBeDefined();
    });
  });

  it('shows empty state when no keyframes in replay mode', async () => {
    mockApiFetch.mockResolvedValue({ keyframes: [] });
    render(<ReplayScrubber leadId="lead-1" />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByText(/No replay data available/)).toBeDefined();
    });
  });

  it('shows live scrub bar even with no keyframes in live mode', async () => {
    mockApiFetch.mockResolvedValue({ keyframes: [] });
    render(<ReplayScrubber leadId="lead-1" liveMode={true} />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId('replay-scrubber')).toBeDefined();
    });
    expect(screen.getByText('LIVE')).toBeDefined();
  });

  it('renders scrubber with controls when keyframes exist', async () => {
    mockApiFetch.mockResolvedValue(sampleKeyframes);
    render(<ReplayScrubber leadId="lead-1" />, { wrapper: createWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId('replay-scrubber')).toBeDefined();
    });
    // Time display shows current time (0:00) and possibly duration (0:00)
    const timeElements = screen.getAllByText('0:00');
    expect(timeElements.length).toBeGreaterThanOrEqual(1);
    // Speed buttons (4× is default, 8× and 16× should be present)
    expect(screen.getByText('4×')).toBeDefined();
    expect(screen.getByText('8×')).toBeDefined();
  });

  it('has speed selector buttons', async () => {
    mockApiFetch.mockResolvedValue(sampleKeyframes);
    render(<ReplayScrubber leadId="lead-1" />, { wrapper: createWrapper() });
    await waitFor(() => expect(screen.getByTestId('replay-scrubber')).toBeDefined());
    expect(screen.getByText('4×')).toBeDefined();
    expect(screen.getByText('32×')).toBeDefined();
    expect(screen.getByText('720×')).toBeDefined();
  });
});
