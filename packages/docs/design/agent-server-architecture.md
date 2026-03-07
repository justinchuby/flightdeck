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

### Architectural Invariant: Agent Server is the SOLE Agent Owner

The agent server is the **exclusive owner** of all agent lifecycles. The orchestration server NEVER launches, messages, or terminates agents directly. All agent operations go through the agent server:

```
✅ Orchestration → AgentServerClient.spawn() → IPC → Agent Server → subprocess
❌ Orchestration → AcpAdapter.start() → subprocess (NEVER)
```

**Why no fallback to direct spawning?** If the agent server is down, the orchestration server does NOT silently fall back to spawning agents directly. Instead:

1. **Agent operations fail with a clear error.** `AgentServerClient.spawn()` throws `AgentServerUnavailableError`.
2. **The UI shows an error state.** Users see exactly what's wrong and what to do about it.
3. **No silent degradation.** Silent fallback to direct spawning would mean agents survive restarts sometimes (agent server up) but not other times (agent server down). This inconsistency is worse than a clear error.

This means the agent server is a **hard dependency** — if it's not running, no agents can be created. This is the correct design for a core infrastructure component.

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
- Lightweight token auth (one random secret, ~15 lines — not the full daemon auth flow)
- No cross-platform named pipes (TCP localhost is cross-platform natively)
- NDJSON only for the reconnect path, not the primary path
- ~80 lines of socket code total, not 600

**Implementation: TCP localhost with shared secret.**

The agent server listens on a random localhost port and generates a per-session auth token. Both are written to files with `0o600` permissions (readable only by the same OS user).

```typescript
// Agent server: listen on localhost for reconnection
const token = crypto.randomBytes(32).toString('hex');  // 256-bit random token
const reconnectServer = net.createServer((conn) => handleReconnect(conn, token));
reconnectServer.listen(0, '127.0.0.1', () => {
  const port = reconnectServer.address().port;
  const runDir = getRunDir();
  fs.writeFileSync(path.join(runDir, 'agent-server.port'), String(port), { mode: 0o600 });
  fs.writeFileSync(path.join(runDir, 'agent-server.token'), token, { mode: 0o600 });
});
```

## Discovery, Authentication, and Reconnection

How the orchestration server finds, authenticates with, and reconnects to an existing agent server:

```
~/.flightdeck/run/
  agent-server.pid          # PID of agent server process
  agent-server.port         # TCP port for reconnection (0o600)
  agent-server.token        # Shared secret for auth (0o600, 256-bit hex)
```

All three files are written with `mode: 0o600` — only the owning OS user can read them. This prevents other users on the machine from discovering the port or token. Same-user processes CAN read the files, which is why the token exists: knowing the port isn't enough, you must also present the token.

### Authentication Handshake

When the orchestration server connects to the agent server's TCP port, the first message must be an `auth` message containing the token **and the declared scope**. The agent server validates the token and **binds the connection to the declared `(projectId, teamId)` scope** — all subsequent messages on this connection are constrained to that scope.

```typescript
// Agent server: handleReconnect()
function handleReconnect(conn: net.Socket, expectedToken: string): void {
  let authenticated = false;

  // 5-second auth timeout — reject slow/hanging connections
  const authTimeout = setTimeout(() => {
    if (!authenticated) {
      conn.end(JSON.stringify({ type: 'error', code: 'auth_timeout', message: 'Auth timeout' }) + '\n');
      conn.destroy();
    }
  }, 5_000);

  conn.once('data', (data) => {
    clearTimeout(authTimeout);
    try {
      const msg = JSON.parse(data.toString().trim());
      if (msg.type !== 'auth' || !msg.token) {
        conn.end(JSON.stringify({ type: 'error', code: 'auth_required', message: 'First message must be auth' }) + '\n');
        conn.destroy();
        return;
      }

      // Timing-safe comparison to prevent timing attacks
      const expected = Buffer.from(expectedToken, 'utf8');
      const received = Buffer.from(msg.token, 'utf8');
      if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
        conn.end(JSON.stringify({ type: 'error', code: 'auth_failed', message: 'Invalid token' }) + '\n');
        conn.destroy();
        return;
      }

      // Validate required scope declaration
      if (!msg.projectId || !msg.teamId) {
        conn.end(JSON.stringify({ type: 'error', code: 'scope_required',
          message: 'Auth must include projectId and teamId' }) + '\n');
        conn.destroy();
        return;
      }

      authenticated = true;
      // Bind connection to declared scope — immutable for this connection's lifetime
      const connectionScope: ConnectionScope = {
        projectId: msg.projectId,
        teamId: msg.teamId,
        permission: this.resolvePermission(msg.projectId, msg.teamId),
      };

      conn.write(JSON.stringify({
        type: 'auth_ok',
        pid: process.pid,
        agentCount: this.getAgentsByScope(msg.projectId, msg.teamId).length,
        scope: connectionScope,
      }) + '\n');
      this.acceptReconnection(conn, connectionScope);
    } catch {
      conn.end(JSON.stringify({ type: 'error', code: 'parse_error', message: 'Invalid JSON' }) + '\n');
      conn.destroy();
    }
  });
}

// Connection scope — bound at auth time, enforced on every subsequent message
interface ConnectionScope {
  projectId: string;
  teamId: string;
  permission: TeamPermission;
}
```

**Scope enforcement:** After auth, every message on this connection is validated against the bound scope. The `projectId` and `teamId` fields in messages like `SpawnAgentMessage` are verified to match the connection scope — a client cannot operate outside its declared scope regardless of what it puts in message fields.

```typescript
// Agent server: enforceScope() — called before processing any message
function enforceScope(msg: OrchestrationMessage, conn: ScopedConnection): void {
  if ('projectId' in msg && msg.projectId !== conn.scope.projectId) {
    throw new ScopeViolationError(
      `Connection bound to project ${conn.scope.projectId}, message targets ${msg.projectId}`);
  }
  if ('teamId' in msg && msg.teamId !== conn.scope.teamId) {
    throw new ScopeViolationError(
      `Connection bound to team ${conn.scope.teamId}, message targets ${msg.teamId}`);
  }
}
```

```typescript
// Orchestration server: ForkTransport.reconnectViaTcp()
async reconnectViaTcp(port: number, tokenPath: string, scope: TeamContext): Promise<void> {
  const token = fs.readFileSync(tokenPath, 'utf8').trim();
  const conn = net.createConnection({ host: '127.0.0.1', port });

  await new Promise<void>((resolve, reject) => {
    conn.on('connect', () => {
      // Send auth with scope declaration as first message
      conn.write(JSON.stringify({
        type: 'auth',
        token,
        projectId: scope.projectId,
        teamId: scope.teamId,
      }) + '\n');
    });

    conn.once('data', (data) => {
      const response = JSON.parse(data.toString().trim());
      if (response.type === 'auth_ok') {
        resolve();
      } else {
        reject(new Error(`Auth failed: ${response.message}`));
      }
    });

    conn.on('error', reject);
    setTimeout(() => reject(new Error('Connection timeout')), 5_000);
  });

  // Authenticated + scope-bound — wire up message handling
  this.setupMessageHandler(conn);
  this.setState('connected');
}
```

### Security Properties

| Threat | Mitigation |
|--------|------------|
| Other OS user reads port/token files | `0o600` file permissions — only owning user can read |
| Same-user rogue process connects without token | Connection rejected — `auth_required` error |
| Same-user rogue process reads token file and connects | ⚠️ **Possible** — same security boundary as the daemon design. Token file is the sole barrier for same-user processes. This is acceptable for a local dev tool. |
| **Impersonating another team** | **Connection scope bound at auth time.** The `(projectId, teamId)` declared in the auth message is immutable for the connection lifetime. All subsequent messages are validated against this scope. A valid token lets you authenticate, but you can only access your declared scope. |
| Timing attack on token comparison | `crypto.timingSafeEqual()` prevents timing-based token extraction |
| Slow/hanging connection | 5-second auth timeout — connection destroyed if no auth received |
| Replay attack (stale token from previous session) | Token is regenerated on every agent server startup. Old tokens are invalid. |
| Network sniffing (remote attacker) | TCP bound to `127.0.0.1` — not reachable from network |
| **Global list leaking all team data** | `ListAgentsMessage` **requires** `(projectId, teamId)` — connection scope is enforced. No unscoped listing without `server_admin` permission (local-only, resolved at auth time). |

**Security boundary:** Same as the daemon design — the token file (0o600) is the sole barrier against same-user attackers. For a local dev tool running on the developer's own machine, this is the appropriate security level. The WebSocketTransport (future) adds TLS for network scenarios and per-team tokens for team isolation.

### Discovery Flow

```typescript
function discoverAgentServer(): { pid: number; port: number; tokenPath: string } | null {
  const runDir = getRunDir();
  const pidFile = path.join(runDir, 'agent-server.pid');
  const portFile = path.join(runDir, 'agent-server.port');
  const tokenFile = path.join(runDir, 'agent-server.token');

  if (!fs.existsSync(pidFile) || !fs.existsSync(portFile) || !fs.existsSync(tokenFile)) return null;

  const pid = parseInt(fs.readFileSync(pidFile, 'utf8'));
  const port = parseInt(fs.readFileSync(portFile, 'utf8'));

  // Verify process is alive
  try {
    process.kill(pid, 0);  // Signal 0 = check existence
    return { pid, port, tokenPath: tokenFile };
  } catch {
    // Stale files — clean up
    for (const f of [pidFile, portFile, tokenFile]) {
      try { fs.unlinkSync(f); } catch {}
    }
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
       │  ── TCP connect (new process) ────│
       │  ── auth(token) ─────────────────→│  Token validated (timingSafeEqual)
       │  ←── auth_ok(pid, agentCount) ────│
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

## Error Handling: Agent Server Failure = UI Error

The agent server is a hard dependency. When it's unavailable, the orchestration server MUST surface a clear error to the user — never fail silently.

### Health Check Heartbeat

The orchestration server monitors the agent server's health via periodic pings:

```typescript
class AgentServerHealthMonitor {
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private missedHeartbeats = 0;
  private _status: AgentServerStatus = 'connecting';

  readonly HEARTBEAT_INTERVAL_MS = 10_000;  // 10 seconds
  readonly MAX_MISSED_HEARTBEATS = 3;       // 30s before 'unreachable'
  readonly HEARTBEAT_TIMEOUT_MS = 5_000;    // 5s per ping

  constructor(
    private client: AgentServerClient,
    private onStatusChange: (status: AgentServerStatus) => void,
  ) {}

  start(): void {
    this.heartbeatInterval = setInterval(() => this.ping(), this.HEARTBEAT_INTERVAL_MS);
  }

  private async ping(): Promise<void> {
    try {
      const start = Date.now();
      await this.client.ping(this.HEARTBEAT_TIMEOUT_MS);
      this.missedHeartbeats = 0;
      this.setStatus('healthy', { latencyMs: Date.now() - start });
    } catch {
      this.missedHeartbeats++;
      if (this.missedHeartbeats >= this.MAX_MISSED_HEARTBEATS) {
        this.setStatus('unreachable');
      } else {
        this.setStatus('degraded', { missedHeartbeats: this.missedHeartbeats });
      }
    }
  }

  private setStatus(status: AgentServerStatus, meta?: Record<string, unknown>): void {
    if (status !== this._status) {
      this._status = status;
      this.onStatusChange(status);
    }
  }
}

