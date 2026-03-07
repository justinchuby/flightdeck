# Two-Process Architecture: Orchestration Server + Agent Server

> **Status:** Design  
> **Author:** Architect (cc29bb0d)  
> **Supersedes:** Daemon design (D2-D7) from hot-reload-agent-preservation.md  
> **Context:** User approved process isolation via `fork()` + Node IPC after architectural assessment found ~48% of daemon code was over-engineered for a local dev tool.

## Problem

When the Flightdeck orchestration server restarts (tsx watch, code change, crash), all agent subprocesses die because they're children of the server process. A 12-agent AI crew developing Flightdeck itself loses all in-flight work on every save.

The daemon design (D2-D7) solved this with a standalone daemon process communicating over Unix domain sockets with custom auth. It worked, but was over-engineered: 3,726 LOC and 230 tests for something `child_process.fork({ detached: true })` achieves at the OS level.

## Solution: Two-Process Architecture

Split the server into two processes:

```
┌─────────────────────────────────────────────────────────────────┐
│  Developer's terminal                                           │
│                                                                 │
│  $ npm run dev                                                  │
│    │                                                            │
│    ├─ tsx watch → Orchestration Server (restarts on code change)│
│    │               ├─ Express + WebSocket (UI, API)             │
│    │               ├─ DAG, governance, coordination             │
│    │               ├─ Knowledge, memory, file locks             │
│    │               └─ AgentServerClient (IPC to Agent Server)   │
│    │                        │                                   │
│    │                   [Node IPC]  ← pluggable transport        │
│    │                        │                                   │
│    └─ fork({detached}) → Agent Server (never restarts)          │
│                            ├─ AgentManager (spawn/terminate)    │
│                            ├─ AcpAdapter subprocesses           │
│                            │   ├─ copilot-cli (agent 1)        │
│                            │   ├─ copilot-cli (agent 2)        │
│                            │   └─ claude-cli  (agent 3)        │
│                            ├─ EventBuffer (replay on reconnect) │
│                            └─ MassFailureDetector               │
│                                                                 │
│  Orchestration Server restarts → Agent Server unaffected        │
│  All agents continue working. Zero interruption.                │
└─────────────────────────────────────────────────────────────────┘
```

**Key insight:** `child_process.fork()` creates a Node process with a built-in IPC channel. `detached: true` ensures it survives parent exit. Node's IPC uses `process.send()` / `process.on('message')` — structured messaging with automatic serialization, cross-platform, zero dependencies.

## Transport Interface

The transport layer is pluggable: Node IPC today, WebSocket tomorrow (for network separation, multi-machine, cloud).

```typescript
// packages/server/src/transport/types.ts

/**
 * Pluggable transport for Orchestration↔Agent Server communication.
 * Two implementations: ForkTransport (Node IPC) and WebSocketTransport (future).
 */
interface AgentServerTransport {
  /** Connect to the agent server. Resolves when ready to send messages. */
  connect(): Promise<void>;

  /** Disconnect gracefully. */
  disconnect(): Promise<void>;

  /** Send a typed message to the other side. */
  send(message: AgentServerMessage): void;

  /** Register a handler for incoming messages. Returns unsubscribe function. */
  onMessage(handler: (message: AgentServerMessage) => void): () => void;

  /** Listen for connection state changes. */
  onStateChange(handler: (state: TransportState) => void): () => void;

  /** Current connection state. */
  readonly state: TransportState;

  /** Whether this transport supports reconnection (IPC: yes, fork-restart: maybe). */
  readonly supportsReconnect: boolean;
}

type TransportState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * Server-side transport: listens for connections from the orchestration server.
 * Used by the Agent Server.
 */
interface AgentServerListener {
  /** Start listening. For ForkTransport, this just means process.on('message'). */
  listen(): void;

  /** Stop listening and clean up. */
  close(): void;

  /** Register handler for incoming messages. */
  onMessage(handler: (message: AgentServerMessage) => void): () => void;

  /** Send a message to the connected orchestration server. */
  send(message: AgentServerMessage): void;

  /** Listen for connection/disconnection events. */
  onConnection(handler: (connected: boolean) => void): () => void;
}
```

### ForkTransport (Default — Node IPC)

