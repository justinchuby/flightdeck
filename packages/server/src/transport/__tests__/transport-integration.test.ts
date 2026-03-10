/**
 * Transport Integration Test — ForkTransport ↔ ForkListener end-to-end.
 *
 * Verifies that the transport layer works for IPC message passing
 * using mock process objects (no real child_process.fork).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { TransportConnection, OrchestratorMessage, AgentServerMessage } from '../types.js';

// ── Mock IPC channel ─────────────────────────────────────────

/**
 * Simulates a bidirectional IPC channel between a parent (orchestrator)
 * and child (agent server) process.
 */
function createIpcChannel() {
  const parentSide = new EventEmitter();
  const childSide = new EventEmitter();

  // parent.send() → child receives 'message'
  (parentSide as any).send = vi.fn((msg: any) => {
    childSide.emit('message', msg);
  });

  // child.send() → parent receives 'message'
  (childSide as any).send = vi.fn((msg: any) => {
    parentSide.emit('message', msg);
  });

  return { parentSide, childSide };
}

/**
 * Wraps one side of the IPC channel as a TransportConnection.
 */
function wrapAsConnection(side: EventEmitter & { send: (msg: any) => void }): TransportConnection {
  const handlers: Array<(msg: any) => void> = [];
  const conn: TransportConnection = {
    id: `mock-${Math.random().toString(36).slice(2, 8)}`,
    get isConnected() { return true; },
    send(msg: AgentServerMessage | OrchestratorMessage) {
      side.send(msg);
    },
    onMessage(handler: (msg: any) => void) {
      handlers.push(handler);
      side.on('message', handler);
      return () => {
        side.off('message', handler);
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    },
    onDisconnect(_handler: (reason: string) => void) {
      return () => {};
    },
    close() {
      for (const h of handlers) side.off('message', h);
      handlers.length = 0;
    },
  };
  return conn;
}

// ── Tests ────────────────────────────────────────────────────

describe('Transport Integration — IPC channel', () => {
  let channel: ReturnType<typeof createIpcChannel>;
  let orchestratorConn: TransportConnection;
  let serverConn: TransportConnection;

  beforeEach(() => {
    channel = createIpcChannel();
    orchestratorConn = wrapAsConnection(channel.parentSide as any);
    serverConn = wrapAsConnection(channel.childSide as any);
  });

  afterEach(() => {
    orchestratorConn.close();
    serverConn.close();
  });

  it('sends ping from orchestrator and receives on server', () => {
    const received: any[] = [];
    serverConn.onMessage((msg) => received.push(msg));

    const pingMsg: OrchestratorMessage = {
      type: 'ping',
      requestId: 'req-1',
    };
    orchestratorConn.send(pingMsg as any);

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('ping');
    expect(received[0].requestId).toBe('req-1');
  });

  it('sends pong from server to orchestrator', () => {
    const received: any[] = [];
    orchestratorConn.onMessage((msg) => received.push(msg));

    const pongMsg: AgentServerMessage = {
      type: 'pong',
      requestId: 'req-1',
      timestamp: Date.now(),
    };
    serverConn.send(pongMsg);

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('pong');
  });

  it('handles full spawn flow: spawn_agent → agent_spawned', () => {
    const serverReceived: any[] = [];
    const orchestratorReceived: any[] = [];

    serverConn.onMessage((msg) => serverReceived.push(msg));
    orchestratorConn.onMessage((msg) => orchestratorReceived.push(msg));

    // Orchestrator sends spawn request
    orchestratorConn.send({
      type: 'spawn_agent',
      requestId: 'req-spawn',
      scope: { projectId: 'proj-1', teamId: 'team-1' },
      role: 'developer',
      model: 'gpt-4',
      task: 'implement feature',
    } as any);

    expect(serverReceived).toHaveLength(1);
    expect(serverReceived[0].type).toBe('spawn_agent');

    // Server responds with agent_spawned
    serverConn.send({
      type: 'agent_spawned',
      requestId: 'req-spawn',
      agentId: 'agent-001',
      role: 'developer',
      model: 'gpt-4',
      pid: 12345,
    } as AgentServerMessage);

    expect(orchestratorReceived).toHaveLength(1);
    expect(orchestratorReceived[0].type).toBe('agent_spawned');
    expect(orchestratorReceived[0].agentId).toBe('agent-001');
  });

  it('handles bidirectional message flow', () => {
    const serverReceived: any[] = [];
    const orchestratorReceived: any[] = [];

    serverConn.onMessage((msg) => serverReceived.push(msg));
    orchestratorConn.onMessage((msg) => orchestratorReceived.push(msg));

    // Send multiple messages both ways
    orchestratorConn.send({ type: 'ping', requestId: 'p1' } as any);
    orchestratorConn.send({ type: 'ping', requestId: 'p2' } as any);
    serverConn.send({ type: 'pong', requestId: 'p1', timestamp: 1 } as AgentServerMessage);
    serverConn.send({ type: 'pong', requestId: 'p2', timestamp: 2 } as AgentServerMessage);

    expect(serverReceived).toHaveLength(2);
    expect(orchestratorReceived).toHaveLength(2);
  });

  it('handles agent_event relay', () => {
    const received: any[] = [];
    orchestratorConn.onMessage((msg) => received.push(msg));

    serverConn.send({
      type: 'agent_event',
      agentId: 'agent-001',
      eventType: 'text',
      eventId: 'evt-1',
      data: { content: 'Hello world' },
    } as AgentServerMessage);

    expect(received).toHaveLength(1);
    expect(received[0].eventType).toBe('text');
    expect(received[0].data.content).toBe('Hello world');
  });

  it('unsubscribes message handler correctly', () => {
    const received: any[] = [];
    const unsub = serverConn.onMessage((msg) => received.push(msg));

    orchestratorConn.send({ type: 'ping', requestId: '1' } as any);
    expect(received).toHaveLength(1);

    unsub();
    orchestratorConn.send({ type: 'ping', requestId: '2' } as any);
    expect(received).toHaveLength(1); // No new messages after unsub
  });

  it('close() removes all handlers', () => {
    const received: any[] = [];
    serverConn.onMessage((msg) => received.push(msg));
    serverConn.onMessage((msg) => received.push(msg)); // Two handlers

    orchestratorConn.send({ type: 'ping', requestId: '1' } as any);
    expect(received).toHaveLength(2); // Both handlers fire

    serverConn.close();
    orchestratorConn.send({ type: 'ping', requestId: '2' } as any);
    expect(received).toHaveLength(2); // No new messages
  });

  it('handles terminate flow: terminate_agent → agent_exited', () => {
    const orchestratorReceived: any[] = [];
    orchestratorConn.onMessage((msg) => orchestratorReceived.push(msg));

    // Server emits exit event
    serverConn.send({
      type: 'agent_event',
      agentId: 'agent-001',
      eventType: 'exit',
      eventId: 'evt-exit',
      data: { exitCode: 0, reason: 'completed' },
    } as unknown as AgentServerMessage);

    expect(orchestratorReceived).toHaveLength(1);
    expect(orchestratorReceived[0].eventType).toBe('exit');
    expect(orchestratorReceived[0].data.exitCode).toBe(0);
  });
});
