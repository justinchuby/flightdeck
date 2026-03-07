/**
 * AgentServerHealth — health state machine for the agent server connection.
 *
 * Tracks connection health by monitoring ping/pong round-trips.
 * State machine: connected → degraded (1 missed pong) → disconnected (3 missed pongs).
 * On pong received: reset to connected.
 *
 * Design: docs/design/agent-server-architecture.md (AS10)
 */

// ── Types ───────────────────────────────────────────────────────────

export type HealthState = 'connected' | 'degraded' | 'disconnected';

export interface HealthStateChange {
  previous: HealthState;
  current: HealthState;
  missedPongs: number;
  lastPongAt: number | null;
  /** Round-trip latency of the most recent pong (ms), or null if none received yet. */
  latencyMs: number | null;
}

export interface AgentServerHealthOptions {
  /** Ping interval in ms (default: 5000). */
  pingIntervalMs?: number;
  /** Number of missed pongs before entering 'degraded' state (default: 1). */
  degradedThreshold?: number;
  /** Number of missed pongs before entering 'disconnected' state (default: 3). */
  disconnectedThreshold?: number;
}

/** Callback that sends a ping message. Returns the requestId used. */
export type PingSender = () => string;

const DEFAULTS = {
  pingIntervalMs: 5_000,
  degradedThreshold: 1,
  disconnectedThreshold: 3,
};

// ── AgentServerHealth ───────────────────────────────────────────────

export class AgentServerHealth {
  private _state: HealthState = 'connected';
  private missedPongs = 0;
  private lastPongAt: number | null = null;
  private latencyMs: number | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pendingPing: { requestId: string; sentAt: number } | null = null;
  private stateHandlers = new Set<(change: HealthStateChange) => void>();

  private readonly pingIntervalMs: number;
  private readonly degradedThreshold: number;
  private readonly disconnectedThreshold: number;
  private readonly sendPing: PingSender;

  constructor(sendPing: PingSender, options?: AgentServerHealthOptions) {
    this.sendPing = sendPing;
    this.pingIntervalMs = options?.pingIntervalMs ?? DEFAULTS.pingIntervalMs;
    this.degradedThreshold = options?.degradedThreshold ?? DEFAULTS.degradedThreshold;
    this.disconnectedThreshold = options?.disconnectedThreshold ?? DEFAULTS.disconnectedThreshold;
  }

  // ── Public API ────────────────────────────────────────────────

  /** Current health state. */
  get state(): HealthState {
    return this._state;
  }

  /** Milliseconds since last successful pong, or null if none received. */
  get lastPongAge(): number | null {
    return this.lastPongAt !== null ? Date.now() - this.lastPongAt : null;
  }

  /** Most recent round-trip latency in ms, or null. */
  get lastLatency(): number | null {
    return this.latencyMs;
  }

  /** Number of consecutive missed pongs. */
  get consecutiveMisses(): number {
    return this.missedPongs;
  }

  /** Start the ping interval. */
  start(): void {
    if (this.pingTimer) return;
    this._state = 'connected';
    this.missedPongs = 0;

    this.pingTimer = setInterval(() => {
      this.tick();
    }, this.pingIntervalMs);
  }

  /** Stop the ping interval and reset state. */
  stop(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.pendingPing = null;
    this.missedPongs = 0;
  }

  /**
   * Record a received pong. Call this when the transport receives a pong message.
   * @param requestId - The requestId from the PongMessage.
   */
  recordPong(requestId: string): void {
    if (this.pendingPing && this.pendingPing.requestId === requestId) {
      this.latencyMs = Date.now() - this.pendingPing.sentAt;
      this.pendingPing = null;
    }

    this.lastPongAt = Date.now();
    this.missedPongs = 0;

    if (this._state !== 'connected') {
      this.setState('connected');
    }
  }

  /** Register a handler for health state changes. Returns unsubscribe function. */
  onStateChange(handler: (change: HealthStateChange) => void): () => void {
    this.stateHandlers.add(handler);
    return () => { this.stateHandlers.delete(handler); };
  }

  /** Whether the health monitor is actively pinging. */
  get isRunning(): boolean {
    return this.pingTimer !== null;
  }

  // ── Internal ──────────────────────────────────────────────────

  /** Called on each ping interval tick. */
  private tick(): void {
    // If there's a pending ping that wasn't answered, count it as missed
    if (this.pendingPing) {
      this.missedPongs++;
      this.pendingPing = null;
      this.evaluateState();
    }

    // Send a new ping
    try {
      const requestId = this.sendPing();
      this.pendingPing = { requestId, sentAt: Date.now() };
    } catch {
      // Transport might be disconnected — count as miss
      this.missedPongs++;
      this.evaluateState();
    }
  }

  /** Evaluate state transitions based on missed pong count. */
  private evaluateState(): void {
    if (this.missedPongs >= this.disconnectedThreshold) {
      if (this._state !== 'disconnected') {
        this.setState('disconnected');
      }
    } else if (this.missedPongs >= this.degradedThreshold) {
      if (this._state !== 'degraded') {
        this.setState('degraded');
      }
    }
  }

  private setState(newState: HealthState): void {
    const previous = this._state;
    if (previous === newState) return;

    this._state = newState;

    const change: HealthStateChange = {
      previous,
      current: newState,
      missedPongs: this.missedPongs,
      lastPongAt: this.lastPongAt,
      latencyMs: this.latencyMs,
    };

    for (const handler of this.stateHandlers) {
      try {
        handler(change);
      } catch {
        // Non-fatal — don't let handler errors break health monitoring
      }
    }
  }
}
