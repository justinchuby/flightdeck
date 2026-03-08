/**
 * ForkTransport tests.
 *
 * Uses a real child_process.fork() with a mock agent server script
 * to test the full IPC lifecycle: fork, ready handshake, message routing,
 * disconnect, reconnect, and error handling.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ForkTransport } from '../ForkTransport.js';
import type { AgentServerMessage, TransportState } from '../types.js';

// ── Test Helpers ────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fork-transport-test-'));
  return dir;
}

/**
 * Write a mock agent server script that:
 * - Sends 'ready' on startup
 * - Echoes received messages back as AgentServerMessages
 * - Responds to ping with pong
 * - Exits on 'terminate' message
 */
function writeMockServer(dir: string, behavior: 'normal' | 'slow-start' | 'crash-on-start' | 'crash-after-ready' | 'no-ready' | 'echo'): string {
  const scriptPath = join(dir, 'mock-server.mjs');
  let code: string;

  switch (behavior) {
    case 'normal':
      code = `
process.send({ type: 'ready', pid: process.pid });
process.on('message', (msg) => {
  if (msg.type === 'ping') {
    process.send({ type: 'pong', requestId: msg.requestId, timestamp: Date.now() });
  } else if (msg.type === 'list_agents') {
    process.send({ type: 'agent_list', requestId: msg.requestId, agents: [] });
  } else if (msg.type === 'terminate_agent') {
    process.send({ type: 'agent_exited', agentId: msg.agentId, exitCode: 0 });
  }
});
`;
      break;

    case 'echo':
      code = `
process.send({ type: 'ready', pid: process.pid });
process.on('message', (msg) => {
  if (msg.type === 'ping') {
    process.send({ type: 'pong', requestId: msg.requestId, timestamp: Date.now() });
  } else if (msg.type === 'spawn_agent') {
    process.send({
      type: 'agent_spawned',
      requestId: msg.requestId,
      agentId: 'test-agent-1',
      role: msg.role,
      model: msg.model,
      pid: process.pid,
    });
  }
});
`;
      break;

    case 'slow-start':
      code = `
setTimeout(() => {
  process.send({ type: 'ready', pid: process.pid });
}, 500);
process.on('message', () => {});
`;
      break;

    case 'crash-on-start':
      code = `
process.exit(1);
`;
      break;

    case 'crash-after-ready':
      code = `
process.send({ type: 'ready', pid: process.pid });
setTimeout(() => { process.exit(1); }, 100);
`;
      break;

    case 'no-ready':
      code = `
// Never sends ready message, just stays alive
setInterval(() => {}, 60000);
`;
      break;
  }

  writeFileSync(scriptPath, code, { mode: 0o755 });
  return scriptPath;
}

// ── Tests ───────────────────────────────────────────────────────────