type AgentServerStatus = 'connecting' | 'healthy' | 'degraded' | 'unreachable' | 'crashed';
```

### Connection Status Tracking

The orchestration server tracks the agent server connection state and pushes updates to the UI via WebSocket:

```typescript
// In container.ts — wire health monitor to WebSocket
const healthMonitor = new AgentServerHealthMonitor(agentServerClient, (status) => {
  // Persist status for API queries
  container.internal.agentServerStatus = status;

  // Push to all connected UI clients immediately
  wsServer.broadcast({
    type: 'agent_server:status',
    status,
    timestamp: Date.now(),
    ...(status === 'crashed' ? { message: 'Agent server process exited unexpectedly' } : {}),
    ...(status === 'unreachable' ? { message: `No heartbeat response for ${30}s` } : {}),
  });
});
```

### UI Error States

The web UI reacts to `agent_server:status` WebSocket events with appropriate visual indicators:

| Status | UI Treatment | User Action |
|--------|-------------|-------------|
| `connecting` | Spinner in header: "Connecting to agent server..." | Wait |
| `healthy` | Green dot in header (same as current daemon dot) | None needed |
| `degraded` | Amber dot + tooltip: "Agent server slow (1 missed heartbeat)" | Monitor |
| `unreachable` | **Red banner across top:** "⚠️ Agent server unreachable — agents may be unresponsive" | Check logs, restart |
| `crashed` | **Red overlay banner:** "🔴 Agent server crashed. All agents lost. [Restart Agent Server] [View Logs]" | Click restart or investigate |

**Banner behavior:**
- **Red banner (unreachable/crashed)** is non-dismissible — it stays until the agent server recovers
- **[Restart Agent Server]** calls the API endpoint `POST /api/agent-server/restart` which re-forks a new agent server
- **[View Logs]** opens the agent server's stderr output (captured by the orchestration server)
- When status returns to `healthy`, the banner auto-dismisses with a green toast: "✅ Agent server reconnected"

### Agent Server Crashes

If the agent server process dies (OOM, segfault, unhandled exception):

1. ForkTransport detects child `'exit'` event → status becomes `crashed`
2. All agents are lost (they were children of the agent server)
3. WebSocket pushes `agent_server:status = 'crashed'` to UI
4. UI shows red overlay: "Agent server crashed. All agents lost. [Restart Agent Server]"
5. **No silent fallback.** Spawn requests return `AgentServerUnavailableError` until agent server is restarted.
6. On restart: orchestration server forks new agent server → status returns to `healthy` → SDK resume restores agents from roster

```typescript
// ForkTransport: detect crash
this.child.on('exit', (code, signal) => {
  this.setState('disconnected');
  this.healthMonitor.setStatus('crashed');

  // All pending requests fail immediately
  for (const [id, pending] of this.pendingRequests) {
    pending.reject(new AgentServerUnavailableError('Agent server crashed'));
  }
  this.pendingRequests.clear();
});
```

### Orchestration Server Crashes

If the orchestration server dies:
1. Agent server detects IPC disconnect
2. Agents keep running, events buffered
3. tsx watch restarts orchestration server
4. New server connects, authenticates, subscribes, replays events
5. Zero agent interruption — the core use case

### IPC Channel Corruption

If `process.send()` throws (channel destroyed, serialization error):
1. Agent server catches the error
2. Falls back to buffering mode (same as disconnect)
3. Orchestration server reconnects via TCP

### Agent Server Won't Start

If fork fails or agent server crashes on startup:
1. ForkTransport.connect() times out (10s default)
2. Status set to `crashed` → UI shows error banner
3. **No agents can be created.** All spawn requests fail with `AgentServerUnavailableError`.
4. UI shows: "🔴 Agent server failed to start. [Retry] [View Logs]"
5. **[Retry]** attempts to fork again
6. The orchestration server itself remains functional (UI, API, DAG viewing) — just no agent operations

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

## State Persistence Ownership

### Principle: Write-on-Mutation, Not Write-on-Shutdown

The agent server persists state on **every lifecycle event** (spawn, status change, exit), not just on graceful shutdown. This means:

- **Graceful shutdown:** State is already in SQLite. Shutdown just flushes any remaining buffers.
- **Crash:** The last-mutated state is already in SQLite. At most one event is lost (the one being processed when the crash occurred).
- **Restart:** The agent server reads persisted state, detects stale/crashed agents, and marks them dead or attempts SDK resume.

This mirrors the `TimerRegistry` and `MessageQueueStore` patterns already in the codebase — DB-first, in-memory cache second.

### Shared Database with Ownership Boundaries

A single shared SQLite database (WAL mode, already configured) with clear write ownership per table. Only one process writes to any given table — this eliminates write contention without requiring separate databases or synchronization protocols.

**Why shared DB (not separate)?**
- SQLite WAL mode supports concurrent readers with a single writer — perfect for two-process architecture
- No sync complexity (no replication, no conflict resolution, no message-based state transfer)
- Both processes see the same data immediately (no eventual consistency)
- Existing 25+ tables and migrations work unchanged
- Single backup, single migration path

### Multi-Orchestrator Write Contention (SQLITE_BUSY)

**Problem:** The two-process model assumes exactly one agent server and one orchestration server. But in the multi-team scenario with WebSocketTransport, multiple orchestration servers connect simultaneously. If each opens its own SQLite connection and writes to "orchestration-owned" tables (dagTasks, knowledge, messageQueue, etc.), SQLite WAL mode only allows **one writer at a time** — concurrent writes cause `SQLITE_BUSY` errors.

**This is a fundamental constraint.** SQLite is an embedded database designed for single-process or single-writer use. Our options:

| Approach | Complexity | Latency | Correctness |
|----------|-----------|---------|-------------|
| **A. Agent server as DB write proxy** | Medium | +1 IPC hop per write | ✅ Single writer guaranteed |
| **B. Separate DBs per team** | High | None | ✅ But loses shared reads |
| **C. Write-ahead queue via agent server** | Medium | Async batched | ✅ Ordered, single writer |
| **D. SQLite busy timeout + retry** | Low | Unpredictable | ⚠️ Works under low contention |

**Chosen approach: A + D hybrid — Agent server as the sole DB writer, with busy timeout as a safety net.**

**Rationale:**
- The agent server is already a singleton shared process. It's the natural home for the single DB writer.
- All orchestration servers send write requests to the agent server via IPC/WebSocket. The agent server executes writes sequentially.
- This extends the existing "sole agent owner" invariant: the agent server is also the **sole DB writer**.
- The orchestration server becomes a **read-only DB client** with writes proxied through the agent server.
- The `busy_timeout` pragma (already set at 5000ms) handles the edge case where the agent server and a read query collide in WAL mode.

```typescript
// Updated architecture: agent server owns ALL DB writes

// Orchestration → Agent Server (new message types for DB writes)
type DbWriteMessage =
  | { type: 'db_write'; requestId: string; table: string; operation: 'insert' | 'update' | 'delete'; data: unknown }
  | { type: 'db_batch_write'; requestId: string; writes: DbWriteMessage[] };

// Agent server processes writes sequentially — no SQLITE_BUSY possible
class AgentServer {
  private writeQueue = new AsyncQueue<DbWriteMessage>();

  async processWrites(): Promise<void> {
    for await (const msg of this.writeQueue) {
      // Single-threaded write processing — no contention
      await this.executeDbWrite(msg);
      this.sendWriteResult(msg.requestId, { success: true });
    }
  }
}

// Orchestration server: read directly, write via agent server
class OrchestrationDbClient {
  private db: BetterSqlite3.Database;  // Read-only connection
  private agentServer: AgentServerClient;

  read<T>(query: () => T): T {
    return query();  // Direct read — WAL mode allows concurrent readers
  }

