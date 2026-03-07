import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DaemonProcess } from '../daemon/DaemonProcess.js';
import { DaemonClient } from '../daemon/DaemonClient.js';
import {
  serializeMessage,
  parseNdjsonBuffer,
  createRequest,
  createResponse,
  createErrorResponse,
  createNotification,
  isRequest,
  isResponse,
  isNotification,
  RPC_ERRORS,
  getSocketDir,
  type AgentDescriptor,
} from '../daemon/DaemonProtocol.js';
import { EventBuffer } from '../daemon/EventBuffer.js';

// ── Test helpers ────────────────────────────────────────────────────

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'daemon-test-'));
}

function makeDescriptor(overrides: Partial<AgentDescriptor> = {}): AgentDescriptor {
  return {
    agentId: 'agent-1',
    pid: 1234,
    role: 'developer',
    model: 'sonnet',
    status: 'running',
    sessionId: 'sess-abc',
    taskSummary: 'building feature',
    spawnedAt: new Date().toISOString(),
    lastEventId: null,
    ...overrides,
  };
}

// ── Protocol Tests ──────────────────────────────────────────────────

describe('DaemonProtocol', () => {
  describe('NDJSON serialization', () => {
    it('serializes a message with trailing newline', () => {
      const msg = createRequest(1, 'ping');
      const serialized = serializeMessage(msg);
      expect(serialized).toMatch(/\n$/);
      expect(JSON.parse(serialized)).toEqual(msg);
    });

    it('parses complete messages from buffer', () => {
      const line1 = JSON.stringify(createRequest(1, 'ping')) + '\n';
      const line2 = JSON.stringify(createRequest(2, 'list')) + '\n';
      const [msgs, remaining] = parseNdjsonBuffer(line1 + line2);
      expect(msgs).toHaveLength(2);
      expect(remaining).toBe('');
    });

    it('returns partial data as remaining buffer', () => {
      const complete = JSON.stringify(createRequest(1, 'ping')) + '\n';
      const partial = '{"jsonrpc":"2.0","method":"li';
      const [msgs, remaining] = parseNdjsonBuffer(complete + partial);
      expect(msgs).toHaveLength(1);
      expect(remaining).toBe(partial);
    });

    it('skips malformed lines', () => {
      const good = JSON.stringify(createRequest(1, 'ping')) + '\n';
      const bad = 'not valid json\n';
      const [msgs, remaining] = parseNdjsonBuffer(good + bad);
      expect(msgs).toHaveLength(1);
      expect(remaining).toBe('');
    });

    it('handles empty lines', () => {
      const line = JSON.stringify(createRequest(1, 'ping')) + '\n\n\n';
      const [msgs, remaining] = parseNdjsonBuffer(line);
      expect(msgs).toHaveLength(1);
      expect(remaining).toBe('');
    });
  });

  describe('message constructors', () => {
    it('creates a request', () => {
      const req = createRequest(42, 'spawn', { agentId: 'a1' });
      expect(req.jsonrpc).toBe('2.0');
      expect(req.id).toBe(42);
      expect(req.method).toBe('spawn');
      expect(req.params).toEqual({ agentId: 'a1' });
    });

    it('creates a response', () => {
      const res = createResponse(42, { ok: true });
      expect(res.id).toBe(42);
      expect(res.result).toEqual({ ok: true });
      expect(res.error).toBeUndefined();
    });

    it('creates an error response', () => {
      const res = createErrorResponse(42, RPC_ERRORS.AUTH_FAILED, 'bad token');
      expect(res.id).toBe(42);
      expect(res.error?.code).toBe(RPC_ERRORS.AUTH_FAILED);
      expect(res.error?.message).toBe('bad token');
    });

    it('creates a notification', () => {
      const notif = createNotification('daemon.event', { type: 'test' });
      expect(notif.jsonrpc).toBe('2.0');
      expect(notif.method).toBe('daemon.event');
      expect('id' in notif).toBe(false);
    });
  });

  describe('type guards', () => {
    it('identifies requests', () => {
      expect(isRequest(createRequest(1, 'test'))).toBe(true);
      expect(isRequest(createResponse(1, {}))).toBe(false);
      expect(isRequest(createNotification('test'))).toBe(false);
    });

    it('identifies responses', () => {
      expect(isResponse(createResponse(1, {}))).toBe(true);
      expect(isResponse(createRequest(1, 'test'))).toBe(false);
    });

    it('identifies notifications', () => {
      expect(isNotification(createNotification('test'))).toBe(true);
      expect(isNotification(createRequest(1, 'test'))).toBe(false);
    });
  });

  describe('getSocketDir', () => {
    it('returns XDG_RUNTIME_DIR path when set', () => {
      const orig = process.env.XDG_RUNTIME_DIR;
      process.env.XDG_RUNTIME_DIR = '/run/user/1000';
      try {
        expect(getSocketDir()).toBe('/run/user/1000/flightdeck');
      } finally {
        if (orig === undefined) delete process.env.XDG_RUNTIME_DIR;
        else process.env.XDG_RUNTIME_DIR = orig;
      }
    });

    it('falls back to TMPDIR', () => {
      const origXdg = process.env.XDG_RUNTIME_DIR;
      const origTmp = process.env.TMPDIR;
      delete process.env.XDG_RUNTIME_DIR;
      process.env.TMPDIR = '/tmp';
      try {
        const dir = getSocketDir();
        expect(dir).toMatch(/^\/tmp\/flightdeck-/);
      } finally {
        if (origXdg !== undefined) process.env.XDG_RUNTIME_DIR = origXdg;
        if (origTmp !== undefined) process.env.TMPDIR = origTmp;
        else delete process.env.TMPDIR;
      }
    });
  });
});

