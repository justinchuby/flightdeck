/**
 * Daemon process — the persistent background process that keeps agents alive.
 *
 * Creates a Unix Domain Socket server, authenticates clients with a 256-bit
 * token, manages the single-client connection model, and dispatches JSON-RPC
 * commands. Buffers events when the server is disconnected and replays them
 * on reconnect.
 *
 * Design: packages/docs/design/hot-reload-agent-preservation.md
 */
import { createServer, type Server, type Socket } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  mkdirSync,
  existsSync,
  unlinkSync,
  openSync,
  writeSync,
  closeSync,
  fdatasyncSync,
  writeFileSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';
import { EventBuffer } from './EventBuffer.js';
import {
  type JsonRpcMessage,
  type JsonRpcRequest,
  type DaemonEvent,
  type DaemonAgentStatus,
  type AgentDescriptor,
  type AuthParams,
  type SpawnParams,
  type TerminateParams,
  type SendParams,
  type SubscribeParams,
  type ShutdownParams,
  type ConfigureParams,
  type MassFailureData,
  RPC_ERRORS,
  serializeMessage,
  parseNdjsonBuffer,
  createResponse,
  createErrorResponse,
  createNotification,
  isRequest,
  getSocketDir,
} from './DaemonProtocol.js';

// ── Types ───────────────────────────────────────────────────────────

export interface DaemonProcessOptions {
  /** Override socket directory (for testing). */
  socketDir?: string;
  /** Override socket filename (for testing). */
  socketName?: string;
  /** Auto-shutdown timeout when orphaned in ms (default: 12h). */
  orphanTimeoutMs?: number;
  /** Mass failure detector settings. */
  massFailure?: {
    threshold?: number;
    windowMs?: number;
    cooldownMs?: number;
  };
}

interface ManagedAgent {
  descriptor: AgentDescriptor;
  onMessage?: (message: string) => void;
  onTerminate?: (timeoutMs: number) => Promise<void>;
}

interface ConnectedClient {
  socket: Socket;
  pid: number;
  connectedAt: number;
  buffer: string;
}

// ── Mass Failure Detector ───────────────────────────────────────────

interface ExitRecord {
  agentId: string;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  timestamp: number;
}

class MassFailureDetector {
  private recentExits: ExitRecord[] = [];
  private paused = false;
  private pausedAt: number | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private threshold = 3,
    private windowMs = 60_000,
    private cooldownMs = 120_000,
  ) {}

  recordExit(record: ExitRecord): MassFailureData | null {
    this.recentExits.push(record);
    // Cap at 50 entries
    if (this.recentExits.length > 50) this.recentExits.shift();

    if (this.paused) return null;

    const now = Date.now();
    const windowStart = now - this.windowMs;
    const recentInWindow = this.recentExits.filter(r => r.timestamp >= windowStart);

    if (recentInWindow.length >= this.threshold) {
      this.paused = true;
      this.pausedAt = now;
      const pausedUntil = new Date(now + this.cooldownMs).toISOString();

      this.resumeTimer = setTimeout(() => {
        this.paused = false;
        this.pausedAt = null;
        this.resumeTimer = null;
      }, this.cooldownMs);

      return {
        exitCount: recentInWindow.length,
        windowSeconds: Math.round((now - recentInWindow[0].timestamp) / 1000),
        recentExits: recentInWindow.map(r => ({
          agentId: r.agentId,
          exitCode: r.exitCode,
          signal: r.signal,
          error: r.error,
          timestamp: new Date(r.timestamp).toISOString(),
        })),
        pausedUntil,
        likelyCause: this.detectCause(recentInWindow),
      };
    }

    return null;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  resume(): void {
    this.paused = false;
    this.pausedAt = null;
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
  }

  configure(opts: { threshold?: number; windowMs?: number; cooldownMs?: number }): void {
    if (opts.threshold !== undefined) this.threshold = opts.threshold;
    if (opts.windowMs !== undefined) this.windowMs = opts.windowMs;
    if (opts.cooldownMs !== undefined) this.cooldownMs = opts.cooldownMs;
  }

  dispose(): void {
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
  }

  private detectCause(exits: ExitRecord[]): MassFailureData['likelyCause'] {
    const errors = exits.map(e => e.error ?? '').filter(Boolean);
    if (errors.length === 0) return 'unknown';

    if (errors.every(e => /401|unauthorized/i.test(e))) return 'auth_failure';
    if (errors.every(e => /429|rate.?limit/i.test(e))) return 'rate_limit';
    if (errors.every(e => /503|unavailable/i.test(e))) return 'model_unavailable';

    const signals = exits.map(e => e.signal).filter(Boolean);
    if (signals.every(s => s === 'SIGKILL') || exits.every(e => e.exitCode === 137)) {
      return 'resource_exhaustion';
    }

    return 'unknown';
  }
}