  async write(table: string, operation: string, data: unknown): Promise<void> {
    // Proxy write through agent server
    await this.agentServer.sendAndWait({
      type: 'db_write',
      requestId: nanoid(),
      table,
      operation,
      data,
    });
  }
}
```

**Impact on the existing table ownership model:**
- The "Agent Server Owns / Orchestration Server Owns" table split remains conceptually correct — it determines which process **initiates** writes.
- But physically, ALL writes flow through the agent server's DB connection.
- Orchestration-initiated writes (dagTasks, knowledge, etc.) are sent as messages to the agent server, which executes them.
- This adds ~1ms latency per write (IPC round-trip) — negligible for a dev tool.

**Phase 1 (ForkTransport, single orchestrator):** Both processes can write directly — there's only one orchestration server, so no contention. The busy timeout handles rare WAL collisions.

**Phase 2 (WebSocketTransport, multi orchestrator):** All orchestration writes proxy through the agent server. This is a transport-layer concern — the application code uses the same `OrchestrationDbClient` interface regardless.

> **Note:** Tables are scoped by `(projectId, teamId)` or `(projectId)` only. See the **Multi-Team, Multi-Project Model** section for full scoping rules, schema changes, and index strategy.

#### Agent Server Owns (writes):

| Table | Scope | Write Trigger |
|-------|-------|---------------|
| `agentRoster` | `(projectId, teamId)` | Every spawn, status change, exit |
| `activeDelegations` | `(projectId, teamId)` | Delegation create, complete, fail |
| `conversations` (agent rows) | `(agentId)` | On agent output events |
| `messages` (agent rows) | `(conversationId)` | On each agent message |

#### Orchestration Server Owns (writes):

| Table | Scope | Write Trigger |
|-------|-------|---------------|
| `dagTasks` | `(projectId, leadId=teamId)` | DAG mutations |
| `projects` | global | Project CRUD |
| `messageQueue` | `(projectId, teamId)` | Agent messaging |
| `knowledge` | `(projectId)` — shared across teams | Knowledge operations |
| `fileLocks` | `(projectId)` — shared across teams | Lock/unlock operations |
| `decisions` | `(projectId, teamId)` | Governance actions |
| `timers` | `(projectId, teamId)` | Timer create/fire/cancel |
| `chatGroups`, `chatGroupMessages` | `(projectId, teamId)` | Group operations |
| `activityLog` | `(projectId, teamId)` | All significant events |
| `collectiveMemory` | `(projectId)` — shared across teams | Memory operations |
| `agentPlans` | `(agentId)` | Plan updates |

#### Both Read:

| Reader | Tables Read | Purpose |
|--------|------------|---------|
| Agent server | `messageQueue` | Drain queued messages to agents on startup |
| Agent server | `projects` | Resolve project config for agent spawn |
| Orchestration server | `agentRoster` | Display agent status in UI, reconciliation |
| Orchestration server | `activeDelegations` | Track delegation status in DAG view |
| Orchestration server | `conversations`, `messages` | Display agent conversation history in UI |

### Filesystem Mirroring Ownership

Each process runs its own `SyncEngine` instance for the tables it owns. See the **Multi-Team, Multi-Project Model** section for the full directory structure with team-scoped paths.

**Summary:** Team-scoped data lives under `~/.flightdeck/projects/<project-id>/teams/<team-id>/` (agents, DAG, activity). Project-scoped shared data lives under `~/.flightdeck/projects/<project-id>/` (knowledge, locks, memory).

**Rule:** Each directory is written by exactly one process. The other process may read but never writes. This eliminates filesystem race conditions without locks.

## Recovery Responsibilities

### Who Restarts What

| Failure | Who Detects | Who Recovers | Recovery Action |
|---------|-------------|-------------|-----------------|
| Agent server crash | Orchestration server (ForkTransport `'exit'` event) | Orchestration server | Re-fork agent server, wait for ready, reconcile |
| Orchestration server crash | Agent server (IPC disconnect) | tsx watch (auto-restart) | New server connects, authenticates, subscribes |
| Individual agent crash | Agent server (child `'exit'` event) | Orchestration server (decides policy) | SDK resume, re-spawn, or mark failed |
| Both crash | OS / developer | Developer restarts `npm run dev` | Full startup sequence |

### Agent Server Self-Recovery on Startup

When the agent server starts (fresh or after crash), it recovers its own state:

```typescript
class AgentServer {
  async recover(): Promise<RecoveryResult> {
    // 1. Read last-known agent roster from SQLite
    const roster = db.select().from(agentRoster)
      .where(eq(agentRoster.status, 'running')).all();

    const recovered: string[] = [];
    const stale: string[] = [];

    for (const entry of roster) {
      // 2. Check if the agent process is still alive (from previous session)
      if (this.isProcessAlive(entry.pid)) {
        // Agent survived (rare — only if agent server was the one that died
        // but agents were somehow reparented). Re-adopt.
        this.reattachAgent(entry);
        recovered.push(entry.agentId);
      } else {
        // Agent is dead — mark as stale in DB
        db.update(agentRoster)
          .set({ status: 'stale', updatedAt: now() })
          .where(eq(agentRoster.id, entry.id)).run();
        stale.push(entry.agentId);
      }
    }

    return { recovered, stale, total: roster.length };
  }
}
```

### Orchestration Server Reconciliation

After the agent server restarts (or on initial connection), the orchestration server reconciles what SHOULD be running vs what IS running. **Reconciliation is team-scoped** — each orchestration server only reconciles its own `(projectId, teamId)` scope:

```typescript
async function reconcileAgents(
  agentServerClient: AgentServerClient,
  scope: TeamContext,          // ← Team-scoped reconciliation
  dagTasks: DagTask[],
  roster: AgentRosterEntry[],
): Promise<ReconciliationPlan> {
  // 1. Ask agent server what's alive in OUR scope
  const liveAgents = await agentServerClient.list();  // Already scope-enforced by connection
  const liveSet = new Set(liveAgents.map(a => a.agentId));

  // 2. Compare with what OUR DAG says should be running
  const activeTasks = dagTasks.filter(t =>
    t.status === 'in_progress' &&
    t.assignedAgentId &&
    t.teamId === scope.teamId &&     // ← Only our team's tasks
    t.projectId === scope.projectId  // ← Only our project
  );

  const plan: ReconciliationPlan = {
    alive: [],       // Running and should be running ✅
    missing: [],     // Should be running but not found — need re-spawn
    orphaned: [],    // Running but no DAG task — may be stale
    staleInDb: [],   // Marked stale in roster — need resume or re-spawn
  };

  for (const task of activeTasks) {
    if (liveSet.has(task.assignedAgentId)) {
      plan.alive.push(task.assignedAgentId);
    } else {
      plan.missing.push({ agentId: task.assignedAgentId, task });
    }
  }

  // 3. Execute plan
  for (const { agentId, task } of plan.missing) {
    const rosterEntry = roster.find(r => r.agentId === agentId);
    if (rosterEntry?.sessionId && rosterEntry.supportsResume) {
      // Attempt SDK resume
      await agentServerClient.spawn({ ...rosterEntry, sessionId: rosterEntry.sessionId });
    } else {
      // Fresh spawn with task context
      await agentServerClient.spawn({ role: task.role, task: task.description, ... });
    }
  }

  return plan;
}
```

**Reconciliation runs:**
1. On orchestration server startup (connect to existing agent server)
2. After agent server restart (re-fork recovery)
3. On explicit user action ("Reconcile agents" button)

## Multi-Team, Multi-Project Model

### Overview

The agent server supports a **many-to-many** relationship between teams and projects:

- A **team** can work on multiple projects simultaneously
- A **project** can be worked on by multiple teams
- The agent server hosts agents from ALL teams across ALL projects

```
┌──────────────────────────────────────────────────────────────────┐
│  Agent Server (shared infrastructure)                            │
│                                                                  │
│  ┌─ Project: acme-app ─────────────────────────────────────┐     │
│  │  ┌─ Team: alice ──────┐  ┌─ Team: bob ──────────────┐  │     │
│  │  │  architect (agent)  │  │  developer-1 (agent)      │  │     │
│  │  │  developer-1        │  │  developer-2              │  │     │
│  │  │  developer-2        │  │  qa-tester                │  │     │
│  │  └────────────────────┘  └───────────────────────────┘  │     │
│  │  Knowledge: shared across both teams                     │     │
│  │  DAG: separate per team (alice's DAG, bob's DAG)         │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                  │
│  ┌─ Project: billing-service ──────────────────────────────┐     │
│  │  ┌─ Team: alice ──────┐                                  │     │
│  │  │  developer-1        │  (alice works on both projects) │     │
│  │  │  developer-2        │                                  │     │
│  │  └────────────────────┘                                  │     │
│  │  Knowledge: separate from acme-app                       │     │
│  └──────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

### Team Identity

A **team** has a **stable, persistent identity** that survives lead restarts and session changes:

```typescript
type TeamId = string;  // e.g., "alice-team", "ci-pipeline", or auto-generated "team-a1b2c3d4"

interface TeamContext {
  teamId: TeamId;       // Stable identifier — persists across sessions
  projectId: string;    // The project being worked on
}
```

**Why NOT teamId = leadId?** The critical reviewer identified that tying team identity to the lead's agentId creates a fragile coupling: if the lead process restarts (new agentId), the entire team identity changes. All team-scoped data (roster, DAG, delegations) becomes orphaned under the old teamId. This is unacceptable for persistent teams.

**teamId is a stable, first-class identity:**

| Property | leadId (rejected) | teamId (chosen) |
|----------|-------------------|-----------------|
| Lifespan | One session (ephemeral) | Persists across sessions |
| Stability | Changes on lead restart | Survives restarts |
| Storage | In-memory only | Stored in `teams` table + config |
| Assignment | Implicit from process | Explicit (config or auto-generated) |
| Relationship to lead | 1:1 (tightly coupled) | 1:many (team outlives any lead) |

**How teamId is assigned:**
1. **Config-based (recommended for persistent teams):** User sets `teamId: 'alice-team'` in `flightdeck.config.yaml`. This is the primary mechanism for teams that persist across sessions.
2. **Auto-generated on first session:** If no teamId is configured, one is generated on first run (`team-${nanoid(8)}`) and stored in the project's team registry. Subsequent sessions reuse it.
3. **Default fallback:** Solo developers with no config get `teamId = 'default'` (implicit single-team mode). All existing code continues to work unchanged.

**Relationship to leadId:** The `dagTasks.leadId` column records WHICH lead instance is running a DAG, not team identity. Multiple lead instances across sessions share the same `teamId` but have different `leadId` values. The compound key for DAG tasks is `(id, teamId)` — not `(id, leadId)`.

```sql
-- New: teams registry table
CREATE TABLE teams (
  team_id TEXT PRIMARY KEY,
  name TEXT,                          -- Human-readable name (e.g., "Alice's crew")
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  config TEXT                         -- JSON: default model, provider prefs, etc.
);

-- dagTasks: rename leadId usage to teamId for scoping
-- (leadId column retained for "which lead instance" tracking, but scoping uses teamId)
```

### Scoping Hierarchy

The compound key `(projectId, teamId)` is the primary scoping mechanism. Different data types scope differently:

```
                    ┌─────────────────────────────┐
                    │  Global (agent server-wide)  │
                    │  - Server config             │
                    │  - Health monitoring          │
                    │  - Mass failure detection     │
                    └──────────┬──────────────────┘
                               │
                    ┌──────────▼──────────────────┐
                    │  Project-scoped (projectId)  │
                    │  - Knowledge store            │
                    │  - File locks                 │
                    │  - Project config             │
                    │  - Collective memory          │
                    └──────────┬──────────────────┘
                               │
                    ┌──────────▼──────────────────┐
                    │  Team-scoped                  │
                    │  (projectId + teamId)         │
                    │  - Agent roster               │
                    │  - DAG tasks                  │
                    │  - Active delegations          │
                    │  - Chat groups                │
                    │  - Message queue              │
                    │  - Activity log               │
                    └──────────┬──────────────────┘
                               │
                    ┌──────────▼──────────────────┐
                    │  Agent-scoped (agentId)       │
                    │  - Conversations / messages   │
                    │  - Agent plans                │
                    │  - Agent memory               │
                    └─────────────────────────────┘
```

**Key rule: Knowledge is project-level, not team-level.** When Alice's team learns that "the billing API uses OAuth2," Bob's team on the same project should see that knowledge too. Knowledge is a shared asset for the project. But Alice's DAG and agents are her own — Bob shouldn't see or control them (unless granted access).

### Data Ownership with Multi-Team

#### Agent Server Owns (writes):

| Table | Scope | Key Columns | Write Trigger |
|-------|-------|-------------|---------------|
| `agentRoster` | `(projectId, teamId)` | agentId, role, status, pid, **projectId**, **teamId** | Every spawn, status change, exit |
| `activeDelegations` | `(projectId, teamId)` | delegationId, agentId, task, **projectId**, **teamId** | Delegation create, complete, fail |
| `conversations` | `(agentId)` | id, agentId, taskId | On agent output |
| `messages` | `(conversationId)` | id, conversationId, sender, content | On each agent message |

#### Orchestration Server Owns (writes):

| Table | Scope | Key Columns | Write Trigger |
|-------|-------|-------------|---------------|
| `dagTasks` | `(projectId, teamId)` | id, **leadId** (=teamId), **projectId** | DAG mutations |
| `knowledge` | `(projectId)` | id, **projectId**, category, key | Knowledge operations |
| `messageQueue` | `(projectId, teamId)` | id, agentId, **projectId**, **teamId** | Agent messaging |
| `fileLocks` | `(projectId)` | filePath, agentId, **projectId** | Lock/unlock |
| `decisions` | `(projectId, teamId)` | id, **projectId**, **teamId** | Governance actions |
| `collectiveMemory` | `(projectId)` | id, **projectId**, key | Memory operations |
| `chatGroups` | `(projectId, teamId)` | id, **projectId**, **teamId** | Group operations |
| `activityLog` | `(projectId, teamId)` | id, **projectId**, **teamId** | All significant events |
| `timers` | `(projectId, teamId)` | id, **projectId**, **teamId** | Timer operations |
| `agentPlans` | `(agentId)` | agentId, plan | Plan updates |

#### Cross-Team Read Patterns:

| Reader | Tables Read | Scope | Purpose |
|--------|-------------|-------|---------|
| Team A's orchestrator | `knowledge` | projectId only | See knowledge from all teams |
| Team A's orchestrator | `fileLocks` | projectId only | See all locks (prevent conflicts) |
| Team A's orchestrator | `agentRoster` | own (projectId, teamId) | Own agents only (default) |
| Project admin | `agentRoster` | projectId only | See all teams' agents |
| Agent server | `messageQueue` | (projectId, teamId) per agent | Drain messages to each agent |

### Scenarios

#### Scenario 1: Solo Developer (default)

```
Config: No explicit teamId
teamId = 'default' (auto-assigned)

Agent Server:
  Project: my-app
    Team: default
      lead, architect, developer-1, developer-2
```

Everything works as before. The `teamId = 'default'` is implicit — solo developers never need to think about teams. All existing code continues to work unchanged because the default value is applied automatically.

#### Scenario 2: One Developer, Multiple Projects

```
Alice opens two terminal tabs, each running a different project.

Agent Server:
  Project: acme-app (tab 1)
    Team: alice-lead-x7k2
      architect, dev-1, dev-2, qa
  Project: billing-service (tab 2)
    Team: alice-lead-m4n9
      dev-1, dev-2

Alice's agent budget: 6 total agents across both projects.
She switches tabs — the orchestration server in each tab connects
to the same agent server with different (projectId, teamId) scopes.
```

The agent server manages both project's agents simultaneously. Each orchestration server only sees its own scope. When Alice closes tab 1, she can choose to terminate acme-app agents or let them keep running.

