/**
 * Health heartbeat integration tests.
 *
 * Tests the ping/pong auto-response in ForkListener (IPC and TCP),
 * and the full ForkTransport → ForkListener round-trip with AgentServerHealth.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createConnection, type Socket } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ForkListener, type ForkProcess } from '../ForkListener.js';
import type {
  TransportConnection,
  OrchestratorMessage,
  AgentServerMessage,
  PingMessage,
  PongMessage,
  MessageScope,
} from '../types.js';
import { AgentServerHealth } from '../../agents/AgentServerHealth.js';

// ── Helpers ─────────────────────────────────────────────────────────

const scope: MessageScope = { projectId: 'test-proj', teamId: 'team-1' };

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
  _emit(event: string, ...args: unknown[]): void;
};

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'health-heartbeat-test-'));
}

/** Wait for the TCP server to be ready. */
function waitForPort(listener: ForkListener, timeout = 2000): Promise<number> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (listener.port !== null) {
        resolve(listener.port);
      } else if (Date.now() - start > timeout) {
        reject(new Error('Timed out waiting for port'));
      } else {
        setTimeout(check, 10);
      }
    };
    check();
  });
}

/** Connect a TCP socket to a ForkListener and authenticate. */
async function connectAndAuth(port: number, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setEncoding('utf-8');

    socket.on('connect', () => {
      const authMsg = JSON.stringify({
        type: 'authenticate',
        requestId: 'auth-1',
        token,
      }) + '\n';
      socket.write(authMsg);
    });

    let buffer = '';
    socket.on('data', (data: string) => {
      buffer += data;
      if (buffer.includes('\n')) {
        const line = buffer.split('\n')[0];
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'auth_result' && msg.success) {
            socket.removeAllListeners('data');
            resolve(socket);
          } else {
            reject(new Error(`Auth failed: ${JSON.stringify(msg)}`));
          }
        } catch {
          reject(new Error(`Invalid JSON: ${line}`));
        }
      }
    });

    socket.on('error', reject);
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Health heartbeat', () => {
  describe('ForkListener auto-pong via IPC', () => {
    it('responds to ping with pong containing matching requestId and timestamp', () => {
      const proc = createMockProcess();
      const listener = new ForkListener({ process: proc, portFileDir: makeTempDir() });

      let connection: TransportConnection | null = null;
      listener.onConnection((conn) => { connection = conn; });
      listener.listen();

      expect(connection).not.toBeNull();

      // Send a ping via IPC
      const pingMsg: PingMessage = { type: 'ping', requestId: 'hb-42' };
      proc._emit('message', pingMsg);

      // ForkListener should auto-respond with pong
      expect(proc.send).toHaveBeenCalled();
      const sentMessages = proc.send.mock.calls.map(([msg]: unknown[]) => msg as AgentServerMessage);
      const pong = sentMessages.find((m: AgentServerMessage) => m.type === 'pong') as PongMessage | undefined;

      expect(pong).toBeDefined();
      expect(pong!.requestId).toBe('hb-42');
      expect(pong!.timestamp).toBeGreaterThan(0);

      listener.close();
    });

    it('still delivers ping to user message handlers', () => {
      const proc = createMockProcess();
      const listener = new ForkListener({ process: proc, portFileDir: makeTempDir() });

      const received: OrchestratorMessage[] = [];
      listener.onConnection((conn) => {
        conn.onMessage((msg) => received.push(msg));
      });
      listener.listen();

      const pingMsg: PingMessage = { type: 'ping', requestId: 'hb-99' };
      proc._emit('message', pingMsg);

      // User handler should also receive the ping
      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('ping');
      expect((received[0] as PingMessage).requestId).toBe('hb-99');

      listener.close();
    });

    it('responds to multiple pings', () => {
      const proc = createMockProcess();
      const listener = new ForkListener({ process: proc, portFileDir: makeTempDir() });
      listener.onConnection(() => {});
      listener.listen();

      proc._emit('message', { type: 'ping', requestId: 'hb-1' });
      proc._emit('message', { type: 'ping', requestId: 'hb-2' });
      proc._emit('message', { type: 'ping', requestId: 'hb-3' });

      const pongs = proc.send.mock.calls
        .map(([msg]: unknown[]) => msg as AgentServerMessage)
        .filter((m: AgentServerMessage) => m.type === 'pong') as PongMessage[];

      expect(pongs).toHaveLength(3);
      expect(pongs.map(p => p.requestId)).toEqual(['hb-1', 'hb-2', 'hb-3']);

      listener.close();
    });
  });

  describe('ForkListener auto-pong via TCP', () => {
    let listener: ForkListener;
    let tempDir: string;

    beforeEach(() => {
      tempDir = makeTempDir();
    });

    afterEach(() => {
      listener?.close();
    });

    it('responds to ping with pong over TCP', async () => {
      // No IPC (standalone mode)
      const proc: ForkProcess = {
        on: () => {},
        off: () => {},
      };

      listener = new ForkListener({
        process: proc,
        portFileDir: tempDir,
        authTimeoutMs: 5000,
      });

      let token = '';
      // We need access to the auth token — read from file after listen()
      listener.listen();
      const port = await waitForPort(listener);

      // Read token from file
      const { readFileSync } = await import('node:fs');
      token = readFileSync(join(tempDir, 'agent-server.token'), 'utf-8').trim();

      // Wait for connection to be emitted
      const connectionPromise = new Promise<TransportConnection>((resolve) => {
        listener.onConnection(resolve);
      });

      const socket = await connectAndAuth(port, token);
      const conn = await connectionPromise;

      // Send ping over TCP
      const pongPromise = new Promise<PongMessage>((resolve) => {
        let buffer = '';
        socket.on('data', (data: string) => {
          buffer += data;
          const lines = buffer.split('\n');
          buffer = lines.pop()!;
          for (const line of lines) {
            if (!line.trim()) continue;
            const msg = JSON.parse(line.trim());
            if (msg.type === 'pong') resolve(msg as PongMessage);
          }
        });
      });

      socket.write(JSON.stringify({ type: 'ping', requestId: 'tcp-hb-1' }) + '\n');

      const pong = await pongPromise;
      expect(pong.requestId).toBe('tcp-hb-1');
      expect(pong.timestamp).toBeGreaterThan(0);

      socket.destroy();
    });
  });

  describe('AgentServerHealth integration', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('full round-trip: health sends pings via transport, listener responds, health stays connected', () => {
      const proc = createMockProcess();
      const listener = new ForkListener({ process: proc, portFileDir: makeTempDir() });
      listener.onConnection(() => {});
      listener.listen();

      // Simulate the transport side: health sends ping, listener auto-responds
      let pingCounter = 0;
      const health = new AgentServerHealth(() => {
        const requestId = `hb-${++pingCounter}`;
        // Simulate sending via transport
        proc._emit('message', { type: 'ping', requestId } as PingMessage);
        return requestId;
      }, { pingIntervalMs: 100 });

      // The listener auto-responds via proc.send — feed pongs back to health
      const originalSend = proc.send.getMockImplementation() ?? (() => true);
      proc.send.mockImplementation((msg: unknown) => {
        const m = msg as AgentServerMessage;
        if (m.type === 'pong') {
          health.recordPong((m as PongMessage).requestId);
        }
        return true;
      });

      health.start();

      // Tick a few intervals — pongs should keep health connected
      vi.advanceTimersByTime(100); // hb-1 → pong
      vi.advanceTimersByTime(100); // hb-2 → pong
      vi.advanceTimersByTime(100); // hb-3 → pong

      expect(health.state).toBe('connected');
      expect(health.consecutiveMisses).toBe(0);

      health.stop();
      listener.close();
    });

    it('health degrades when listener stops responding', () => {
      const proc = createMockProcess();
      const listener = new ForkListener({ process: proc, portFileDir: makeTempDir() });
      listener.onConnection(() => {});
      listener.listen();

      let pingCounter = 0;
      const health = new AgentServerHealth(() => {
        const requestId = `hb-${++pingCounter}`;
        // Don't forward pings to listener — simulate broken connection
        return requestId;
      }, { pingIntervalMs: 100, degradedThreshold: 1, disconnectedThreshold: 3 });

      health.start();

      vi.advanceTimersByTime(100); // hb-1 sent, no response
      vi.advanceTimersByTime(100); // hb-1 missed → degraded
      expect(health.state).toBe('degraded');

      vi.advanceTimersByTime(100); // hb-2 missed
      vi.advanceTimersByTime(100); // hb-3 missed → disconnected
      expect(health.state).toBe('disconnected');

      health.stop();
      listener.close();
    });
  });
});