```typescript
// packages/server/src/transport/ForkTransport.ts

/**
 * Orchestration server side: manages the forked Agent Server process.
 * Uses Node's built-in IPC channel (process.send / process.on('message')).
 */
class ForkTransport implements AgentServerTransport {
  private child: ChildProcess | null = null;
  private messageHandlers: Set<(msg: AgentServerMessage) => void> = new Set();
  private stateHandlers: Set<(state: TransportState) => void> = new Set();
  private _state: TransportState = 'disconnected';

  constructor(private options: ForkTransportOptions) {}

  async connect(): Promise<void> {
    // 1. Check if an agent server is already running (PID file)
    const existingPid = this.findExistingAgentServer();
    if (existingPid) {
      // Reconnect to existing detached process
      this.child = await this.reconnectToProcess(existingPid);
    } else {
      // Fork a new agent server
      this.child = fork(this.options.entryPoint, this.options.args ?? [], {
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, FLIGHTDECK_AGENT_SERVER: '1' },
      });
      this.child.unref(); // Don't keep orchestration server alive
    }

    // 2. Wire IPC message handler
    this.child.on('message', (msg: AgentServerMessage) => {
      for (const handler of this.messageHandlers) handler(msg);
    });

    // 3. Detect agent server exit (crash)
    this.child.on('exit', (code, signal) => {
      this.setState('disconnected');
      // Agent server crashed — all agents lost, trigger recovery
    });

    // 4. Wait for 'ready' message from agent server
    await this.waitForReady(this.options.readyTimeoutMs ?? 10_000);
    this.setState('connected');
  }

  send(message: AgentServerMessage): void {
    if (!this.child?.connected) throw new Error('Agent server not connected');
    this.child.send(message);
  }

  async disconnect(): Promise<void> {
    if (this.child?.connected) {
      this.send({ type: 'shutdown', persist: false });
      // Wait for graceful exit, then force
      await this.waitForExit(5_000);
    }
    this.setState('disconnected');
  }

  // ... onMessage, onStateChange, state getter
}

interface ForkTransportOptions {
  /** Path to agent-server.ts entry point */
  entryPoint: string;
  /** Additional CLI args */
  args?: string[];
  /** How long to wait for 'ready' message (ms) */
  readyTimeoutMs?: number;
  /** PID file path for reconnecting to detached process */
  pidFilePath?: string;
}
```

### ForkListener (Agent Server side)

```typescript
// packages/server/src/transport/ForkListener.ts

/**
 * Agent server side: listens on the IPC channel from the parent.
 * Detects parent disconnect (orchestration server restart) and buffers events.
 */
class ForkListener implements AgentServerListener {
  private messageHandlers: Set<(msg: AgentServerMessage) => void> = new Set();
  private parentConnected = true;

  listen(): void {
    // IPC messages from orchestration server
    process.on('message', (msg: AgentServerMessage) => {
      if (msg.type === 'ping') {
        process.send!({ type: 'pong', timestamp: Date.now() });
        return;
      }
      for (const handler of this.messageHandlers) handler(msg);
    });

    // Detect parent disconnect (orchestration server restarted)
    process.on('disconnect', () => {
      this.parentConnected = false;
      this.emitConnection(false);
      // Don't exit — agents stay alive. Wait for reconnect.
    });
  }

  send(message: AgentServerMessage): void {
    if (!this.parentConnected || !process.send) {
      // Buffer or drop — orchestration server not connected
      return;
    }
    process.send(message);
  }

  // ... onMessage, onConnection, close
}
```

### Future: WebSocketTransport

```typescript
// packages/server/src/transport/WebSocketTransport.ts (future)

/**
 * Network-capable transport for multi-machine deployment.
 * Same AgentServerTransport interface — drop-in replacement for ForkTransport.
 *
 * Use cases:
 * - Agent Server on a GPU machine, Orchestration Server on a laptop
 * - Shared agent pool across multiple orchestration servers
 * - Cloud deployment: Agent Server in a container, UI server on edge
 */
class WebSocketTransport implements AgentServerTransport {
  constructor(private url: string, private authToken: string) {}

  async connect(): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.on('open', () => this.authenticate());
    this.ws.on('message', (data) => this.handleMessage(JSON.parse(data)));
    // ... reconnect with exponential backoff
  }

  send(message: AgentServerMessage): void {
    this.ws.send(JSON.stringify(message));
  }

  // Same interface, network-capable
}
```

**The transport interface is the seam.** Everything above it (AgentServerClient, orchestration logic) is identical regardless of whether the agent server is a local fork or a remote WebSocket endpoint.

## Message Protocol

All messages are typed TypeScript objects. No JSON-RPC, no NDJSON, no wire format — Node IPC handles serialization.