#### Scenario 3: Team Collaboration (Same Project)

```
Alice and Bob both work on acme-app.
Alice runs her own Flightdeck instance, Bob runs his.
Both connect to the same agent server (via WebSocketTransport, future).

Agent Server:
  Project: acme-app
    Team: alice-lead-x7k2
      architect, dev-1, dev-2       # Alice's crew
    Team: bob-lead-j8p5
      dev-1, dev-2, qa              # Bob's crew

Shared across teams:
  - Knowledge store (projectId = acme-app)
  - File locks (projectId = acme-app) — prevents Alice and Bob editing same files

Isolated per team:
  - Agent roster (each team's agents are independent)
  - DAG tasks (each team runs its own task DAG)
  - Delegations (each team's delegation chain)
```

**File lock contention:** File locks are project-scoped. If Alice's dev-1 locks `src/api.ts`, Bob's dev-2 sees the lock and cannot acquire it. This is the coordination mechanism between teams — they share the lock table even though they have separate agents.

**Knowledge sharing:** When Alice's architect writes to knowledge ("the auth module uses JWT"), Bob's agents see it when they query knowledge. Knowledge flows between teams automatically.

#### Scenario 4: Enterprise (Many Teams, Many Projects)

```
Agent Server (centralized, running on a shared machine):
  Project: platform-api
    Team: alice-lead    (3 agents)
    Team: bob-lead      (4 agents)
    Team: ci-pipeline   (2 agents, automated)
  Project: mobile-app
    Team: carol-lead    (5 agents)
    Team: alice-lead    (2 agents — Alice works on both)
  Project: data-pipeline
    Team: dave-lead     (3 agents)

Total: 19 agents, 4 projects, 5 teams
Some teams span multiple projects (alice-lead on both platform-api and mobile-app).
```

This requires the WebSocketTransport (multiple orchestration servers connecting over the network). The ForkTransport (single parent) works only for local/solo scenarios.

### Agent Server API Changes

All scoping-relevant messages gain `projectId` and `teamId` fields:

```typescript
// Updated OrchestrationMessage types

interface SpawnAgentMessage {
  type: 'spawn';
  requestId: string;
  projectId: string;            // ← NEW: which project
  teamId: string;               // ← NEW: which team
  params: {
    agentId: string;
    role: string;
    task: string;
    provider: string;
    model?: string;
    cwd: string;
    env?: Record<string, string>;
    cliCommand: string;
    cliArgs: string[];
    sessionId?: string;
    autopilot: boolean;
    systemPrompt: string;
  };
}

interface TerminateAgentMessage {
  type: 'terminate';
  requestId: string;
  projectId: string;            // ← NEW
  teamId: string;               // ← NEW
  agentId: string;
  reason?: string;
}

interface ListAgentsMessage {
  type: 'list';
  requestId: string;
  projectId: string;            // ← REQUIRED: always scoped (enforced by connection scope)
  teamId: string;               // ← REQUIRED: always scoped (enforced by connection scope)
  // Connection scope is validated — clients cannot list outside their bound scope.
  // Cross-team listing requires server_admin permission (resolved at auth time).
}

interface SubscribeMessage {
  type: 'subscribe';
  projectId: string;            // ← NEW
  teamId: string;               // ← NEW
  agentId?: string;             // Optional: subscribe to one agent, or all in scope
  lastSeenEventId?: string;
  fromStart?: boolean;
}

interface ConfigureMessage {
  type: 'configure';
  projectId: string;            // ← NEW: declare project context
  teamId: string;               // ← NEW: declare team context
  massFailure?: { threshold?: number; windowMs?: number; cooldownMs?: number };
}
```

**Updated response types:**

```typescript
interface AgentDescriptor {
  agentId: string;
  projectId: string;            // ← NEW
  teamId: string;               // ← NEW
  role: string;
  task: string;
  provider: string;
  model?: string;
  sessionId?: string;
  pid: number;
  status: 'running' | 'idle' | 'prompting' | 'exited';
  startedAt: string;
}

interface AgentEventMessage {
  type: 'agent_event';
  eventId: string;
  agentId: string;
  projectId: string;            // ← NEW: for event routing
  teamId: string;               // ← NEW: for event routing
  event: AgentEvent;
}

interface MassFailureMessage {
  type: 'mass_failure';
  projectId: string;            // ← NEW: mass failure is project-scoped
  teamId: string;               // ← NEW: ...and team-scoped
  exitCount: number;
  windowSeconds: number;
  recentExits: Array<{ agentId: string; exitCode: number | null; error: string | null }>;
  pausedUntilMs: number;
  likelyCause: 'auth_failure' | 'rate_limit' | 'model_unavailable' | 'resource_exhaustion' | 'unknown';
}
```

**Agent server routing logic:**

```typescript
class AgentServer {
  // Agents indexed by compound key for efficient scoping
  private agents = new Map<string, ManagedAgent>();  // agentId → agent
  private projectTeamIndex = new Map<string, Set<string>>();  // "projectId:teamId" → Set<agentId>
  private projectIndex = new Map<string, Set<string>>();       // "projectId" → Set<agentId>

  handleList(msg: ListAgentsMessage, conn: ScopedConnection): AgentDescriptor[] {
    // Enforce connection scope — always scoped to the authenticated (projectId, teamId)
    this.enforceScope(msg, conn);

    const key = `${conn.scope.projectId}:${conn.scope.teamId}`;
    const ids = this.projectTeamIndex.get(key) ?? new Set();
    return [...ids].map(id => this.toDescriptor(this.agents.get(id)!));

    // Cross-team view (project admin) is a separate message type:
    // ListAllProjectAgentsMessage — requires server_admin permission,
    // validated at auth time. Never exposed through standard ListAgentsMessage.
  }

  routeEvent(event: AgentEventMessage): void {
    // Only send events to orchestration servers subscribed to the matching scope
    for (const subscriber of this.subscribers) {
      if (subscriber.scope.projectId === event.projectId &&
          subscriber.scope.teamId === event.teamId) {
        subscriber.transport.send(event);
      }
    }
  }
}
```

**Mass failure detection is scoped per `(projectId, teamId)`:**

```typescript
// Each team gets its own mass failure detector
private massFailureDetectors = new Map<string, MassFailureDetector>();

onAgentExit(agent: ManagedAgent, exitCode: number): void {
  const key = `${agent.projectId}:${agent.teamId}`;
  let detector = this.massFailureDetectors.get(key);
  if (!detector) {
    detector = new MassFailureDetector(this.config.massFailure);
    this.massFailureDetectors.set(key, detector);
  }
  detector.recordExit(agent.agentId, exitCode);
  // A bad API key in Alice's team doesn't pause Bob's team
}
```

### Database Schema Changes

#### `agentRoster` — Add `teamId`

```sql
-- Migration: add teamId to agent_roster
ALTER TABLE agent_roster ADD COLUMN team_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX idx_agent_roster_project_team ON agent_roster(project_id, team_id);
CREATE INDEX idx_agent_roster_team ON agent_roster(team_id);
```

```typescript
export const agentRoster = sqliteTable('agent_roster', {
  agentId: text('agent_id').primaryKey(),
  role: text('role').notNull(),
  model: text('model').notNull(),
  status: text('status').notNull().default('idle'),
  sessionId: text('session_id'),
  projectId: text('project_id'),
  teamId: text('team_id').notNull().default('default'),     // ← NEW
  createdAt: text('created_at').notNull().default(utcNow),
  updatedAt: text('updated_at').notNull().default(utcNow),
  lastTaskSummary: text('last_task_summary'),
  metadata: text('metadata'),
});
// Indexes: status, projectId, (projectId + teamId), teamId
```

#### `activeDelegations` — Add `projectId` and `teamId`

```sql
-- Migration: add projectId and teamId to active_delegations
ALTER TABLE active_delegations ADD COLUMN project_id TEXT;
ALTER TABLE active_delegations ADD COLUMN team_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX idx_active_delegations_project_team
  ON active_delegations(project_id, team_id);
```

```typescript
export const activeDelegations = sqliteTable('active_delegations', {
  delegationId: text('delegation_id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agentRoster.agentId),
  task: text('task').notNull(),
  context: text('context'),
  dagTaskId: text('dag_task_id'),
  projectId: text('project_id'),                              // ← NEW
  teamId: text('team_id').notNull().default('default'),       // ← NEW
  status: text('status').notNull().default('active'),
  createdAt: text('created_at').notNull().default(utcNow),
  completedAt: text('completed_at'),
  result: text('result'),
});
// Indexes: (agentId + status), status, dagTaskId, (projectId + teamId)
```

#### `dagTasks` — Already has `leadId` ≈ `teamId`

The `dagTasks` table already has `leadId` as part of its compound primary key. In the multi-team model, `leadId` IS the `teamId`:

```typescript
// Existing — no migration needed for dagTasks
export const dagTasks = sqliteTable('dag_tasks', {
  id: text('id').notNull(),
  leadId: text('lead_id').notNull(),     // This IS the teamId
  projectId: text('project_id'),
  // ... rest unchanged
});
// Primary key: (id, leadId)
// leadId = teamId — same identity, already in place
```

#### `messageQueue` — Add `teamId`

```sql
ALTER TABLE message_queue ADD COLUMN team_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX idx_message_queue_project_team ON message_queue(project_id, team_id);
```

#### `chatGroups` — Add `teamId`

```sql
ALTER TABLE chat_groups ADD COLUMN team_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX idx_chat_groups_project_team ON chat_groups(project_id, team_id);
```

#### `activityLog` — Add `teamId`

```sql
ALTER TABLE activity_log ADD COLUMN team_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX idx_activity_log_project_team ON activity_log(project_id, team_id);
```

#### Tables that do NOT get `teamId` (project-scoped only):

| Table | Reason |
|-------|--------|
| `knowledge` | Shared across all teams on a project |
| `fileLocks` | Shared — teams must see each other's locks to avoid conflicts |
| `collectiveMemory` | Shared knowledge across teams |
| `projects` | Project metadata is global |

#### Index Strategy

```sql
-- Compound indexes for efficient (projectId, teamId) scoping
-- These are the hot query paths: "list agents for my team on my project"

CREATE INDEX idx_agent_roster_project_team ON agent_roster(project_id, team_id);
CREATE INDEX idx_active_delegations_project_team ON active_delegations(project_id, team_id);
CREATE INDEX idx_message_queue_project_team ON message_queue(project_id, team_id);
CREATE INDEX idx_chat_groups_project_team ON chat_groups(project_id, team_id);
CREATE INDEX idx_activity_log_project_team ON activity_log(project_id, team_id);

-- Project-only indexes for cross-team queries
CREATE INDEX idx_knowledge_project ON knowledge(project_id);
CREATE INDEX idx_file_locks_project ON file_locks(project_id);

-- Team-only index for "find all of Alice's agents across projects"
CREATE INDEX idx_agent_roster_team ON agent_roster(team_id);
```

### Security: Team Isolation

#### Can Team A See Team B's Agents?

**No.** Each connection is **scope-bound at auth time** to a `(projectId, teamId)` pair. The agent server enforces this on every query — there is no code path that returns agents outside the connection's scope through the standard `ListAgentsMessage`.

```typescript
// All queries are scope-enforced — no optional scoping
handleList(msg: ListAgentsMessage, conn: ScopedConnection): void {
  this.enforceScope(msg, conn);
  const key = `${conn.scope.projectId}:${conn.scope.teamId}`;
  const agents = this.getAgentsByKey(key);
  this.send({ type: 'list_result', requestId: msg.requestId, agents });
}
```

