// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';

// --- Hoisted state shared between mock factories and tests ---
const hoisted = vi.hoisted(() => {
  const { EventEmitter } = require('events') as typeof import('events');
  const mockAppendLine = vi.fn();
  const mockGetConfiguration = vi.fn();

  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 0; // CONNECTING
    send = vi.fn();
    close = vi.fn();
    terminate = vi.fn();
    removeAllListeners = vi.fn().mockReturnThis();

    simulateOpen() {
      this.readyState = 1;
      this.emit('open');
    }
    simulateMessage(data: Record<string, unknown>) {
      this.emit('message', Buffer.from(JSON.stringify(data)));
    }
    simulateClose(code = 1000, reason = '') {
      this.readyState = 3;
      this.emit('close', code, Buffer.from(reason));
    }
    simulateError(msg: string) {
      this.emit('error', new Error(msg));
    }
    simulatePong() {
      this.emit('pong');
    }
  }

  const state = {
    latestWs: null as InstanceType<typeof MockWebSocket> | null,
  };

  return { mockAppendLine, mockGetConfiguration, MockWebSocket, state };
});

// --- Mock vscode ---
vi.mock('vscode', () => {
  class EventEmitter<T> {
    private listeners: Array<(e: T) => void> = [];
    event = (listener: (e: T) => void) => {
      this.listeners.push(listener);
      return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
    };
    fire(data: T) { this.listeners.forEach(l => l(data)); }
    dispose() { this.listeners = []; }
  }
  return {
    EventEmitter,
    workspace: {
      getConfiguration: (...args: unknown[]) => hoisted.mockGetConfiguration(...args),
    },
  };
});

// --- Mock ws ---
vi.mock('ws', () => {
  const WS = vi.fn(function () {
    hoisted.state.latestWs = new hoisted.MockWebSocket();
    return hoisted.state.latestWs;
  });
  Object.defineProperty(WS, 'OPEN', { value: 1, configurable: true });
  Object.defineProperty(WS, 'CONNECTING', { value: 0, configurable: true });
  return { default: WS };
});

// Import module under test after mocks
import { FlightdeckConnection, type ConnectionState } from '../connection';
import WebSocket from 'ws';

// --- Test helpers ---
const { mockAppendLine, mockGetConfiguration, MockWebSocket, state } = hoisted;
const mockOutputChannel = { appendLine: mockAppendLine } as unknown as import('vscode').OutputChannel;

function createConnection(): FlightdeckConnection {
  const context = { subscriptions: [] } as unknown as import('vscode').ExtensionContext;
  return new FlightdeckConnection(context, mockOutputChannel);
}

function startHealthServer(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else if (req.url === '/api/projects') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{ id: '1', name: 'Test' }]));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