```typescript
// packages/server/src/transport/protocol.ts

// ─── Orchestration → Agent Server ───────────────────────────

type OrchestrationMessage =
  | SpawnAgentMessage
  | TerminateAgentMessage
  | SendPromptMessage
  | CancelPromptMessage
  | ListAgentsMessage
  | SubscribeMessage
  | ShutdownMessage
  | PingMessage
  | ConfigureMessage;

interface SpawnAgentMessage {
  type: 'spawn';
  requestId: string;
  params: {
    agentId: string;
    role: string;
    task: string;
    provider: string;        // 'copilot' | 'claude' | 'gemini' | etc.
    model?: string;
    cwd: string;
    env?: Record<string, string>;
    cliCommand: string;
    cliArgs: string[];
    sessionId?: string;      // For resume
    autopilot: boolean;
    systemPrompt: string;
  };
}

interface TerminateAgentMessage {
  type: 'terminate';
  requestId: string;
  agentId: string;
  reason?: string;
}

interface SendPromptMessage {
  type: 'prompt';
  requestId: string;
  agentId: string;
  content: string;           // The message to send to the agent
  options?: {
    maxTurns?: number;
    timeout?: number;
  };
}

interface CancelPromptMessage {
  type: 'cancel';
  agentId: string;
}

interface ListAgentsMessage {
  type: 'list';
  requestId: string;
}

interface SubscribeMessage {
  type: 'subscribe';
  agentId: string;
  lastSeenEventId?: string;  // For event replay after reconnect
  fromStart?: boolean;       // Replay full agent descriptor + all buffered events
}

interface ShutdownMessage {
  type: 'shutdown';
  persist: boolean;          // true = keep agents (dev mode), false = terminate all (prod)
}

interface PingMessage {
  type: 'ping';
  timestamp: number;
}

interface ConfigureMessage {
  type: 'configure';
  massFailure?: { threshold?: number; windowMs?: number; cooldownMs?: number };
}

// ─── Agent Server → Orchestration ───────────────────────────

type AgentServerMessage =
  | ReadyMessage
  | SpawnResultMessage
  | TerminateResultMessage
  | PromptResultMessage
  | ListResultMessage
  | AgentEventMessage
  | MassFailureMessage
  | PongMessage
  | ErrorMessage;

interface ReadyMessage {
  type: 'ready';
  pid: number;
  agentCount: number;        // How many agents survived from previous session
  version: string;
}

interface SpawnResultMessage {
  type: 'spawn_result';
  requestId: string;
  success: boolean;
  agentId?: string;
  sessionId?: string;
  error?: string;
}

interface TerminateResultMessage {
  type: 'terminate_result';
  requestId: string;
  success: boolean;
  error?: string;
}

interface PromptResultMessage {
  type: 'prompt_result';
  requestId: string;
  agentId: string;
  stopReason: 'end_turn' | 'max_turns' | 'cancelled' | 'error';
  error?: string;
}

interface ListResultMessage {
  type: 'list_result';
  requestId: string;
  agents: AgentDescriptor[];
}

interface AgentDescriptor {
  agentId: string;
  role: string;
  task: string;
  provider: string;
  model?: string;
  sessionId?: string;
  pid: number;
  status: 'running' | 'idle' | 'prompting' | 'exited';
  startedAt: string;
}

/** Streaming events from agents, forwarded to orchestration server. */
interface AgentEventMessage {
  type: 'agent_event';
  eventId: string;           // Monotonic ID for replay
  agentId: string;
  event: AgentEvent;
}

type AgentEvent =
  | { kind: 'text'; content: string }
  | { kind: 'thinking'; content: string }
  | { kind: 'tool_call'; name: string; args: string; id: string }
  | { kind: 'tool_result'; id: string; result: string }
  | { kind: 'plan'; plan: string[] }
  | { kind: 'usage'; inputTokens: number; outputTokens: number }
  | { kind: 'status'; status: string }
  | { kind: 'prompt_complete'; stopReason: string }
  | { kind: 'exit'; exitCode: number | null; signal: string | null }
  | { kind: 'connected'; sessionId: string }
  | { kind: 'error'; message: string };

interface MassFailureMessage {
  type: 'mass_failure';
  exitCount: number;
  windowSeconds: number;
  recentExits: Array<{
    agentId: string;
    exitCode: number | null;
    error: string | null;
  }>;
  pausedUntilMs: number;
  likelyCause: 'auth_failure' | 'rate_limit' | 'model_unavailable' | 'resource_exhaustion' | 'unknown';
}

interface PongMessage {
  type: 'pong';
  timestamp: number;
}

interface ErrorMessage {
  type: 'error';
  requestId?: string;
  code: string;
  message: string;
}

// ─── Shared ─────────────────────────────────────────────────

type AgentServerMessage = OrchestrationMessage | AgentServerMessage;

/** Generate monotonic event IDs */
function nextEventId(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
```

## Agent Server Entry Point

