/**
 * ForkTransport — orchestrator-side transport for communicating with
 * the agent server via child_process.fork().
 *
 * The agent server runs as a detached child process that survives orchestrator
 * restarts. Communication uses Node.js IPC (process.send / child.on('message')).
 * On connect, checks for an existing PID file and reconnects if the process is alive.
 *
 * State machine: disconnected → connecting → connected → disconnected
 *                                  ↑          ↓
 *                                  ← reconnecting ←
 *
 * Design: docs/design/agent-server-architecture.md
 */
import { fork, type ChildProcess } from 'node:child_process';
import { createConnection, type Socket } from 'node:net';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { logger } from '../utils/logger.js';
import {
  type AgentServerTransport,
  type TransportState,
  type OrchestratorMessage,
  type AgentServerMessage,
  type PongMessage,
  validateMessage,
  isAgentServerMessage,
} from './types.js';
import {
  AgentServerHealth,
  type AgentServerHealthOptions,
  type HealthState,
  type HealthStateChange,
} from '../agents/AgentServerHealth.js';

// ── Types ───────────────────────────────────────────────────────────

export interface ForkTransportOptions {
  /** Path to the agent server entry point script. */
  serverScript: string;
  /** Directory for PID file and state (default: ~/.flightdeck). */
  stateDir?: string;
  /** PID filename (default: 'agent-server.pid'). */
  pidFileName?: string;
  /** Port filename (default: 'agent-server.port'). */
  portFileName?: string;
  /** Token filename (default: 'agent-server.token'). */
  tokenFileName?: string;
  /** Node.js args passed to fork (e.g., ['--max-old-space-size=4096']). */
  execArgv?: string[];
  /** Environment variables for the child process. */
  env?: Record<string, string>;
  /** Timeout for waiting for 'ready' message from server on fork (ms, default: 10000). */
  readyTimeoutMs?: number;
  /** Timeout for reconnect attempts (ms, default: 5000). */
  reconnectTimeoutMs?: number;
  /** Whether to auto-reconnect on unexpected disconnect (default: true). */
  autoReconnect?: boolean;
  /** Delay before reconnect attempt (ms, default: 1000). */
  reconnectDelayMs?: number;
  /** Max consecutive reconnect attempts (default: 5). */
  maxReconnectAttempts?: number;
  /** TCP host for reconnection (default: '127.0.0.1'). */
  tcpHost?: string;
}

/** Internal ready message sent by child on startup. */
interface ReadyMessage {
  type: 'ready';
  pid: number;
}

function isReadyMessage(msg: unknown): msg is ReadyMessage {
  return !!msg && typeof msg === 'object'
    && (msg as Record<string, unknown>).type === 'ready'
    && typeof (msg as Record<string, unknown>).pid === 'number';
}

const DEFAULT_STATE_DIR = join(
  process.env.HOME ?? process.env.USERPROFILE ?? '/tmp',
  '.flightdeck',
);

// ── ForkTransport ───────────────────────────────────────────────────

export class ForkTransport implements AgentServerTransport {
  private _state: TransportState = 'disconnected';
  private child: ChildProcess | null = null;
  private messageHandlers = new Set<(message: AgentServerMessage) => void>();
  private stateHandlers = new Set<(state: TransportState) => void>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private pingCounter = 0;
  private health: AgentServerHealth | null = null;

  private readonly serverScript: string;
  private readonly stateDir: string;
  private readonly pidFilePath: string;
  private readonly portFilePath: string;
  private readonly tokenFilePath: string;
  private readonly execArgv: string[];
  private readonly childEnv: Record<string, string>;
  private readonly readyTimeoutMs: number;
  private readonly reconnectTimeoutMs: number;
  private readonly autoReconnect: boolean;
  private readonly reconnectDelayMs: number;
  private readonly maxReconnectAttempts: number;
  private readonly tcpHost: string;

  /** TCP socket used for reconnection (null when using IPC). */
  private tcpSocket: Socket | null = null;
  private tcpBuffer = '';

