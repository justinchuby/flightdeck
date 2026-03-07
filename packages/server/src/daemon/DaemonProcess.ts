/**
 * Daemon process — the persistent background process that keeps agents alive.
 *
 * Creates a Unix Domain Socket server, authenticates clients with a 256-bit
 * token, manages the single-client connection model, and dispatches JSON-RPC
 * commands. Buffers events when the server is disconnected and replays them
 * on reconnect.
 *
 * Supports two lifecycle modes:
 * - production: daemon shuts down when the server disconnects (no orphans)
 * - development: daemon persists, agents survive for hot-reload iteration
 *
 * Design: packages/docs/design/hot-reload-agent-preservation.md
 */
import { createServer, type Server, type Socket } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  openSync,
  writeSync,
  closeSync,
  fdatasyncSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { logger } from '../utils/logger.js';
import { EventBuffer } from './EventBuffer.js';
import {
  type JsonRpcRequest,
  type DaemonEvent,
  type DaemonAgentStatus,
  type DaemonLifecycleMode,
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
} from './DaemonProtocol.js';
import { createTransport, type TransportAdapter } from './platform.js';
import { MassFailureDetector } from './MassFailureDetector.js';

// ── Constants ───────────────────────────────────────────────────────

/** Maximum NDJSON buffer size (1 MB) to prevent unbounded memory from malformed input. */
const MAX_NDJSON_LINE_LENGTH = 1_048_576;

/** Maximum number of exited/crashed agents to retain in the map for status queries. */
const MAX_DEAD_AGENTS = 200;

// ── Types ───────────────────────────────────────────────────────────

export interface DaemonProcessOptions {
  /** Override socket directory (for testing). */
  socketDir?: string;
  /** Override socket filename (for testing). */
  socketName?: string;
  /** Lifecycle mode: 'production' (default) or 'development'. */
  mode?: DaemonLifecycleMode;
  /** Auto-shutdown timeout when orphaned in ms (default: 12h). Dev mode only. */
  orphanTimeoutMs?: number;
  /** Grace period before production shutdown on disconnect in ms (default: 5000). */
  productionGracePeriodMs?: number;
  /** Orphan warning intervals in ms (default: [1h, 6h, 11h]). Dev mode only. */
  orphanWarningIntervalsMs?: number[];
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
  private orphanWarningTimers: ReturnType<typeof setTimeout>[] = [];
  private disposed = false;
  private signalCleanup: (() => void) | null = null;
  private _mode: DaemonLifecycleMode;
  private lastShutdownReason: string | null = null;

  /** Cross-platform transport adapter for IPC, permissions, and signal handling. */
  readonly transport: TransportAdapter;

  private readonly orphanTimeoutMs: number;
  private readonly productionGracePeriodMs: number;
  private readonly orphanWarningIntervalsMs: number[];
  private readonly socketName: string;

  constructor(options: DaemonProcessOptions = {}) {
    this.transport = createTransport(options.socketDir);
    this.socketDir = options.socketDir ?? this.transport.getSocketDir();
    this.socketName = options.socketName ?? 'agent-host.sock';
    this.socketPath = this.transport.getAddress(this.socketName);
    this._mode = options.mode ?? DaemonProcess.detectMode();
    this.orphanTimeoutMs = options.orphanTimeoutMs ?? 12 * 60 * 60 * 1000;
    this.productionGracePeriodMs = options.productionGracePeriodMs ?? 5000;
    this.orphanWarningIntervalsMs = options.orphanWarningIntervalsMs ?? [
      1 * 60 * 60 * 1000,   // 1h
      6 * 60 * 60 * 1000,   // 6h
      11 * 60 * 60 * 1000,  // 11h
    ];

    this.eventBuffer = new EventBuffer();

    const mf = options.massFailure ?? {};
    this.massFailureDetector = new MassFailureDetector(mf);
  }

  /**
   * Detect lifecycle mode from environment.
   * Dev mode if tsx watch, ts-node-dev, nodemon, or NODE_ENV=development.
   */
  static detectMode(): DaemonLifecycleMode {
    if (
      process.env.TSX_WATCH ||
      process.env.TS_NODE_DEV ||
      process.env.NODEMON ||
      process.env.NODE_ENV === 'development'
    ) {
      return 'development';
    }
    return 'production';
  }

  /** The IPC address (socket path on Unix, pipe name on Windows). */
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