```typescript
// packages/server/src/agent-server.ts  (~200-300 lines)

import { ForkListener } from './transport/ForkListener.js';
import { EventBuffer } from './daemon/EventBuffer.js';          // REUSED
import { MassFailureDetector } from './daemon/MassFailureDetector.js';  // REUSED

class AgentServer {
  private listener: AgentServerListener;
  private agents = new Map<string, ManagedAgent>();
  private eventBuffer: EventBuffer;
  private massFailure: MassFailureDetector;
  private orchestratorConnected = false;
  private orphanTimer: NodeJS.Timeout | null = null;

  constructor(listener: AgentServerListener, options?: AgentServerOptions) {
    this.listener = listener;
    this.eventBuffer = new EventBuffer({
      maxEventsPerAgent: 100,
      maxEventAgeMs: 30_000,
    });
    this.massFailure = new MassFailureDetector({
      threshold: options?.massFailure?.threshold ?? 3,
      windowMs: options?.massFailure?.windowMs ?? 60_000,
      cooldownMs: options?.massFailure?.cooldownMs ?? 120_000,
    });

    this.massFailure.onMassFailure((data) => {
      this.listener.send({ type: 'mass_failure', ...data });
    });
  }

  start(): void {
    this.listener.listen();
    this.listener.onMessage((msg) => this.handleMessage(msg));
    this.listener.onConnection((connected) => {
      this.orchestratorConnected = connected;
      if (connected) {
        this.clearOrphanTimer();
        this.eventBuffer.stopBuffering();
      } else {
        this.eventBuffer.startBuffering();
        this.startOrphanTimer();
      }
    });

    // Write PID file for reconnection
    this.writePidFile();

    // Signal ready
    this.listener.send({
      type: 'ready',
      pid: process.pid,
      agentCount: this.agents.size,
      version: '1.0.0',
    });
  }

  private handleMessage(msg: OrchestrationMessage): void {
    switch (msg.type) {
      case 'spawn':     return this.handleSpawn(msg);
      case 'terminate': return this.handleTerminate(msg);
      case 'prompt':    return this.handlePrompt(msg);
      case 'cancel':    return this.handleCancel(msg);
      case 'list':      return this.handleList(msg);
      case 'subscribe': return this.handleSubscribe(msg);
      case 'shutdown':  return this.handleShutdown(msg);
      case 'configure': return this.handleConfigure(msg);
      case 'ping':      break; // Handled by listener
    }
  }

  private async handleSpawn(msg: SpawnAgentMessage): Promise<void> {
    if (this.massFailure.isPaused()) {
      this.listener.send({
        type: 'spawn_result',
        requestId: msg.requestId,
        success: false,
        error: `Spawning paused: mass failure detected. Resumes in ${this.massFailure.remainingCooldown()}ms`,
      });
      return;
    }

    try {
      const agent = await this.spawnAgent(msg.params);
      this.agents.set(msg.params.agentId, agent);

      this.listener.send({
        type: 'spawn_result',
        requestId: msg.requestId,
        success: true,
        agentId: msg.params.agentId,
        sessionId: agent.sessionId,
      });
    } catch (err) {
      this.listener.send({
        type: 'spawn_result',
        requestId: msg.requestId,
        success: false,
        error: String(err),
      });
    }
  }

  private async spawnAgent(params: SpawnAgentMessage['params']): Promise<ManagedAgent> {
    // Create adapter via existing AdapterFactory
    const adapter = createAdapterForProvider({
      provider: params.provider,
      autopilot: params.autopilot,
      model: params.model,
    });

    const sessionId = await adapter.start({
      cliCommand: params.cliCommand,
      cliArgs: params.cliArgs,
      cwd: params.cwd,
      env: params.env,
      sessionId: params.sessionId,
      model: params.model,
      systemPrompt: params.systemPrompt,
    });

    // Wire adapter events → agent events → IPC
    adapter.on('text', (content) => this.emitEvent(params.agentId, { kind: 'text', content }));
    adapter.on('thinking', (content) => this.emitEvent(params.agentId, { kind: 'thinking', content }));
    adapter.on('tool_call', (tc) => this.emitEvent(params.agentId, { kind: 'tool_call', ...tc }));
    adapter.on('plan', (plan) => this.emitEvent(params.agentId, { kind: 'plan', plan }));
    adapter.on('usage_update', (u) => this.emitEvent(params.agentId, { kind: 'usage', ...u }));
    adapter.on('prompt_complete', (r) => this.emitEvent(params.agentId, { kind: 'prompt_complete', stopReason: r }));
    adapter.on('exit', (code, signal) => {
      this.emitEvent(params.agentId, { kind: 'exit', exitCode: code, signal });
      this.massFailure.recordExit({ agentId: params.agentId, exitCode: code, signal, error: null, timestamp: Date.now() });
      this.agents.delete(params.agentId);
    });

    return { adapter, sessionId, params, startedAt: new Date().toISOString() };
  }

  private emitEvent(agentId: string, event: AgentEvent): void {
    const msg: AgentEventMessage = {
      type: 'agent_event',
      eventId: nextEventId(),
      agentId,
      event,
    };

    // Always buffer (for replay)
    this.eventBuffer.push(msg);

    // Forward to orchestration server if connected
    if (this.orchestratorConnected) {
      this.listener.send(msg);
    }
  }

  private handleSubscribe(msg: SubscribeMessage): void {
    // Replay buffered events for this agent since lastSeenEventId
    const buffered = this.eventBuffer.drain(msg.agentId, msg.lastSeenEventId);
    for (const event of buffered) {
      this.listener.send(event);
    }
  }

  private handleShutdown(msg: ShutdownMessage): void {
    if (msg.persist) {
      // Dev mode: orchestration server is shutting down, keep agents alive
      return;
    }
    // Production mode: terminate everything
    this.terminateAll().then(() => process.exit(0));
  }

  // ─── Orphan self-termination ──────────────────────────────

  private readonly ORPHAN_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 hours

  private startOrphanTimer(): void {
    this.clearOrphanTimer();
    this.orphanTimer = setTimeout(() => {
      console.warn('[agent-server] No orchestration server connected for 12h. Shutting down.');
      this.terminateAll().then(() => process.exit(0));
    }, this.ORPHAN_TIMEOUT_MS);
  }

  private clearOrphanTimer(): void {
    if (this.orphanTimer) {
      clearTimeout(this.orphanTimer);
      this.orphanTimer = null;
    }
  }

  // ─── Agent lifecycle ──────────────────────────────────────

  private async terminateAll(): Promise<void> {
    const promises = [...this.agents.entries()].map(([id, agent]) =>
      this.terminateAgent(id, agent)
    );
    await Promise.allSettled(promises);
  }

  private async terminateAgent(agentId: string, agent: ManagedAgent): Promise<void> {
    try {
      await agent.adapter.terminate();
    } catch {
      // Force kill if terminate() fails
      agent.adapter.process?.kill('SIGKILL');
    }
    this.agents.delete(agentId);
  }
}

// ─── Entry point ────────────────────────────────────────────

if (process.env.FLIGHTDECK_AGENT_SERVER === '1') {
  const listener = new ForkListener();
  const server = new AgentServer(listener);
  server.start();
}
```

