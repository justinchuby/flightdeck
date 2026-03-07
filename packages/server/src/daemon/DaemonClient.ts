/**
 * Daemon client — used by the Flightdeck server to connect to the daemon.
 *
 * Connects to the daemon's Unix Domain Socket, authenticates with a token,
 * sends JSON-RPC commands, and receives event notifications. Includes
 * heartbeat (ping every 10s) and reconnection logic.
 *
 * Design: packages/docs/design/hot-reload-agent-preservation.md
 */
import { connect, type Socket } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TypedEmitter } from '../utils/TypedEmitter.js';
import { logger } from '../utils/logger.js';
import {
  type JsonRpcMessage,
  type JsonRpcResponse,
  type DaemonEvent,
  type AgentDescriptor,
  type SpawnParams,
  type SubscribeParams,
  type ListResult,
  type AuthResult,
  type SpawnResult,
  type SubscribeResult,
  RPC_ERRORS,
  serializeMessage,
  parseNdjsonBuffer,
  createRequest,
  isResponse,
  isNotification,
  getSocketDir,
} from './DaemonProtocol.js';

// ── Types ───────────────────────────────────────────────────────────

export interface DaemonClientOptions {
  /** Override socket directory (for testing). */
  socketDir?: string;
  /** Socket filename (default: 'agent-host.sock'). */
  socketName?: string;
  /** Heartbeat interval in ms (default: 10000). */
  heartbeatIntervalMs?: number;
  /** Number of missed heartbeats before daemon-lost (default: 3). */
  heartbeatMissThreshold?: number;
  /** Auth retry delay in ms (default: 500). */
  authRetryDelayMs?: number;
  /** Max auth retries (default: 3). */
  maxAuthRetries?: number;
  /** Request timeout in ms (default: 30000). */
  requestTimeoutMs?: number;
}

export interface DaemonClientEvents {
  'connected': AuthResult;
  'disconnected': { reason: string };
  'event': DaemonEvent;
  'daemon-lost': { missedHeartbeats: number };
  'error': { error: string };
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_OPTIONS: Required<DaemonClientOptions> = {
  socketDir: '',
  socketName: 'agent-host.sock',
  heartbeatIntervalMs: 10_000,
  heartbeatMissThreshold: 3,
  authRetryDelayMs: 500,
  maxAuthRetries: 3,
  requestTimeoutMs: 30_000,
};

// ── Daemon Client ───────────────────────────────────────────────────

export class DaemonClient extends TypedEmitter<DaemonClientEvents> {
  private socket: Socket | null = null;
  private buffer = '';
  private nextId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private missedHeartbeats = 0;
  private disposed = false;
  private connected = false;

  private readonly options: Required<DaemonClientOptions>;
  private readonly socketDir: string;
  private readonly socketPath: string;

  constructor(options: DaemonClientOptions = {}) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.socketDir = this.options.socketDir || getSocketDir();
    this.socketPath = join(this.socketDir, this.options.socketName);
  }

  /** Whether the client is connected and authenticated. */
  get isConnected(): boolean {
    return this.connected;
  }

  // ── Connection ────────────────────────────────────────────────

  /**
   * Connect to the daemon and authenticate.
   * Retries auth with fresh token reads if the first attempt fails.
   */
  async connect(tokenOverride?: string): Promise<AuthResult> {
    if (this.disposed) throw new Error('DaemonClient has been disposed');
    if (this.connected) throw new Error('Already connected');

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.options.maxAuthRetries; attempt++) {
      try {
        const token = tokenOverride ?? this.readToken();
        const result = await this.connectAndAuth(token);
        this.connected = true;
        this.startHeartbeat();
        this.emit('connected', result);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Only retry auth failures (not connection failures)
        if (lastError.message.includes('Invalid token') && attempt < this.options.maxAuthRetries) {
          logger.info({
            module: 'daemon-client',
            msg: 'Auth failed, retrying with fresh token',
            attempt: attempt + 1,
          });
          await this.delay(this.options.authRetryDelayMs);
          continue;
        }

        throw lastError;
      }
    }

