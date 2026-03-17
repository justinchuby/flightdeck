import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { TimerDisplay } from '../TimerDisplay';
import { useTimerStore } from '../../../stores/timerStore';
import { useAppStore } from '../../../stores/appStore';
import type { TimerInfo } from '../../../types';
import { apiFetch } from '../../../hooks/useApi';

// Mock apiFetch — default returns empty, overridden per test via setupTimers
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue([]),
  getAuthToken: vi.fn().mockReturnValue(null),
}));

const mockApiFetch = vi.mocked(apiFetch);

function makeTimer(overrides: Partial<TimerInfo> = {}): TimerInfo {
  return {
    id: 'timer-1',
    agentId: 'agent-abc12345deadbeef',
    label: 'check-build',
    message: 'Check if the build passed',
    fireAt: Date.now() + 60_000,
    createdAt: new Date().toISOString(),
    status: 'pending',
    repeat: false,
    delaySeconds: 60,
    remainingMs: 60_000,
    ...overrides,
  };
}

/** Set timer data in both the mock API response and the store */
function setupTimers(timers: TimerInfo[], recentlyFiredIds: string[] = []) {
  mockApiFetch.mockResolvedValueOnce(timers);
  useTimerStore.setState({ timers, recentlyFiredIds });
}

describe('TimerDisplay', () => {
  beforeEach(() => {
    useTimerStore.setState({ timers: [], recentlyFiredIds: [] });
    mockApiFetch.mockResolvedValue([]);
    useAppStore.setState({
      agents: [
        {
          id: 'agent-abc12345deadbeef',
          role: { id: 'developer', name: 'Developer', icon: '💻', description: '', model: '' },
          status: 'running',
          childIds: [],
        } as any,
      ],
    });
  });

  it('shows empty state when no timers', async () => {
    await act(async () => { render(<TimerDisplay />); });
    expect(screen.getByText('No active timers')).toBeTruthy();
  });

  it('renders timer label and countdown', async () => {
    setupTimers([makeTimer()]);
    await act(async () => { render(<TimerDisplay />); });
    expect(screen.getByText('check-build')).toBeTruthy();
  });

  it('shows agent role and short ID', async () => {
    setupTimers([makeTimer()]);
    await act(async () => { render(<TimerDisplay />); });
    expect(screen.getByText(/Developer/)).toBeTruthy();
    expect(screen.getByText(/agent-ab…/)).toBeTruthy();
  });

  it('shows timer message', async () => {
    setupTimers([makeTimer()]);
    await act(async () => { render(<TimerDisplay />); });
    expect(screen.getByText(/Check if the build passed/)).toBeTruthy();
  });

  it('shows cancel button for active timers', async () => {
    setupTimers([makeTimer()]);
    await act(async () => { render(<TimerDisplay />); });
    expect(screen.getByLabelText('Cancel timer check-build')).toBeTruthy();
  });

  it('hides cancel button for fired timers', async () => {
    setupTimers([makeTimer({ status: 'fired', remainingMs: 0 })]);
    await act(async () => { render(<TimerDisplay />); });
    fireEvent.click(screen.getByText(/All/));
    expect(screen.queryByLabelText('Cancel timer check-build')).toBeNull();
  });

  it('cancel button removes timer optimistically', async () => {
    setupTimers([makeTimer()]);
    await act(async () => { render(<TimerDisplay />); });
    fireEvent.click(screen.getByLabelText('Cancel timer check-build'));
    await waitFor(() => {
      expect(useTimerStore.getState().timers).toHaveLength(0);
    });
  });

  it('applies green flash class for recently fired timers', async () => {
    setupTimers([makeTimer({ id: 't1', status: 'fired', remainingMs: 0 })], ['t1']);
    await act(async () => { render(<TimerDisplay />); });
    fireEvent.click(screen.getByText(/All/));
    const card = screen.getByTestId('timer-t1');
    expect(card.className).toContain('border-green-500');
  });

  it('filter buttons toggle between active, fired, and all', async () => {
    const active = makeTimer({ id: 't1', label: 'active-timer', status: 'pending' });
    const fired = makeTimer({ id: 't2', label: 'fired-timer', status: 'fired', remainingMs: 0 });
    setupTimers([active, fired]);
    await act(async () => { render(<TimerDisplay />); });

    // Default: active filter — only active timer shown
    expect(screen.getByText('active-timer')).toBeTruthy();
    expect(screen.queryByText('fired-timer')).toBeNull();

    // Switch to fired
    fireEvent.click(screen.getByText(/Fired/));
    expect(screen.queryByText('active-timer')).toBeNull();
    expect(screen.getByText('fired-timer')).toBeTruthy();

    // Switch to all
    fireEvent.click(screen.getByText(/All/));
    expect(screen.getByText('active-timer')).toBeTruthy();
    expect(screen.getByText('fired-timer')).toBeTruthy();
  });

  it('shows repeat indicator for repeating timers', async () => {
    setupTimers([makeTimer({ repeat: true, delaySeconds: 300 })]);
    await act(async () => { render(<TimerDisplay />); });
    expect(screen.getByText('every 300s')).toBeTruthy();
  });

  it('shows fired! text for recently fired timers', async () => {
    setupTimers([makeTimer({ id: 't1', status: 'fired', remainingMs: 0 })], ['t1']);
    await act(async () => { render(<TimerDisplay />); });
    fireEvent.click(screen.getByText(/All/));
    expect(screen.getByText('✓ fired!')).toBeTruthy();
  });
});