### ManagedAgent (Internal)

```typescript
interface ManagedAgent {
  adapter: AgentAdapter;
  sessionId: string;
  params: SpawnAgentMessage['params'];
  startedAt: string;
}

interface AgentServerOptions {
  massFailure?: {
    threshold?: number;
    windowMs?: number;
    cooldownMs?: number;
  };
  orphanTimeoutMs?: number;
}
```

## Orchestration Server Client

The orchestration server uses an `AgentServerClient` to talk to the agent server through the transport:

```typescript
// packages/server/src/agents/AgentServerClient.ts (~300 lines)

class AgentServerClient {
  private transport: AgentServerTransport;
  private pendingRequests = new Map<string, PendingRequest>();
  private eventHandlers = new Map<string, Set<(event: AgentEvent) => void>>();
  private lastSeenEventIds = new Map<string, string>();  // Per-agent event cursor

  constructor(transport: AgentServerTransport) {
    this.transport = transport;
    this.transport.onMessage((msg) => this.handleMessage(msg));
  }

  /** Spawn an agent on the agent server. */
  async spawn(params: SpawnAgentMessage['params']): Promise<{ sessionId: string }> {
    const requestId = generateRequestId();
    this.transport.send({ type: 'spawn', requestId, params });
    const result = await this.waitForResponse<SpawnResultMessage>(requestId);
    if (!result.success) throw new Error(result.error);
    return { sessionId: result.sessionId! };
  }

  /** Send a prompt to an agent. */
  async prompt(agentId: string, content: string, options?: PromptOptions): Promise<PromptResult> {
    const requestId = generateRequestId();
    this.transport.send({ type: 'prompt', requestId, agentId, content, options });
    return this.waitForResponse<PromptResultMessage>(requestId);
  }

  /** Terminate an agent. */
  async terminate(agentId: string, reason?: string): Promise<void> {
    const requestId = generateRequestId();
    this.transport.send({ type: 'terminate', requestId, agentId, reason });
    const result = await this.waitForResponse<TerminateResultMessage>(requestId);
    if (!result.success) throw new Error(result.error);
  }

  /** List all agents on the agent server. */
  async list(): Promise<AgentDescriptor[]> {
    const requestId = generateRequestId();
    this.transport.send({ type: 'list', requestId });
    const result = await this.waitForResponse<ListResultMessage>(requestId);
    return result.agents;
  }

  /** Subscribe to events from an agent. Replays missed events. */
  subscribe(agentId: string, handler: (event: AgentEvent) => void): () => void {
    // Register local handler
    if (!this.eventHandlers.has(agentId)) {
      this.eventHandlers.set(agentId, new Set());
    }
    this.eventHandlers.get(agentId)!.add(handler);

    // Ask agent server to replay from last seen event
    this.transport.send({
      type: 'subscribe',
      agentId,
      lastSeenEventId: this.lastSeenEventIds.get(agentId),
    });

    // Return unsubscribe
    return () => { this.eventHandlers.get(agentId)?.delete(handler); };
  }

  /** Request graceful shutdown. */
  async shutdown(persist: boolean): Promise<void> {
    this.transport.send({ type: 'shutdown', persist });
  }

  // ─── Internal ─────────────────────────────────────────────

  private handleMessage(msg: AgentServerMessage): void {
    switch (msg.type) {
      case 'agent_event':
        this.handleAgentEvent(msg as AgentEventMessage);
        break;
      case 'mass_failure':
        this.emit('mass_failure', msg);
        break;
      case 'spawn_result':
      case 'terminate_result':
      case 'prompt_result':
      case 'list_result':
        this.resolveRequest(msg);
        break;
    }
  }

  private handleAgentEvent(msg: AgentEventMessage): void {
    // Track event cursor for replay
    this.lastSeenEventIds.set(msg.agentId, msg.eventId);

    // Forward to subscribers
    const handlers = this.eventHandlers.get(msg.agentId);
    if (handlers) {
      for (const handler of handlers) handler(msg.event);
    }
  }

  private waitForResponse<T>(requestId: string, timeoutMs = 30_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request ${requestId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timer });
    });
  }

  private resolveRequest(msg: { requestId: string }): void {
    const pending = this.pendingRequests.get(msg.requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(msg.requestId);
      pending.resolve(msg);
    }
  }
}
```

## How Hot-Reload Works

### Startup Sequence