// ── DaemonProcess + DaemonClient Integration ────────────────────────

describe('DaemonProcess', () => {
  let tempDir: string;
  let daemon: DaemonProcess;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(async () => {
    if (daemon) {
      try { await daemon.stop(); } catch { /* ignore */ }
    }
  });

  it('starts and creates socket + token + pid files', async () => {
    daemon = new DaemonProcess({ socketDir: tempDir });
    await daemon.start();

    expect(existsSync(join(tempDir, 'agent-host.sock'))).toBe(true);
    expect(existsSync(join(tempDir, 'agent-host.token'))).toBe(true);
    expect(existsSync(join(tempDir, 'agent-host.pid'))).toBe(true);

    const token = readFileSync(join(tempDir, 'agent-host.token'), 'utf-8');
    expect(token).toHaveLength(64); // 32 bytes hex
    expect(daemon.token).toBe(token);

    const pid = readFileSync(join(tempDir, 'agent-host.pid'), 'utf-8');
    expect(pid).toBe(String(process.pid));
  });

  it('stops and cleans up files', async () => {
    daemon = new DaemonProcess({ socketDir: tempDir });
    await daemon.start();
    await daemon.stop();

    expect(existsSync(join(tempDir, 'agent-host.sock'))).toBe(false);
    expect(existsSync(join(tempDir, 'agent-host.token'))).toBe(false);
    expect(existsSync(join(tempDir, 'agent-host.pid'))).toBe(false);
  });

  it('refuses to start twice', async () => {
    daemon = new DaemonProcess({ socketDir: tempDir });
    await daemon.start();
    await expect(daemon.start()).rejects.toThrow('already running');
  });

  it('refuses to start after disposal', async () => {
    daemon = new DaemonProcess({ socketDir: tempDir });
    await daemon.stop();
    await expect(daemon.start()).rejects.toThrow('disposed');
  });

  // ── Agent Management ──────────────────────────────────────────

  describe('agent management', () => {
    it('registers and lists agents', async () => {
      daemon = new DaemonProcess({ socketDir: tempDir });
      await daemon.start();

      daemon.registerAgent(makeDescriptor({ agentId: 'a1' }));
      daemon.registerAgent(makeDescriptor({ agentId: 'a2' }));

      const agents = daemon.listAgents();
      expect(agents).toHaveLength(2);
      expect(agents.map(a => a.agentId).sort()).toEqual(['a1', 'a2']);
      expect(daemon.agentCount).toBe(2);
    });

    it('updates agent status', async () => {
      daemon = new DaemonProcess({ socketDir: tempDir });
      await daemon.start();

      daemon.registerAgent(makeDescriptor({ agentId: 'a1', status: 'running' }));
      daemon.updateAgentStatus('a1', 'idle');

      expect(daemon.getAgent('a1')?.status).toBe('idle');
    });

    it('records agent exit', async () => {
      daemon = new DaemonProcess({ socketDir: tempDir });
      await daemon.start();

      daemon.registerAgent(makeDescriptor({ agentId: 'a1' }));
      daemon.recordAgentExit('a1', 0, null, null);

      expect(daemon.getAgent('a1')?.status).toBe('exited');
    });

    it('records crashed agent (non-zero exit)', async () => {
      daemon = new DaemonProcess({ socketDir: tempDir });
      await daemon.start();

      daemon.registerAgent(makeDescriptor({ agentId: 'a1' }));
      daemon.recordAgentExit('a1', 1, null, 'Error: crashed');

      expect(daemon.getAgent('a1')?.status).toBe('crashed');
    });
  });

  // ── Mass Failure Detection ────────────────────────────────────

  describe('mass failure detection', () => {
    it('pauses spawning after threshold exits', async () => {
      daemon = new DaemonProcess({
        socketDir: tempDir,
        massFailure: { threshold: 2, windowMs: 60_000, cooldownMs: 60_000 },
      });
      await daemon.start();

      for (let i = 0; i < 3; i++) {
        daemon.registerAgent(makeDescriptor({ agentId: `a${i}` }));
      }

      expect(daemon.isSpawningPaused).toBe(false);

      daemon.recordAgentExit('a0', 1, null, 'Error: 401 Unauthorized');
      daemon.recordAgentExit('a1', 1, null, 'Error: 401 Unauthorized');

      expect(daemon.isSpawningPaused).toBe(true);
    });
  });
});

