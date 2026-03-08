/**
 * ForkListener — comprehensive tests for the agent-server-side listener.
 *
 * Tests cover: IPC connection mode, TCP connection mode, TransportConnection
 * interface, message validation, disconnect handling, port file management,
 * multiple connections, and cleanup.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createConnection, type Socket } from 'node:net';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { ForkListener, type ForkProcess } from '../ForkListener.js';
import type {
  TransportConnection,
  OrchestratorMessage,
  AgentServerMessage,
  SpawnAgentMessage,
  MessageScope,
} from '../types.js';

// ── Helpers ─────────────────────────────────────────────────────────

const scope: MessageScope = { projectId: 'test-proj', teamId: 'team-1' };

function spawnMsg(requestId = 'req-1'): SpawnAgentMessage {
  return {
    type: 'spawn_agent',
    requestId,
    scope,
    role: 'developer',
    model: 'fast',
  };
}

function pongMsg(requestId = 'req-1'): AgentServerMessage {
  return { type: 'pong', requestId, timestamp: Date.now() };
}

/** Create a mock process with IPC support. */
function createMockProcess(): MockProcess {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  return {
    send: vi.fn(() => true),
    connected: true,
    on(event: string, listener: (...args: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    off(event: string, listener: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(listener);
    },
    _listeners: listeners,
    _emit(event: string, ...args: unknown[]) {
      listeners.get(event)?.forEach(h => h(...args));
    },
  };
}

type MockProcess = ForkProcess & {
  send: ReturnType<typeof vi.fn>;
  _listeners: Map<string, Set<(...args: unknown[]) => void>>;
  _emit: (event: string, ...args: unknown[]) => void;
};

/** Create a temporary directory for port files. */
function createTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'fork-listener-test-'));
}

/** Connect to a TCP port and return the socket. */
function tcpConnect(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ port, host: '127.0.0.1' }, () => {
      resolve(socket);
    });
    socket.on('error', reject);
  });
}

/** Send an NDJSON message over a TCP socket. */
function tcpSend(socket: Socket, msg: object): void {
  socket.write(JSON.stringify(msg) + '\n');
}

/** Read one NDJSON message from a TCP socket. */
function tcpRead(socket: Socket): Promise<object> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (data: Buffer) => {
      buffer += data.toString();
      const idx = buffer.indexOf('\n');
      if (idx >= 0) {
        socket.off('data', onData);
        resolve(JSON.parse(buffer.slice(0, idx)));
      }
    };
    socket.on('data', onData);
    socket.on('error', reject);
    setTimeout(() => reject(new Error('TCP read timeout')), 2000);
  });
}

/** Read the auth token from the token file in the temp dir. */
function readToken(dir: string, tokenFileName = 'agent-server.token'): string {
  return readFileSync(join(dir, tokenFileName), 'utf-8').trim();
}

/** Authenticate a TCP socket: send AuthenticateMessage, wait for auth_result. */
async function tcpAuth(socket: Socket, token: string): Promise<void> {
  const authMsg = { type: 'authenticate', requestId: 'auth-test', token };
  tcpSend(socket, authMsg);
  const reply = await tcpRead(socket) as Record<string, unknown>;
  if (reply.type !== 'auth_result' || reply.success !== true) {
    throw new Error(`Auth failed: ${JSON.stringify(reply)}`);
  }
}

// ── Tests ───────────────────────────────────────────────────────────