// ── Daemon Process ──────────────────────────────────────────────────

export class DaemonProcess {
  private server: Server | null = null;
  private client: ConnectedClient | null = null;
  private agents = new Map<string, ManagedAgent>();
  private eventBuffer: EventBuffer;
  private massFailureDetector: MassFailureDetector;
  private sessionToken: string = '';
  private socketPath: string;
  private socketDir: string;
  private startedAt: number = 0;
  private orphanTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  private readonly orphanTimeoutMs: number;
  private readonly socketName: string;

  constructor(options: DaemonProcessOptions = {}) {
    this.socketDir = options.socketDir ?? getSocketDir();
    this.socketName = options.socketName ?? 'agent-host.sock';
    this.socketPath = join(this.socketDir, this.socketName);
    this.orphanTimeoutMs = options.orphanTimeoutMs ?? 12 * 60 * 60 * 1000;

    this.eventBuffer = new EventBuffer();

    const mf = options.massFailure ?? {};
    this.massFailureDetector = new MassFailureDetector(
      mf.threshold,
      mf.windowMs,
      mf.cooldownMs,
    );
  }

  /** The UDS socket path. */
  get path(): string {
    return this.socketPath;
  }

  /** The authentication token for this session. */
  get token(): string {
    return this.sessionToken;
  }

  /** Whether a client is currently connected. */
  get hasClient(): boolean {
    return this.client !== null;
  }

  /** Number of managed agents. */
  get agentCount(): number {
    return this.agents.size;
  }

  /** Whether spawning is paused due to mass failure. */
  get isSpawningPaused(): boolean {
    return this.massFailureDetector.isPaused;
  }

  // ── Startup ─────────────────────────────────────────────────────

  /** Start the daemon: create socket, generate token, begin listening. */
  async start(): Promise<void> {
    if (this.disposed) throw new Error('DaemonProcess has been disposed');
    if (this.server) throw new Error('DaemonProcess is already running');

    this.startedAt = Date.now();

    // Create socket directory with owner-only access
    mkdirSync(this.socketDir, { recursive: true, mode: 0o700 });

    // Verify directory ownership
    this.verifyDirectoryOwnership();

    // Clean up stale socket
    await this.cleanStaleSocket();

    // Generate session token
    this.sessionToken = randomBytes(32).toString('hex');

    // Write token file with restrictive permissions (atomic via fd)
    this.writeTokenFile();

    // Write PID file (informational only)
    this.writePidFile();

    // Create UDS server with restrictive umask
    await this.createServer();

    logger.info({
      module: 'daemon',
      msg: 'Daemon started',
      socketPath: this.socketPath,
      pid: process.pid,
    });
  }

  // ── Shutdown ────────────────────────────────────────────────────

  /** Graceful shutdown: terminate agents, close connections, clean up files. */
  async stop(options: { persist?: boolean; timeoutMs?: number } = {}): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    const { persist = false, timeoutMs = 5000 } = options;