  constructor(options: ForkTransportOptions) {
    this.serverScript = resolve(options.serverScript);
    this.stateDir = options.stateDir ?? DEFAULT_STATE_DIR;
    this.pidFilePath = join(this.stateDir, options.pidFileName ?? 'agent-server.pid');
    this.portFilePath = join(this.stateDir, options.portFileName ?? 'agent-server.port');
    this.tokenFilePath = join(this.stateDir, options.tokenFileName ?? 'agent-server.token');
    this.execArgv = options.execArgv ?? [];
    this.childEnv = options.env ?? {};
    this.readyTimeoutMs = options.readyTimeoutMs ?? 10_000;
    this.reconnectTimeoutMs = options.reconnectTimeoutMs ?? 5_000;
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.tcpHost = options.tcpHost ?? '127.0.0.1';
  }

  // ── AgentServerTransport interface ────────────────────────────

  get state(): TransportState {
    return this._state;
  }

  get supportsReconnect(): boolean {
    return this.autoReconnect;
  }

  async connect(): Promise<void> {
    if (this.disposed) throw new Error('ForkTransport has been disposed');
    if (this._state === 'connected') throw new Error('Already connected');

    this.reconnectAttempts = 0;
    this.setState('connecting');

    // Try reconnecting to an existing agent server first
    const existingPid = this.readPidFile();
    if (existingPid !== null && this.isProcessAlive(existingPid)) {
      // Prefer TCP reconnection (with auth) when port + token files exist
      const port = this.readPortFile();
      const token = this.readTokenFile();
      if (port !== null && token !== null) {
        try {
          await this.reconnectViaTcp(port, token);
          return;
        } catch (err) {
          logger.info({
            module: 'fork-transport',
            msg: 'TCP reconnect failed, trying IPC re-fork',
            pid: existingPid,
            err: String(err),
          });
        }
      }

      // Fallback: IPC re-fork
      try {
        await this.reconnectToExisting(existingPid);
        return;
      } catch (err) {
        logger.info({
          module: 'fork-transport',
          msg: 'Reconnect to existing server failed, forking new one',
          pid: existingPid,
          err: String(err),
        });
        this.cleanupPidFile();
      }
    }

    // Fork a new agent server
    await this.forkNew();
  }

  async disconnect(): Promise<void> {
    this.cancelReconnect();
    this.stopHealthCheck();

    if (this.tcpSocket) {
      this.cleanupTcpSocket();
    }

    if (this.child) {
      // Disconnect the IPC channel but leave the child running (detached)
      this.detachChild();
    }

    this.setState('disconnected');
  }

  send(message: OrchestratorMessage): void {
    if (this._state !== 'connected') {
      throw new Error(`Cannot send: transport is ${this._state}`);
    }

    // TCP path
    if (this.tcpSocket && !this.tcpSocket.destroyed) {
      this.tcpSocket.write(JSON.stringify(message) + '\n');
      return;
    }

    // IPC path
    if (this.child?.connected) {
      this.child.send(message);
      return;
    }

    throw new Error('Cannot send: no active connection');
  }

  onMessage(handler: (message: AgentServerMessage) => void): () => void {
    this.messageHandlers.add(handler);
    return () => { this.messageHandlers.delete(handler); };
  }

