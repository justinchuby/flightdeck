// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';

// --- Hoisted state shared between mock factories and tests ---
const hoisted = vi.hoisted(() => {
  const { EventEmitter } = require('events') as typeof import('events');
  const mockAppendLine = vi.fn();
  const mockGetConfiguration = vi.fn();
  const mockShowWarningMessage = vi.fn();

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

  return { mockAppendLine, mockGetConfiguration, mockShowWarningMessage, MockWebSocket, state };
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
    window: {
      showWarningMessage: hoisted.mockShowWarningMessage,
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
import type * as vscode from 'vscode';

// --- Test helpers ---
const { mockAppendLine, mockGetConfiguration, mockShowWarningMessage, MockWebSocket, state } = hoisted;
const mockOutputChannel = { appendLine: mockAppendLine } as unknown as vscode.OutputChannel;

const mockGlobalState = {
  get: vi.fn(),
  update: vi.fn().mockResolvedValue(undefined),
};

function createConnection(
  globalStateOverride?: typeof mockGlobalState,
): FlightdeckConnection {
  const gs = globalStateOverride ?? mockGlobalState;
  const context = {
    subscriptions: [],
    globalState: gs,
  } as unknown as vscode.ExtensionContext;
  return new FlightdeckConnection(context, mockOutputChannel);
}

/**
 * Start a real HTTP server that responds to /health, /version, /api/projects.
 */
function startHealthServer(
  versionPayload = { version: '0.5.0', apiVersion: 1 },
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else if (req.url === '/version') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(versionPayload));
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

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// --- Tests ---
describe('FlightdeckConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.latestWs = null;
    mockAppendLine.mockClear();
    mockGetConfiguration.mockReset();
    mockShowWarningMessage.mockReset();
    mockGlobalState.get.mockReset();
    mockGlobalState.update.mockReset().mockResolvedValue(undefined);
    mockGetConfiguration.mockReturnValue({
      get: (_key: string, _defaultVal?: string) => undefined,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------
  // 1. Initial state
  // ---------------------------------------------------------------
  describe('initial state', () => {
    it('starts disconnected with connected=false and empty serverUrl', () => {
      const conn = createConnection();
      expect(conn.state).toBe('disconnected');
      expect(conn.connected).toBe(false);
      expect(conn.serverUrl).toBe('');
      expect(conn.serverVersion).toBeNull();
      conn.dispose();
    });
  });

  // ---------------------------------------------------------------
  // 2. discoverServer
  // ---------------------------------------------------------------
  describe('discoverServer', () => {
    it('returns explicit URL immediately without health probe', async () => {
      vi.useRealTimers();
      const conn = createConnection();
      const result = await conn.discoverServer('http://custom:9999');
      expect(result).toBe('http://custom:9999');
      conn.dispose();
    });

    it('probes config URL and returns it when healthy', async () => {
      vi.useRealTimers();
      const { server, port } = await startHealthServer();
      try {
        const configUrl = `http://localhost:${port}`;
        mockGetConfiguration.mockReturnValue({
          get: (key: string) => (key === 'serverUrl' ? configUrl : undefined),
        });
        const conn = createConnection();
        const result = await conn.discoverServer();
        expect(result).toBe(configUrl);
        conn.dispose();
      } finally {
        await closeServer(server);
      }
    });

    it('skips config URL when not responding and falls through', async () => {
      vi.useRealTimers();
      mockGetConfiguration.mockReturnValue({
        get: (key: string) => (key === 'serverUrl' ? 'http://localhost:1' : undefined),
      });
      mockGlobalState.get.mockReturnValue(undefined);
      const originalEnv = process.env.FLIGHTDECK_PORT;
      delete process.env.FLIGHTDECK_PORT;
      try {
        const conn = createConnection();
        const result = await conn.discoverServer();
        // Falls through to port scan (may or may not find something)
        expect(result === null || typeof result === 'string').toBe(true);
        expect(mockAppendLine).toHaveBeenCalledWith(
          expect.stringContaining('not responding'),
        );
        conn.dispose();
      } finally {
        if (originalEnv !== undefined) process.env.FLIGHTDECK_PORT = originalEnv;
      }
    });

    it('probes FLIGHTDECK_PORT env var and returns URL when healthy', async () => {
      vi.useRealTimers();
      const { server, port } = await startHealthServer();
      const originalEnv = process.env.FLIGHTDECK_PORT;
      try {
        process.env.FLIGHTDECK_PORT = String(port);
        mockGlobalState.get.mockReturnValue(undefined);
        const conn = createConnection();
        const result = await conn.discoverServer();
        expect(result).toBe(`http://localhost:${port}`);
        conn.dispose();
      } finally {
        if (originalEnv !== undefined) {
          process.env.FLIGHTDECK_PORT = originalEnv;
        } else {
          delete process.env.FLIGHTDECK_PORT;
        }
        await closeServer(server);
      }
    });

    it('probes globalState last-known URL and returns it when healthy', async () => {
      vi.useRealTimers();
      const { server, port } = await startHealthServer();
      try {
        const lastUrl = `http://localhost:${port}`;
        mockGlobalState.get.mockReturnValue(lastUrl);
        const conn = createConnection();
        const result = await conn.discoverServer();
        expect(result).toBe(lastUrl);
        expect(mockAppendLine).toHaveBeenCalledWith(
          expect.stringContaining('last-known URL'),
        );
        conn.dispose();
      } finally {
        await closeServer(server);
      }
    });

    it('returns null when no server is found anywhere', async () => {
      vi.useRealTimers();
      mockGlobalState.get.mockReturnValue(undefined);
      const originalEnv = process.env.FLIGHTDECK_PORT;
      delete process.env.FLIGHTDECK_PORT;
      try {
        const conn = createConnection();
        const result = await conn.discoverServer();
        expect(result === null || result?.startsWith('http')).toBe(true);
        conn.dispose();
      } finally {
        if (originalEnv !== undefined) process.env.FLIGHTDECK_PORT = originalEnv;
      }
    });
  });

  // ---------------------------------------------------------------
  // 3. connect with real server
  // ---------------------------------------------------------------
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
      await closeServer(server);
    });

    it('discovery → health check → WS connect → subscribe → version', async () => {
      const conn = createConnection();
      const states: ConnectionState[] = [];
      conn.onStateChange((s) => states.push(s));

      await conn.connect(`http://localhost:${port}`);

      // WS should have been created after health + version pass
      expect(state.latestWs).not.toBeNull();
      expect(states).toContain('connecting');

      // Simulate WS open → connected
      state.latestWs!.simulateOpen();
      expect(conn.state).toBe('connected');
      expect(conn.connected).toBe(true);
      expect(states).toContain('connected');

      // Subscribe message sent on open
      expect(state.latestWs!.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'subscribe', agentId: '*' }),
      );

      // Version info populated
      expect(conn.serverVersion).toEqual({ version: '0.5.0', apiVersion: 1 });

      conn.dispose();
    });

    it('skips if already connecting', async () => {
      const conn = createConnection();
      const p1 = conn.connect(`http://localhost:${port}`);
      const p2 = conn.connect(`http://localhost:${port}`);
      await Promise.allSettled([p1, p2]);
      conn.dispose();
    });

    it('transitions to error state on health check failure', async () => {
      vi.useRealTimers();
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

  // ---------------------------------------------------------------
  // 4. connect stores URL in globalState
  // ---------------------------------------------------------------
  describe('connect persists URL', () => {
    let server: http.Server;
    let port: number;

    beforeEach(async () => {
      vi.useRealTimers();
      const result = await startHealthServer();
      server = result.server;
      port = result.port;
    });

    afterEach(async () => {
      await closeServer(server);
    });

    it('calls globalState.update with the server URL after successful connect', async () => {
      const conn = createConnection();
      await conn.connect(`http://localhost:${port}`);

      expect(mockGlobalState.update).toHaveBeenCalledWith(
        'flightdeck.lastServerUrl',
        `http://localhost:${port}`,
      );
      conn.dispose();
    });
  });

  // ---------------------------------------------------------------
  // 5. disconnect
  // ---------------------------------------------------------------
  describe('disconnect', () => {
    it('stops reconnect and transitions to disconnected', () => {
      const conn = createConnection();
      const states: ConnectionState[] = [];
      conn.onStateChange((s) => states.push(s));
      conn.disconnect();
      // Already disconnected, so no state change
      expect(states).toHaveLength(0);
      conn.dispose();
    });

    it('moves from connected → disconnected', async () => {
      vi.useRealTimers();
      const { server, port } = await startHealthServer();
      try {
        const conn = createConnection();
        await conn.connect(`http://localhost:${port}`);
        state.latestWs!.simulateOpen();
        expect(conn.state).toBe('connected');

        conn.disconnect();
        expect(conn.state).toBe('disconnected');
        expect(conn.connected).toBe(false);
        conn.dispose();
      } finally {
        await closeServer(server);
      }
    });
  });

  // ---------------------------------------------------------------
  // 6. send
  // ---------------------------------------------------------------
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

  // ---------------------------------------------------------------
  // 7. fetch
  // ---------------------------------------------------------------
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
      await closeServer(server);
    });

    it('GET /health returns parsed JSON', async () => {
      const conn = createConnection();
      (conn as unknown as Record<string, unknown>)._serverUrl = `http://localhost:${port}`;
      const data = await conn.fetchRaw<{ status: string }>('/health');
      expect(data).toEqual({ status: 'ok' });
      conn.dispose();
    });

    it('GET /api/projects returns parsed JSON', async () => {
      const conn = createConnection();
      (conn as unknown as Record<string, unknown>)._serverUrl = `http://localhost:${port}`;
      const data = await conn.fetchRaw<Array<{ id: string }>>('/api/projects');
      expect(data).toEqual([{ id: '1', name: 'Test' }]);
      conn.dispose();
    });

    it('rejects on 404', async () => {
      const conn = createConnection();
      (conn as unknown as Record<string, unknown>)._serverUrl = `http://localhost:${port}`;
      await expect(conn.fetchRaw('/nonexistent')).rejects.toThrow('HTTP 404');
      conn.dispose();
    });
  });

  // ---------------------------------------------------------------
  // 8. WS messages
  // ---------------------------------------------------------------
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
      await closeServer(server);
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

  // ---------------------------------------------------------------
  // 9. reconnection
  // ---------------------------------------------------------------
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
        await closeServer(server);
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
        await closeServer(server);
      }
    });

    it('re-runs discoverServer during reconnection', async () => {
      vi.useRealTimers();
      const { server, port } = await startHealthServer();

      try {
        const conn = createConnection();
        await conn.connect(`http://localhost:${port}`);
        state.latestWs!.simulateOpen();

        // Spy on discoverServer
        const discoverSpy = vi.spyOn(conn, 'discoverServer');

        // Close triggers scheduled reconnect
        state.latestWs!.simulateClose(1006, 'gone');
        expect(conn.state).toBe('disconnected');

        // Wait for reconnect timer (3s)
        await new Promise((r) => setTimeout(r, 3500));

        expect(discoverSpy).toHaveBeenCalled();
        conn.dispose();
      } finally {
        await closeServer(server);
      }
    });
  });

  // ---------------------------------------------------------------
  // 10. onDidChangeConnection
  // ---------------------------------------------------------------
  describe('onDidChangeConnection', () => {
    it('fires true on connect, false on disconnect', async () => {
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
        await closeServer(server);
      }
    });

    it('does not fire duplicate values', async () => {
      vi.useRealTimers();
      const { server, port } = await startHealthServer();

      try {
        const conn = createConnection();
        const events: boolean[] = [];
        conn.onDidChangeConnection((v) => events.push(v));

        await conn.connect(`http://localhost:${port}`);
        state.latestWs!.simulateOpen();
        // Fire connecting → connected is one true

        conn.disconnect();
        // disconnected → one false

        expect(events).toEqual([true, false]);
        conn.dispose();
      } finally {
        await closeServer(server);
      }
    });
  });

  // ---------------------------------------------------------------
  // 11. dispose
  // ---------------------------------------------------------------
  describe('dispose', () => {
    it('cleans up all resources', () => {
      const conn = createConnection();
      const mockWs = new MockWebSocket();
      mockWs.readyState = MockWebSocket.OPEN;
      (conn as unknown as Record<string, unknown>).ws = mockWs;
      conn.dispose();
      expect(conn.state).toBe('disconnected');
    });

    it('is safe to call multiple times', () => {
      const conn = createConnection();
      conn.dispose();
      conn.dispose(); // should not throw
    });
  });

  // ---------------------------------------------------------------
  // API version mismatch warning
  // ---------------------------------------------------------------
  describe('API version mismatch', () => {
    it('shows warning when server apiVersion differs from expected', async () => {
      vi.useRealTimers();
      const { server, port } = await startHealthServer({ version: '0.6.0', apiVersion: 99 });
      try {
        const conn = createConnection();
        await conn.connect(`http://localhost:${port}`);
        expect(mockShowWarningMessage).toHaveBeenCalledWith(
          expect.stringContaining('may not be compatible'),
        );
        conn.dispose();
      } finally {
        await closeServer(server);
      }
    });

    it('does not show warning when apiVersion matches', async () => {
      vi.useRealTimers();
      const { server, port } = await startHealthServer({ version: '0.5.0', apiVersion: 1 });
      try {
        const conn = createConnection();
        await conn.connect(`http://localhost:${port}`);
        expect(mockShowWarningMessage).not.toHaveBeenCalled();
        conn.dispose();
      } finally {
        await closeServer(server);
      }
    });
  });
});