// --- Tests ---
describe('FlightdeckConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.latestWs = null;
    mockAppendLine.mockClear();
    mockGetConfiguration.mockReset();
    mockGetConfiguration.mockReturnValue({
      get: (_key: string, defaultVal?: string) => defaultVal,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('starts in disconnected state', () => {
      const conn = createConnection();
      expect(conn.state).toBe('disconnected');
      expect(conn.connected).toBe(false);
      expect(conn.serverUrl).toBe('');
      conn.dispose();
    });
  });

  describe('resolveServerUrl', () => {
    it('uses explicit parameter when provided', () => {
      const conn = createConnection();
      expect(conn.resolveServerUrl('http://custom:9999')).toBe('http://custom:9999');
      conn.dispose();
    });

    it('falls back to VS Code config', () => {
      mockGetConfiguration.mockReturnValue({
        get: () => 'http://config:5000',
      });
      const conn = createConnection();
      expect(conn.resolveServerUrl()).toBe('http://config:5000');
      conn.dispose();
    });

    it('falls back to FLIGHTDECK_PORT env var', () => {
      mockGetConfiguration.mockReturnValue({ get: () => undefined });
      const originalEnv = process.env.FLIGHTDECK_PORT;
      process.env.FLIGHTDECK_PORT = '4444';
      try {
        const conn = createConnection();
        expect(conn.resolveServerUrl()).toBe('http://localhost:4444');
        conn.dispose();
      } finally {
        if (originalEnv === undefined) delete process.env.FLIGHTDECK_PORT;
        else process.env.FLIGHTDECK_PORT = originalEnv;
      }
    });

    it('defaults to http://localhost:3001', () => {
      mockGetConfiguration.mockReturnValue({ get: () => undefined });
      const originalEnv = process.env.FLIGHTDECK_PORT;
      delete process.env.FLIGHTDECK_PORT;
      try {
        const conn = createConnection();
        expect(conn.resolveServerUrl()).toBe('http://localhost:3001');
        conn.dispose();
      } finally {
        if (originalEnv !== undefined) process.env.FLIGHTDECK_PORT = originalEnv;
      }
    });
  });

  describe('connect', () => {
    it('skips if already connecting', async () => {
      const conn = createConnection();
      const p1 = conn.connect('http://localhost:99999');
      const p2 = conn.connect('http://localhost:99999');
      await Promise.allSettled([p1, p2]);
      conn.dispose();
    });

    it('transitions to error state on health check failure', async () => {
      const states: ConnectionState[] = [];
      const conn = createConnection();
      conn.onStateChange((s) => states.push(s));
      await conn.connect('http://localhost:1');
      expect(conn.state).toBe('error');
      expect(states).toContain('connecting');
      expect(states).toContain('error');
      conn.dispose();
    });
  });

  describe('connect with real health server', () => {
    let server: http.Server;
    let port: number;

    beforeEach(async () => {
      vi.useRealTimers();
      const result = await startHealthServer();
      server = result.server;
      port = result.port;
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('connects after successful health check', async () => {
      const conn = createConnection();
      const states: ConnectionState[] = [];
      conn.onStateChange((s) => states.push(s));

      await conn.connect(`http://localhost:${port}`);

      expect(state.latestWs).not.toBeNull();
      expect(states).toContain('connecting');

      // Simulate WS open
      state.latestWs!.simulateOpen();
      expect(conn.state).toBe('connected');
      expect(conn.connected).toBe(true);
      expect(states).toContain('connected');

      // Should have sent subscribe message
      expect(state.latestWs!.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'subscribe', agentId: '*' }),
      );

      conn.dispose();
    });
  });

  describe('disconnect', () => {
    it('transitions to disconnected and stops reconnect', () => {
      const conn = createConnection();
      const states: ConnectionState[] = [];
      conn.onStateChange((s) => states.push(s));
      conn.disconnect();
      expect(states).toHaveLength(0); // already disconnected
      conn.dispose();
    });
  });

  describe('send', () => {
    it('sends JSON when connected', () => {
      const conn = createConnection();
      const mockWs = new MockWebSocket();
      mockWs.readyState = MockWebSocket.OPEN;
      (conn as unknown as Record<string, unknown>).ws = mockWs;

      conn.send({ type: 'test', data: 123 });
      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'test', data: 123 }),
      );
      conn.dispose();
    });

    it('no-ops when not connected', () => {
      const conn = createConnection();
      conn.send({ type: 'test' }); // should not throw
      conn.dispose();
    });
  });

  describe('fetch', () => {
    let server: http.Server;
    let port: number;

    beforeEach(async () => {
      vi.useRealTimers();
      const result = await startHealthServer();
      server = result.server;
      port = result.port;
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('fetches JSON from the server', async () => {
      const conn = createConnection();
      (conn as unknown as Record<string, unknown>)._serverUrl = `http://localhost:${port}`;
      const data = await conn.fetch<{ status: string }>('/health');
      expect(data).toEqual({ status: 'ok' });
      conn.dispose();
    });

    it('fetches from nested API paths', async () => {
      const conn = createConnection();
      (conn as unknown as Record<string, unknown>)._serverUrl = `http://localhost:${port}`;
      const data = await conn.fetch<Array<{ id: string }>>('/api/projects');
      expect(data).toEqual([{ id: '1', name: 'Test' }]);
      conn.dispose();
    });

    it('rejects on HTTP error', async () => {
      const conn = createConnection();
      (conn as unknown as Record<string, unknown>)._serverUrl = `http://localhost:${port}`;
      await expect(conn.fetch('/nonexistent')).rejects.toThrow('HTTP 404');
      conn.dispose();
    });
  });

  describe('WebSocket message handling', () => {
    let server: http.Server;
    let port: number;

    beforeEach(async () => {
      vi.useRealTimers();
      const result = await startHealthServer();
      server = result.server;
      port = result.port;
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('fires onMessage for valid JSON messages', async () => {
      const conn = createConnection();
      const messages: Array<Record<string, unknown>> = [];
      conn.onMessage((msg) => messages.push(msg as unknown as Record<string, unknown>));

      await conn.connect(`http://localhost:${port}`);
      state.latestWs!.simulateOpen();

      state.latestWs!.simulateMessage({ type: 'agent:spawned', agent: { id: '123' } });
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'agent:spawned', agent: { id: '123' } });
      conn.dispose();
    });

    it('logs invalid JSON without crashing', async () => {
      const conn = createConnection();
      await conn.connect(`http://localhost:${port}`);
      state.latestWs!.simulateOpen();

      state.latestWs!.emit('message', Buffer.from('not json'));
      expect(mockAppendLine).toHaveBeenCalledWith(
        expect.stringContaining('Invalid message'),
      );
      conn.dispose();
    });
  });

  describe('reconnection', () => {
    it('schedules reconnect on WebSocket close', async () => {
      vi.useRealTimers();
      const { server, port } = await startHealthServer();

      try {
        const conn = createConnection();
        const states: ConnectionState[] = [];
        conn.onStateChange((s) => states.push(s));

        await conn.connect(`http://localhost:${port}`);
        state.latestWs!.simulateOpen();
        expect(conn.state).toBe('connected');

        state.latestWs!.simulateClose(1006, 'abnormal');
        expect(conn.state).toBe('disconnected');

        expect(mockAppendLine).toHaveBeenCalledWith(
          expect.stringContaining('Reconnecting in'),
        );
        conn.dispose();
      } finally {
        server.close();
      }
    });

    it('does not reconnect after explicit disconnect', async () => {
      vi.useRealTimers();
      const { server, port } = await startHealthServer();

      try {
        const conn = createConnection();
        await conn.connect(`http://localhost:${port}`);
        state.latestWs!.simulateOpen();

        conn.disconnect();
        const reconnectCalls = (mockAppendLine.mock.calls as string[][])
          .filter(([msg]) => typeof msg === 'string' && msg.includes('Reconnecting'));
        expect(reconnectCalls).toHaveLength(0);
        conn.dispose();
      } finally {
        server.close();
      }
    });
  });

  describe('onDidChangeConnection (compat)', () => {
    it('fires true when connected, false when disconnected', async () => {
      vi.useRealTimers();
      const { server, port } = await startHealthServer();

      try {
        const conn = createConnection();
        const events: boolean[] = [];
        conn.onDidChangeConnection((v) => events.push(v));

        await conn.connect(`http://localhost:${port}`);
        state.latestWs!.simulateOpen();
        expect(events).toContain(true);

        conn.disconnect();
        expect(events).toContain(false);
        conn.dispose();
      } finally {
        server.close();
      }
    });
  });

  describe('dispose', () => {
    it('cleans up all resources', () => {
      const conn = createConnection();
      const mockWs = new MockWebSocket();
      mockWs.readyState = MockWebSocket.OPEN;
      (conn as unknown as Record<string, unknown>).ws = mockWs;
      conn.dispose();
      expect(conn.state).toBe('disconnected');
    });
  });
});
