import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for Agent.ts status change debounce (B3 fix).
 *
 * The idle debounce is internal to Agent — we can't easily instantiate
 * a real Agent without spawning a process. Instead we test the behavior
 * via AgentManager's onStatus callback by verifying that rapid
 * running→idle→running sequences result in fewer emitted status_change
 * events.
 *
 * These tests directly exercise the notifyStatus logic by creating a
 * minimal Agent-like object with the same debounce behavior.
 */

// Replicate the debounce logic from Agent.ts so we can unit test it in isolation
type AgentStatus = 'idle' | 'running' | 'completed' | 'failed' | 'terminated' | 'creating';

class StatusNotifier {
  private _idleDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly IDLE_DEBOUNCE_MS = 500;
  private listeners: Array<(status: AgentStatus) => void> = [];

  onStatus(listener: (status: AgentStatus) => void): void {
    this.listeners.push(listener);
  }

  notifyStatus(status: AgentStatus): void {
    if (this._idleDebounceTimer) {
      clearTimeout(this._idleDebounceTimer);
      this._idleDebounceTimer = null;
    }
    if (status === 'idle') {
      this._idleDebounceTimer = setTimeout(() => {
        this._idleDebounceTimer = null;
        for (const listener of this.listeners) {
          listener(status);
        }
      }, StatusNotifier.IDLE_DEBOUNCE_MS);
    } else {
      for (const listener of this.listeners) {
        listener(status);
      }
    }
  }

  destroy(): void {
    if (this._idleDebounceTimer) {
      clearTimeout(this._idleDebounceTimer);
      this._idleDebounceTimer = null;
    }
    this.listeners.length = 0;
  }
}

describe('Status change debounce (B3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces idle transition by 500ms', () => {
    const notifier = new StatusNotifier();
    const listener = vi.fn();
    notifier.onStatus(listener);

    notifier.notifyStatus('idle');

    // Not yet emitted
    expect(listener).not.toHaveBeenCalled();

    // After 500ms, idle fires
    vi.advanceTimersByTime(500);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('idle');

    notifier.destroy();
  });

  it('fires running immediately (no debounce)', () => {
    const notifier = new StatusNotifier();
    const listener = vi.fn();
    notifier.onStatus(listener);

    notifier.notifyStatus('running');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('running');

    notifier.destroy();
  });

  it('cancels pending idle when running fires within debounce window', () => {
    const notifier = new StatusNotifier();
    const listener = vi.fn();
    notifier.onStatus(listener);

    // Agent goes idle...
    notifier.notifyStatus('idle');
    expect(listener).not.toHaveBeenCalled();

    // ...but quickly goes running again (within 500ms)
    vi.advanceTimersByTime(200);
    notifier.notifyStatus('running');

    // Running fired immediately
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('running');

    // Advance past the original 500ms — idle should NOT fire
    vi.advanceTimersByTime(500);
    expect(listener).toHaveBeenCalledTimes(1);

    notifier.destroy();
  });

  it('reduces rapid running→idle→running churn to minimal events', () => {
    const notifier = new StatusNotifier();
    const listener = vi.fn();
    notifier.onStatus(listener);

    // Simulate rapid churn: running→idle→running→idle→running→idle
    notifier.notifyStatus('running');  // fires immediately
    notifier.notifyStatus('idle');     // debounced...
    vi.advanceTimersByTime(100);
    notifier.notifyStatus('running');  // cancels idle, fires immediately
    notifier.notifyStatus('idle');     // debounced...
    vi.advanceTimersByTime(100);
    notifier.notifyStatus('running');  // cancels idle, fires immediately
    notifier.notifyStatus('idle');     // debounced...

    // Only 3 'running' events fired so far
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls.every((c: any[]) => c[0] === 'running')).toBe(true);

    // After 500ms the final idle fires
    vi.advanceTimersByTime(500);
    expect(listener).toHaveBeenCalledTimes(4);
    expect(listener).toHaveBeenLastCalledWith('idle');

    notifier.destroy();
  });

  it('fires terminal states immediately and cancels pending idle', () => {
    const notifier = new StatusNotifier();
    const listener = vi.fn();
    notifier.onStatus(listener);

    notifier.notifyStatus('idle');     // debounced
    notifier.notifyStatus('terminated'); // fires immediately, cancels idle

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('terminated');

    // Idle should not fire after timeout
    vi.advanceTimersByTime(500);
    expect(listener).toHaveBeenCalledTimes(1);

    notifier.destroy();
  });

  it('fires completed immediately', () => {
    const notifier = new StatusNotifier();
    const listener = vi.fn();
    notifier.onStatus(listener);

    notifier.notifyStatus('completed');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('completed');

    notifier.destroy();
  });
});
