import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { agentServerRoutes } from './agent-server.js';
import type { AppContext } from './context.js';
import type { AgentServerClient } from '../agents/AgentServerClient.js';
import type { AgentInfo } from '../transport/types.js';

// ── Helpers ─────────────────────────────────────────────────────────

function mockClient(overrides: Partial<AgentServerClient> = {}): AgentServerClient {
  return {
    isConnected: true,
    state: 'connected',
    pendingCount: 0,
    trackedAgentCount: 2,
    ping: vi.fn().mockResolvedValue(Date.now()),
    list: vi.fn().mockResolvedValue([]),
    terminate: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AgentServerClient;
}

function minimalCtx(overrides: Partial<AppContext> = {}): AppContext {
  return {
    agentManager: {} as any,
    roleRegistry: {} as any,
    config: {} as any,
    db: {} as any,
    lockRegistry: {} as any,
    activityLedger: {} as any,
    decisionLog: {} as any,
    ...overrides,
  } as AppContext;
}

const sampleAgents: AgentInfo[] = [
  { agentId: 'aaa-111', role: 'developer', model: 'fast', status: 'running', pid: 1234, task: 'implement feature', sessionId: 'sess-1', spawnedAt: '2026-01-01T00:00:00Z' },
  { agentId: 'bbb-222', role: 'reviewer', model: 'standard', status: 'idle', pid: 5678, spawnedAt: '2026-01-01T00:01:00Z' },
];

/** Spin up a test server with the agent-server routes */
function createTestServer(ctx: Partial<AppContext> = {}): { app: express.Express; start: () => Promise<string>; stop: () => Promise<void> } {
  const app = express();
  app.use(express.json());
  app.use(agentServerRoutes(minimalCtx(ctx)));

  let server: Server;
  return {
    app,
    start: () => new Promise<string>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    }),
    stop: () => new Promise<void>((resolve) => {
      server?.close(() => resolve());
    }),
  };
}

// ── GET /agent-server/status ────────────────────────────────────────

describe('GET /agent-server/status', () => {
  let baseUrl: string;
  let stop: () => Promise<void>;

  afterAll(async () => { await stop?.(); });

  it('returns not-running when no client', async () => {
    const srv = createTestServer();
    baseUrl = await srv.start();
    stop = srv.stop;

    const res = await fetch(`${baseUrl}/agent-server/status`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.running).toBe(false);
    expect(body.connected).toBe(false);
    expect(body.agentCount).toBe(0);

    await stop();
  });

  it('returns status with agent count and latency when connected', async () => {
    const client = mockClient({
      list: vi.fn().mockResolvedValue(sampleAgents),
    });
    const srv = createTestServer({ agentServerClient: client });
    baseUrl = await srv.start();
    stop = srv.stop;

    const res = await fetch(`${baseUrl}/agent-server/status`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.running).toBe(true);
    expect(body.connected).toBe(true);
    expect(body.agentCount).toBe(2);
    expect(typeof body.latencyMs).toBe('number');
    expect(body.state).toBe('connected');
    expect(body.trackedAgents).toBe(2);
    expect(client.ping).toHaveBeenCalled();
    expect(client.list).toHaveBeenCalled();

    await stop();
  });

  it('returns zero agent count when disconnected', async () => {
    const client = mockClient({ isConnected: false, state: 'disconnected' as any });
    const srv = createTestServer({ agentServerClient: client });
    baseUrl = await srv.start();
    stop = srv.stop;

    const res = await fetch(`${baseUrl}/agent-server/status`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.running).toBe(false);
    expect(body.agentCount).toBe(0);
    expect(body.latencyMs).toBeNull();

    await stop();
  });

  it('handles ping failure gracefully', async () => {
    const client = mockClient({
      ping: vi.fn().mockRejectedValue(new Error('timeout')),
      list: vi.fn().mockResolvedValue(sampleAgents),
    });
    const srv = createTestServer({ agentServerClient: client });
    baseUrl = await srv.start();
    stop = srv.stop;

    const res = await fetch(`${baseUrl}/agent-server/status`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.running).toBe(true);
    expect(body.latencyMs).toBeNull();
    expect(body.agentCount).toBe(2);

    await stop();
  });
});

// ── GET /agent-server/agents ────────────────────────────────────────