  onStateChange(handler: (state: TransportState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => { this.stateHandlers.delete(handler); };
  }

  // ── Public helpers ────────────────────────────────────────────

  /** Full disposal — disconnect and prevent reconnection. */
  dispose(): void {
    this.disposed = true;
    this.cancelReconnect();
    this.stopHealthCheck();

    if (this.tcpSocket) {
      this.cleanupTcpSocket();
    }

    if (this.child) {
      this.detachChild();
    }

    this.messageHandlers.clear();
    this.stateHandlers.clear();
    this._state = 'disconnected';
  }

  /** Get the PID of the connected agent server (or null). */
  get serverPid(): number | null {
    return this.child?.pid ?? null;
  }

  /** Get the PID file path. */
  get pidFile(): string {
    return this.pidFilePath;
  }

  // ── Health Check ─────────────────────────────────────────────

  /**
   * Start periodic health checking via ping/pong.
   * Automatically sends pings and tracks pong responses.
   * Pong messages are intercepted before reaching normal message handlers.
   */
  startHealthCheck(options?: AgentServerHealthOptions): AgentServerHealth {
    this.stopHealthCheck();

    this.health = new AgentServerHealth(() => {
      const requestId = `hb-${++this.pingCounter}`;
      this.send({ type: 'ping', requestId });
      return requestId;
    }, options);

    this.health.start();
    return this.health;
  }

  /** Stop the health check interval. */
  stopHealthCheck(): void {
    if (this.health) {
      this.health.stop();
      this.health = null;
    }
  }

  /** Current health state, or null if health checking is not active. */
  get healthState(): HealthState | null {
    return this.health?.state ?? null;
  }

  /** The AgentServerHealth instance, or null if not active. */
  get healthMonitor(): AgentServerHealth | null {
    return this.health;
  }

  // ── Fork new server ───────────────────────────────────────────

  private async forkNew(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.cleanupChild();
          this.setState('disconnected');
          reject(new Error(`Agent server did not send ready message within ${this.readyTimeoutMs}ms`));
        }
      }, this.readyTimeoutMs);

      try {
        this.child = fork(this.serverScript, [], {
          detached: true,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          execArgv: this.execArgv,
          env: { ...process.env, ...this.childEnv },
        });
      } catch (err) {
        settled = true;
        clearTimeout(timeout);
        this.setState('disconnected');
        reject(new Error(`Failed to fork agent server: ${String(err)}`));
        return;
      }

      this.child.on('message', (msg: unknown) => {
        if (!settled && isReadyMessage(msg)) {
          settled = true;
          clearTimeout(timeout);
          this.writePidFile(msg.pid);
          this.setupChildHandlers();
          this.setState('connected');
          resolve();
          return;
        }

        // After ready, route messages normally
        if (settled) {
          this.handleChildMessage(msg);
        }
      });

      this.child.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          this.cleanupChild();
          this.setState('disconnected');
          reject(new Error(`Agent server fork error: ${err.message}`));
        } else {
          logger.warn({ module: 'fork-transport', msg: 'Child process error', err: String(err) });
        }
      });

      this.child.on('exit', (code, signal) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          this.child = null;
          this.setState('disconnected');
          reject(new Error(`Agent server exited during startup (code=${code}, signal=${signal})`));
        }
      });
    });
  }

  // ── Reconnect to existing ─────────────────────────────────────

  private async reconnectToExisting(pid: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.cleanupChild();
          reject(new Error(`Reconnect timed out after ${this.reconnectTimeoutMs}ms`));
        }
      }, this.reconnectTimeoutMs);

      try {
        // Fork a helper that connects to the existing process via IPC
        // We use process._debugProcess to send SIGUSR1, but for IPC we need
        // the original child reference. Since detached children lose IPC on
        // disconnect, we re-fork with a reconnect flag that the server detects.
        this.child = fork(this.serverScript, ['--reconnect', String(pid)], {
          detached: true,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          execArgv: this.execArgv,
          env: { ...process.env, ...this.childEnv },
        });
      } catch (err) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Failed to reconnect: ${String(err)}`));
        return;
      }

      this.child.on('message', (msg: unknown) => {
        if (!settled && isReadyMessage(msg)) {
          settled = true;
          clearTimeout(timeout);
          this.writePidFile(msg.pid);
          this.setupChildHandlers();
          this.setState('connected');
          resolve();
          return;
        }

        if (settled) {
          this.handleChildMessage(msg);
        }
      });

      this.child.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          this.cleanupChild();
          reject(new Error(`Reconnect error: ${err.message}`));
        }
      });

      this.child.on('exit', (code, signal) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          this.child = null;
          reject(new Error(`Server exited during reconnect (code=${code}, signal=${signal})`));
        }
      });
    });
  }

  // ── TCP reconnection with auth ────────────────────────────────

  private async reconnectViaTcp(port: number, token: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.cleanupTcpSocket();
          reject(new Error(`TCP reconnect timed out after ${this.reconnectTimeoutMs}ms`));
        }
      }, this.reconnectTimeoutMs);

      try {
        this.tcpSocket = createConnection({ host: this.tcpHost, port });
      } catch (err) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`TCP connect failed: ${String(err)}`));
        return;
      }

      this.tcpSocket.setEncoding('utf-8');

      this.tcpSocket.on('connect', () => {
        // Send AuthenticateMessage as first message
        const authMsg = {
          type: 'authenticate',
          requestId: `auth-${Date.now()}`,
          token,
        };
        this.tcpSocket!.write(JSON.stringify(authMsg) + '\n');
      });

      this.tcpSocket.on('data', (data: string) => {
        if (settled) {
          // After auth, route messages normally
          this.handleTcpData(data);
          return;
        }

        // During auth, look for AuthResultMessage
        this.tcpBuffer += data;
        const lines = this.tcpBuffer.split('\n');
        this.tcpBuffer = lines.pop()!;

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const msg = JSON.parse(trimmed);
            if (msg.type === 'auth_result') {
              settled = true;
              clearTimeout(timeout);

              if (msg.success) {
                this.setupTcpHandlers();
                this.setState('connected');
                resolve();
              } else {
                this.cleanupTcpSocket();
                reject(new Error(`TCP auth rejected: ${msg.error ?? 'unknown'}`));
              }
              return;
            }
            if (msg.type === 'error' && (msg.code === 'AUTH_REQUIRED' || msg.code === 'AUTH_FAILED')) {
              settled = true;
              clearTimeout(timeout);
              this.cleanupTcpSocket();
              reject(new Error(`TCP auth error: ${msg.message}`));
              return;
            }
          } catch {
            // Ignore parse errors during auth
          }
        }
      });

      this.tcpSocket.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          this.cleanupTcpSocket();
          reject(new Error(`TCP socket error: ${err.message}`));
        }
      });

      this.tcpSocket.on('close', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          this.tcpSocket = null;
          reject(new Error('TCP socket closed before auth completed'));
        }
      });
    });
  }

  private setupTcpHandlers(): void {
    if (!this.tcpSocket) return;

    // Remove connect-phase listeners and add runtime listeners
    this.tcpSocket.removeAllListeners('data');
    this.tcpSocket.removeAllListeners('error');
    this.tcpSocket.removeAllListeners('close');

    this.tcpSocket.on('data', (data: string) => {
      this.handleTcpData(data);
    });

    this.tcpSocket.on('close', () => {
      logger.info({ module: 'fork-transport', msg: 'TCP connection closed' });
      this.tcpSocket = null;
      this.handleUnexpectedDisconnect('TCP connection closed');
    });

    this.tcpSocket.on('error', (err) => {
      logger.warn({ module: 'fork-transport', msg: 'TCP socket error', err: String(err) });
    });
  }

  /** Parse NDJSON data from TCP socket and dispatch messages. */
  private handleTcpData(data: string): void {
    this.tcpBuffer += data;
    const lines = this.tcpBuffer.split('\n');
    this.tcpBuffer = lines.pop()!;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const raw = JSON.parse(trimmed);
        const validated = validateMessage(raw);
        if (validated && isAgentServerMessage(validated)) {
          // Feed pongs to the health monitor
          if (validated.type === 'pong' && this.health) {
            this.health.recordPong((validated as PongMessage).requestId);
          }

          for (const handler of this.messageHandlers) {
            try {
              handler(validated);
            } catch (err) {
              logger.error({ module: 'fork-transport', msg: 'Message handler error', err: String(err) });
            }
          }
        }
      } catch {
        logger.warn({ module: 'fork-transport', msg: 'Invalid JSON from TCP', data: data.slice(0, 100) });
      }
    }
  }

  private cleanupTcpSocket(): void {
    if (!this.tcpSocket) return;
    this.tcpSocket.removeAllListeners();
    try { this.tcpSocket.destroy(); } catch { /* ignore */ }
    this.tcpSocket = null;
    this.tcpBuffer = '';
  }

  // ── Child process management ──────────────────────────────────

  private setupChildHandlers(): void {
    if (!this.child) return;

    // Remove the connect-phase listeners; add runtime listeners
    this.child.removeAllListeners('message');
    this.child.removeAllListeners('error');
    this.child.removeAllListeners('exit');

    this.child.on('message', (msg: unknown) => {
      this.handleChildMessage(msg);
    });

    this.child.on('disconnect', () => {
      logger.info({ module: 'fork-transport', msg: 'IPC channel disconnected' });
      this.child = null;
      this.handleUnexpectedDisconnect('IPC channel disconnected');
    });

    this.child.on('exit', (code, signal) => {
      logger.info({ module: 'fork-transport', msg: 'Agent server exited', code, signal });
      this.child = null;
      this.cleanupPidFile();
      this.handleUnexpectedDisconnect(`Server exited (code=${code}, signal=${signal})`);
    });

    this.child.on('error', (err) => {
      logger.warn({ module: 'fork-transport', msg: 'Child process error', err: String(err) });
    });
  }

  private handleChildMessage(msg: unknown): void {
    const validated = validateMessage(msg);
    if (validated && isAgentServerMessage(validated)) {
      // Feed pongs to the health monitor
      if (validated.type === 'pong' && this.health) {
        this.health.recordPong((validated as PongMessage).requestId);
      }

      for (const handler of this.messageHandlers) {
        try {
          handler(validated);
        } catch (err) {
          logger.error({ module: 'fork-transport', msg: 'Message handler error', err: String(err) });
        }
      }
    }
  }

  private handleUnexpectedDisconnect(reason: string): void {
    if (this.disposed) return;

    if (this._state === 'connected' && this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.setState('reconnecting');
      this.scheduleReconnect(reason);
    } else {
      this.setState('disconnected');
    }
  }

  // ── Auto-reconnect ────────────────────────────────────────────

  private scheduleReconnect(reason: string): void {
    this.reconnectAttempts++;

    logger.info({
      module: 'fork-transport',
      msg: 'Scheduling reconnect',
      attempt: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
      delayMs: this.reconnectDelayMs,
      reason,
    });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      try {
        this.setState('connecting');
        await this.forkNew();
      } catch (err) {
        logger.warn({ module: 'fork-transport', msg: 'Reconnect failed', err: String(err) });

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.setState('reconnecting');
          this.scheduleReconnect(`retry after: ${String(err)}`);
        } else {
          logger.error({
            module: 'fork-transport',
            msg: 'Max reconnect attempts reached',
            attempts: this.reconnectAttempts,
          });
          this.setState('disconnected');
        }
      }
    }, this.reconnectDelayMs);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
  }

  // ── State management ──────────────────────────────────────────

  private setState(newState: TransportState): void {
    if (this._state === newState) return;

    const previous = this._state;
    this._state = newState;

    logger.info({
      module: 'fork-transport',
      msg: 'State change',
      from: previous,
      to: newState,
    });

    for (const handler of this.stateHandlers) {
      try {
        handler(newState);
      } catch (err) {
        logger.error({ module: 'fork-transport', msg: 'State handler error', err: String(err) });
      }
    }
  }

  // ── PID file management ───────────────────────────────────────

  private readPidFile(): number | null {
    try {
      if (!existsSync(this.pidFilePath)) return null;
      const content = readFileSync(this.pidFilePath, 'utf-8').trim();
      const pid = parseInt(content, 10);
      return Number.isFinite(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }

  private writePidFile(pid: number): void {
    try {
      mkdirSync(this.stateDir, { recursive: true });
      writeFileSync(this.pidFilePath, String(pid), { mode: 0o600 });
    } catch (err) {
      logger.warn({ module: 'fork-transport', msg: 'Failed to write PID file', err: String(err) });
    }
  }

  private cleanupPidFile(): void {
    try {
      if (existsSync(this.pidFilePath)) {
        unlinkSync(this.pidFilePath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  // ── Port / Token file readers ─────────────────────────────────

  private readPortFile(): number | null {
    try {
      if (!existsSync(this.portFilePath)) return null;
      const content = readFileSync(this.portFilePath, 'utf-8').trim();
      const port = parseInt(content, 10);
      return Number.isFinite(port) && port > 0 && port <= 65535 ? port : null;
    } catch {
      return null;
    }
  }

  private readTokenFile(): string | null {
    try {
      if (!existsSync(this.tokenFilePath)) return null;
      const token = readFileSync(this.tokenFilePath, 'utf-8').trim();
      return token.length > 0 ? token : null;
    } catch {
      return null;
    }
  }

  // ── Process utilities ─────────────────────────────────────────

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private detachChild(): void {
    if (!this.child) return;

    this.child.removeAllListeners();
    if (this.child.connected) {
      try { this.child.disconnect(); } catch { /* ignore */ }
    }
    this.child.unref();
    this.child = null;
  }

  private cleanupChild(): void {
    if (!this.child) return;
    this.child.removeAllListeners();
    try { this.child.kill(); } catch { /* ignore */ }
    this.child = null;
  }
}