```
1. npm run dev
   └─ scripts/dev.mjs
      │
      ├─ Check for existing agent server (PID file)
      │   ├─ Found + alive → skip fork, reuse existing
      │   └─ Not found or dead → fork new agent server
      │
      ├─ Fork agent server (detached: true)
      │   └─ agent-server.ts starts, writes PID file, sends 'ready'
      │
      ├─ Start orchestration server (tsx watch)
      │   └─ index.ts creates container, connects to agent server via ForkTransport
      │       └─ AgentServerClient.connect() → sends 'subscribe' for each known agent
      │
      └─ Start Vite dev server (UI)
```

### Hot-Reload Cycle (Developer Saves a File)

```
t=0.0s  Developer saves packages/server/src/foo.ts
t=0.0s  tsx watch detects change
t=0.1s  tsx sends SIGTERM to orchestration server
t=0.1s  Orchestration server graceful shutdown:
          1. Close WebSocket connections (UI gets 'server restarting' event)
          2. IPC channel closes (process.disconnect)
          3. Agent server detects disconnect → starts buffering events
          4. Express server closes
          5. Process exits
t=0.5s  tsx forks new orchestration server process
t=1.0s  New server starts, creates container
t=1.2s  ForkTransport.connect():
          - Reads PID file → finds existing agent server
          - Opens new IPC channel to agent server process
          - Agent server detects reconnection → stops buffering
t=1.3s  AgentServerClient subscribes to all agents (from SQLite roster)
t=1.3s  Agent server replays buffered events (lastSeenEventId per agent)
t=1.5s  UI reconnects via WebSocket → sees all agents running
t=1.5s  ✅ Hot-reload complete. Zero agent interruption.
```

### The Reconnect Problem: fork() IPC and Detached Processes

**Critical detail:** When the orchestration server exits, the Node IPC channel to the forked agent server is destroyed. You cannot reconnect a Node IPC channel to a detached process — `fork()` creates a one-time IPC pipe.

**Solution: Reconnection via secondary channel.**

After the agent server is forked and detached, it opens a secondary IPC mechanism for reconnection:

```typescript
// Agent server: after fork, open a Unix domain socket for reconnection
class AgentServer {
  private reconnectSocket: net.Server | null = null;

  start(): void {
    // Primary: Node IPC (from fork)
    this.listener.listen();

    // Secondary: UDS for reconnection after orchestration restart
    const socketPath = path.join(this.getSocketDir(), 'agent-server.sock');
    this.reconnectSocket = net.createServer((conn) => {
      // New orchestration server connecting
      this.handleReconnect(conn);
    });
    this.reconnectSocket.listen(socketPath);
  }
}
```

```typescript
// ForkTransport: connect() checks for existing agent server
class ForkTransport implements AgentServerTransport {
  async connect(): Promise<void> {
    const existingPid = this.readPidFile();
    if (existingPid && this.isProcessAlive(existingPid)) {
      // Reconnect via UDS (not fork IPC — that channel is dead)
      this.socket = net.createConnection(this.getSocketPath());
      // Use NDJSON over socket for reconnection only
      this.setState('connected');
    } else {
      // First start: fork + use Node IPC
      this.child = fork(...);
      this.setState('connected');
    }
  }
}
```

**This means we need a minimal socket for reconnection.** However, it's dramatically simpler than the full daemon:
- No auth needed (socket file permissions = 0o600, same as before)
- No cross-platform named pipes (can use TCP localhost as fallback)
- NDJSON only for the reconnect path, not the primary path
- ~50 lines of socket code, not 600

**Alternative: Use TCP localhost.** Even simpler — the agent server listens on a random localhost port, writes port to a file. New orchestration server reads the file and connects. Cross-platform, no UDS, ~30 lines.

```typescript
// Agent server: listen on localhost for reconnection
const reconnectServer = net.createServer(handleReconnect);
reconnectServer.listen(0, '127.0.0.1', () => {
  const port = reconnectServer.address().port;
  fs.writeFileSync(portFilePath, String(port), { mode: 0o600 });
});
```

## Discovery and Reconnection

How the orchestration server finds and reconnects to an existing agent server:

```
~/.flightdeck/run/
  agent-server.pid          # PID of agent server process
  agent-server.port         # TCP port for reconnection (0o600 permissions)
```

**Discovery flow:**
```typescript
function discoverAgentServer(): { pid: number; port: number } | null {
  const pidFile = path.join(getRunDir(), 'agent-server.pid');
  const portFile = path.join(getRunDir(), 'agent-server.port');

  if (!fs.existsSync(pidFile) || !fs.existsSync(portFile)) return null;

  const pid = parseInt(fs.readFileSync(pidFile, 'utf8'));
  const port = parseInt(fs.readFileSync(portFile, 'utf8'));

  // Verify process is alive
  try {
    process.kill(pid, 0);  // Signal 0 = check existence
    return { pid, port };
  } catch {
    // Stale PID file — clean up
    fs.unlinkSync(pidFile);
    fs.unlinkSync(portFile);
    return null;
  }
}
```

## Event Replay on Reconnect

When the orchestration server reconnects, it needs to catch up on events that happened during the restart window (~1-2 seconds):