**Cross-team visibility** (e.g., for a project dashboard) requires a separate `AdminListMessage` type that is only processed for connections with `server_admin` permission. This permission is resolved at auth time based on the token — the agent-server.token grants `server_admin` for local ForkTransport connections (single-user dev tool). The future WebSocketTransport can issue per-team tokens with `team_member` permission only.

```typescript
type TeamPermission = 'team_member' | 'project_admin' | 'server_admin';

// team_member: see/control own team's agents only (default for WebSocket)
// project_admin: see (not control) all teams' agents on a project
// server_admin: see/control everything (default for ForkTransport / local)
```

#### Can Team A Control Team B's Agents?

**No.** Even project admins can only view, not control other teams' agents. Agent operations (spawn, terminate, prompt) are always scoped to `(projectId, teamId)` and the agent server enforces this:

```typescript
handleTerminate(msg: TerminateAgentMessage): void {
  const agent = this.agents.get(msg.agentId);
  if (!agent) return this.sendError(msg.requestId, 'AGENT_NOT_FOUND');
  // Enforce team ownership
  if (agent.teamId !== msg.teamId || agent.projectId !== msg.projectId) {
    return this.sendError(msg.requestId, 'TEAM_SCOPE_VIOLATION',
      `Agent ${msg.agentId} belongs to team ${agent.teamId}, not ${msg.teamId}`);
  }
  this.doTerminate(agent, msg.reason);
}
```

#### Knowledge Sharing Boundaries

Knowledge is project-scoped for **reads** but team-scoped for **writes**. This prevents cross-team knowledge poisoning while preserving shared visibility.

**Write isolation:** Each team writes to its own partition within the knowledge table. The `teamId` column (DB-enforced, not metadata JSON) determines ownership:

```sql
-- Knowledge table gains a non-nullable teamId column for write ownership
ALTER TABLE knowledge ADD COLUMN team_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX idx_knowledge_project_team ON knowledge(project_id, team_id);
```

| Operation | Scope | Rule |
|-----------|-------|------|
| **Write** knowledge | `(projectId, teamId)` | Agent server enforces: writes carry the connection's bound `teamId`. DB column, not metadata. |
| **Read** knowledge | `(projectId)` | All teams on the project see all knowledge entries |
| **Update** own entries | `(projectId, teamId)` | Teams can only update entries where `team_id` matches |
| **Delete** own entries | `(projectId, teamId)` | DB `WHERE team_id = ?` enforced — not bypassable via metadata mutation |
| **Dispute** other's entry | `(projectId)` | Teams can flag (not delete) another team's entry for review |

**Why DB column, not metadata JSON?** The critical reviewer correctly identified that authorization based on mutable JSON metadata (`metadata.source.teamId`) is bypassable — any process with DB write access could modify the JSON to claim ownership. Moving `teamId` to a dedicated column with `CHECK` constraints or application-level enforcement makes ownership immutable.

**Knowledge attribution is preserved in metadata** for informational purposes (which agent, which session, confidence level), but **authorization uses the DB column only.**

```typescript
// Knowledge write — agent server enforces team scope
async writeKnowledge(entry: KnowledgeEntry, conn: ScopedConnection): Promise<void> {
  // teamId comes from the connection scope, NOT from the entry payload
  await db.insert(knowledge).values({
    projectId: conn.scope.projectId,
    teamId: conn.scope.teamId,            // DB column — immutable ownership
    category: entry.category,
    key: entry.key,
    content: entry.content,
    metadata: JSON.stringify({
      source: {
        agentId: entry.agentId,           // Informational — who wrote it
        teamId: conn.scope.teamId,        // Informational duplicate
        sessionId: entry.sessionId,
        mechanism: entry.mechanism,
      },
      confidence: entry.confidence,
      tags: entry.tags,
    }),
  });
}

// Knowledge delete — enforced by teamId column
async deleteKnowledge(id: number, conn: ScopedConnection): Promise<boolean> {
  const result = db.delete(knowledge)
    .where(and(
      eq(knowledge.id, id),
      eq(knowledge.projectId, conn.scope.projectId),
      eq(knowledge.teamId, conn.scope.teamId),  // Can only delete own team's entries
    ))
    .run();
  return result.changes > 0;
}
```

**Cross-team knowledge disputes:** If Team A believes Team B wrote incorrect knowledge, Team A can create a `dispute` entry (a special knowledge category) referencing the disputed entry. The orchestration server can surface disputes in the Knowledge Panel for human review. This models real-world disagreement without allowing destructive cross-team actions.

### Filesystem Mirroring with Multi-Team

Updated directory structure with team-scoping:

```
~/.flightdeck/projects/<project-id>/
  teams/                                        # ← NEW: team-scoped data
    <team-id>/
      agents/                                   # Agent server SyncEngine
        roster.json                             # This team's agent roster
        delegations.json                        # This team's delegations
        sessions/
          <agent-id>.json                       # Per-agent session data
      dag/                                      # Orchestration server SyncEngine
        tasks.json                              # This team's task DAG
      activity/                                 # Orchestration server SyncEngine
        log.json                                # This team's activity
      messages/                                 # Orchestration server SyncEngine
        queue.json                              # Queued messages for this team
  knowledge/                                    # Orchestration server SyncEngine (shared)
    core.json                                   # Shared across all teams
    procedural.json
    semantic.json
    episodic.json
  locks/                                        # Orchestration server SyncEngine (shared)
    active.json                                 # All teams' file locks
  memory/                                       # Orchestration server SyncEngine (shared)
    collective.json                             # Shared collective memory
  project.yaml                                  # Project metadata
```

**Ownership rules:**
- `teams/<team-id>/agents/` → written by agent server
- `teams/<team-id>/dag/` → written by orchestration server for that team

**teamId validation (path traversal prevention):** The `teamId` is used in filesystem paths, so it MUST be validated before use. Reject any teamId containing path separators, dots, or other dangerous characters:

```typescript
const TEAM_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/;

function validateTeamId(teamId: string): void {
  if (!TEAM_ID_PATTERN.test(teamId)) {
    throw new Error(
      `Invalid teamId "${teamId}": must be 1-63 alphanumeric/dash/underscore characters, ` +
      `starting with alphanumeric. Path traversal characters (., /, \\) are forbidden.`
    );
  }
}

// Called at: auth handshake, team creation, config loading, any path construction
```

This prevents attacks like `teamId: '../../../etc/passwd'` or `teamId: '..\\..\\windows'`.
- `knowledge/`, `locks/`, `memory/` → written by orchestration server (project-level)
- No cross-team file writes — each team's directory is isolated

**Solo developer (backward compatible):**
```
~/.flightdeck/projects/<project-id>/
  teams/default/                                # teamId = 'default'
    agents/roster.json
    dag/tasks.json
  knowledge/core.json
  project.yaml
```

### Agent Server as Shared Service

The agent server is infrastructure that outlives any single project or team session:

- **User switches projects:** The orchestration server sends a new `configure` message with the new `(projectId, teamId)`. Old agents keep running. The user can explicitly terminate them or leave them.
- **User switches teams:** Same mechanism — the orchestration server re-configures its scope.
- **Agent server restart:** All teams lose agents simultaneously. Recovery (via reconciliation) is per-team — each orchestration server reconciles its own team's agents.
- **Multiple orchestration servers:** With WebSocketTransport, multiple orchestration servers connect simultaneously, each with their own `(projectId, teamId)` scope. Events are routed only to the matching subscriber.

```
Multi-Team Architecture (WebSocketTransport, future):

  Alice's Orchestrator ──────────┐  scope: (acme-app, alice-lead)
                                 │
  Bob's Orchestrator ────────────┤  scope: (acme-app, bob-lead)
                                 │
  Alice's 2nd Orchestrator ──────┤  scope: (billing-svc, alice-lead)
                                 │
         Agent Server ───────────┘
           ├─ acme-app / alice-lead: 3 agents
           ├─ acme-app / bob-lead: 4 agents
           └─ billing-svc / alice-lead: 2 agents

  Events for alice-lead's agents on acme-app → only Alice's 1st orchestrator
  Events for bob-lead's agents on acme-app → only Bob's orchestrator
  Alice's 2nd orchestrator only sees billing-svc agents
```

This is the natural evolution of the architecture. No redesign needed — only the WebSocketTransport implementation and multi-client support in the agent server listener.

## Portable Teams (Export/Import)

### Motivation

Persistent teams accumulate valuable expertise: codebase knowledge, learned procedures, training corrections, and specialization. This expertise should be **portable** — teams should be exportable from one Flightdeck instance and importable into another, carrying all their accumulated intelligence.

Use cases:
- **Onboarding:** Export a senior team, import on a new developer's machine to bootstrap their crew
- **CI/CD:** Export a trained team from dev, import into a CI environment with the same expertise
- **Backup:** Export before a major change, import to roll back
- **Sharing:** Publish team configs for common project types (React app team, Go API team)

### Export: Team → Portable Bundle

```
flightdeck team export --team alice-team --project acme-app --output ./alice-team-export
```

**What's included (persistent, portable state):**

```
alice-team-export/
  manifest.json                     # Bundle metadata + version
  team.json                         # Team config: teamId, name, creation date
  agents/
    arch-alpha.json                 # Agent identity: name, role, model, specialization
    dev-bravo.json                  # Agent identity + config
    qa-charlie.json
  knowledge/
    core.json                       # Knowledge entries (category: core)
    procedural.json                 # Learned procedures
    semantic.json                   # Domain facts
    episodic.json                   # Session summaries (sanitized)
  training/
    corrections.json                # Training corrections with tags
    feedback.json                   # Positive/negative feedback history
  dag-templates/
    default-workflow.json           # Reusable DAG patterns / workflow templates
  identity/
    protection-hashes.json          # Identity protection hashes (prevents impersonation)
  config/
    team-config.yaml                # Provider preferences, model overrides, thresholds
```

**What's EXCLUDED (ephemeral, non-portable):**

| Excluded | Reason |
|----------|--------|
| Active sessions, PIDs | Process-specific, meaningless on another machine |
| Socket paths, ports, tokens | Infrastructure-specific |
| Running agent state | Can't serialize a live process |
| File locks | Transient coordination state |
| Message queue contents | Ephemeral delivery state |
| Absolute file paths in cwd | Machine-specific |

### Bundle Format

```typescript
interface TeamBundle {
  version: '1.0';                    // Bundle format version
  exportedAt: string;                // ISO 8601 timestamp
  flightdeckVersion: string;         // Flightdeck version that created the bundle
  team: {
    teamId: string;
    name: string;
    createdAt: string;
    config: Record<string, unknown>;
  };
  agents: AgentExport[];
  knowledge: KnowledgeExport[];
  training: TrainingExport;
  dagTemplates: DagTemplate[];
  identityHashes: IdentityHash[];
}

interface AgentExport {
  name: string;                      // Human-readable name
  role: string;                      // Architect, Developer, etc.
  model: string;                     // Default model preference
  specialization: string[];          // Domain tags
  totalSessions: number;             // Experience indicator
  totalTasks: number;
  taskSuccessRate: number;
  feedbackScore?: number;
  config: Record<string, unknown>;   // Agent-specific config overrides
}

interface KnowledgeExport {
  category: 'core' | 'episodic' | 'procedural' | 'semantic';
  key: string;
  content: string;
  confidence: number;
  tags: string[];
  source: { mechanism: string; agentName?: string };
}

interface TrainingExport {
  corrections: Array<{ agentName: string; correction: string; tags: string[]; date: string }>;
  feedback: Array<{ agentName: string; type: 'positive' | 'negative'; context: string; date: string }>;
}
```

### Import: Portable Bundle → Team

```
flightdeck team import --from ./alice-team-export --project billing-svc
```