  /** Current lifecycle mode. */
  get mode(): DaemonLifecycleMode {
    return this._mode;
  }

  /** Switch lifecycle mode at runtime. */
  setMode(mode: DaemonLifecycleMode): void {
    const previous = this._mode;
    this._mode = mode;
    if (previous !== mode) {
      logger.info({ module: 'daemon', msg: 'Lifecycle mode changed', from: previous, to: mode });
    }
  }

  // ── Startup ─────────────────────────────────────────────────────

  /** Start the daemon: create socket, generate token, begin listening. */
  async start(): Promise<void> {
    if (this.disposed) throw new Error('DaemonProcess has been disposed');
    if (this.server) throw new Error('DaemonProcess is already running');

    this.startedAt = Date.now();

    // Create socket directory with platform-appropriate permissions
    this.transport.ensureSocketDir();

    // Verify directory ownership (Unix: uid check, Windows: DACL)
    this.transport.verifyDirectoryOwnership();

    // Clean up stale socket/pipe
    const staleResult = await this.transport.cleanupStale(this.socketPath);
    if (staleResult === 'live-daemon') {
      throw new Error(`Another daemon is already running at ${this.socketPath}`);
    }

    // Generate session token
    this.sessionToken = randomBytes(32).toString('hex');

    // Write token file with restrictive permissions (atomic via fd)
    this.writeTokenFile();

    // Write PID file (informational only)
    this.writePidFile();

    // Create IPC server with platform-appropriate security
    await this.createServer();

    // Register cross-platform signal handlers
    this.signalCleanup = this.transport.setupSignalHandlers((signal) => {
      logger.info({ module: 'daemon', msg: 'Received signal', signal });
      this.stop({ persist: signal !== 'SIGKILL', reason: `signal-${signal}` }).catch(err => {
        logger.error({ module: 'daemon', msg: 'Signal-triggered shutdown failed', err: String(err) });
      });
    });

    logger.info({
      module: 'daemon',
      msg: 'Daemon started',
      platform: this.transport.platform,
      socketPath: this.socketPath,
      pid: process.pid,
      mode: this._mode,
    });
  }

  // ── Shutdown ────────────────────────────────────────────────────

  /** Graceful shutdown: terminate agents, close connections, clean up files. */
  async stop(options: { persist?: boolean; timeoutMs?: number; reason?: string } = {}): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    const { persist = false, timeoutMs = 5000, reason = 'manual' } = options;
    this.lastShutdownReason = reason;

    logger.info({ module: 'daemon', msg: 'Shutting down', persist, timeoutMs, reason, mode: this._mode });

    // Notify connected client
    if (this.client) {
      this.sendNotification('daemon.event', {
        event: EventBuffer.createEvent('daemon:shutting_down', { persist, reason }),
      });
    }

    // Cancel all timers
    this.clearOrphanTimers();

    // Always write manifest for resume (includes agent state)
    this.writeShutdownManifest(reason);