describe('GET /agent-server/agents', () => {
  it('returns empty array when no client', async () => {
    const srv = createTestServer();
    const baseUrl = await srv.start();

    const res = await fetch(`${baseUrl}/agent-server/agents`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);

    await srv.stop();
  });

  it('returns safe agent subset (no sessionId or pid)', async () => {
    const client = mockClient({
      list: vi.fn().mockResolvedValue(sampleAgents),
    });
    const srv = createTestServer({ agentServerClient: client });
    const baseUrl = await srv.start();

    const res = await fetch(`${baseUrl}/agent-server/agents`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual({
      agentId: 'aaa-111',
      role: 'developer',
      model: 'fast',
      status: 'running',
      task: 'implement feature',
      spawnedAt: '2026-01-01T00:00:00Z',
    });
    // sessionId and pid must NOT be present
    expect(body[0]).not.toHaveProperty('sessionId');
    expect(body[0]).not.toHaveProperty('pid');
    // Agent without task → null
    expect(body[1].task).toBeNull();

    await srv.stop();
  });

  it('returns empty array on list failure', async () => {
    const client = mockClient({
      list: vi.fn().mockRejectedValue(new Error('connection lost')),
    });
    const srv = createTestServer({ agentServerClient: client });
    const baseUrl = await srv.start();

    const res = await fetch(`${baseUrl}/agent-server/agents`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);

    await srv.stop();
  });
});

// ── POST /agent-server/stop ─────────────────────────────────────────

describe('POST /agent-server/stop', () => {
  it('returns 503 when no client', async () => {
    const srv = createTestServer();
    const baseUrl = await srv.start();

    const res = await fetch(`${baseUrl}/agent-server/stop`, { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toMatch(/not connected/);

    await srv.stop();
  });

  it('terminates running agents and disconnects', async () => {
    const client = mockClient({
      list: vi.fn().mockResolvedValue(sampleAgents),
      terminate: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    });
    const srv = createTestServer({ agentServerClient: client });
    const baseUrl = await srv.start();

    const res = await fetch(`${baseUrl}/agent-server/stop`, { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.acknowledged).toBe(true);
    // Only 'running' agent gets terminated (not 'idle')
    expect(body.terminatedCount).toBe(1);
    expect(client.terminate).toHaveBeenCalledWith('aaa-111', 'UI-triggered shutdown');
    expect(client.disconnect).toHaveBeenCalled();

    await srv.stop();
  });

  it('handles terminate error gracefully and still disconnects', async () => {
    const client = mockClient({
      list: vi.fn().mockResolvedValue(sampleAgents),
      terminate: vi.fn().mockRejectedValue(new Error('already gone')),
      disconnect: vi.fn().mockResolvedValue(undefined),
    });
    const srv = createTestServer({ agentServerClient: client });
    const baseUrl = await srv.start();

    const res = await fetch(`${baseUrl}/agent-server/stop`, { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(client.disconnect).toHaveBeenCalled();

    await srv.stop();
  });
});

// ── POST /agent-server/mode ─────────────────────────────────────────

describe('POST /agent-server/mode', () => {
  it('returns 501 not implemented', async () => {
    const client = mockClient();
    const srv = createTestServer({ agentServerClient: client });
    const baseUrl = await srv.start();

    const res = await fetch(`${baseUrl}/agent-server/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'development' }),
    });
    const body = await res.json();

    expect(res.status).toBe(501);
    expect(body.error).toMatch(/not available/);

    await srv.stop();
  });
});

// ── POST /agent-server/terminate/:agentId ───────────────────────────

describe('POST /agent-server/terminate/:agentId', () => {
  it('rejects invalid agentId format', async () => {
    const client = mockClient();
    const srv = createTestServer({ agentServerClient: client });
    const baseUrl = await srv.start();

    const res = await fetch(`${baseUrl}/agent-server/terminate/DROP%20TABLE%20agents`, { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/Invalid agentId/);

    await srv.stop();
  });

  it('returns 503 when no client', async () => {
    const srv = createTestServer();
    const baseUrl = await srv.start();

    const res = await fetch(`${baseUrl}/agent-server/terminate/aaa-111-222-333`, { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(503);

    await srv.stop();
  });

  it('terminates agent successfully', async () => {
    const client = mockClient({
      terminate: vi.fn().mockResolvedValue(undefined),
    });
    const srv = createTestServer({ agentServerClient: client });
    const baseUrl = await srv.start();

    const res = await fetch(`${baseUrl}/agent-server/terminate/aaa-111-222-333`, { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.terminated).toBe(true);
    expect(body.agentId).toBe('aaa-111-222-333');
    expect(client.terminate).toHaveBeenCalledWith('aaa-111-222-333', 'UI-triggered termination');

    await srv.stop();
  });

  it('returns 500 on terminate failure', async () => {
    const client = mockClient({
      terminate: vi.fn().mockRejectedValue(new Error('agent not found')),
    });
    const srv = createTestServer({ agentServerClient: client });
    const baseUrl = await srv.start();

    const res = await fetch(`${baseUrl}/agent-server/terminate/aaa-111-222-333`, { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('agent not found');

    await srv.stop();
  });
});