describe('ForkTransport', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(async () => {
    // Clean up any leftover processes
  });

  describe('constructor', () => {
    it('initializes in disconnected state', () => {
      const scriptPath = writeMockServer(tempDir, 'normal');
      const transport = new ForkTransport({ serverScript: scriptPath, stateDir: tempDir });
      expect(transport.state).toBe('disconnected');
      expect(transport.serverPid).toBeNull();
      expect(transport.supportsReconnect).toBe(true);
    });

    it('respects autoReconnect=false', () => {
      const scriptPath = writeMockServer(tempDir, 'normal');
      const transport = new ForkTransport({ serverScript: scriptPath, stateDir: tempDir, autoReconnect: false });
      expect(transport.supportsReconnect).toBe(false);
    });
  });

  describe('connect', () => {
    it('forks a new server and transitions to connected', async () => {
      const scriptPath = writeMockServer(tempDir, 'normal');
      const transport = new ForkTransport({ serverScript: scriptPath, stateDir: tempDir });
      const states: TransportState[] = [];
      transport.onStateChange(s => states.push(s));

      await transport.connect();

      expect(transport.state).toBe('connected');
      expect(transport.serverPid).toBeGreaterThan(0);
      expect(states).toContain('connecting');
      expect(states).toContain('connected');

      transport.dispose();
    });

    it('writes PID file on successful connect', async () => {
      const scriptPath = writeMockServer(tempDir, 'normal');
      const transport = new ForkTransport({ serverScript: scriptPath, stateDir: tempDir });

      await transport.connect();

      expect(existsSync(transport.pidFile)).toBe(true);
      const pidContent = readFileSync(transport.pidFile, 'utf-8').trim();
      expect(parseInt(pidContent, 10)).toBe(transport.serverPid);

      transport.dispose();
    });

    it('waits for slow-starting server', async () => {
      const scriptPath = writeMockServer(tempDir, 'slow-start');
      const transport = new ForkTransport({
        serverScript: scriptPath,
        stateDir: tempDir,
        readyTimeoutMs: 5000,
      });

      await transport.connect();
      expect(transport.state).toBe('connected');

      transport.dispose();
    });

    it('rejects if server exits during startup', async () => {
      const scriptPath = writeMockServer(tempDir, 'crash-on-start');
      const transport = new ForkTransport({ serverScript: scriptPath, stateDir: tempDir });

      await expect(transport.connect()).rejects.toThrow(/exited during startup/);
      expect(transport.state).toBe('disconnected');
    });

    it('rejects if server does not send ready in time', async () => {
      const scriptPath = writeMockServer(tempDir, 'no-ready');
      const transport = new ForkTransport({
        serverScript: scriptPath,
        stateDir: tempDir,
        readyTimeoutMs: 200,
      });

      await expect(transport.connect()).rejects.toThrow(/did not send ready/);
      expect(transport.state).toBe('disconnected');
    });

    it('rejects if already connected', async () => {
      const scriptPath = writeMockServer(tempDir, 'normal');
      const transport = new ForkTransport({ serverScript: scriptPath, stateDir: tempDir });

      await transport.connect();
      await expect(transport.connect()).rejects.toThrow(/Already connected/);

      transport.dispose();
    });

    it('rejects if disposed', async () => {
      const scriptPath = writeMockServer(tempDir, 'normal');
      const transport = new ForkTransport({ serverScript: scriptPath, stateDir: tempDir });

      transport.dispose();
      await expect(transport.connect()).rejects.toThrow(/disposed/);
    });
  });

  describe('send and receive', () => {
    it('sends messages to agent server via IPC', async () => {
      const scriptPath = writeMockServer(tempDir, 'normal');
      const transport = new ForkTransport({ serverScript: scriptPath, stateDir: tempDir });
      await transport.connect();

      const received: AgentServerMessage[] = [];
      transport.onMessage(msg => received.push(msg));

      transport.send({
        type: 'ping',
        requestId: 'test-1',
      });

      // Wait for IPC round-trip
      await new Promise(r => setTimeout(r, 100));

      expect(received.length).toBe(1);
      expect(received[0].type).toBe('pong');
      expect((received[0] as any).requestId).toBe('test-1');

      transport.dispose();
    });

    it('receives agent_spawned response', async () => {
      const scriptPath = writeMockServer(tempDir, 'echo');
      const transport = new ForkTransport({ serverScript: scriptPath, stateDir: tempDir });
      await transport.connect();

      const received: AgentServerMessage[] = [];
      transport.onMessage(msg => received.push(msg));

      transport.send({
        type: 'spawn_agent',
        requestId: 'spawn-1',
        scope: { projectId: 'p1', teamId: 't1' },
        role: 'developer',
        model: 'claude-sonnet',
      });

      await new Promise(r => setTimeout(r, 100));

      expect(received.length).toBe(1);
      expect(received[0].type).toBe('agent_spawned');
      expect((received[0] as any).role).toBe('developer');

      transport.dispose();
    });

    it('throws when sending in disconnected state', () => {
      const scriptPath = writeMockServer(tempDir, 'normal');
      const transport = new ForkTransport({ serverScript: scriptPath, stateDir: tempDir });

      expect(() => transport.send({ type: 'ping', requestId: 'x' })).toThrow(/Cannot send/);
    });

    it('supports multiple message handlers', async () => {
      const scriptPath = writeMockServer(tempDir, 'normal');
      const transport = new ForkTransport({ serverScript: scriptPath, stateDir: tempDir });
      await transport.connect();

      const received1: AgentServerMessage[] = [];
      const received2: AgentServerMessage[] = [];
      transport.onMessage(msg => received1.push(msg));
      transport.onMessage(msg => received2.push(msg));

      transport.send({ type: 'ping', requestId: 'multi-1' });
      await new Promise(r => setTimeout(r, 100));

      expect(received1.length).toBe(1);
      expect(received2.length).toBe(1);

      transport.dispose();
    });

    it('unsubscribe removes handler', async () => {
      const scriptPath = writeMockServer(tempDir, 'normal');
      const transport = new ForkTransport({ serverScript: scriptPath, stateDir: tempDir });
      await transport.connect();

      const received: AgentServerMessage[] = [];
      const unsub = transport.onMessage(msg => received.push(msg));

      transport.send({ type: 'ping', requestId: 'unsub-1' });
      await new Promise(r => setTimeout(r, 100));
      expect(received.length).toBe(1);

      unsub();

      transport.send({ type: 'ping', requestId: 'unsub-2' });
      await new Promise(r => setTimeout(r, 100));
      expect(received.length).toBe(1); // no new messages

      transport.dispose();
    });
  });

  describe('disconnect', () => {
    it('transitions to disconnected state', async () => {
      const scriptPath = writeMockServer(tempDir, 'normal');
      const transport = new ForkTransport({ serverScript: scriptPath, stateDir: tempDir });
      await transport.connect();

      await transport.disconnect();
      expect(transport.state).toBe('disconnected');
      expect(transport.serverPid).toBeNull();
    });

    it('is safe to call when already disconnected', async () => {
      const scriptPath = writeMockServer(tempDir, 'normal');
      const transport = new ForkTransport({ serverScript: scriptPath, stateDir: tempDir });

      await transport.disconnect(); // no-op
      expect(transport.state).toBe('disconnected');
    });
  });

  describe('state change events', () => {
    it('emits state changes through full lifecycle', async () => {
      const scriptPath = writeMockServer(tempDir, 'normal');
      const transport = new ForkTransport({ serverScript: scriptPath, stateDir: tempDir });
      const states: TransportState[] = [];
      transport.onStateChange(s => states.push(s));

      await transport.connect();
      await transport.disconnect();

      expect(states).toEqual(['connecting', 'connected', 'disconnected']);
    });

    it('unsubscribe stops notifications', async () => {
      const scriptPath = writeMockServer(tempDir, 'normal');
      const transport = new ForkTransport({ serverScript: scriptPath, stateDir: tempDir });
      const states: TransportState[] = [];
      const unsub = transport.onStateChange(s => states.push(s));

      await transport.connect();
      unsub();
      await transport.disconnect();

      // Only got connecting + connected, not disconnected
      expect(states).toEqual(['connecting', 'connected']);
    });
  });

  describe('server crash and reconnect', () => {
    it('detects server exit and transitions to reconnecting', async () => {
      const scriptPath = writeMockServer(tempDir, 'crash-after-ready');
      const transport = new ForkTransport({
        serverScript: scriptPath,
        stateDir: tempDir,
        autoReconnect: true,
        reconnectDelayMs: 50,
        maxReconnectAttempts: 1,
      });

      const states: TransportState[] = [];
      transport.onStateChange(s => states.push(s));

      await transport.connect();

      // Wait for crash + reconnect attempt
      await new Promise(r => setTimeout(r, 500));

      expect(states).toContain('reconnecting');

      transport.dispose();
    });

    it('goes to disconnected when autoReconnect is false', async () => {
      const scriptPath = writeMockServer(tempDir, 'crash-after-ready');
      const transport = new ForkTransport({
        serverScript: scriptPath,
        stateDir: tempDir,
        autoReconnect: false,
      });

      const states: TransportState[] = [];
      transport.onStateChange(s => states.push(s));

      await transport.connect();
      await new Promise(r => setTimeout(r, 300));

      expect(transport.state).toBe('disconnected');
      expect(states).not.toContain('reconnecting');

      transport.dispose();
    });

    it('gives up after maxReconnectAttempts', async () => {
      // Script that always crashes after ready
      const scriptPath = writeMockServer(tempDir, 'crash-after-ready');
      const transport = new ForkTransport({
        serverScript: scriptPath,
        stateDir: tempDir,
        autoReconnect: true,
        reconnectDelayMs: 50,
        maxReconnectAttempts: 2,
      });

      await transport.connect();

      // Wait for crash + reconnect attempts to exhaust
      // Each cycle: ~100ms crash + 50ms delay + fork overhead
      await new Promise(r => setTimeout(r, 4000));

      expect(transport.state).toBe('disconnected');

      transport.dispose();
    }, 10_000);
  });

  describe('PID file', () => {
    it('reconnects to existing server via PID file', async () => {
      const scriptPath = writeMockServer(tempDir, 'normal');

      // First connection — forks and writes PID file
      const transport1 = new ForkTransport({ serverScript: scriptPath, stateDir: tempDir });
      await transport1.connect();
      const pid1 = transport1.serverPid;
      expect(pid1).toBeGreaterThan(0);

      // Disconnect (child keeps running detached)
      await transport1.disconnect();

      // Second connection — should detect PID file
      const transport2 = new ForkTransport({
        serverScript: scriptPath,
        stateDir: tempDir,
        reconnectTimeoutMs: 3000,
      });

      await transport2.connect();
      expect(transport2.state).toBe('connected');

      transport2.dispose();
    });

    it('cleans up PID file on server exit', async () => {
      const scriptPath = writeMockServer(tempDir, 'crash-after-ready');
      const transport = new ForkTransport({
        serverScript: scriptPath,
        stateDir: tempDir,
        autoReconnect: false,
      });

      await transport.connect();
      expect(existsSync(transport.pidFile)).toBe(true);

      // Wait for crash
      await new Promise(r => setTimeout(r, 300));

      expect(existsSync(transport.pidFile)).toBe(false);

      transport.dispose();
    });

    it('ignores stale PID file pointing to dead process', async () => {
      const scriptPath = writeMockServer(tempDir, 'normal');

      // Write a stale PID file with a dead PID
      const stateDir = tempDir;
      const pidPath = join(stateDir, 'agent-server.pid');
      writeFileSync(pidPath, '99999999'); // very unlikely to be alive

      const transport = new ForkTransport({ serverScript: scriptPath, stateDir });
      await transport.connect();

      // Should have forked a new server, not tried reconnecting to dead PID
      expect(transport.state).toBe('connected');
      expect(transport.serverPid).toBeGreaterThan(0);
      expect(transport.serverPid).not.toBe(99999999);

      transport.dispose();
    });
  });

  describe('dispose', () => {
    it('prevents further operations', async () => {
      const scriptPath = writeMockServer(tempDir, 'normal');
      const transport = new ForkTransport({ serverScript: scriptPath, stateDir: tempDir });
      await transport.connect();

      transport.dispose();

      expect(transport.state).toBe('disconnected');
      await expect(transport.connect()).rejects.toThrow(/disposed/);
    });

    it('cleans up handlers', async () => {
      const scriptPath = writeMockServer(tempDir, 'normal');
      const transport = new ForkTransport({ serverScript: scriptPath, stateDir: tempDir });

      const states: TransportState[] = [];
      transport.onStateChange(s => states.push(s));

      transport.dispose();

      // No state changes should fire after dispose
      expect(states.length).toBe(0);
    });

    it('is safe to call multiple times', () => {
      const scriptPath = writeMockServer(tempDir, 'normal');
      const transport = new ForkTransport({ serverScript: scriptPath, stateDir: tempDir });

      transport.dispose();
      transport.dispose(); // no-op, no error
      expect(transport.state).toBe('disconnected');
    });
  });
});