    logger.info({ module: 'daemon', msg: 'Shutting down', persist, timeoutMs });

    // Notify connected client
    if (this.client) {
      this.sendNotification('daemon.event', {
        event: EventBuffer.createEvent('daemon:shutting_down', { persist }),
      });
    }

    // Cancel orphan timer
    if (this.orphanTimer) {
      clearTimeout(this.orphanTimer);
      this.orphanTimer = null;
    }

    // Terminate agents (unless persisting)
    if (!persist) {
      await this.terminateAllAgents(timeoutMs);
    } else {
      this.writeShutdownManifest();
    }

    // Disconnect client
    if (this.client) {
      this.client.socket.destroy();
      this.client = null;
    }

    // Close server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    // Clean up files
    this.cleanupFiles();

    this.massFailureDetector.dispose();

    logger.info({ module: 'daemon', msg: 'Daemon stopped' });
  }

  // ── Agent Management ──────────────────────────────────────────

  /**
   * Register an agent with the daemon.
   * The actual process spawning is handled externally — the daemon tracks state.
   */
  registerAgent(
    descriptor: AgentDescriptor,
    handlers?: { onMessage?: (msg: string) => void; onTerminate?: (timeoutMs: number) => Promise<void> },
  ): void {
    this.agents.set(descriptor.agentId, {
      descriptor,
      onMessage: handlers?.onMessage,
      onTerminate: handlers?.onTerminate,
    });

    const event = EventBuffer.createEvent('agent:spawned', {
      agent: descriptor,
    }, descriptor.agentId);

    this.emitEvent(event);
  }

  /** Update an agent's status. */
  updateAgentStatus(agentId: string, status: DaemonAgentStatus, extra?: Record<string, unknown>): void {
    const managed = this.agents.get(agentId);
    if (!managed) return;

    managed.descriptor.status = status;
    if (extra?.sessionId !== undefined) {
      managed.descriptor.sessionId = extra.sessionId as string | null;
    }
    if (extra?.pid !== undefined) {
      managed.descriptor.pid = extra.pid as number | null;
    }

    const event = EventBuffer.createEvent('agent:status', {
      agentId,
      status,
      ...extra,
    }, agentId);

    managed.descriptor.lastEventId = event.eventId;
    this.emitEvent(event);
  }

  /**
   * Record an agent exit. Removes the agent from active management
   * and checks for mass failure.
   */
  recordAgentExit(
    agentId: string,
    exitCode: number | null,
    signal: string | null,
    error: string | null,
  ): void {
    const managed = this.agents.get(agentId);
    if (managed) {
      managed.descriptor.status = exitCode === 0 ? 'exited' : 'crashed';
    }

    const event = EventBuffer.createEvent('agent:exit', {
      agentId,
      exitCode,
      signal,
      error,
    }, agentId);

    if (managed) {
      managed.descriptor.lastEventId = event.eventId;
    }
    this.emitEvent(event);

    // Check mass failure
    const massFailure = this.massFailureDetector.recordExit({
      agentId,
      exitCode,
      signal,
      error,
      timestamp: Date.now(),
    });

    if (massFailure) {
      logger.warn({
        module: 'daemon',
        msg: 'Mass failure detected',
        exitCount: massFailure.exitCount,
        likelyCause: massFailure.likelyCause,
      });
      const mfEvent = EventBuffer.createEvent('daemon:mass_failure', massFailure as unknown as Record<string, unknown>);
      this.emitEvent(mfEvent);
    }
  }

  /** Get all agent descriptors. */
  listAgents(): AgentDescriptor[] {
    return Array.from(this.agents.values()).map(a => ({ ...a.descriptor }));
  }

  /** Get a single agent descriptor. */
  getAgent(agentId: string): AgentDescriptor | undefined {
    return this.agents.get(agentId)?.descriptor;
  }

  // ── Connection Handling ───────────────────────────────────────

  private async createServer(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server = createServer((socket) => this.handleConnection(socket));

      this.server.on('error', (err) => {
        logger.error({ module: 'daemon', msg: 'Server error', err: String(err) });
        reject(err);
      });

      // Set restrictive umask BEFORE listen() so socket is born with 0600
      const previousUmask = process.umask(0o177);

      this.server.listen(this.socketPath, () => {
        process.umask(previousUmask);
        resolve();
      });
    });
  }

  private handleConnection(socket: Socket): void {
    logger.info({ module: 'daemon', msg: 'New connection attempt' });

    let buffer = '';
    let authenticated = false;

    // First message must be auth — 5s timeout
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        logger.warn({ module: 'daemon', msg: 'Auth timeout — disconnecting' });
        socket.destroy();
      }
    }, 5000);

    socket.on('data', (data) => {
      buffer += data.toString();
      const [messages, remaining] = parseNdjsonBuffer(buffer);
      buffer = remaining;

      for (const msg of messages) {
        if (!authenticated) {
          // First message must be auth
          if (isRequest(msg) && msg.method === 'auth') {
            clearTimeout(authTimeout);
            authenticated = this.handleAuth(socket, msg);
          } else {
            socket.write(serializeMessage(
              createErrorResponse(
                isRequest(msg) ? msg.id : 0,
                RPC_ERRORS.AUTH_REQUIRED,
                'Authentication required as first message',
              ),
            ));
            socket.destroy();
          }
          return;
        }

        // Authenticated — dispatch
        if (isRequest(msg)) {
          this.handleRequest(msg);
        }
      }
    });

    socket.on('close', () => {
      clearTimeout(authTimeout);
      if (authenticated && this.client?.socket === socket) {
        this.handleClientDisconnect();
      }
    });

    socket.on('error', (err) => {
      clearTimeout(authTimeout);
      logger.warn({ module: 'daemon', msg: 'Socket error', err: String(err) });
      if (authenticated && this.client?.socket === socket) {
        this.handleClientDisconnect();
      }
    });
  }

  private handleAuth(socket: Socket, request: JsonRpcRequest): boolean {
    const params = request.params as unknown as AuthParams | undefined;
    if (!params?.token) {
      socket.write(serializeMessage(
        createErrorResponse(request.id, RPC_ERRORS.AUTH_FAILED, 'Missing token'),
      ));
      socket.destroy();
      return false;
    }

    // Timing-safe token comparison
    const provided = Buffer.from(params.token);
    const expected = Buffer.from(this.sessionToken);

    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      socket.write(serializeMessage(
        createErrorResponse(request.id, RPC_ERRORS.AUTH_FAILED, 'Invalid token'),
      ));
      socket.destroy();
      return false;
    }

    // Single-client: reject if another client is connected
    if (this.client) {
      const elapsed = Math.round((Date.now() - this.client.connectedAt) / 1000);
      socket.write(serializeMessage(
        createErrorResponse(
          request.id,
          RPC_ERRORS.CLIENT_ALREADY_CONNECTED,
          `Connection rejected: server PID ${this.client.pid} connected ${elapsed}s ago is still active`,
        ),
      ));
      socket.destroy();
      return false;
    }

    // Accept client
    this.client = {
      socket,
      pid: params.pid ?? 0,
      connectedAt: Date.now(),
      buffer: '',
    };

    // Cancel orphan timer
    if (this.orphanTimer) {
      clearTimeout(this.orphanTimer);
      this.orphanTimer = null;
    }

    // Stop event buffering
    this.eventBuffer.stopBuffering();

    // Send auth success
    socket.write(serializeMessage(
      createResponse(request.id, {
        daemonPid: process.pid,
        uptime: Math.round((Date.now() - this.startedAt) / 1000),
        agentCount: this.agents.size,
      }),
    ));

    logger.info({
      module: 'daemon',
      msg: 'Client authenticated',
      clientPid: params.pid,
      agentCount: this.agents.size,
    });

    // Emit connection event
    const event = EventBuffer.createEvent('daemon:client_connected', {
      clientPid: params.pid,
    });
    this.emitEvent(event);

    return true;
  }

  private handleClientDisconnect(): void {
    const clientPid = this.client?.pid;
    this.client = null;

    logger.info({
      module: 'daemon',
      msg: 'Client disconnected — entering orphaned mode',
      clientPid,
    });

    // Start event buffering
    this.eventBuffer.startBuffering();

    // Start orphan auto-shutdown timer
    if (this.orphanTimeoutMs > 0) {
      this.orphanTimer = setTimeout(() => {
        logger.warn({
          module: 'daemon',
          msg: 'Orphan timeout — shutting down',
          timeoutMs: this.orphanTimeoutMs,
        });
        this.stop().catch(err => {
          logger.error({ module: 'daemon', msg: 'Shutdown failed', err: String(err) });
        });
      }, this.orphanTimeoutMs);
    }

    // Emit disconnection event (buffered)
    const event = EventBuffer.createEvent('daemon:client_disconnected', { clientPid });
    this.emitEvent(event);
  }

  // ── Request Dispatch ──────────────────────────────────────────

  private handleRequest(request: JsonRpcRequest): void {
    try {
      switch (request.method) {
        case 'ping':
          this.sendResponse(request.id, { pong: true, timestamp: Date.now() });
          break;

        case 'list':
          this.sendResponse(request.id, { agents: this.listAgents() });
          break;

        case 'spawn':
          this.handleSpawn(request);
          break;

        case 'terminate':
          this.handleTerminate(request);
          break;

        case 'send':
          this.handleSend(request);
          break;

        case 'subscribe':
          this.handleSubscribe(request);
          break;

        case 'shutdown':
          this.handleShutdown(request);
          break;

        case 'configure':
          this.handleConfigure(request);
          break;

        case 'resumeSpawning':
          this.massFailureDetector.resume();
          this.sendResponse(request.id, { resumed: true });
          break;

        default:
          this.sendError(request.id, RPC_ERRORS.METHOD_NOT_FOUND, `Unknown method: ${request.method}`);
      }
    } catch (err) {
      this.sendError(request.id, RPC_ERRORS.INTERNAL_ERROR, String(err));
    }
  }

  private handleSpawn(request: JsonRpcRequest): void {
    const params = request.params as unknown as SpawnParams | undefined;
    if (!params?.agentId || !params.role || !params.model) {
      this.sendError(request.id, RPC_ERRORS.INVALID_PARAMS, 'Missing required params: agentId, role, model');
      return;
    }

    if (this.massFailureDetector.isPaused) {
      this.sendError(request.id, RPC_ERRORS.SPAWNING_PAUSED, 'Spawning paused due to mass failure');
      return;
    }

    if (this.agents.has(params.agentId)) {
      this.sendError(request.id, RPC_ERRORS.INVALID_PARAMS, `Agent ${params.agentId} already exists`);
      return;
    }

    // Create the agent descriptor — actual process spawning is external
    const descriptor: AgentDescriptor = {
      agentId: params.agentId,
      pid: null,
      role: params.role,
      model: params.model,
      status: 'starting',
      sessionId: params.sessionId ?? null,
      taskSummary: params.taskSummary ?? null,
      spawnedAt: new Date().toISOString(),
      lastEventId: null,
    };

    this.registerAgent(descriptor);
    this.sendResponse(request.id, { agentId: params.agentId, pid: null });
  }

  private async handleTerminate(request: JsonRpcRequest): Promise<void> {
    const params = request.params as unknown as TerminateParams | undefined;
    if (!params?.agentId) {
      this.sendError(request.id, RPC_ERRORS.INVALID_PARAMS, 'Missing required param: agentId');
      return;
    }

    const managed = this.agents.get(params.agentId);
    if (!managed) {
      this.sendError(request.id, RPC_ERRORS.AGENT_NOT_FOUND, `Agent ${params.agentId} not found`);
      return;
    }

    try {
      if (managed.onTerminate) {
        await managed.onTerminate(params.timeoutMs ?? 5000);
      }
      this.updateAgentStatus(params.agentId, 'exited');
      this.agents.delete(params.agentId);
      this.sendResponse(request.id, { terminated: true });
    } catch (err) {
      this.sendError(request.id, RPC_ERRORS.INTERNAL_ERROR, `Terminate failed: ${String(err)}`);
    }
  }

  private handleSend(request: JsonRpcRequest): void {
    const params = request.params as unknown as SendParams | undefined;
    if (!params?.agentId || params.message === undefined) {
      this.sendError(request.id, RPC_ERRORS.INVALID_PARAMS, 'Missing required params: agentId, message');
      return;
    }

    const managed = this.agents.get(params.agentId);
    if (!managed) {
      this.sendError(request.id, RPC_ERRORS.AGENT_NOT_FOUND, `Agent ${params.agentId} not found`);
      return;
    }

    if (managed.onMessage) {
      managed.onMessage(params.message);
      this.sendResponse(request.id, { sent: true });
    } else {
      this.sendError(request.id, RPC_ERRORS.INTERNAL_ERROR, 'Agent has no message handler');
    }
  }

  private handleSubscribe(request: JsonRpcRequest): void {
    const params = request.params as unknown as SubscribeParams | undefined;

    const events = this.eventBuffer.drain(
      params?.agentId,
      params?.lastSeenEventId,
    );

    // If fromStart, also include current agent descriptors
    if (params?.fromStart) {
      const agents = params.agentId
        ? [this.getAgent(params.agentId)].filter(Boolean)
        : this.listAgents();

      this.sendResponse(request.id, { agents, bufferedEvents: events });
    } else {
      this.sendResponse(request.id, { bufferedEvents: events });
    }
  }

  private handleShutdown(request: JsonRpcRequest): void {
    const params = request.params as unknown as ShutdownParams | undefined;
    this.sendResponse(request.id, { acknowledged: true });

    // Schedule shutdown after response is sent
    setImmediate(() => {
      this.stop({
        persist: params?.persist,
        timeoutMs: params?.timeoutMs,
      }).catch(err => {
        logger.error({ module: 'daemon', msg: 'Shutdown failed', err: String(err) });
      });
    });
  }

  private handleConfigure(request: JsonRpcRequest): void {
    const params = request.params as unknown as ConfigureParams | undefined;

    if (params?.massFailure) {
      this.massFailureDetector.configure({
        threshold: params.massFailure.threshold,
        windowMs: params.massFailure.windowSeconds ? params.massFailure.windowSeconds * 1000 : undefined,
        cooldownMs: params.massFailure.cooldownSeconds ? params.massFailure.cooldownSeconds * 1000 : undefined,
      });
    }

    this.sendResponse(request.id, { configured: true });
  }

  // ── Event Emission ────────────────────────────────────────────

  private emitEvent(event: DaemonEvent): void {
    // Buffer if no client
    this.eventBuffer.push(event);

    // Send to connected client
    if (this.client) {
      try {
        this.client.socket.write(serializeMessage(
          createNotification('daemon.event', { event: event as unknown as Record<string, unknown> }),
        ));
      } catch (err) {
        logger.warn({ module: 'daemon', msg: 'Failed to emit event', err: String(err) });
      }
    }
  }

  private sendResponse(id: number, result: unknown): void {
    if (!this.client) return;
    try {
      this.client.socket.write(serializeMessage(createResponse(id, result)));
    } catch (err) {
      logger.warn({ module: 'daemon', msg: 'Failed to send response', err: String(err) });
    }
  }

  private sendError(id: number, code: number, message: string): void {
    if (!this.client) return;
    try {
      this.client.socket.write(serializeMessage(createErrorResponse(id, code, message)));
    } catch (err) {
      logger.warn({ module: 'daemon', msg: 'Failed to send error', err: String(err) });
    }
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    if (!this.client) return;
    try {
      this.client.socket.write(serializeMessage(createNotification(method, params)));
    } catch (err) {
      logger.warn({ module: 'daemon', msg: 'Failed to send notification', err: String(err) });
    }
  }

  // ── Agent Termination ─────────────────────────────────────────

  private async terminateAllAgents(timeoutMs: number): Promise<void> {
    const terminations = Array.from(this.agents.entries()).map(async ([id, managed]) => {
      try {
        if (managed.onTerminate) {
          await managed.onTerminate(timeoutMs);
        }
        this.updateAgentStatus(id, 'exited');
      } catch (err) {
        logger.warn({ module: 'daemon', msg: 'Agent terminate failed', agentId: id, err: String(err) });
      }
    });

    await Promise.allSettled(terminations);
    this.agents.clear();
  }

  // ── File Management ───────────────────────────────────────────

  private verifyDirectoryOwnership(): void {
    try {
      const stat = statSync(this.socketDir);
      const uid = process.getuid?.();
      if (uid !== undefined && stat.uid !== uid) {
        throw new Error(
          `Socket directory ${this.socketDir} is owned by uid ${stat.uid}, ` +
          `but daemon is running as uid ${uid}. ` +
          `This usually means a previous run used sudo. Fix: sudo rm -rf ${this.socketDir}`,
        );
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  private async cleanStaleSocket(): Promise<void> {
    if (!existsSync(this.socketPath)) return;

    return new Promise<void>((resolve) => {
      const { connect } = require('node:net') as typeof import('node:net');
      const probe = connect(this.socketPath);

      probe.on('connect', () => {
        // Live daemon already running
        probe.destroy();
        throw new Error(`Another daemon is already running at ${this.socketPath}`);
      });

      probe.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ECONNREFUSED') {
          // Stale socket — clean up
          try { unlinkSync(this.socketPath); } catch { /* ignore */ }
          resolve();
        } else {
          throw new Error(`Cannot probe daemon socket: ${err.code} — ${err.message}`);
        }
      });
    });
  }

  private writeTokenFile(): void {
    const tokenPath = join(this.socketDir, 'agent-host.token');
    const fd = openSync(tokenPath, 'w', 0o600);
    writeSync(fd, this.sessionToken);
    fdatasyncSync(fd);
    closeSync(fd);
  }

  private writePidFile(): void {
    const pidPath = join(this.socketDir, 'agent-host.pid');
    writeFileSync(pidPath, String(process.pid), { mode: 0o644 });
  }

  private writeShutdownManifest(): void {
    const manifestPath = join(this.socketDir, 'daemon-manifest.json');
    const manifest = {
      version: '1.0.0',
      shutdownAt: new Date().toISOString(),
      shutdownReason: 'graceful',
      agents: this.listAgents(),
    };
    try {
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    } catch (err) {
      logger.warn({ module: 'daemon', msg: 'Failed to write manifest', err: String(err) });
    }
  }

  private cleanupFiles(): void {
    const files = [
      this.socketPath,
      join(this.socketDir, 'agent-host.token'),
      join(this.socketDir, 'agent-host.pid'),
    ];
    for (const f of files) {
      try { unlinkSync(f); } catch { /* ignore */ }
    }
  }

  /** Read an existing shutdown manifest (for resume). */
  static readManifest(socketDir?: string): { agents: AgentDescriptor[]; shutdownAt: string } | null {
    const dir = socketDir ?? getSocketDir();
    const manifestPath = join(dir, 'daemon-manifest.json');
    try {
      const data = readFileSync(manifestPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
}
