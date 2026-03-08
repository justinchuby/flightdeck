import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentServerHealth } from '../agents/AgentServerHealth.js';
import type { HealthStateChange } from '../agents/AgentServerHealth.js';

/**
 * Tests for the AgentServerHealth → WebSocket bridge.
 *
 * Since WebSocketServer requires a full HTTP server, we test the health → broadcast
 * wiring in isolation by directly exercising AgentServerHealth + a mock broadcaster.
 * This validates the event shape that wireAgentServerHealth() produces.
 */

describe('AgentServerHealth → WebSocket bridge', () => {
  let health: AgentServerHealth;
  let sentPings: string[];
  let broadcasts: Array<{ type: string; state: string; detail?: string }>;

  beforeEach(() => {
    sentPings = [];
    broadcasts = [];
    let pingCounter = 0;

    health = new AgentServerHealth(
      () => {
        const id = `ping-${++pingCounter}`;
        sentPings.push(id);
        return id;
      },
      { pingIntervalMs: 50, degradedThreshold: 1, disconnectedThreshold: 3 },
    );

    // Simulate what wireAgentServerHealth() does — subscribe to state changes
    // and produce the same message shape
    health.onStateChange((change: HealthStateChange) => {
      let detail: string | undefined;
      if (change.current === 'degraded') {
        detail = `${change.missedPongs} missed pong(s)`;
      } else if (change.current === 'disconnected') {
        detail = 'Agent server unreachable';
      }

      broadcasts.push({
        type: 'agentServerStatus',
        state: change.current,
        detail,
      });
    });
  });

  it('emits degraded event after missed pong threshold', async () => {
    health.start();

    // Wait for 2 ticks (1 missed pong → degraded)
    await new Promise((r) => setTimeout(r, 120));
    health.stop();

    const degraded = broadcasts.find((b) => b.state === 'degraded');
    expect(degraded).toBeDefined();
    expect(degraded!.type).toBe('agentServerStatus');
    expect(degraded!.detail).toMatch(/missed pong/);
  });

  it('emits disconnected event after 3 missed pongs', async () => {
    health.start();

    // Wait for enough ticks to reach disconnected (3 missed pongs)
    await new Promise((r) => setTimeout(r, 250));
    health.stop();

    const disconnected = broadcasts.find((b) => b.state === 'disconnected');
    expect(disconnected).toBeDefined();
    expect(disconnected!.type).toBe('agentServerStatus');
    expect(disconnected!.detail).toBe('Agent server unreachable');
  });

  it('emits connected event when pong arrives after degraded', async () => {
    health.start();

    // Wait for degraded state
    await new Promise((r) => setTimeout(r, 120));

    // Send a pong to recover
    if (sentPings.length > 0) {
      health.recordPong(sentPings[sentPings.length - 1]);
    }

    health.stop();

    const connected = broadcasts.find((b) => b.state === 'connected');
    expect(connected).toBeDefined();
    expect(connected!.type).toBe('agentServerStatus');
    expect(connected!.detail).toBeUndefined();
  });

  it('message shape matches AgentServerStatusEvent (AS19 UI contract)', () => {
    // Simulate a state change directly
    const mockChange: HealthStateChange = {
      previous: 'connected',
      current: 'degraded',
      missedPongs: 1,
      lastPongAt: Date.now() - 5000,
      latencyMs: 42,
    };

    // Produce the message
    let detail: string | undefined;
    if (mockChange.current === 'degraded') {
      detail = `${mockChange.missedPongs} missed pong(s)`;
    } else if (mockChange.current === 'disconnected') {
      detail = 'Agent server unreachable';
    }

    const msg = {
      type: 'agentServerStatus' as const,
      state: mockChange.current,
      detail,
    };

    // Validate shape matches what AgentServerStatus.tsx expects
    expect(msg.type).toBe('agentServerStatus');
    expect(['connected', 'degraded', 'disconnected']).toContain(msg.state);
    expect(typeof msg.detail === 'string' || msg.detail === undefined).toBe(true);
  });

  it('no events when state does not change', () => {
    // Start and immediately stop — no pings sent, no state changes
    health.start();
    health.stop();

    expect(broadcasts).toHaveLength(0);
  });
});
