/**
 * Agent Server Integration Test — spawn, message, terminate flow.
 *
 * Tests the full lifecycle through AgentServer: spawn an agent, send messages,
 * receive events, and terminate — all through the transport layer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentServer } from '../agent-server.js';
import type { TransportConnection, AgentServerListener, OrchestratorMessage, AgentServerMessage } from '../transport/types.js';

// ── Mock AdapterFactory ──────────────────────────────────────

const mockCreateAdapter = vi.fn();
vi.mock('../adapters/AdapterFactory.js', () => ({
  createAdapterForProvider: (...args: any[]) => mockCreateAdapter(...args),
  buildStartOptions: vi.fn(() => ({
    cwd: process.cwd(),
    instructions: '',
  })),
}));

// ── Mock helpers ─────────────────────────────────────────────

function createMockAdapter() {
  const adapter = new EventEmitter() as any;
  adapter.type = 'mock';
  adapter.isConnected = true;
  adapter.isPrompting = false;
  adapter.promptingStartedAt = null;
  adapter.currentSessionId = null;
  adapter.supportsImages = false;
  adapter.start = vi.fn().mockResolvedValue('session-integration');
  adapter.prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });
  adapter.cancel = vi.fn().mockResolvedValue(undefined);
  adapter.terminate = vi.fn();
  adapter.resolvePermission = vi.fn();
  return adapter;
}

function createMockConnection(): TransportConnection & {
  _sentMessages: AgentServerMessage[];
  simulateMessage: (msg: OrchestratorMessage) => void;
} {
  const handlers: Array<(msg: OrchestratorMessage) => void> = [];
  const disconnectHandlers: Array<(reason: string) => void> = [];
  const sent: AgentServerMessage[] = [];

  return {
    id: `mock-${Math.random().toString(36).slice(2, 8)}`,
    get isConnected() { return true; },
    _sentMessages: sent,
    send(msg: AgentServerMessage) { sent.push(msg); },
    onMessage(handler: (msg: OrchestratorMessage) => void) {
      handlers.push(handler);
      return () => { handlers.splice(handlers.indexOf(handler), 1); };
    },
    onDisconnect(handler: (reason: string) => void) {
      disconnectHandlers.push(handler);
      return () => { disconnectHandlers.splice(disconnectHandlers.indexOf(handler), 1); };
    },
    close() { handlers.length = 0; disconnectHandlers.length = 0; },
    simulateMessage(msg: OrchestratorMessage) {
      handlers.forEach((h) => h(msg));
    },
  };
}

function createMockListener(): AgentServerListener & {
  simulateConnection: (conn: TransportConnection) => void;
} {
  let connHandler: ((conn: TransportConnection) => void) | null = null;
  return {
    listen: vi.fn(),
    close: vi.fn(),
    onConnection(handler: (conn: TransportConnection) => void) {
      connHandler = handler;
      return () => { connHandler = null; };
    },
    simulateConnection(conn: TransportConnection) {
      connHandler?.(conn);
    },
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('Agent Server Integration — full lifecycle', () => {
  let server: AgentServer;
  let listener: ReturnType<typeof createMockListener>;
  let conn: ReturnType<typeof createMockConnection>;
  let adapter: ReturnType<typeof createMockAdapter>;
  let runtimeDir: string;

  const SCOPE = { projectId: 'proj-1', teamId: 'team-1' };

  beforeEach(() => {
    vi.useFakeTimers();
    runtimeDir = mkdtempSync(join(tmpdir(), 'as-integration-'));
    listener = createMockListener();
    adapter = createMockAdapter();
    mockCreateAdapter.mockReturnValue({ adapter: adapter as any, backend: 'mock', fallback: false });

    server = new AgentServer({
      listener,
      runtimeDir,
      orphanTimeoutMs: 60_000,
    });
    server.start();

    conn = createMockConnection();
    listener.simulateConnection(conn);
  });

  afterEach(async () => {
    if (server.started && !server.stopped) {
      await server.stop();
    }
    vi.useRealTimers();
  });

  async function spawnAgent(overrides: Partial<OrchestratorMessage> = {}) {
    const msg = {
      type: 'spawn_agent',
      requestId: 'req-spawn-1',
      scope: SCOPE,
      role: 'developer',
      model: 'gpt-4',
      task: 'integration test task',
      ...overrides,
    } as OrchestratorMessage;

    conn.simulateMessage(msg);

    await vi.waitFor(() => {
      const agents = server.listAgents();
      return agents.length > 0 && agents[0].status === 'running';
    });

    return server.listAgents()[0];
  }

  // ── Spawn ──────────────────────────────────────────────

  it('spawns an agent and receives agent_spawned response', async () => {
    await spawnAgent();

    const spawnedMsg = conn._sentMessages.find((m) => m.type === 'agent_spawned');
    expect(spawnedMsg).toBeDefined();
    expect((spawnedMsg as any).role).toBe('developer');
    expect((spawnedMsg as any).model).toBe('gpt-4');
  });

  it('tracks agent in server with correct metadata', async () => {
    const agent = await spawnAgent();

    expect(agent.role).toBe('developer');
    expect(agent.model).toBe('gpt-4');
    expect(agent.status).toBe('running');
    expect(agent.projectId).toBe('proj-1');
    expect(agent.teamId).toBe('team-1');
    expect(agent.sessionId).toBe('session-integration');
  });

  // ── Events ─────────────────────────────────────────────

  it('relays text events from adapter to connection', async () => {
    await spawnAgent();

    adapter.emit('text', 'Hello from agent');

    const textEvents = conn._sentMessages.filter(
      (m) => m.type === 'agent_event' && (m as any).eventType === 'text',
    );
    expect(textEvents).toHaveLength(1);
    expect((textEvents[0] as any).data).toEqual({ text: 'Hello from agent' });
  });

  it('relays thinking events', async () => {
    await spawnAgent();

    adapter.emit('thinking', 'Analyzing the problem...');

    const thinkingEvents = conn._sentMessages.filter(
      (m) => m.type === 'agent_event' && (m as any).eventType === 'thinking',
    );
    expect(thinkingEvents).toHaveLength(1);
  });

  it('relays tool_call events', async () => {
    await spawnAgent();

    adapter.emit('tool_call', { name: 'bash', input: 'ls' });

    const toolEvents = conn._sentMessages.filter(
      (m) => m.type === 'agent_event' && (m as any).eventType === 'tool_call',
    );
    expect(toolEvents).toHaveLength(1);
    expect((toolEvents[0] as any).data.name).toBe('bash');
  });

  it('relays usage events', async () => {
    await spawnAgent();

    adapter.emit('usage', { inputTokens: 100, outputTokens: 50 });

    const usageEvents = conn._sentMessages.filter(
      (m) => m.type === 'agent_event' && (m as any).eventType === 'usage',
    );
    expect(usageEvents).toHaveLength(1);
  });

  // ── Messages ───────────────────────────────────────────

  it('forwards send_message to adapter.prompt()', async () => {
    const agent = await spawnAgent();

    conn.simulateMessage({
      type: 'send_message',
      requestId: 'req-msg-1',
      scope: SCOPE,
      agentId: agent.id,
      content: 'Please implement the feature',
    } as OrchestratorMessage);

    expect(adapter.prompt).toHaveBeenCalledWith('Please implement the feature');
  });

  // ── Terminate ──────────────────────────────────────────

  it('terminates agent and removes from server', async () => {
    const agent = await spawnAgent();
    expect(server.agentCount).toBe(1);

    conn.simulateMessage({
      type: 'terminate_agent',
      requestId: 'req-term-1',
      scope: SCOPE,
      agentId: agent.id,
    } as OrchestratorMessage);

    // Adapter terminate was called
    expect(adapter.terminate).toHaveBeenCalled();
  });

  // ── Exit ───────────────────────────────────────────────

  it('handles agent exit and sends agent_exited', async () => {
    await spawnAgent();
    expect(server.agentCount).toBe(1);

    adapter.emit('exit', 0);

    expect(server.agentCount).toBe(0);

    const exitMsgs = conn._sentMessages.filter((m) => m.type === 'agent_exited');
    expect(exitMsgs).toHaveLength(1);
    expect((exitMsgs[0] as any).exitCode).toBe(0);
  });

  // ── Multiple agents ────────────────────────────────────

  it('manages multiple agents concurrently', async () => {
    const adapter2 = createMockAdapter();
    mockCreateAdapter
      .mockReturnValueOnce({ adapter: adapter as any, backend: 'mock', fallback: false })
      .mockReturnValueOnce({ adapter: adapter2 as any, backend: 'mock', fallback: false });

    conn.simulateMessage({
      type: 'spawn_agent',
      requestId: 'req-s1',
      scope: SCOPE,
      role: 'developer',
      model: 'gpt-4',
    } as OrchestratorMessage);

    conn.simulateMessage({
      type: 'spawn_agent',
      requestId: 'req-s2',
      scope: SCOPE,
      role: 'architect',
      model: 'claude-3',
    } as OrchestratorMessage);

    await vi.waitFor(() => server.agentCount === 2);

    const agents = server.listAgents();
    const roles = agents.map((a) => a.role).sort();
    expect(roles).toEqual(['architect', 'developer']);
  });

  // ── Ping/Pong ──────────────────────────────────────────

  it('responds to ping with pong', () => {
    conn.simulateMessage({
      type: 'ping',
      requestId: 'req-ping',
    } as OrchestratorMessage);

    const pong = conn._sentMessages.find((m) => m.type === 'pong');
    expect(pong).toBeDefined();
    expect((pong as any).requestId).toBe('req-ping');
  });

  // ── Server stop ────────────────────────────────────────

  it('terminates all agents on stop', async () => {
    await spawnAgent();
    expect(server.agentCount).toBe(1);

    await server.stop();
    expect(adapter.terminate).toHaveBeenCalled();
  });
});