**Import process:**
1. **Validate bundle:** Check `version` compatibility, required fields, schema integrity
2. **Create team:** Register new team with imported config (or merge into existing team)
3. **Create agents:** Populate agent roster from exported identities (new agentIds, same names/roles/specialization)
4. **Load knowledge:** Import all knowledge entries, tagged with `mechanism: 'imported'` and source bundle reference
5. **Load training:** Import corrections and feedback history
6. **Load DAG templates:** Make templates available for the new project
7. **Skip identity hashes:** Regenerate from imported agent configs (hashes are machine-specific)

**Conflict handling on import:**
- **Duplicate teamId:** Prompt user: merge (combine agents + knowledge) or rename
- **Duplicate agent names:** Auto-suffix (e.g., "Arch-Alpha" → "Arch-Alpha-2")
- **Duplicate knowledge keys:** Keep both with different `source.mechanism` tags, let the agent reconcile during use

### Selective Export

```
# Export specific agents only
flightdeck team export --team alice-team --agents arch-alpha,dev-bravo --output ./partial

# Export knowledge only (no agents)
flightdeck team export --team alice-team --knowledge-only --output ./knowledge-dump

# Export without episodic knowledge (session-specific, less portable)
flightdeck team export --team alice-team --exclude-episodic --output ./portable
```

### .flightdeck/ as Portable Format

The filesystem mirror (`~/.flightdeck/projects/<id>/teams/<team-id>/`) is **structurally similar** to the export format. Could the existing filesystem mirror BE the portable format?

**Partially yes:** The `agents/`, `knowledge/`, and `dag/` directories already contain the right data in JSON format. But:
- The filesystem mirror includes **ephemeral state** (active sessions, running status) that shouldn't be exported
- It lacks the **manifest** with version info and export metadata
- It doesn't include **training history** (stored in separate DB tables, not mirrored to filesystem)

**Recommendation:** The export command reads from the filesystem mirror + DB, filters out ephemeral state, adds the manifest, and produces the bundle. The import command reverses this. The filesystem mirror is a *source* for export, not the export format itself.

### Version Compatibility

```typescript
// On import, validate bundle version against current Flightdeck
function validateBundleVersion(bundle: TeamBundle): ValidationResult {
  const current = parseVersion(FLIGHTDECK_VERSION);
  const bundleVersion = bundle.version;

  // Semantic: same major = compatible, different major = breaking
  if (bundleVersion === '1.0') {
    return { compatible: true };
  }
  return {
    compatible: false,
    reason: `Bundle version ${bundleVersion} is not compatible with current Flightdeck`,
    suggestion: 'Upgrade Flightdeck or re-export from a compatible version',
  };
}
```

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
| **Token auth** | 100 | Simplified to connect-time-only (not per-request) |
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
| **Security** | UDS + 256-bit token + umask | Token file (0o600) + localhost | Same security boundary, less ceremony |
| **Network-capable** | ✅ TCP fallback | ✅ Via WebSocketTransport | Pluggable transport enables this |
| **Reconnection** | UDS socket (always available) | TCP reconnect (port file) | Slightly more moving parts |
| **Independent lifecycle** | ✅ Standalone process | ✅ Detached fork | Equivalent |
| **Auth overhead** | Per-request token verification | Token on connect only (not per-message) | Simpler |
| **Maintenance** | Higher (custom protocol, 4 transports) | Lower (Node builtins + TCP) | Less to go wrong |
| **Remote agent pools** | Possible but not designed | ✅ WebSocketTransport ready | Better architecture for future |
| **Implementation** | Mostly done (~3,700 LOC) | ~2 days refactor | Reuses 621 LOC |

## Future: WebSocket Transport for Network Separation

The pluggable transport interface enables a clean evolution path:

```
Phase 1 (now):   ForkTransport — local dev, Node IPC + TCP reconnect, single team
Phase 2 (next):  WebSocketTransport — network separation, multi-team collaboration
```

**WebSocket transport enables the multi-team scenarios** described in "Multi-Team, Multi-Project Model":
- **Team collaboration:** Alice and Bob each run their own orchestration server, both connect to a shared agent server. Each operates in their own `(projectId, teamId)` scope.
- **Multi-machine:** Agent server on a GPU machine, orchestration servers on laptops
- **Shared agent pools:** Multiple developers share a pool of persistent agents
- **Cloud deployment:** Agent server in a container, UI servers on edge/CDN
- **Enterprise:** Many teams, many projects, centralized agent infrastructure

**The interface is already correct for this.** `AgentServerTransport.send()` and `.onMessage()` work identically whether the transport is a fork IPC channel, a TCP socket, or a WebSocket. The message protocol (typed TypeScript objects) serializes to JSON for network transport. The `(projectId, teamId)` scoping in all messages means the agent server can route events to the correct subscriber regardless of transport.