describe('ForkListener', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  // ── Construction ──────────────────────────────────────────────

  describe('construction', () => {
    it('creates with default options', () => {
      const proc = createMockProcess();
      const listener = new ForkListener({ process: proc });
      expect(listener.isListening).toBe(false);
      expect(listener.port).toBeNull();
      expect(listener.connectionCount).toBe(0);
      listener.close();
    });

    it('accepts custom options', () => {
      const proc = createMockProcess();
      const listener = new ForkListener({
        process: proc,
        portFileDir: tmpDir,
        portFileName: 'custom.port',
        tcpHost: '127.0.0.1',
        tcpPort: 0,
      });
      expect(listener.isListening).toBe(false);
      listener.close();
    });
  });

  // ── IPC Mode ──────────────────────────────────────────────────

  describe('IPC mode', () => {
    let proc: MockProcess;
    let listener: ForkListener;

    beforeEach(() => {
      proc = createMockProcess();
      listener = new ForkListener({
        process: proc,
        portFileDir: tmpDir,
      });
    });

    afterEach(() => {
      listener.close();
    });

    it('creates an IPC connection on listen()', () => {
      const connections: TransportConnection[] = [];
      listener.onConnection(conn => connections.push(conn));
      listener.listen();

      expect(connections).toHaveLength(1);
      expect(connections[0].id).toMatch(/^ipc-/);
      expect(connections[0].isConnected).toBe(true);
      expect(listener.connectionCount).toBe(1);
    });

    it('forwards validated messages to connection handlers', () => {
      const messages: OrchestratorMessage[] = [];
      listener.onConnection(conn => {
        conn.onMessage(msg => messages.push(msg));
      });
      listener.listen();

      // Simulate parent sending a message
      proc._emit('message', spawnMsg());

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('spawn_agent');
    });

    it('ignores invalid messages', () => {
      const messages: OrchestratorMessage[] = [];
      listener.onConnection(conn => {
        conn.onMessage(msg => messages.push(msg));
      });
      listener.listen();

      proc._emit('message', { invalid: true });
      proc._emit('message', 'not an object');
      proc._emit('message', null);

      expect(messages).toHaveLength(0);
    });

    it('ignores server→orchestrator messages on IPC', () => {
      const messages: OrchestratorMessage[] = [];
      listener.onConnection(conn => {
        conn.onMessage(msg => messages.push(msg));
      });
      listener.listen();

      // AgentServerMessage should be filtered out
      proc._emit('message', { type: 'pong', requestId: 'r1', timestamp: 1 });

      expect(messages).toHaveLength(0);
    });

    it('sends messages back via process.send()', () => {
      let conn: TransportConnection | null = null;
      listener.onConnection(c => { conn = c; });
      listener.listen();

      const msg = pongMsg();
      conn!.send(msg);
      expect(proc.send).toHaveBeenCalledWith(msg);
    });

    it('handles IPC disconnect (parent process exit)', () => {
      let disconnectReason = '';
      listener.onConnection(conn => {
        conn.onDisconnect(reason => { disconnectReason = reason; });
      });
      listener.listen();

      proc._emit('disconnect');

      expect(disconnectReason).toBe('parent process disconnected');
      expect(listener.connectionCount).toBe(0);
    });

    it('does not create IPC connection when process has no send()', () => {
      const noIpcProc: ForkProcess = {
        on: vi.fn(),
        off: vi.fn(),
        // No send — not a forked process
      };

      const l = new ForkListener({
        process: noIpcProc,
        portFileDir: tmpDir,
      });

      const connections: TransportConnection[] = [];
      l.onConnection(conn => connections.push(conn));
      l.listen();

      // No IPC connection — only TCP will be available
      const ipcConns = connections.filter(c => c.id.startsWith('ipc-'));
      expect(ipcConns).toHaveLength(0);

      l.close();
    });

    it('listen() is idempotent', () => {
      const connections: TransportConnection[] = [];
      listener.onConnection(conn => connections.push(conn));

      listener.listen();
      listener.listen(); // second call should be no-op

      const ipcConns = connections.filter(c => c.id.startsWith('ipc-'));
      expect(ipcConns).toHaveLength(1);
    });

    it('unsubscribe from onConnection works', () => {
      const connections: TransportConnection[] = [];
      const unsub = listener.onConnection(conn => connections.push(conn));

      unsub(); // remove handler before listen
      listener.listen();

      expect(connections).toHaveLength(0);
    });

    it('unsubscribe from onMessage works', () => {
      const messages: OrchestratorMessage[] = [];
      listener.onConnection(conn => {
        const unsub = conn.onMessage(msg => messages.push(msg));
        unsub(); // immediately unsubscribe
      });
      listener.listen();

      proc._emit('message', spawnMsg());
      expect(messages).toHaveLength(0);
    });

    it('unsubscribe from onDisconnect works', () => {
      let called = false;
      listener.onConnection(conn => {
        const unsub = conn.onDisconnect(() => { called = true; });
        unsub();
      });
      listener.listen();

      proc._emit('disconnect');
      expect(called).toBe(false);
    });

    it('connection.close() marks it disconnected', () => {
      let conn: TransportConnection | null = null;
      let reason = '';
      listener.onConnection(c => {
        conn = c;
        c.onDisconnect(r => { reason = r; });
      });
      listener.listen();

      conn!.close();
      expect(conn!.isConnected).toBe(false);
      expect(reason).toBe('closed by server');
    });

    it('send after disconnect is a no-op', () => {
      let conn: TransportConnection | null = null;
      listener.onConnection(c => { conn = c; });
      listener.listen();

      conn!.close();
      conn!.send(pongMsg()); // should not throw
      // The send mock call from before close might exist, but no new calls
      const callsAfterClose = proc.send.mock.calls.length;
      conn!.send(pongMsg());
      expect(proc.send.mock.calls.length).toBe(callsAfterClose);
    });
  });

  // ── TCP Mode ──────────────────────────────────────────────────

  describe('TCP mode', () => {
    let listener: ForkListener;

    beforeEach(async () => {
      // No IPC (standalone process)
      const noIpcProc: ForkProcess = {
        on: vi.fn(),
        off: vi.fn(),
      };
      listener = new ForkListener({
        process: noIpcProc,
        portFileDir: tmpDir,
        portFileName: 'test.port',
      });
    });

    afterEach(() => {
      listener.close();
    });

    it('starts TCP server and writes port file', async () => {
      listener.listen();

      // Wait for server to start
      await vi.waitFor(() => {
        expect(listener.port).not.toBeNull();
      }, { timeout: 2000 });

      // Port file should exist
      const portFile = join(tmpDir, 'test.port');
      expect(existsSync(portFile)).toBe(true);
      expect(readFileSync(portFile, 'utf-8')).toBe(String(listener.port));
    });

    it('accepts TCP connections', async () => {
      const connections: TransportConnection[] = [];
      listener.onConnection(conn => connections.push(conn));
      listener.listen();

      await vi.waitFor(() => expect(listener.port).not.toBeNull(), { timeout: 2000 });

      const socket = await tcpConnect(listener.port!);
      try {
        const token = readToken(tmpDir);
        await tcpAuth(socket, token);

        await vi.waitFor(() => expect(connections).toHaveLength(1), { timeout: 2000 });

        expect(connections[0].id).toMatch(/^tcp-/);
        expect(connections[0].isConnected).toBe(true);
      } finally {
        socket.destroy();
      }
    });

    it('receives NDJSON messages over TCP', async () => {
      const messages: OrchestratorMessage[] = [];
      listener.onConnection(conn => {
        conn.onMessage(msg => messages.push(msg));
      });
      listener.listen();

      await vi.waitFor(() => expect(listener.port).not.toBeNull(), { timeout: 2000 });

      const socket = await tcpConnect(listener.port!);
      try {
        const token = readToken(tmpDir);
        await tcpAuth(socket, token);

        tcpSend(socket, spawnMsg('tcp-req-1'));

        await vi.waitFor(() => expect(messages).toHaveLength(1), { timeout: 2000 });
        expect(messages[0].type).toBe('spawn_agent');
        expect((messages[0] as SpawnAgentMessage).requestId).toBe('tcp-req-1');
      } finally {
        socket.destroy();
      }
    });

    it('sends NDJSON messages back over TCP', async () => {
      let conn: TransportConnection | null = null;
      listener.onConnection(c => { conn = c; });
      listener.listen();

      await vi.waitFor(() => expect(listener.port).not.toBeNull(), { timeout: 2000 });

      const socket = await tcpConnect(listener.port!);
      try {
        const token = readToken(tmpDir);
        await tcpAuth(socket, token);
        await vi.waitFor(() => expect(conn).not.toBeNull(), { timeout: 2000 });

        const msg: AgentServerMessage = { type: 'pong', requestId: 'r1', timestamp: 123 };
        conn!.send(msg);

        const received = await tcpRead(socket);
        expect(received).toEqual(msg);
      } finally {
        socket.destroy();
      }
    });

    it('handles TCP disconnect', async () => {
      let reason = '';
      listener.onConnection(conn => {
        conn.onDisconnect(r => { reason = r; });
      });
      listener.listen();

      await vi.waitFor(() => expect(listener.port).not.toBeNull(), { timeout: 2000 });

      const socket = await tcpConnect(listener.port!);
      const token = readToken(tmpDir);
      await tcpAuth(socket, token);

      await vi.waitFor(() => expect(listener.connectionCount).toBeGreaterThan(0), { timeout: 2000 });

      socket.destroy();

      await vi.waitFor(() => expect(reason).toBe('socket closed'), { timeout: 2000 });
    });

    it('accepts multiple TCP connections', async () => {
      const connections: TransportConnection[] = [];
      listener.onConnection(conn => connections.push(conn));
      listener.listen();

      await vi.waitFor(() => expect(listener.port).not.toBeNull(), { timeout: 2000 });
      const token = readToken(tmpDir);

      const s1 = await tcpConnect(listener.port!);
      const s2 = await tcpConnect(listener.port!);
      try {
        await tcpAuth(s1, token);
        await tcpAuth(s2, token);

        await vi.waitFor(() => expect(connections).toHaveLength(2), { timeout: 2000 });

        expect(connections[0].id).not.toBe(connections[1].id);
        expect(listener.connectionCount).toBe(2);
      } finally {
        s1.destroy();
        s2.destroy();
      }
    });

    it('ignores invalid JSON over TCP', async () => {
      const messages: OrchestratorMessage[] = [];
      listener.onConnection(conn => {
        conn.onMessage(msg => messages.push(msg));
      });
      listener.listen();

      await vi.waitFor(() => expect(listener.port).not.toBeNull(), { timeout: 2000 });

      const socket = await tcpConnect(listener.port!);
      try {
        const token = readToken(tmpDir);
        await tcpAuth(socket, token);

        socket.write('not json\n');
        socket.write('{"also": "invalid"}\n');
        tcpSend(socket, spawnMsg('valid-1'));

        await vi.waitFor(() => expect(messages).toHaveLength(1), { timeout: 2000 });
        expect((messages[0] as SpawnAgentMessage).requestId).toBe('valid-1');
      } finally {
        socket.destroy();
      }
    });

    it('removes port file on close', async () => {
      listener.listen();
      await vi.waitFor(() => expect(listener.port).not.toBeNull(), { timeout: 2000 });

      const portFile = join(tmpDir, 'test.port');
      expect(existsSync(portFile)).toBe(true);

      listener.close();
      expect(existsSync(portFile)).toBe(false);
    });

    it('connection.close() destroys socket', async () => {
      let conn: TransportConnection | null = null;
      listener.onConnection(c => { conn = c; });
      listener.listen();

      await vi.waitFor(() => expect(listener.port).not.toBeNull(), { timeout: 2000 });

      const socket = await tcpConnect(listener.port!);
      try {
        const token = readToken(tmpDir);
        await tcpAuth(socket, token);
        await vi.waitFor(() => expect(conn).not.toBeNull(), { timeout: 2000 });

        conn!.close();
        expect(conn!.isConnected).toBe(false);
      } finally {
        socket.destroy();
      }
    });
  });

  // ── Combined IPC + TCP ────────────────────────────────────────

  describe('combined IPC + TCP', () => {
    let proc: MockProcess;
    let listener: ForkListener;

    beforeEach(() => {
      proc = createMockProcess();
      listener = new ForkListener({
        process: proc,
        portFileDir: tmpDir,
        portFileName: 'combined.port',
      });
    });

    afterEach(() => {
      listener.close();
    });

    it('creates both IPC and TCP connections', async () => {
      const connections: TransportConnection[] = [];
      listener.onConnection(conn => connections.push(conn));
      listener.listen();

      // IPC connection created immediately
      expect(connections.filter(c => c.id.startsWith('ipc-'))).toHaveLength(1);

      // Wait for TCP server
      await vi.waitFor(() => expect(listener.port).not.toBeNull(), { timeout: 2000 });

      // TCP connection (auth required)
      const socket = await tcpConnect(listener.port!);
      try {
        const token = readToken(tmpDir);
        await tcpAuth(socket, token);

        await vi.waitFor(() => expect(connections).toHaveLength(2), { timeout: 2000 });

        expect(connections[1].id).toMatch(/^tcp-/);
        expect(listener.connectionCount).toBe(2);
      } finally {
        socket.destroy();
      }
    });

    it('IPC and TCP connections are independent', async () => {
      const ipcMessages: OrchestratorMessage[] = [];
      const tcpMessages: OrchestratorMessage[] = [];

      let tcpConn: TransportConnection | null = null;
      listener.onConnection(conn => {
        if (conn.id.startsWith('ipc-')) {
          conn.onMessage(msg => ipcMessages.push(msg));
        } else {
          tcpConn = conn;
          conn.onMessage(msg => tcpMessages.push(msg));
        }
      });
      listener.listen();
      await vi.waitFor(() => expect(listener.port).not.toBeNull(), { timeout: 2000 });

      const socket = await tcpConnect(listener.port!);
      try {
        const token = readToken(tmpDir);
        await tcpAuth(socket, token);
        await vi.waitFor(() => expect(tcpConn).not.toBeNull(), { timeout: 2000 });

        // IPC message
        proc._emit('message', spawnMsg('ipc-1'));
        expect(ipcMessages).toHaveLength(1);
        expect(tcpMessages).toHaveLength(0);

        // TCP message
        tcpSend(socket, spawnMsg('tcp-1'));
        await vi.waitFor(() => expect(tcpMessages).toHaveLength(1), { timeout: 2000 });
        expect(ipcMessages).toHaveLength(1); // unchanged
      } finally {
        socket.destroy();
      }
    });
  });

  // ── TCP Auth ───────────────────────────────────────────────────

  describe('TCP auth', () => {
    let listener: ForkListener;

    beforeEach(() => {
      const noIpcProc: ForkProcess = { on: vi.fn(), off: vi.fn() };
      listener = new ForkListener({
        process: noIpcProc,
        portFileDir: tmpDir,
        portFileName: 'auth-test.port',
        authTimeoutMs: 1000,
      });
    });

    afterEach(() => {
      listener.close();
    });

    it('writes token file with restrictive permissions on listen', async () => {
      listener.listen();
      await vi.waitFor(() => expect(listener.port).not.toBeNull(), { timeout: 2000 });

      const tokenFile = join(tmpDir, 'agent-server.token');
      expect(existsSync(tokenFile)).toBe(true);
      const token = readFileSync(tokenFile, 'utf-8');
      expect(token).toHaveLength(64); // 32 bytes hex-encoded
    });

    it('removes token file on close', async () => {
      listener.listen();
      await vi.waitFor(() => expect(listener.port).not.toBeNull(), { timeout: 2000 });

      const tokenFile = join(tmpDir, 'agent-server.token');
      expect(existsSync(tokenFile)).toBe(true);

      listener.close();
      expect(existsSync(tokenFile)).toBe(false);
    });

    it('rejects connections with wrong token', async () => {
      listener.listen();
      await vi.waitFor(() => expect(listener.port).not.toBeNull(), { timeout: 2000 });

      const socket = await tcpConnect(listener.port!);
      try {
        const authMsg = { type: 'authenticate', requestId: 'auth-bad', token: 'wrong-token' };
        tcpSend(socket, authMsg);
        const reply = await tcpRead(socket) as Record<string, unknown>;

        expect(reply.type).toBe('auth_result');
        expect(reply.success).toBe(false);
      } finally {
        socket.destroy();
      }
    });

    it('rejects connections that send non-auth message first', async () => {
      listener.listen();
      await vi.waitFor(() => expect(listener.port).not.toBeNull(), { timeout: 2000 });

      const socket = await tcpConnect(listener.port!);
      try {
        tcpSend(socket, spawnMsg('bad-first'));
        const reply = await tcpRead(socket) as Record<string, unknown>;

        expect(reply.type).toBe('error');
        expect(reply.code).toBe('AUTH_REQUIRED');
      } finally {
        socket.destroy();
      }
    });

    it('rejects connections that time out without auth', async () => {
      const connections: TransportConnection[] = [];
      listener.onConnection(conn => connections.push(conn));
      listener.listen();

      await vi.waitFor(() => expect(listener.port).not.toBeNull(), { timeout: 2000 });

      const socket = await tcpConnect(listener.port!);
      try {
        // Don't send anything — wait for timeout
        const reply = await tcpRead(socket) as Record<string, unknown>;

        expect(reply.type).toBe('error');
        expect(reply.code).toBe('AUTH_REQUIRED');
        // Connection should NOT have been emitted
        expect(connections).toHaveLength(0);
      } finally {
        socket.destroy();
      }
    });

    it('accepts connections with correct token', async () => {
      const connections: TransportConnection[] = [];
      listener.onConnection(conn => connections.push(conn));
      listener.listen();

      await vi.waitFor(() => expect(listener.port).not.toBeNull(), { timeout: 2000 });

      const socket = await tcpConnect(listener.port!);
      try {
        const token = readToken(tmpDir);
        await tcpAuth(socket, token);

        expect(connections).toHaveLength(1);
        expect(connections[0].isConnected).toBe(true);
      } finally {
        socket.destroy();
      }
    });

    it('IPC connections skip auth', () => {
      const proc = createMockProcess();
      const l = new ForkListener({
        process: proc,
        portFileDir: tmpDir,
      });

      const connections: TransportConnection[] = [];
      l.onConnection(conn => connections.push(conn));
      l.listen();

      // IPC connection emitted immediately — no auth needed
      expect(connections).toHaveLength(1);
      expect(connections[0].id).toMatch(/^ipc-/);
      expect(connections[0].isConnected).toBe(true);

      l.close();
    });
  });

  // ── Close / Cleanup ───────────────────────────────────────────

  describe('close and cleanup', () => {
    it('close() is idempotent', () => {
      const proc = createMockProcess();
      const l = new ForkListener({ process: proc, portFileDir: tmpDir });
      l.listen();
      l.close();
      l.close(); // should not throw
      expect(l.isListening).toBe(false);
    });

    it('close() before listen() is a no-op', () => {
      const proc = createMockProcess();
      const l = new ForkListener({ process: proc, portFileDir: tmpDir });
      l.close(); // should not throw
      expect(l.isListening).toBe(false);
    });

    it('close() disconnects all active connections', async () => {
      const proc = createMockProcess();
      const l = new ForkListener({ process: proc, portFileDir: tmpDir });

      const disconnectReasons: string[] = [];
      l.onConnection(conn => {
        conn.onDisconnect(r => disconnectReasons.push(r));
      });
      l.listen();

      await vi.waitFor(() => expect(l.port).not.toBeNull(), { timeout: 2000 });

      const socket = await tcpConnect(l.port!);
      try {
        const token = readToken(tmpDir);
        await tcpAuth(socket, token);

        await vi.waitFor(() => expect(l.connectionCount).toBe(2), { timeout: 2000 });

        l.close();

        // Both connections should have been disconnected
        expect(disconnectReasons).toContain('closed by server');
        expect(l.connectionCount).toBe(0);
      } finally {
        socket.destroy();
      }
    });
  });
});
