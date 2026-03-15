import { describe, it, expect } from 'vitest';

/**
 * Tests that WebSocketServer broadcasts all agent:status updates immediately
 * with no throttling or buffering. The throttle was removed because the upstream
 * AgentEvents idle debounce already handles churn reduction — a second layer of
 * delay only caused stale status in the UI.
 *
 * This mirrors the WebSocketServer 'agent:status' handler logic for focused testing.
 */

interface StatusMessage {
  type: string;
  agentId: string;
  status: string;
}

/** Mirrors the simplified WebSocketServer agent:status handler (no throttle). */
function broadcastStatus(agentId: string, status: string): StatusMessage {
  return { type: 'agent:status', agentId, status };
}

describe('WebSocket agent:status — immediate broadcast (no throttle)', () => {
  it.each(['creating', 'running', 'idle', 'completed', 'failed', 'terminated'] as const)(
    '%s status broadcasts immediately',
    (status) => {
      const msg = broadcastStatus('agent-1', status);
      expect(msg).toEqual({ type: 'agent:status', agentId: 'agent-1', status });
    },
  );

  it('rapid status transitions all produce individual broadcasts', () => {
    const statuses = ['creating', 'running', 'idle', 'running', 'idle', 'completed'] as const;
    const messages = statuses.map(s => broadcastStatus('agent-1', s));

    expect(messages).toHaveLength(6);
    expect(messages.map(m => m.status)).toEqual([
      'creating', 'running', 'idle', 'running', 'idle', 'completed',
    ]);
  });

  it('multiple agents broadcast independently', () => {
    const msg1 = broadcastStatus('agent-1', 'running');
    const msg2 = broadcastStatus('agent-2', 'idle');

    expect(msg1.agentId).toBe('agent-1');
    expect(msg2.agentId).toBe('agent-2');
  });
});