**What WebSocketTransport adds:**
- TLS encryption (wss://)
- Token authentication (Bearer header per connection)
- Reconnect with exponential backoff
- **Connection multiplexing** (multiple orchestration servers, one per team)
- Event routing by `(projectId, teamId)` scope
- ~300-400 LOC

This is the path from "local dev tool" to "team infrastructure" — and the transport interface makes it a clean addition, not a rewrite.

## Team Management UI

### Paradigm Shift: Agents as Persistent Team Members

The current UI treats agents as ephemeral workers — they're spawned, do work, and disappear. The `/agents` dashboard shows a live fleet with transient state (status, current task, token usage). There's no continuity between sessions.

The new model treats agents as **persistent team members** with identity, accumulated knowledge, specialization, and history that spans sessions. An architect agent that has learned your codebase over 50 sessions is fundamentally more valuable than a freshly spawned one. The UI must reflect this.

```
Current Mental Model:                   New Mental Model:
┌──────────────────────────┐            ┌──────────────────────────┐
│  Agent = disposable tool │            │  Agent = team member     │
│  Spawn → work → discard  │     →      │  Hire → train → grow     │
│  No memory between runs  │            │  Persistent memory       │
│  Interchangeable         │            │  Unique specialization   │
│  Status: running/idle    │            │  History, skills, trust  │
└──────────────────────────┘            └──────────────────────────┘
```

### Navigation Integration

New routes integrate into the existing sidebar as a **primary navigation group** (alongside Lead, Overview, Agents):

```
Sidebar Navigation:
  ┌─ Primary ────────────────────────┐
  │  🎯 Lead         (/)             │
  │  📊 Overview     (/overview)     │
  │  🤖 Agents       (/agents)       │  ← live fleet (real-time, current session)
  │  👥 Team         (/team)         │  ← NEW: persistent roster
  │  📋 Tasks        (/tasks)        │
  │  📅 Timeline     (/timeline)     │
  │  🎮 Mission      (/mission-ctrl) │
  │  🎨 Canvas       (/canvas)       │
  ├─ More ───────────────────────────┤
  │  📁 Projects     (/projects)     │
  │  🧠 Knowledge    (/knowledge)    │
  │  ⚡ Daemon       (/daemon)       │  ← rename to "Agent Server"
  │  📈 Analytics    (/analytics)    │
  │  💬 Groups       (/groups)       │
  │  🏗️ Org Chart    (/org)          │
  │  🗄️ Data         (/data)         │
  └──────────────────────────────────┘
```

**Key distinction:** `/agents` remains the **live fleet view** (real-time status, current session, operational). `/team` is the **persistent roster view** (history, identity, cross-session). They show different facets of the same agents — linked by `agentId`.

### 1. Team Roster View (`/team`)

The primary view: all persistent agents across all projects.

```
┌──────────────────────────────────────────────────────────────────────┐
│  👥 Team Roster                                    [+ New Agent]     │
│                                                                      │
│  Filter: [All Projects ▾] [All Roles ▾] [Status: Active ▾] 🔍      │
│  Group by: [None ▾ | Project | Role | Specialization]                │
│                                                                      │
│  ┌─ Summary Cards ─────────────────────────────────────────────────┐ │
│  │  Active: 8  │  Idle: 3  │  Stale: 1  │  Total Knowledge: 847  │ │
│  │  Sessions: 142  │  Avg Uptime: 4.2h  │  Projects: 3           │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ 🏗️ Arch-Alpha        Architect    acme-app       ●  Active     │ │
│  │    Specialization: System design, API architecture              │ │
│  │    Knowledge: 127 entries │ Sessions: 34 │ Since: Jan 15       │ │
│  │    Current: "Designing payment service integration"             │ │
│  ├─────────────────────────────────────────────────────────────────┤ │
│  │ 💻 Dev-Bravo          Developer   acme-app       ●  Active     │ │
│  │    Specialization: React frontend, TypeScript                   │ │
│  │    Knowledge: 89 entries │ Sessions: 28 │ Since: Jan 20        │ │
│  │    Current: "Implementing checkout flow"                        │ │
│  ├─────────────────────────────────────────────────────────────────┤ │
│  │ 🧪 QA-Charlie         QA Tester   acme-app       ○  Idle       │ │
│  │    Specialization: E2E testing, Playwright                      │ │
│  │    Knowledge: 56 entries │ Sessions: 19 │ Since: Feb 3         │ │
│  │    Last active: 2h ago │ "Completed payment flow tests"        │ │
│  ├─────────────────────────────────────────────────────────────────┤ │
│  │ 💻 Dev-Delta          Developer   billing-svc    ⚠  Stale      │ │
│  │    Specialization: Go microservices, gRPC                       │ │
│  │    Knowledge: 34 entries │ Sessions: 8 │ Since: Feb 28         │ │
│  │    Stale since: 6h ago │ Last: "Refactoring invoice handler"   │ │
│  │    [Resume] [Retire] [Reassign]                                 │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

**Per-agent row data:**
- **Identity:** Name (human-readable, persistent), role icon, role label
- **Assignment:** Current project, current team
- **Status:** Active (running now), idle (alive but not working), stale (process dead, state preserved), retired (archived)
- **Specialization:** Learned domain tags from knowledge entries and task history
- **Knowledge:** Entry count — how much this agent "knows"
- **Experience:** Session count, first active date
- **Current/Last task:** What they're doing or last did
- **Actions:** Context-dependent (Resume for stale, Retire for idle, Reassign for any)

### 2. Agent Profiles (`/team/:agentId`)

Individual agent detail page — the "personnel file":

```
┌──────────────────────────────────────────────────────────────────────┐
│  ← Back to Roster                                                    │
│                                                                      │
│  ┌──────────────────────────────────────────────────────┐            │
│  │  🏗️ Arch-Alpha                          ●  Active    │            │
│  │  Role: Architect │ Team: alice-lead │ acme-app       │            │
│  │  Since: Jan 15, 2026 │ 34 sessions │ 127 knowledge  │            │
│  │  Model: claude-sonnet-4.5 │ Provider: claude         │            │
│  │  [Message] [Reassign] [Retrain] [Retire]             │            │
│  └──────────────────────────────────────────────────────┘            │
│                                                                      │
│  ┌─ Tabs ──────────────────────────────────────────────────────────┐ │
│  │  [Overview] [Knowledge] [History] [Skills] [Contributions]      │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ── Overview Tab ──────────────────────────────────────────────────  │
│                                                                      │
│  Specialization Tags:                                                │
│  [System Design] [API Architecture] [Database Modeling] [TypeScript] │
│  [Microservices] [Event-Driven Architecture]                         │
│                                                                      │
│  Performance Summary:                                                │
│  ┌─────────────┬────────────┬──────────────┬──────────────────────┐  │
│  │ Tasks Done  │ Avg Rating │ Knowledge    │ Context Efficiency   │  │
│  │ 89          │ 4.2/5      │ 127 entries  │ 72% (tokens/task)   │  │
│  └─────────────┴────────────┴──────────────┴──────────────────────┘  │
│                                                                      │
│  Recent Activity:                                                    │
│  • 10m ago  Completed "Design payment service API" ✅               │
│  • 2h ago   Reviewed PR #142 — found 3 issues                      │
│  • 5h ago   Updated knowledge: "billing uses Stripe Connect"        │
│  • 1d ago   Session #33 — 4 tasks, 2h 15m active                   │
│                                                                      │
│  ── Knowledge Tab ─────────────────────────────────────────────────  │
│                                                                      │
│  Knowledge by Category:                                              │
│  [Core: 12] [Procedural: 45] [Semantic: 58] [Episodic: 12]         │
│                                                                      │
│  High-Confidence Entries:                                            │
│  • "acme-app uses Next.js 15 with app router" (conf: 0.95)         │
│  • "Payment flow: Stripe → webhook → inventory update" (conf: 0.92)│
│  • "All API routes require auth middleware" (conf: 0.90)            │
│                                                                      │
│  Recently Learned:                                                   │
│  • "Invoice PDF generation uses @react-pdf" (2h ago, conf: 0.78)   │
│  • "Rate limiting is per-tenant, not global" (5h ago, conf: 0.85)  │
│                                                                      │
│  Training History:                                                   │
│  12 corrections received │ 8 positive feedback │ 2 negative         │
│  Top correction tags: [naming-conventions] [test-coverage]           │
│                                                                      │
│  ── History Tab ───────────────────────────────────────────────────  │
│                                                                      │
│  Session Log (most recent first):                                    │
│  #34 │ 2h 15m │ 4 tasks │ "Payment service design" │ Today         │
│  #33 │ 1h 45m │ 3 tasks │ "API versioning strategy" │ Yesterday    │
│  #32 │ 3h 20m │ 6 tasks │ "Database migration plan" │ Mar 5        │
│  ...                                                                 │
│                                                                      │
│  ── Skills Tab ────────────────────────────────────────────────────  │
│                                                                      │
│  Skills are inferred from task history and knowledge:                │
│  ████████████ System Design       (34 tasks, 89% success)           │
│  █████████░░░ API Architecture    (28 tasks, 85% success)           │
│  ███████░░░░░ Database Modeling   (19 tasks, 82% success)           │
│  ████░░░░░░░░ Frontend Review     (8 tasks, 75% success)            │
│                                                                      │
│  ── Contributions Tab ─────────────────────────────────────────────  │
│                                                                      │
│  Files modified: 142 │ Commits: 67 │ PRs reviewed: 23               │
│  Most-touched files:                                                 │
│  • src/api/payments/   (34 changes)                                 │
│  • src/db/migrations/  (22 changes)                                 │
│  • docs/architecture/  (18 changes)                                 │
└──────────────────────────────────────────────────────────────────────┘
```

**Data sources for the profile:**
- **Identity & assignment** → `agentRoster` table + persisted agent config
- **Knowledge** → `knowledge` table filtered by `metadata.source.agentId`
- **Training** → KnowledgePanel's existing `TrainingSummary` API, scoped per agent
- **Session history** → `projectSessions` + `activityLog` joined on agentId
- **Skills** → derived from `dagTasks` (completed tasks by category) + `knowledge` entries
- **Contributions** → `activityLog` events of type commit, file-edit, pr-review

### 3. Team Composition (`/team/compose`)

Manage team structure — assign agents to projects, create new persistent agents:

```
┌──────────────────────────────────────────────────────────────────────┐
│  🏗️ Team Composition                                                │
│                                                                      │
│  ┌─ Project: acme-app ─────────────────────────────────────────────┐ │
│  │                                                                  │ │
│  │  Team: alice-lead              [+ Add Agent] [Auto-compose]     │ │
│  │                                                                  │ │
│  │  Assigned:                                                       │ │
│  │  🏗️ Arch-Alpha (Architect)    ● Active    [Reassign] [Remove]  │ │
│  │  💻 Dev-Bravo  (Developer)    ● Active    [Reassign] [Remove]  │ │
│  │  💻 Dev-Echo   (Developer)    ○ Idle      [Reassign] [Remove]  │ │
│  │  🧪 QA-Charlie (QA Tester)   ○ Idle      [Reassign] [Remove]  │ │
│  │                                                                  │ │
│  │  Available (unassigned):                                         │ │
│  │  💻 Dev-Foxtrot (Developer)   — Unassigned  [Assign Here]      │ │
│  │  📝 Writer-Golf (Tech Writer) — Unassigned  [Assign Here]      │ │
│  │                                                                  │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─ Create New Agent ──────────────────────────────────────────────┐ │
│  │  Name: [________________]  Role: [Architect ▾]                   │ │
│  │  Model: [claude-sonnet-4.5 ▾]  Provider: [claude ▾]            │ │
│  │  Specialization: [System design, API architecture      ]        │ │
│  │  Initial Knowledge: [Import from project ▾] [Import from agent] │ │
│  │  Assign to: [acme-app ▾]  Team: [alice-lead ▾]                 │ │
│  │  [Create Agent]                                                  │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

**Key operations:**
- **Assign/Reassign:** Move an agent from one project to another (or one team to another). The agent keeps its knowledge and identity. Knowledge portability: agent-level knowledge travels with the agent; project-level knowledge stays.
- **Auto-compose:** Given a task description, suggest a team composition (roles, count, which existing agents to reuse vs. create new).
- **Clone:** Create a new agent initialized with another agent's knowledge (fork an expert). The clone starts with the same knowledge entries but diverges from there.
- **Import knowledge:** When creating an agent, optionally seed it with knowledge from a project or from another agent.

### 4. Knowledge Management per Agent

Extends the existing Knowledge Panel (`/knowledge`) with per-agent scoping. Accessible both from `/knowledge` (add agent filter) and from the agent profile's Knowledge tab.

```
┌──────────────────────────────────────────────────────────────────────┐
│  🧠 Knowledge — Agent: Arch-Alpha                 [All Agents ▾]    │
│                                                                      │
│  ┌─ What This Agent Knows ─────────────────────────────────────────┐ │
│  │                                                                  │ │
│  │  127 entries │ Est. 45K tokens │ 4 categories                   │ │
│  │                                                                  │ │
│  │  Confidence Distribution:                                        │ │
│  │  High (>0.85): ████████████████░░░░  68 entries (54%)           │ │
│  │  Med (0.5-0.85):████████░░░░░░░░░░░  41 entries (32%)           │ │
│  │  Low (<0.5):    ████░░░░░░░░░░░░░░░  18 entries (14%)           │ │
│  │                                                                  │ │
│  │  Knowledge Sources:                                              │ │
│  │  Self-learned: 89 │ Taught by user: 23 │ Inherited: 15          │ │
│  │                                                                  │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─ Knowledge Timeline ────────────────────────────────────────────┐ │
│  │  ▊ ▊▊▊▊ ▊▊▊▊▊▊▊▊ ▊▊▊▊▊▊▊ ▊▊▊▊▊▊▊▊▊▊▊▊▊ ▊▊▊▊▊            │ │
│  │  Jan     Feb        Mar (entries added over time)               │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  Actions: [Teach Agent] [Prune Low-Confidence] [Export] [Transfer]  │
│                                                                      │
│  Teach Agent: Send a correction or new knowledge directly            │
│  Transfer: Copy selected entries to another agent                    │
│  Prune: Remove entries below confidence threshold                    │
└──────────────────────────────────────────────────────────────────────┘
```

**Per-agent knowledge tracking requires a schema extension:**

```typescript
// Extend knowledge metadata to track authoring agent
interface KnowledgeMetadata {
  source: {
    agentId?: string;        // Which agent learned/wrote this
    teamId?: string;         // Which team context
    sessionId?: string;      // Which session
    mechanism: 'self_learned' | 'taught' | 'inherited' | 'corrected';
  };
  confidence: number;        // 0.0-1.0
  accessCount: number;       // How often this entry was retrieved
  lastAccessedAt?: string;   // For staleness detection
  tags: string[];            // Derived specialization tags
}
```

This uses the existing `metadata` JSON column on the `knowledge` table — no schema migration needed, just structured JSON conventions.

### 5. Team Health Dashboard (`/team/health`)

Operational overview across all teams and projects:

```
┌──────────────────────────────────────────────────────────────────────┐
│  💊 Team Health                                                      │
│                                                                      │
│  ┌─ Agent Status ──────────────────────────────────────────────────┐ │
│  │  ● Active: 8    ○ Idle: 3    ⚠ Stale: 1    ◼ Retired: 2      │ │
│  │                                                                  │ │
│  │  ●●●●●●●● ○○○ ⚠ ◼◼                                            │ │
│  │  (status heatmap — one dot per agent)                            │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─ Resource Usage ────────────────────────────────────────────────┐ │
│  │  Total Tokens Today:  1.2M input │ 340K output                  │ │
│  │  API Costs Est.:      $14.20 (based on model pricing)           │ │
│  │  Avg Context Fill:    68% (across active agents)                │ │
│  │                                                                  │ │
│  │  Per-Agent Burn Rate:                                            │ │
│  │  Dev-Bravo:  ████████████░░░░  78% context │ ~45min to exhaust │ │
│  │  Arch-Alpha: ████████░░░░░░░░  52% context │ ~2h to exhaust   │ │
│  │  Dev-Echo:   ██░░░░░░░░░░░░░░  12% context │ idle              │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─ Uptime & Sessions ─────────────────────────────────────────────┐ │
│  │  Agent Server: ● Running (uptime: 14h 23m)                      │ │
│  │  Orchestration: ● Connected (restarts today: 3, zero-downtime)  │ │
│  │  Active Sessions: 2 (acme-app, billing-svc)                     │ │
│  │                                                                  │ │
│  │  Session History (today):                                        │ │
│  │  ──●──●──●─────────●──●──────●── (session start/end timeline)   │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─ Alerts ────────────────────────────────────────────────────────┐ │
│  │  ⚠ Dev-Delta stale for 6h — [Resume] [Retire]                  │ │
│  │  ⚠ Arch-Alpha context at 78% — consider session rotation       │ │
│  │  ✅ No mass failures in last 24h                                │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

**Data sources:**
- Agent status → `agentRoster` (agent server writes, orchestration reads)
- Token usage → `AgentInfo.inputTokens/outputTokens` from WebSocket events
- Context burn rate → `AgentInfo.contextBurnRate` / `estimatedExhaustionMinutes` (already in AgentInfo)
- Uptime → Agent server health monitor (already designed in Error Handling section)
- Alerts → derived from roster status + context thresholds + mass failure detector

### 6. Cross-Project View (`/team/projects`)

What the team is working on across all projects — a portfolio view:

```
┌──────────────────────────────────────────────────────────────────────┐
│  🌐 Cross-Project Overview                                          │
│                                                                      │
│  ┌─ acme-app ──────────────────────────────────────────────────────┐ │
│  │  Team: alice-lead │ 4 agents │ 12 tasks (8 done, 3 active, 1p) │ │
│  │  Active: Arch-Alpha (designing), Dev-Bravo (implementing)       │ │
│  │  Knowledge: 312 entries │ Last activity: 10m ago                 │ │
│  │  Progress: ████████████████░░░░░░ 72%                           │ │
│  ├──────────────────────────────────────────────────────────────────┤ │
│  │  Team: bob-lead │ 3 agents │ 8 tasks (5 done, 2 active, 1p)    │ │
│  │  Active: Dev-India (testing), Dev-Juliet (fixing)               │ │
│  │  Knowledge: shared with alice-lead (312 entries)                 │ │
│  │  Progress: ████████████░░░░░░░░░░ 58%                           │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─ billing-svc ───────────────────────────────────────────────────┐ │
│  │  Team: alice-lead │ 2 agents │ 5 tasks (3 done, 2 active)      │ │
│  │  Active: Dev-Foxtrot (implementing invoice API)                  │ │
│  │  Knowledge: 89 entries │ Last activity: 2h ago                   │ │
│  │  Progress: ████████████████████░░ 90%                           │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─ Agent Allocation ──────────────────────────────────────────────┐ │
│  │  Arch-Alpha:   acme-app ██████████░░░░░░░░░░ (active)          │ │
│  │  Dev-Bravo:    acme-app ████████████████░░░░ (active)           │ │
│  │  Dev-Foxtrot:  billing  ██████████████████░░ (active)           │ │
│  │  QA-Charlie:   acme-app ░░░░░░░░░░░░░░░░░░░░ (idle)            │ │
│  │  Dev-Delta:    —        ⚠ stale                                 │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### 7. Agent Lifecycle Management

Agents have a full lifecycle beyond spawn/terminate:

```
                    ┌──────────┐
         Create ──→ │  Active  │ ←── Resume
                    └────┬─────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         ┌────────┐ ┌────────┐ ┌────────┐
         │  Idle  │ │ Stale  │ │ Failed │
         └───┬────┘ └───┬────┘ └───┬────┘
             │          │          │
             ▼          ▼          ▼
         ┌────────────────────────────┐
         │         Retired            │
         └────────────┬───────────────┘
                      │
                      ▼
         ┌────────────────────────────┐
         │         Archived           │  (data preserved, agent removed)
         └────────────────────────────┘
```

**Lifecycle operations:**

| Operation | From State | To State | Effect |
|-----------|-----------|----------|--------|
| **Create** | — | Active | New agent with optional knowledge seed |
| **Idle** | Active | Idle | Agent process alive but no active task |
| **Stale** | Active/Idle | Stale | Process died, state preserved in DB |
| **Resume** | Stale/Idle | Active | Restart with SDK session resume + knowledge reload |
| **Retire** | Any except Archived | Retired | Graceful shutdown, final state persisted, removed from active roster |
| **Archive** | Retired | Archived | Move agent data to archive tables, free roster slot |
| **Clone** | Any active/idle | New Active | Fork agent with copied knowledge, new identity |
| **Reassign** | Active/Idle | Active/Idle | Change project/team, agent keeps knowledge |
| **Retrain** | Active/Idle | Active | Inject new knowledge entries, reset low-confidence items |

**Retire vs. Terminate:**
- **Terminate** (existing) = kill the process, forget it existed. Current behavior.
- **Retire** (new) = graceful shutdown, preserve all knowledge and history in the roster as "retired." The agent's knowledge persists and can be inherited by new agents or consulted for reference. Retirement is reversible — a retired agent can be resumed.

**Archive** removes the agent from the active roster entirely but preserves data in archive tables for auditing and knowledge mining.

### Data Model Extensions

The persistent agent model requires extending `AgentInfo` and the roster schema:

```typescript
// Extended AgentInfo for persistent identity
interface PersistentAgentInfo extends AgentInfo {
  // Identity (persistent across sessions)
  name: string;                     // Human-readable name (e.g., "Arch-Alpha")
  specialization: string[];         // Learned domain tags
  firstActiveAt: string;            // When this agent was first created
  totalSessions: number;            // Lifetime session count
  totalTasks: number;               // Lifetime tasks completed

  // Knowledge summary
  knowledgeCount: number;           // Total knowledge entries
  highConfidenceCount: number;      // Entries with confidence > 0.85
  lastLearnedAt?: string;           // When knowledge was last updated

  // Performance
  taskSuccessRate: number;          // Lifetime success rate (0-1)
  avgTaskDuration?: number;         // Average task completion time (ms)
  feedbackScore?: number;           // Aggregate user feedback

  // Lifecycle
  lifecycleStatus: 'active' | 'idle' | 'stale' | 'retired' | 'archived';
  retiredAt?: string;
  retiredReason?: string;

  // Lineage
  clonedFromId?: string;            // If cloned, the source agent
  cloneIds: string[];               // Agents cloned from this one
}
```

```sql
-- Schema extensions for agent_roster
ALTER TABLE agent_roster ADD COLUMN name TEXT;
ALTER TABLE agent_roster ADD COLUMN specialization TEXT DEFAULT '[]';  -- JSON array
ALTER TABLE agent_roster ADD COLUMN first_active_at TEXT;
ALTER TABLE agent_roster ADD COLUMN total_sessions INTEGER DEFAULT 0;
ALTER TABLE agent_roster ADD COLUMN total_tasks INTEGER DEFAULT 0;
ALTER TABLE agent_roster ADD COLUMN task_success_rate REAL DEFAULT 0;
ALTER TABLE agent_roster ADD COLUMN feedback_score REAL;
ALTER TABLE agent_roster ADD COLUMN lifecycle_status TEXT DEFAULT 'active';
ALTER TABLE agent_roster ADD COLUMN retired_at TEXT;
ALTER TABLE agent_roster ADD COLUMN retired_reason TEXT;
ALTER TABLE agent_roster ADD COLUMN cloned_from_id TEXT;
```

### WebSocket Events for Team Management

New event types to support real-time team UI updates:

```typescript
type TeamWebSocketEvent =
  | { type: 'team:agent_created'; agent: PersistentAgentInfo }
  | { type: 'team:agent_updated'; agentId: string; changes: Partial<PersistentAgentInfo> }
  | { type: 'team:agent_retired'; agentId: string; reason: string }
  | { type: 'team:agent_resumed'; agentId: string }
  | { type: 'team:agent_reassigned'; agentId: string; from: TeamContext; to: TeamContext }
  | { type: 'team:agent_cloned'; sourceId: string; cloneId: string; clone: PersistentAgentInfo }
  | { type: 'team:knowledge_changed'; agentId: string; delta: number; total: number }
  | { type: 'team:health_alert'; alert: HealthAlert };

interface HealthAlert {
  severity: 'info' | 'warning' | 'critical';
  agentId?: string;
  message: string;
  action?: { label: string; type: 'resume' | 'retire' | 'reassign' | 'rotate' };
}
```

### Integration with Existing Panels

| Existing Panel | Integration |
|---------------|-------------|
| **Agents** (`/agents`) | Remains the live operational view. Add a "View Profile" link per agent that navigates to `/team/:agentId`. Show `name` alongside `agentId` in the agent card. |
| **Daemon** (`/daemon`) → renamed **Agent Server** | Shows infrastructure status (agent server health, transport, connection). The team view shows the human layer; this shows the machine layer. Add agent count per (projectId, teamId) to the daemon agent list. |
| **Knowledge** (`/knowledge`) | Add an "Agent" filter dropdown. When an agent is selected, show only knowledge entries authored by or relevant to that agent. Link "View all" to the agent profile's Knowledge tab. |
| **Projects** (`/projects`) | Add "Team" column to the project card showing which teams are working on each project. Link team names to the team roster filtered by that project. |
| **Overview** (`/overview`) | Add a "Team Summary" card: active agents, total knowledge, stale agent alerts. Replace the anonymous agent heatmap with named agent tiles. |
| **Tasks** (`/tasks`) | Show the assigned agent's `name` (not just agentId) in task rows. Link to agent profile. |
| **Analytics** (`/analytics`) | Add per-agent analytics: token usage over time, task completion rates, knowledge growth curves. |
| **ChatPanel** (sidebar) | Show the agent's `name` and `specialization` in the header. Add "View Profile" button. Show knowledge count badge. |

### Zustand Store Extension

```typescript
// New store slice for persistent team state
interface TeamStoreSlice {
  // Roster
  roster: Map<string, PersistentAgentInfo>;
  rosterLoading: boolean;
  rosterFilter: {
    projectId?: string;
    teamId?: string;
    status?: string;
    role?: string;
  };

  // Actions
  fetchRoster: () => Promise<void>;
  updateAgentProfile: (agentId: string, changes: Partial<PersistentAgentInfo>) => void;
  retireAgent: (agentId: string, reason: string) => Promise<void>;
  resumeAgent: (agentId: string) => Promise<void>;
  reassignAgent: (agentId: string, to: TeamContext) => Promise<void>;
  cloneAgent: (agentId: string, name: string) => Promise<string>;  // returns new agentId
  createAgent: (config: CreateAgentConfig) => Promise<string>;

  // Computed
  activeCount: () => number;
  staleCount: () => number;
  totalKnowledge: () => number;
  agentsByProject: () => Map<string, PersistentAgentInfo[]>;
}
```

### API Endpoints

New REST endpoints for team management (alongside existing WebSocket for real-time):

```
GET    /api/team/roster                    # List all persistent agents
GET    /api/team/roster/:agentId           # Get agent profile
PATCH  /api/team/roster/:agentId           # Update agent (name, specialization)
POST   /api/team/roster                    # Create new persistent agent
POST   /api/team/roster/:agentId/retire    # Retire agent
POST   /api/team/roster/:agentId/resume    # Resume agent
POST   /api/team/roster/:agentId/reassign  # Reassign to project/team
POST   /api/team/roster/:agentId/clone     # Clone agent
POST   /api/team/roster/:agentId/retrain   # Inject knowledge
DELETE /api/team/roster/:agentId           # Archive agent

GET    /api/team/roster/:agentId/knowledge # Agent's knowledge entries
GET    /api/team/roster/:agentId/history   # Session history
GET    /api/team/roster/:agentId/skills    # Derived skills
GET    /api/team/roster/:agentId/contributions  # File/commit contributions

GET    /api/team/health                    # Team health summary
GET    /api/team/projects                  # Cross-project overview
```

These endpoints are served by the orchestration server, which reads from the shared DB (agent server writes roster, orchestration server reads it) and forwards commands to the agent server for lifecycle operations (resume, reassign require agent server coordination).

## Open Questions

1. **TCP vs UDS for reconnection?** TCP localhost is simpler and cross-platform. UDS is marginally more secure (file permissions on the socket itself). Recommendation: TCP with token auth — simplicity wins, and the token provides equivalent security to UDS file permissions.

2. **~~Should the agent server have its own SQLite connection?~~** **RESOLVED:** Yes — the agent server opens its own connection to the shared SQLite database (WAL mode). It owns writes to agent-scoped tables (agentRoster, activeDelegations, conversations/messages for agents). The orchestration server owns writes to coordination tables (taskDag, knowledge, messageQueue, etc.). Both read each other's tables. See "Shared Database with Ownership Boundaries" section.

3. **In-process Claude SDK agents?** ClaudeSdkAdapter runs in-process (no subprocess). These agents die with the orchestration server, not the agent server. Should they move to the agent server? Probably yes — but that requires the agent server to have the Claude SDK dependency and API key. For now, in-process agents use SDK resume as their survival mechanism.

4. **How does the agent server get config updates?** When the user changes `flightdeck.config.yaml`, the orchestration server's ConfigStore detects it. It should forward relevant config (provider presets, model overrides, mass failure thresholds) to the agent server via a `configure` message. The agent server doesn't watch config files itself.

5. **Agent naming: auto-generated vs user-assigned?** Persistent agents need human-readable names (e.g., "Arch-Alpha"). Should names be auto-generated (role + NATO alphabet suffix), user-assigned at creation, or auto-generated with user-rename? Recommendation: auto-generated with rename — lowers friction for casual use while supporting personalization for long-lived agents.

6. **Knowledge attribution granularity?** The `metadata.source.agentId` field on knowledge entries enables per-agent knowledge views. But existing entries (created before agent tracking) won't have this field. Backfill strategy: tag existing entries as `mechanism: 'legacy'` with no agent attribution, or attempt to infer from `activityLog`.