    throw lastError ?? new Error('Connection failed');
  }

  private connectAndAuth(token: string): Promise<AuthResult> {
    return new Promise<AuthResult>((resolve, reject) => {
      const socket = connect(this.socketPath);
      let buffer = '';
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.destroy();
          reject(new Error('Connection timeout'));
        }
      }, this.options.requestTimeoutMs);

      socket.on('connect', () => {
        // Send auth request
        const authReq = createRequest(0, 'auth', {
          token,
          pid: process.pid,
        } as unknown as Record<string, unknown>);
        socket.write(serializeMessage(authReq));
      });

      socket.on('data', (data) => {
        buffer += data.toString();
        const [messages, remaining] = parseNdjsonBuffer(buffer);
        buffer = remaining;

        for (const msg of messages) {
          if (!settled && isResponse(msg) && msg.id === 0) {
            settled = true;
            clearTimeout(timeout);

            if (msg.error) {
              socket.destroy();
              reject(new Error(msg.error.message));
              return;
            }

            // Auth succeeded — keep the socket
            this.socket = socket;
            this.buffer = buffer;
            this.setupSocketHandlers();
            resolve(msg.result as AuthResult);
            return;
          }
        }
      });

      socket.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error(`Connection error: ${(err as NodeJS.ErrnoException).code ?? err.message}`));
        }
      });

      socket.on('close', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error('Connection closed before auth'));
        }
      });
    });
  }

  private setupSocketHandlers(): void {
    if (!this.socket) return;

    this.socket.on('data', (data) => {
      this.buffer += data.toString();
      const [messages, remaining] = parseNdjsonBuffer(this.buffer);
      this.buffer = remaining;

      for (const msg of messages) {
        if (isResponse(msg)) {
          this.handleResponse(msg);
        } else if (isNotification(msg)) {
          this.handleNotification(msg);
        }
      }
    });

    this.socket.on('close', () => {
      if (this.connected) {
        this.connected = false;
        this.stopHeartbeat();
        this.rejectAllPending('Connection closed');
        this.emit('disconnected', { reason: 'socket closed' });
      }
    });

    this.socket.on('error', (err) => {
      logger.warn({ module: 'daemon-client', msg: 'Socket error', err: String(err) });
      this.emit('error', { error: String(err) });
    });
  }

  // ── Request/Response ──────────────────────────────────────────

  private async request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.socket || !this.connected) {
      throw new Error('Not connected to daemon');
    }

    const id = this.nextId++;
    const req = createRequest(id, method, params);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method} (id=${id})`));
      }, this.options.requestTimeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timer,
      });

      this.socket!.write(serializeMessage(req));
    });
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

    this.pendingRequests.delete(response.id);
    clearTimeout(pending.timer);

    if (response.error) {
      pending.reject(new Error(response.error.message));
    } else {
      pending.resolve(response.result);
    }
  }

  private handleNotification(notification: JsonRpcMessage): void {
    if (!('method' in notification)) return;

    if (notification.method === 'daemon.event' && notification.params) {
      const event = notification.params.event as unknown as DaemonEvent;
      if (event) {
        this.emit('event', event);
      }
    }
  }

  // ── Commands ──────────────────────────────────────────────────

  /** Ping the daemon (heartbeat). */
  async ping(): Promise<{ pong: boolean; timestamp: number }> {
    return this.request('ping');
  }

  /** List all agents managed by the daemon. */
  async listAgents(): Promise<ListResult> {
    return this.request('list');
  }

  /** Tell the daemon to spawn an agent. */
  async spawnAgent(params: SpawnParams): Promise<SpawnResult> {
    return this.request('spawn', params as unknown as Record<string, unknown>);
  }

  /** Tell the daemon to terminate an agent. */
  async terminateAgent(agentId: string, timeoutMs?: number): Promise<{ terminated: boolean }> {
    return this.request('terminate', { agentId, timeoutMs });
  }

  /** Send a message to an agent via the daemon. */
  async sendMessage(agentId: string, message: string): Promise<{ sent: boolean }> {
    return this.request('send', { agentId, message });
  }

  /** Subscribe to agent events. Drains the event buffer. */
  async subscribe(params?: SubscribeParams): Promise<SubscribeResult> {
    return this.request('subscribe', params as unknown as Record<string, unknown>);
  }

  /** Request daemon shutdown. */
  async shutdown(params?: { persist?: boolean; timeoutMs?: number }): Promise<{ acknowledged: boolean }> {
    return this.request('shutdown', params);
  }

  /** Update daemon configuration. */
  async configure(params: { massFailure?: { threshold?: number; windowSeconds?: number; cooldownSeconds?: number } }): Promise<{ configured: boolean }> {
    return this.request('configure', params);
  }

  /** Clear mass failure spawning pause. */
  async resumeSpawning(): Promise<{ resumed: boolean }> {
    return this.request('resumeSpawning');
  }

  // ── Heartbeat ─────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.missedHeartbeats = 0;

    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.ping();
        this.missedHeartbeats = 0;
      } catch {
        this.missedHeartbeats++;
        logger.warn({
          module: 'daemon-client',
          msg: 'Heartbeat missed',
          count: this.missedHeartbeats,
          threshold: this.options.heartbeatMissThreshold,
        });

        if (this.missedHeartbeats >= this.options.heartbeatMissThreshold) {
          this.stopHeartbeat();
          this.emit('daemon-lost', { missedHeartbeats: this.missedHeartbeats });
        }
      }
    }, this.options.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── Disconnect ────────────────────────────────────────────────

  /** Disconnect from the daemon. */
  disconnect(): void {
    this.connected = false;
    this.stopHeartbeat();
    this.rejectAllPending('Client disconnecting');

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  /** Full disposal — disconnects and prevents reconnection. */
  dispose(): void {
    this.disposed = true;
    this.disconnect();
  }

  // ── Helpers ───────────────────────────────────────────────────

  private readToken(): string {
    const tokenPath = join(this.socketDir, 'agent-host.token');
    try {
      return readFileSync(tokenPath, 'utf-8').trim();
    } catch (err) {
      throw new Error(`Cannot read daemon token at ${tokenPath}: ${(err as Error).message}`);
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