    // Terminate agents (unless persisting)
    if (!persist) {
      await this.terminateAllAgents(timeoutMs);
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

    // Remove signal handlers to prevent listener leaks
    if (this.signalCleanup) {
      this.signalCleanup();
      this.signalCleanup = null;
    }

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
   * Record an agent exit. Updates status and checks for mass failure.
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

  /**
   * Remove dead agents (exited/crashed) when the map exceeds MAX_DEAD_AGENTS.
   * Keeps the most recently exited agents for status queries.
   */
  private pruneDeadAgents(): void {
    const deadStatuses = new Set(['exited', 'crashed']);
    const deadEntries: [string, ManagedAgent][] = [];

    for (const [id, managed] of this.agents) {
      if (deadStatuses.has(managed.descriptor.status)) {
        deadEntries.push([id, managed]);
      }
    }

    if (deadEntries.length <= MAX_DEAD_AGENTS) return;

    // Sort by lastEventId ascending (oldest first) and remove excess
    deadEntries.sort((a, b) =>
      (a[1].descriptor.lastEventId ?? '').localeCompare(b[1].descriptor.lastEventId ?? ''),
    );

    const toRemove = deadEntries.length - MAX_DEAD_AGENTS;
    for (let i = 0; i < toRemove; i++) {
      this.agents.delete(deadEntries[i][0]);
    }
  }

  // ── Connection Handling ───────────────────────────────────────

  private async createServer(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server = createServer((socket) => this.handleConnection(socket));

      this.server.on('error', (err) => {
        logger.error({ module: 'daemon', msg: 'Server error', err: String(err) });
        reject(err);
      });

      // Apply platform-specific security before listen()
      const restoreUmask = this.transport.secureBefore();

      this.server.listen(this.socketPath, () => {
        restoreUmask();
        resolve();
      });
    });
  }

  private handleConnection(socket: Socket): void {
    logger.info({ module: 'daemon', msg: 'New connection attempt' });

    let buffer = '';
    let authenticated = false;

    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        logger.warn({ module: 'daemon', msg: 'Auth timeout — disconnecting' });
        socket.destroy();
      }
    }, 5000);

    socket.on('data', (data) => {
      buffer += data.toString();

      // Guard against unbounded memory from malformed input (no newlines)
      if (buffer.length > MAX_NDJSON_LINE_LENGTH) {
        logger.warn({ module: 'daemon', msg: 'NDJSON buffer exceeded 1MB limit — disconnecting', bufferLength: buffer.length });
        socket.destroy();
        return;
      }

      const [messages, remaining] = parseNdjsonBuffer(buffer);
      buffer = remaining;

      for (const msg of messages) {
        if (!authenticated) {
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

    const provided = Buffer.from(params.token);
    const expected = Buffer.from(this.sessionToken);

    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      socket.write(serializeMessage(
        createErrorResponse(request.id, RPC_ERRORS.AUTH_FAILED, 'Invalid token'),
      ));
      socket.destroy();
      return false;
    }

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

    this.client = {
      socket,
      pid: params.pid ?? 0,
      connectedAt: Date.now(),
      buffer: '',
    };

    // Cancel orphan timers (including warnings) on reconnect
    this.clearOrphanTimers();

    this.eventBuffer.stopBuffering();

    socket.write(serializeMessage(
      createResponse(request.id, {
        daemonPid: process.pid,
        uptime: Math.round((Date.now() - this.startedAt) / 1000),
        agentCount: this.agents.size,
        mode: this._mode,
      }),
    ));

    logger.info({
      module: 'daemon',
      msg: 'Client authenticated',
      clientPid: params.pid,
      agentCount: this.agents.size,
      mode: this._mode,
    });

    const event = EventBuffer.createEvent('daemon:client_connected', {
      clientPid: params.pid,
    });
    this.emitEvent(event);

    return true;
  }

  // ── Client Disconnect: Mode-Aware ─────────────────────────────

  private handleClientDisconnect(): void {
    const clientPid = this.client?.pid;
    this.client = null;

    // Start event buffering (both modes)
    this.eventBuffer.startBuffering();
    const event = EventBuffer.createEvent('daemon:client_disconnected', { clientPid, mode: this._mode });
    this.emitEvent(event);

    if (this._mode === 'production') {
      // Production: shut down after brief grace period (handles race with tsx watch restart)
      logger.info({
        module: 'daemon',
        msg: 'Client disconnected in production mode — shutting down',
        clientPid,
        gracePeriodMs: this.productionGracePeriodMs,
      });

      this.orphanTimer = setTimeout(() => {
        this.stop({ persist: false, reason: 'production-disconnect' }).catch(err => {
          logger.error({ module: 'daemon', msg: 'Production shutdown failed', err: String(err) });
        });
      }, this.productionGracePeriodMs);

    } else {
      // Dev mode: enter orphaned mode, agents survive for hot-reload
      logger.info({
        module: 'daemon',
        msg: 'Client disconnected in dev mode — entering orphaned mode',
        clientPid,
        orphanTimeoutMs: this.orphanTimeoutMs,
      });

      // Start orphan warning timers
      this.startOrphanWarnings();

      // Start orphan auto-shutdown timer (12h default)
      if (this.orphanTimeoutMs > 0) {
        this.orphanTimer = setTimeout(() => {
          logger.warn({
            module: 'daemon',
            msg: 'Orphan timeout — no server reconnected, shutting down',
            timeoutMs: this.orphanTimeoutMs,
            agentCount: this.agents.size,
          });
          this.stop({ persist: true, reason: '12h-timeout' }).catch(err => {
            logger.error({ module: 'daemon', msg: 'Orphan shutdown failed', err: String(err) });
          });
        }, this.orphanTimeoutMs);
      }
    }
  }

  // ── Orphan Warning Timers ─────────────────────────────────────

  private startOrphanWarnings(): void {
    for (const intervalMs of this.orphanWarningIntervalsMs) {
      if (intervalMs < this.orphanTimeoutMs) {
        const timer = setTimeout(() => {
          const hours = Math.round(intervalMs / (60 * 60 * 1000));
          const remaining = Math.round((this.orphanTimeoutMs - intervalMs) / (60 * 60 * 1000));
          logger.warn({
            module: 'daemon',
            msg: `Orphaned for ${hours}h — no server reconnected`,
            orphanedHours: hours,
            remainingHours: remaining,
            agentCount: this.agents.size,
          });

          const event = EventBuffer.createEvent('daemon:error', {
            level: 'warning',
            message: `Daemon orphaned for ${hours}h. Auto-shutdown in ${remaining}h.`,
            agentCount: this.agents.size,
          });
          this.emitEvent(event);
        }, intervalMs);

        this.orphanWarningTimers.push(timer);
      }
    }
  }

  private clearOrphanTimers(): void {
    if (this.orphanTimer) {
      clearTimeout(this.orphanTimer);
      this.orphanTimer = null;
    }
    for (const timer of this.orphanWarningTimers) {
      clearTimeout(timer);
    }
    this.orphanWarningTimers = [];
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
          // handleTerminate is async — catch unhandled rejections
          this.handleTerminate(request).catch((err) => {
            logger.error({ module: 'daemon', msg: 'handleTerminate failed', err: String(err) });
            this.sendError(request.id, RPC_ERRORS.INTERNAL_ERROR, `Terminate failed: ${String(err)}`);
          });
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

    setImmediate(() => {
      this.stop({
        persist: params?.persist,
        timeoutMs: params?.timeoutMs,
        reason: 'client-shutdown',
      }).catch(err => {
        logger.error({ module: 'daemon', msg: 'Shutdown failed', err: String(err) });
      });
    });
  }

  private handleConfigure(request: JsonRpcRequest): void {
    const params = request.params as unknown as ConfigureParams | undefined;

    if (params?.mode) {
      this.setMode(params.mode);
    }

    if (params?.massFailure) {
      this.massFailureDetector.configure({
        threshold: params.massFailure.threshold,
        windowMs: params.massFailure.windowSeconds ? params.massFailure.windowSeconds * 1000 : undefined,
        cooldownMs: params.massFailure.cooldownSeconds ? params.massFailure.cooldownSeconds * 1000 : undefined,
      });
    }

    this.sendResponse(request.id, { configured: true, mode: this._mode });
  }

  // ── Event Emission ────────────────────────────────────────────

  private emitEvent(event: DaemonEvent): void {
    this.eventBuffer.push(event);

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

  private writeTokenFile(): void {
    const tokenPath = this.transport.getTokenPath();
    const fd = openSync(tokenPath, 'w', 0o600);
    writeSync(fd, this.sessionToken);
    fdatasyncSync(fd);
    closeSync(fd);
    this.transport.secureFile(tokenPath);
  }

  private writePidFile(): void {
    const pidPath = this.transport.getPidPath();
    writeFileSync(pidPath, String(process.pid), { mode: 0o644 });
  }

  private writeShutdownManifest(reason?: string): void {
    const manifestPath = this.transport.getManifestPath();
    const manifest = {
      version: '1.0.0',
      shutdownAt: new Date().toISOString(),
      shutdownReason: reason ?? this.lastShutdownReason ?? 'unknown',
      mode: this._mode,
      platform: this.transport.platform,
      agents: this.listAgents(),
    };
    try {
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
      this.transport.secureFile(manifestPath);
    } catch (err) {
      logger.warn({ module: 'daemon', msg: 'Failed to write manifest', err: String(err) });
    }
  }

  private cleanupFiles(): void {
    const files = [
      this.socketPath,
      this.transport.getTokenPath(),
      this.transport.getPidPath(),
    ];
    this.transport.cleanupFiles(files);
  }

  /** Read an existing shutdown manifest (for resume). */
  static readManifest(socketDir?: string): {
    agents: AgentDescriptor[];
    shutdownAt: string;
    shutdownReason?: string;
    mode?: DaemonLifecycleMode;
  } | null {
    const transport = createTransport(socketDir);
    const manifestPath = transport.getManifestPath();
    try {
      const data = readFileSync(manifestPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
}