// ── Client-Server Integration ───────────────────────────────────────

describe('DaemonClient ↔ DaemonProcess', () => {
  let tempDir: string;
  let daemon: DaemonProcess;
  let client: DaemonClient;

  beforeEach(async () => {
    tempDir = makeTempDir();
    daemon = new DaemonProcess({ socketDir: tempDir });
    await daemon.start();
  });

  afterEach(async () => {
    if (client) {
      try { client.dispose(); } catch { /* ignore */ }
    }
    if (daemon) {
      try { await daemon.stop(); } catch { /* ignore */ }
    }
  });

  async function createConnectedClient(): Promise<DaemonClient> {
    client = new DaemonClient({
      socketDir: tempDir,
      heartbeatIntervalMs: 60_000, // disable automatic heartbeat for tests
    });
    await client.connect(daemon.token);
    return client;
  }

  it('connects and authenticates successfully', async () => {
    client = await createConnectedClient();
    expect(client.isConnected).toBe(true);
    expect(daemon.hasClient).toBe(true);
  });

  it('rejects invalid token', async () => {
    client = new DaemonClient({
      socketDir: tempDir,
      maxAuthRetries: 0,
    });
    await expect(client.connect('wrong-token')).rejects.toThrow('Invalid token');
    expect(client.isConnected).toBe(false);
  });

  it('rejects second client connection', async () => {
    client = await createConnectedClient();

    const client2 = new DaemonClient({
      socketDir: tempDir,
      maxAuthRetries: 0,
    });
    await expect(client2.connect(daemon.token)).rejects.toThrow('Connection rejected');
    client2.dispose();
  });

  it('pings the daemon', async () => {
    client = await createConnectedClient();
    const result = await client.ping();
    expect(result.pong).toBe(true);
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it('lists agents via client', async () => {
    daemon.registerAgent(makeDescriptor({ agentId: 'a1' }));
    daemon.registerAgent(makeDescriptor({ agentId: 'a2' }));

    client = await createConnectedClient();
    const result = await client.listAgents();
    expect(result.agents).toHaveLength(2);
  });

  it('spawns an agent via client', async () => {
    client = await createConnectedClient();
    const result = await client.spawnAgent({
      agentId: 'new-agent',
      role: 'developer',
      model: 'sonnet',
      cliCommand: 'copilot',
    });

    expect(result.agentId).toBe('new-agent');
    expect(daemon.agentCount).toBe(1);
    expect(daemon.getAgent('new-agent')?.status).toBe('starting');
  });

  it('rejects duplicate spawn', async () => {
    daemon.registerAgent(makeDescriptor({ agentId: 'a1' }));
    client = await createConnectedClient();

    await expect(client.spawnAgent({
      agentId: 'a1',
      role: 'developer',
      model: 'sonnet',
      cliCommand: 'copilot',
    })).rejects.toThrow('already exists');
  });

  it('terminates an agent via client', async () => {
    daemon.registerAgent(makeDescriptor({ agentId: 'a1' }), {
      onTerminate: async () => {},
    });

    client = await createConnectedClient();
    const result = await client.terminateAgent('a1');
    expect(result.terminated).toBe(true);
  });

  it('sends a message to an agent', async () => {
    const messages: string[] = [];
    daemon.registerAgent(makeDescriptor({ agentId: 'a1' }), {
      onMessage: (msg) => messages.push(msg),
    });

    client = await createConnectedClient();
    const result = await client.sendMessage('a1', 'hello agent');
    expect(result.sent).toBe(true);
    expect(messages).toEqual(['hello agent']);
  });

  it('subscribes to events with buffer drain', async () => {
    daemon.registerAgent(makeDescriptor({ agentId: 'a1' }));

    client = await createConnectedClient();
    const result = await client.subscribe({ fromStart: true });
    expect(result.bufferedEvents).toBeDefined();
  });

  it('receives event notifications', async () => {
    client = await createConnectedClient();

    const events: unknown[] = [];
    client.on('event', (event) => events.push(event));

    // Register an agent (generates a spawned event)
    daemon.registerAgent(makeDescriptor({ agentId: 'a1' }));

    // Give the event time to arrive
    await new Promise(r => setTimeout(r, 50));

    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('handles shutdown request', async () => {
    client = await createConnectedClient();
    const result = await client.shutdown({ persist: false, timeoutMs: 1000 });
    expect(result.acknowledged).toBe(true);

    // Give shutdown time to complete
    await new Promise(r => setTimeout(r, 200));
  });

  it('detects client disconnect', async () => {
    client = await createConnectedClient();
    expect(daemon.hasClient).toBe(true);

    client.disconnect();

    // Give the daemon time to detect disconnect
    await new Promise(r => setTimeout(r, 100));
    expect(daemon.hasClient).toBe(false);
  });

  it('buffers events during disconnect and replays on reconnect', async () => {
    daemon.registerAgent(makeDescriptor({ agentId: 'a1' }));

    // Connect and disconnect
    client = await createConnectedClient();
    client.disconnect();
    await new Promise(r => setTimeout(r, 100));

    // Generate events while disconnected
    daemon.updateAgentStatus('a1', 'idle');
    daemon.updateAgentStatus('a1', 'running');

    // Reconnect and subscribe
    const client2 = new DaemonClient({
      socketDir: tempDir,
      heartbeatIntervalMs: 60_000,
    });
    await client2.connect(daemon.token);
    const result = await client2.subscribe({ agentId: 'a1' });

    expect(result.bufferedEvents.length).toBeGreaterThanOrEqual(2);
    client2.dispose();
    client = null as any; // prevent double dispose in afterEach
  });

  it('handles unknown method gracefully', async () => {
    client = await createConnectedClient();
    await expect(
      (client as any).request('nonexistent_method'),
    ).rejects.toThrow('Unknown method');
  });

  it('errors on requests when not connected', async () => {
    client = new DaemonClient({ socketDir: tempDir });
    await expect(client.ping()).rejects.toThrow('Not connected');
  });
});

// ── Shutdown Manifest ───────────────────────────────────────────────

describe('Shutdown manifest', () => {
  it('writes manifest on graceful shutdown with persist', async () => {
    const tempDir = makeTempDir();
    const daemon = new DaemonProcess({ socketDir: tempDir });
    await daemon.start();

    daemon.registerAgent(makeDescriptor({ agentId: 'a1' }));
    await daemon.stop({ persist: true });

    const manifest = DaemonProcess.readManifest(tempDir);
    expect(manifest).not.toBeNull();
    expect(manifest!.agents).toHaveLength(1);
    expect(manifest!.agents[0].agentId).toBe('a1');
    expect(manifest!.shutdownAt).toBeTruthy();
  });

  it('returns null when no manifest exists', () => {
    const tempDir = makeTempDir();
    expect(DaemonProcess.readManifest(tempDir)).toBeNull();
  });

  it('includes mode and reason in manifest', async () => {
    const tempDir = makeTempDir();
    const daemon = new DaemonProcess({ socketDir: tempDir, mode: 'development' });
    await daemon.start();
    daemon.registerAgent(makeDescriptor({ agentId: 'a1' }));
    await daemon.stop({ persist: true, reason: '12h-timeout' });

    const manifest = DaemonProcess.readManifest(tempDir);
    expect(manifest).not.toBeNull();
    expect(manifest!.mode).toBe('development');
    expect(manifest!.shutdownReason).toBe('12h-timeout');
  });

  it('always writes manifest on shutdown (not just persist)', async () => {
    const tempDir = makeTempDir();
    const daemon = new DaemonProcess({ socketDir: tempDir });
    await daemon.start();
    daemon.registerAgent(makeDescriptor({ agentId: 'a1' }));
    await daemon.stop({ persist: false, reason: 'manual' });

    const manifest = DaemonProcess.readManifest(tempDir);
    expect(manifest).not.toBeNull();
    expect(manifest!.shutdownReason).toBe('manual');
  });
});

// ── Lifecycle Modes ─────────────────────────────────────────────────

describe('Daemon lifecycle modes', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  describe('mode detection', () => {
    it('defaults to production mode', () => {
      const daemon = new DaemonProcess({ socketDir: tempDir });
      expect(daemon.mode).toBe('production');
    });

    it('accepts explicit mode option', () => {
      const daemon = new DaemonProcess({ socketDir: tempDir, mode: 'development' });
      expect(daemon.mode).toBe('development');
    });

    it('allows runtime mode switching', async () => {
      const daemon = new DaemonProcess({ socketDir: tempDir, mode: 'production' });
      await daemon.start();
      expect(daemon.mode).toBe('production');

      daemon.setMode('development');
      expect(daemon.mode).toBe('development');

      daemon.setMode('production');
      expect(daemon.mode).toBe('production');

      await daemon.stop();
    });

    it('rejects invalid mode strings at runtime', async () => {
      const daemon = new DaemonProcess({ socketDir: tempDir, mode: 'production' });
      await daemon.start();

      expect(() => daemon.setMode('foo' as any)).toThrow(/Invalid lifecycle mode.*foo/);
      expect(daemon.mode).toBe('production'); // unchanged

      await daemon.stop();
    });

    it('includes mode in auth result', async () => {
      const daemon = new DaemonProcess({ socketDir: tempDir, mode: 'development' });
      await daemon.start();

      const client = new DaemonClient({
        socketDir: tempDir,
        heartbeatIntervalMs: 60_000,
      });
      const result = await client.connect(daemon.token);
      expect(result.mode).toBe('development');

      client.dispose();
      await daemon.stop();
    });
  });

  describe('production mode', () => {
    it('auto-shuts down after client disconnect + grace period', async () => {
      const daemon = new DaemonProcess({
        socketDir: tempDir,
        mode: 'production',
        productionGracePeriodMs: 100,
      });
      await daemon.start();

      const client = new DaemonClient({
        socketDir: tempDir,
        heartbeatIntervalMs: 60_000,
      });
      await client.connect(daemon.token);
      client.disconnect();

      await new Promise(r => setTimeout(r, 300));

      // Daemon should have shut down — socket file cleaned up
      expect(existsSync(join(tempDir, 'agent-host.sock'))).toBe(false);
    });

    it('cancels production shutdown if client reconnects during grace', async () => {
      const daemon = new DaemonProcess({
        socketDir: tempDir,
        mode: 'production',
        productionGracePeriodMs: 500,
      });
      await daemon.start();

      const client1 = new DaemonClient({
        socketDir: tempDir,
        heartbeatIntervalMs: 60_000,
      });
      await client1.connect(daemon.token);
      client1.disconnect();

      await new Promise(r => setTimeout(r, 100));

      const client2 = new DaemonClient({
        socketDir: tempDir,
        heartbeatIntervalMs: 60_000,
      });
      await client2.connect(daemon.token);

      await new Promise(r => setTimeout(r, 500));

      // Daemon should still be running
      expect(daemon.hasClient).toBe(true);
      expect(existsSync(join(tempDir, 'agent-host.sock'))).toBe(true);

      client2.dispose();
      await daemon.stop();
    });

    it('writes manifest with production-disconnect reason', async () => {
      const daemon = new DaemonProcess({
        socketDir: tempDir,
        mode: 'production',
        productionGracePeriodMs: 50,
      });
      await daemon.start();
      daemon.registerAgent(makeDescriptor({ agentId: 'a1' }));

      const client = new DaemonClient({
        socketDir: tempDir,
        heartbeatIntervalMs: 60_000,
      });
      await client.connect(daemon.token);
      client.disconnect();

      await new Promise(r => setTimeout(r, 200));

      const manifest = DaemonProcess.readManifest(tempDir);
      expect(manifest).not.toBeNull();
      expect(manifest!.shutdownReason).toBe('production-disconnect');
      expect(manifest!.mode).toBe('production');
    });
  });

  describe('development mode', () => {
    it('enters orphaned mode on client disconnect (does NOT shutdown)', async () => {
      const daemon = new DaemonProcess({
        socketDir: tempDir,
        mode: 'development',
        orphanTimeoutMs: 60_000,
      });
      await daemon.start();
      daemon.registerAgent(makeDescriptor({ agentId: 'a1' }));

      const client = new DaemonClient({
        socketDir: tempDir,
        heartbeatIntervalMs: 60_000,
      });
      await client.connect(daemon.token);
      client.disconnect();

      await new Promise(r => setTimeout(r, 200));

      // Daemon should still be running, agents preserved
      expect(existsSync(join(tempDir, 'agent-host.sock'))).toBe(true);
      expect(daemon.agentCount).toBe(1);
      expect(daemon.hasClient).toBe(false);

      await daemon.stop();
    });

    it('shuts down after orphan timeout in dev mode', async () => {
      const daemon = new DaemonProcess({
        socketDir: tempDir,
        mode: 'development',
        orphanTimeoutMs: 150,
      });
      await daemon.start();
      daemon.registerAgent(makeDescriptor({ agentId: 'a1' }));

      const client = new DaemonClient({
        socketDir: tempDir,
        heartbeatIntervalMs: 60_000,
      });
      await client.connect(daemon.token);
      client.disconnect();

      await new Promise(r => setTimeout(r, 350));

      // Daemon should have auto-shutdown
      expect(existsSync(join(tempDir, 'agent-host.sock'))).toBe(false);

      const manifest = DaemonProcess.readManifest(tempDir);
      expect(manifest).not.toBeNull();
      expect(manifest!.shutdownReason).toBe('12h-timeout');
      expect(manifest!.agents).toHaveLength(1);
    });

    it('cancels orphan timeout on reconnect', async () => {
      const daemon = new DaemonProcess({
        socketDir: tempDir,
        mode: 'development',
        orphanTimeoutMs: 300,
      });
      await daemon.start();

      const client1 = new DaemonClient({
        socketDir: tempDir,
        heartbeatIntervalMs: 60_000,
      });
      await client1.connect(daemon.token);
      client1.disconnect();

      await new Promise(r => setTimeout(r, 100));
      const client2 = new DaemonClient({
        socketDir: tempDir,
        heartbeatIntervalMs: 60_000,
      });
      await client2.connect(daemon.token);

      await new Promise(r => setTimeout(r, 400));

      expect(existsSync(join(tempDir, 'agent-host.sock'))).toBe(true);

      client2.dispose();
      await daemon.stop();
    });

    it('fires orphan warnings at configured intervals', async () => {
      const daemon = new DaemonProcess({
        socketDir: tempDir,
        mode: 'development',
        orphanTimeoutMs: 1000,
        orphanWarningIntervalsMs: [100, 200],
      });
      await daemon.start();

      const client = new DaemonClient({
        socketDir: tempDir,
        heartbeatIntervalMs: 60_000,
      });
      await client.connect(daemon.token);
      client.disconnect();

      await new Promise(r => setTimeout(r, 350));

      // Daemon should still be running (warnings don't shut down)
      expect(existsSync(join(tempDir, 'agent-host.sock'))).toBe(true);

      await daemon.stop();
    });
  });

  describe('mode switching via configure', () => {
    it('switches mode via JSON-RPC configure command', async () => {
      const daemon = new DaemonProcess({ socketDir: tempDir, mode: 'production' });
      await daemon.start();

      const client = new DaemonClient({
        socketDir: tempDir,
        heartbeatIntervalMs: 60_000,
      });
      await client.connect(daemon.token);

      const result = await client.configure({ mode: 'development' } as any);
      expect(result.configured).toBe(true);
      expect(daemon.mode).toBe('development');

      client.dispose();
      await daemon.stop();
    });
  });
});
