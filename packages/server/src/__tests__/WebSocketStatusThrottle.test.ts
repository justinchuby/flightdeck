import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests the WebSocketServer status throttle logic:
 * - 'running' status bypasses the throttle and broadcasts immediately
 * - Other statuses (idle, etc.) are throttled with 500ms buffer
 * - 'running' cancels any pending throttled status flush
 *
 * This mirrors the core logic from WebSocketServer.wireAgentEvents 'agent:status' handler
 * to enable focused unit testing without full WS server setup.
 */

interface StatusMessage {
  type: string;
  agentId: string;
  status: string;
}

class StatusThrottleHandler {
  private statusThrottleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private statusPending = new Map<string, StatusMessage>();
  readonly broadcasts: StatusMessage[] = [];

  handleStatus(agentId: string, status: string): void {
    const data: StatusMessage = { type: 'agent:status', agentId, status };

    if (status === 'running') {
      const existingTimer = this.statusThrottleTimers.get(agentId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.statusThrottleTimers.delete(agentId);
      }
      this.statusPending.delete(agentId);
      this.broadcasts.push(data);
    } else {
      this.statusPending.set(agentId, data);
      if (!this.statusThrottleTimers.has(agentId)) {
        this.statusThrottleTimers.set(agentId, setTimeout(() => {
          this.statusThrottleTimers.delete(agentId);
          const pending = this.statusPending.get(agentId);
          if (pending) {
            this.statusPending.delete(agentId);
            this.broadcasts.push(pending);
          }
        }, 500));
      }
    }
  }

  dispose(): void {
    for (const timer of this.statusThrottleTimers.values()) clearTimeout(timer);
    this.statusThrottleTimers.clear();
    this.statusPending.clear();
  }
}

describe('WebSocket agent:status throttle', () => {
  let handler: StatusThrottleHandler;

  beforeEach(() => {
    vi.useFakeTimers();
    handler = new StatusThrottleHandler();
  });

  afterEach(() => {
    handler.dispose();
    vi.useRealTimers();
  });

  it('broadcasts running status immediately without throttle', () => {
    handler.handleStatus('agent-1', 'running');
    expect(handler.broadcasts).toHaveLength(1);
    expect(handler.broadcasts[0]).toEqual({
      type: 'agent:status',
      agentId: 'agent-1',
      status: 'running',
    });
  });

  it('throttles idle status by 500ms', () => {
    handler.handleStatus('agent-1', 'idle');
    expect(handler.broadcasts).toHaveLength(0);

    vi.advanceTimersByTime(500);
    expect(handler.broadcasts).toHaveLength(1);
    expect(handler.broadcasts[0].status).toBe('idle');
  });

  it('running cancels pending throttled idle status', () => {
    handler.handleStatus('agent-1', 'idle');
    expect(handler.broadcasts).toHaveLength(0);

    // Running arrives before throttle flush
    handler.handleStatus('agent-1', 'running');
    expect(handler.broadcasts).toHaveLength(1);
    expect(handler.broadcasts[0].status).toBe('running');

    // Advance past throttle — idle should NOT fire
    vi.advanceTimersByTime(600);
    expect(handler.broadcasts).toHaveLength(1);
  });

  it('rapid idle→running→idle: running arrives instantly, idle is delayed', () => {
    handler.handleStatus('agent-1', 'idle');
    vi.advanceTimersByTime(100);

    handler.handleStatus('agent-1', 'running');
    expect(handler.broadcasts).toHaveLength(1);
    expect(handler.broadcasts[0].status).toBe('running');

    handler.handleStatus('agent-1', 'idle');
    expect(handler.broadcasts).toHaveLength(1); // Still just the running

    vi.advanceTimersByTime(500);
    expect(handler.broadcasts).toHaveLength(2);
    expect(handler.broadcasts[1].status).toBe('idle');
  });

  it('multiple agents are throttled independently', () => {
    handler.handleStatus('agent-1', 'idle');
    handler.handleStatus('agent-2', 'running');

    // Agent-2 should broadcast immediately
    expect(handler.broadcasts).toHaveLength(1);
    expect(handler.broadcasts[0].agentId).toBe('agent-2');

    // Agent-1 should broadcast after throttle
    vi.advanceTimersByTime(500);
    expect(handler.broadcasts).toHaveLength(2);
    expect(handler.broadcasts[1].agentId).toBe('agent-1');
  });

  it('only latest idle status is broadcast when multiple updates arrive within throttle window', () => {
    handler.handleStatus('agent-1', 'idle');
    vi.advanceTimersByTime(100);

    // Simulate a different non-running status arriving within the window
    // The pending map is overwritten, but no new timer is started
    handler.handleStatus('agent-1', 'idle');
    vi.advanceTimersByTime(400);

    expect(handler.broadcasts).toHaveLength(1);
    expect(handler.broadcasts[0].status).toBe('idle');
  });

  it('running status is never dropped even with rapid transitions', () => {
    // Simulate: idle → running → idle → running → idle
    handler.handleStatus('agent-1', 'idle');
    handler.handleStatus('agent-1', 'running');
    handler.handleStatus('agent-1', 'idle');
    handler.handleStatus('agent-1', 'running');
    handler.handleStatus('agent-1', 'idle');

    // Both running should have broadcast immediately
    const runningBroadcasts = handler.broadcasts.filter(b => b.status === 'running');
    expect(runningBroadcasts).toHaveLength(2);

    // After throttle period, final idle should arrive
    vi.advanceTimersByTime(500);
    const idleBroadcasts = handler.broadcasts.filter(b => b.status === 'idle');
    expect(idleBroadcasts).toHaveLength(1);
  });
});