```
Orchestration Server                  Agent Server
       │                                   │
       │  ← disconnect (process exit) ─────│
       │                                   │ Events buffered
       │                                   │  (EventBuffer: 100/agent, 30s)
       │                                   │
       │  ── connect (new process) ────────│
       │                                   │
       │  ── subscribe(agent1,             │
       │       lastSeenEventId: 'evt-42')──│
       │                                   │
       │  ←── agent_event(evt-43, text) ───│  Replay
       │  ←── agent_event(evt-44, tool) ───│  from buffer
       │  ←── agent_event(evt-45, text) ───│
       │                                   │
       │  ←── agent_event(evt-46, text) ───│  Live stream
       │                                   │  resumes
```

The `EventBuffer` (reused from daemon, 169 LOC) handles this. The `lastSeenEventId` per agent is tracked by `AgentServerClient` automatically from the live event stream — no manual bookkeeping needed.

## Error Handling and Graceful Degradation

### Agent Server Crashes

If the agent server process dies (OOM, segfault, unhandled exception):
1. ForkTransport detects child `'exit'` event
2. All agents are lost (they were children of the agent server)
3. Orchestration server falls back to Phase 1: SDK resume for all agents
4. UI shows: "Agent server crashed. Resuming agents... (3/12 restored)"

This is the same recovery path as "daemon crash" — SDK resume is the safety net.

### Orchestration Server Crashes

If the orchestration server dies:
1. Agent server detects IPC disconnect
2. Agents keep running, events buffered
3. tsx watch restarts orchestration server
4. New server connects, subscribes, replays events
5. Zero agent interruption — the core use case

### IPC Channel Corruption

If `process.send()` throws (channel destroyed, serialization error):
1. Agent server catches the error
2. Falls back to buffering mode (same as disconnect)
3. Orchestration server reconnects via TCP fallback

### Agent Server Won't Start

If fork fails or agent server crashes immediately:
1. ForkTransport.connect() times out (10s default)
2. Orchestration server falls back to direct ACP spawn (current behavior)
3. No hot-reload protection, but everything else works
4. UI shows warning: "Agent server unavailable — agents won't survive restarts"

## Lifecycle Modes

Same as daemon design — production vs dev behavior:

### Production Mode (`npm start`)

```
Server starts → forks agent server
Server stops (Ctrl+C) → sends shutdown(persist: false) → agent server terminates all → exits
```

Clean shutdown. No orphaned processes. Meets user expectation.

### Dev Mode (`npm run dev`)

```
tsx watch starts → forks agent server (detached)
tsx watch restarts server → IPC disconnects → agent server stays alive
New server connects to existing agent server → events replayed → seamless
```

The agent server stays alive across tsx watch restarts. Only way to stop it:
1. `flightdeck agent-server stop` CLI command
2. Ctrl+C on the dev.mjs parent process (sends SIGTERM to agent server)
3. 12-hour orphan timeout (no orchestration server connected)

### Override Flags

```yaml
# flightdeck.config.yaml
agentServer:
  persistOnShutdown: auto   # 'auto' (dev=persist, prod=stop) | 'always' | 'never'
  orphanTimeoutMs: 43200000 # 12 hours (default)
```

## Integration with dev.mjs

```javascript
// scripts/dev.mjs — modified

import { fork } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';

const AGENT_SERVER_ENTRY = './packages/server/dist/agent-server.js';
const PID_FILE = path.join(os.homedir(), '.flightdeck', 'run', 'agent-server.pid');

async function ensureAgentServer() {
  // Check for existing agent server
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8'));
    try {
      process.kill(pid, 0);  // Check if alive
      console.log(`[dev] Agent server already running (PID ${pid})`);
      return pid;
    } catch {
      unlinkSync(PID_FILE);  // Stale
    }
  }

  // Fork new agent server
  console.log('[dev] Starting agent server...');
  const child = fork(AGENT_SERVER_ENTRY, [], {
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, FLIGHTDECK_AGENT_SERVER: '1' },
  });
  child.unref();

  // Wait for 'ready' message
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Agent server timeout')), 10_000);
    child.on('message', (msg) => {
      if (msg.type === 'ready') { clearTimeout(timeout); resolve(msg); }
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Agent server exited with code ${code}`));
    });
  });

  console.log(`[dev] Agent server ready (PID ${child.pid})`);

  // Disconnect IPC but keep process alive
  child.disconnect();

  return child.pid;
}

async function main() {
  await ensureAgentServer();
  await startOrchestrationServer();  // tsx watch
  await startViteDevServer();
}
```

**Key detail:** After the agent server is forked and ready, `dev.mjs` calls `child.disconnect()` to release the IPC channel. The orchestration server creates its own connection via TCP when it starts. This means:
- The agent server is truly independent of `dev.mjs`
- Multiple tsx watch restarts don't create multiple agent servers
- `dev.mjs` crash doesn't kill the agent server

## Migration from Daemon Code

### What We Reuse (Directly)

| Module | LOC | Changes Needed |
|--------|-----|----------------|
| **EventBuffer.ts** | 169 | None — same API, same behavior |
| **MassFailureDetector.ts** | 252 | None — transport-independent |
| **ReconnectProtocol.ts** (logic only) | ~200 | Strip transport code, keep reconciliation logic |
| **DaemonAdapter.ts** (event mapping) | ~150 | Rename to AgentServerAdapter, simplify |

### What We Drop

| Module | LOC | Why |
|--------|-----|-----|
| **platform.ts** (entire) | 600 | TCP localhost replaces UDS/named pipes |
| **DaemonProcess.ts** (socket/auth) | 400 | fork() IPC + TCP reconnect replaces UDS server |
| **DaemonProtocol.ts** (entire) | 266 | TypeScript types replace JSON-RPC |
| **DaemonClient.ts** (connection/auth) | 200 | AgentServerClient is simpler |
| **Token auth** | 100 | TCP on localhost + file permissions is sufficient |
| **Single-client enforcement** | 80 | fork() is inherently 1:1 |

### What We Write New

| Module | Estimated LOC | Purpose |
|--------|--------------|---------|
| **agent-server.ts** | 250-300 | Agent server entry point |
| **AgentServerClient.ts** | 250-300 | Orchestration server client |
| **ForkTransport.ts** | 100-150 | Node IPC transport |
| **ForkListener.ts** | 80-100 | Agent server listener |
| **protocol.ts** | 150-200 | Message type definitions |
| **dev.mjs changes** | 50-80 | Agent server lifecycle in dev script |
| **Total new code** | **~900-1,100** | |

### Net Change

```
Daemon code:     3,726 LOC
  - Dropped:     1,646 LOC
  - Reused:        621 LOC (EventBuffer + MassFailureDetector + reconciliation)
  + New code:    ~1,000 LOC

Result:          ~1,600 LOC total (vs 3,726)
                 57% reduction in code
                 Same functionality for local dev use case
```

## Comparison: Daemon vs Two-Process vs Hybrid

| Aspect | Full Daemon (D2-D7) | Two-Process (Proposed) | Notes |
|--------|---------------------|------------------------|-------|
| **Total LOC** | 3,726 | ~1,600 | 57% less code |
| **Agent survival** | ✅ | ✅ | Both solve the core problem |
| **Cross-platform** | Custom per platform | Node handles it | TCP localhost works everywhere |
| **Security** | UDS + 256-bit token + umask | File permissions + localhost | Adequate for local dev tool |
| **Network-capable** | ✅ TCP fallback | ✅ Via WebSocketTransport | Pluggable transport enables this |
| **Reconnection** | UDS socket (always available) | TCP reconnect (port file) | Slightly more moving parts |
| **Independent lifecycle** | ✅ Standalone process | ✅ Detached fork | Equivalent |
| **Auth overhead** | Per-request token verification | None (localhost trust) | Simpler |
| **Maintenance** | Higher (custom protocol, 4 transports) | Lower (Node builtins + TCP) | Less to go wrong |
| **Remote agent pools** | Possible but not designed | ✅ WebSocketTransport ready | Better architecture for future |
| **Implementation** | Mostly done (~3,700 LOC) | ~2 days refactor | Reuses 621 LOC |

## Future: WebSocket Transport for Network Separation

The pluggable transport interface enables a clean evolution path:

```
Phase 1 (now):   ForkTransport — local dev, Node IPC + TCP reconnect
Phase 2 (later): WebSocketTransport — network separation
```

**WebSocket transport enables:**
- **Multi-machine:** Agent server on a GPU machine (model inference), orchestration on a laptop (UI)
- **Shared agent pools:** Multiple developers share a pool of persistent agents
- **Cloud deployment:** Agent server in a container, UI server on edge/CDN
- **Horizontal scaling:** Multiple agent servers behind a load balancer

**The interface is already correct for this.** `AgentServerTransport.send()` and `.onMessage()` work identically whether the transport is a fork IPC channel, a TCP socket, or a WebSocket. The message protocol (typed TypeScript objects) serializes to JSON for network transport.

**What WebSocketTransport adds:**
- TLS encryption (wss://)
- Token authentication (Bearer header)
- Reconnect with exponential backoff
- Connection multiplexing (multiple orchestration servers)
- ~200-300 LOC

This is the path from "local dev tool" to "production infrastructure" — and the transport interface makes it a clean addition, not a rewrite.

## Open Questions

1. **TCP vs UDS for reconnection?** TCP localhost is simpler and cross-platform. UDS is marginally more secure (file permissions). Recommendation: TCP — simplicity wins for a local dev tool.

2. **Should the agent server have its own SQLite connection?** Currently: no — all DB writes go through the orchestration server. The agent server is stateless (roster is in-memory, persisted by the orchestration server via AgentRosterRepository). If the agent server needs to write directly (e.g., crash-safe state), it could open its own read-only or write-ahead connection.

3. **In-process Claude SDK agents?** ClaudeSdkAdapter runs in-process (no subprocess). These agents die with the orchestration server, not the agent server. Should they move to the agent server? Probably yes — but that requires the agent server to have the Claude SDK dependency and API key. For now, in-process agents use SDK resume as their survival mechanism.

4. **How does the agent server get config updates?** When the user changes `flightdeck.config.yaml`, the orchestration server's ConfigStore detects it. It should forward relevant config (provider presets, model overrides, mass failure thresholds) to the agent server via a `configure` message. The agent server doesn't watch config files itself.
