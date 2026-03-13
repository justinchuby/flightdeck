import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { apiRouter } from '../api.js';
import { getDefaultConfig } from '../config/configSchema.js';
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks (must be before any import that transitively loads them)
// ---------------------------------------------------------------------------

vi.mock('../agents/agentFiles.js', () => ({
  writeAgentFiles: vi.fn(),
  agentFlagForRole: vi.fn(),
}));

vi.mock('../config.js', () => ({
  updateConfig: vi.fn((patch: any) => ({
    port: 3000,
    host: 'localhost',
    maxConcurrentAgents: patch.maxConcurrentAgents ?? 10,
    workingDirectory: '/tmp',
    parallelSessions: 10,
  })),
  getConfig: vi.fn(() => ({
    port: 3000,
    host: 'localhost',
    maxConcurrentAgents: 10,
    workingDirectory: '/tmp',
    parallelSessions: 10,
  })),
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockAgent(overrides: Record<string, any> = {}) {
  const base = {
    id: 'agent-123',
    role: { id: 'developer', name: 'Developer', model: 'claude-3-5-sonnet' },
    status: 'idle' as string,
    parentId: null as string | null,
    plan: null,
    model: 'claude-3-5-sonnet',
    task: 'test task',
    projectName: 'Test Project',
    cwd: '/tmp/test',
    inputTokens: 100,
    outputTokens: 50,
    contextWindowSize: 200000,
    contextWindowUsed: 1000,
    lastHumanMessageAt: null as Date | null,
    lastHumanMessageText: null as string | null,
    humanMessageResponded: false,
    pendingMessageCount: 0,
    sendMessage: vi.fn(),
    queueMessage: vi.fn(),
    write: vi.fn(),
    interrupt: vi.fn().mockResolvedValue(undefined),
    interruptWithMessage: vi.fn().mockResolvedValue(undefined),
    toJSON: vi.fn().mockReturnValue({ id: 'agent-123', role: 'developer', status: 'idle' }),
  };
  return { ...base, ...overrides };
}

function createLeadAgent(overrides: Record<string, any> = {}) {
  return createMockAgent({
    id: 'lead-001',
    role: { id: 'lead', name: 'Project Lead', model: 'claude-3-5-sonnet' },
    parentId: null,
    toJSON: vi.fn().mockReturnValue({ id: 'lead-001', role: 'lead', status: 'idle' }),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let server: Server;
let baseUrl: string;

// Mocks
const mockChatGroupRegistry = {
  getGroups: vi.fn().mockReturnValue([]),
  getMessages: vi.fn().mockReturnValue([]),
};

const mockTaskDAG = {
  getStatus: vi.fn().mockReturnValue({ tasks: [], edges: [] }),
};

const mockDecisionLog = {
  getAll: vi.fn().mockReturnValue([]),
  getNeedingConfirmation: vi.fn().mockReturnValue([]),
  confirm: vi.fn().mockReturnValue(null),
  reject: vi.fn().mockReturnValue(null),
  getByLeadId: vi.fn().mockReturnValue([]),
};

const mockAgentManager = {
  getAll: vi.fn().mockReturnValue([]),
  getByProject: vi.fn().mockReturnValue([]),
  get: vi.fn().mockReturnValue(undefined),
  getProjectIdForAgent: vi.fn().mockReturnValue(undefined),
  spawn: vi.fn(),
  terminate: vi.fn().mockReturnValue(true),
  restart: vi.fn().mockReturnValue(null),
  resolvePermission: vi.fn().mockReturnValue(true),
  setMaxConcurrent: vi.fn(),
  getDecisionLog: vi.fn().mockReturnValue(mockDecisionLog),
  getChatGroupRegistry: vi.fn().mockReturnValue(mockChatGroupRegistry),
  getDelegations: vi.fn().mockReturnValue([]),
  getTaskDAG: vi.fn().mockReturnValue(mockTaskDAG),
  markHumanInterrupt: vi.fn(), haltHeartbeat: vi.fn(), resumeHeartbeat: vi.fn(),
  persistHumanMessage: vi.fn(),
  consumePendingSystemAction: vi.fn().mockReturnValue(undefined),
  autoSpawnSecretary: vi.fn().mockReturnValue(null),
};

const mockRole = { id: 'developer', name: 'Developer', description: '', systemPrompt: '', color: '#888', icon: '🤖', model: 'claude-3-5-sonnet' };
const mockRoleRegistry = {
  get: vi.fn().mockReturnValue(mockRole),
  getAll: vi.fn().mockReturnValue([mockRole]),
  register: vi.fn((role: any) => role),
  remove: vi.fn().mockReturnValue(true),
};

const mockConfig = {
  port: 0,
  host: 'localhost',
  maxConcurrentAgents: 10,
  workingDirectory: '/tmp/test',
  parallelSessions: 10,
} as any;

const mockConfigStore = {
  writePartial: vi.fn().mockResolvedValue(undefined),
  current: getDefaultConfig(),
} as any;

const mockDrizzleChain = {
  get: vi.fn().mockReturnValue(null),
  all: vi.fn().mockReturnValue([]),
};
const mockDb = {
  drizzle: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(mockDrizzleChain),
        groupBy: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }),
      }),
    }),
  },
  setSetting: vi.fn(),
} as any;

const mockLockRegistry = {
  getAll: vi.fn().mockReturnValue([]),
  acquire: vi.fn().mockReturnValue({ ok: true }),
  release: vi.fn().mockReturnValue(true),
};

const mockActivityLedger = {
  getRecent: vi.fn().mockReturnValue([]),
  getByAgent: vi.fn().mockReturnValue([]),
  getByType: vi.fn().mockReturnValue([]),
  getSince: vi.fn().mockReturnValue([]),
  getSummary: vi.fn().mockReturnValue({}),
};

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const app = express();
  app.use(express.json());

  const router = apiRouter({
    agentManager: mockAgentManager,
    roleRegistry: mockRoleRegistry,
    config: mockConfig,
    configStore: mockConfigStore,
    db: mockDb,
    lockRegistry: mockLockRegistry,
    activityLedger: mockActivityLedger,
    decisionLog: mockDecisionLog,
  } as any);
  app.use('/api', router);

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  vi.clearAllMocks();

  // Reset default return values after clearAllMocks wipes them
  mockAgentManager.getAll.mockReturnValue([]);
  mockAgentManager.get.mockReturnValue(undefined);
  mockAgentManager.terminate.mockReturnValue(true);
  mockAgentManager.restart.mockReturnValue(null);
  mockAgentManager.resolvePermission.mockReturnValue(true);
  mockAgentManager.getDecisionLog.mockReturnValue(mockDecisionLog);
  mockAgentManager.getChatGroupRegistry.mockReturnValue(mockChatGroupRegistry);
  mockAgentManager.getDelegations.mockReturnValue([]);
  mockAgentManager.getTaskDAG.mockReturnValue(mockTaskDAG);
  mockAgentManager.autoSpawnSecretary.mockReturnValue(null);

  mockRoleRegistry.get.mockReturnValue(mockRole);
  mockRoleRegistry.getAll.mockReturnValue([mockRole]);
  mockRoleRegistry.register.mockImplementation((role: any) => role);
  mockRoleRegistry.remove.mockReturnValue(true);

  mockLockRegistry.getAll.mockReturnValue([]);
  mockLockRegistry.acquire.mockReturnValue({ ok: true });
  mockLockRegistry.release.mockReturnValue(true);

  mockActivityLedger.getRecent.mockReturnValue([]);
  mockActivityLedger.getByAgent.mockReturnValue([]);
  mockActivityLedger.getByType.mockReturnValue([]);
  mockActivityLedger.getSince.mockReturnValue([]);
  mockActivityLedger.getSummary.mockReturnValue({});

  mockDecisionLog.getAll.mockReturnValue([]);
  mockDecisionLog.getNeedingConfirmation.mockReturnValue([]);
  mockDecisionLog.confirm.mockReturnValue(null);
  mockDecisionLog.reject.mockReturnValue(null);
  mockDecisionLog.getByLeadId.mockReturnValue([]);

  mockChatGroupRegistry.getGroups.mockReturnValue([]);
  mockChatGroupRegistry.getMessages.mockReturnValue([]);

  mockTaskDAG.getStatus.mockReturnValue({ tasks: [], edges: [] });

  mockDrizzleChain.get.mockReturnValue(null);
  mockDb.drizzle.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue(mockDrizzleChain),
    }),
  });
});

// ---------------------------------------------------------------------------
// Convenience fetch helpers
// ---------------------------------------------------------------------------

function get(path: string) {
  return fetch(`${baseUrl}${path}`);
}

function post(path: string, body?: any) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function patch(path: string, body: any) {
  return fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function del(path: string) {
  return fetch(`${baseUrl}${path}`, { method: 'DELETE' });
}

// ===========================================================================
// Tests
// ===========================================================================

// ── Agents ────────────────────────────────────────────────────────────

describe('Agents', () => {
  it('GET /api/agents returns list of agents', async () => {
    const agent = createMockAgent();
    mockAgentManager.getAll.mockReturnValue([agent]);

    const res = await get('/api/agents');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([{ id: 'agent-123', role: 'developer', status: 'idle' }]);
    expect(agent.toJSON).toHaveBeenCalled();
  });

  it('POST /api/agents with valid role spawns agent (201)', async () => {
    const agent = createMockAgent();
    mockAgentManager.spawn.mockReturnValue(agent);

    const res = await post('/api/agents', { roleId: 'developer', task: 'build feature' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ id: 'agent-123', role: 'developer', status: 'idle' });
    expect(mockAgentManager.spawn).toHaveBeenCalledWith(
      mockRole,
      'build feature',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it('POST /api/agents with unknown role returns 400', async () => {
    mockRoleRegistry.get.mockReturnValue(undefined);

    const res = await post('/api/agents', { roleId: 'nonexistent', task: 'anything' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Unknown role/);
  });

  it('POST /api/agents with missing roleId fails validation (400)', async () => {
    const res = await post('/api/agents', { task: 'some task' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation error');
  });

  it('DELETE /api/agents/:id terminates agent', async () => {
    mockAgentManager.terminate.mockReturnValue(true);

    const res = await del('/api/agents/agent-123');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(mockAgentManager.terminate).toHaveBeenCalledWith('agent-123');
  });

  it('POST /api/agents/:id/message queues message (default mode)', async () => {
    const agent = createMockAgent();
    mockAgentManager.get.mockReturnValue(agent);

    const res = await post('/api/agents/agent-123/message', { text: 'hello agent' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe('queue');
    expect(agent.queueMessage).toHaveBeenCalled();
  });

  it('POST /api/agents/:id/message with mode=interrupt interrupts', async () => {
    const agent = createMockAgent();
    mockAgentManager.get.mockReturnValue(agent);

    const res = await post('/api/agents/agent-123/message', { text: 'stop now', mode: 'interrupt' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe('interrupt');
    expect(agent.interruptWithMessage).toHaveBeenCalled();
  });

  it('POST /api/agents/:id/message returns 404 for unknown agent', async () => {
    mockAgentManager.get.mockReturnValue(undefined);

    const res = await post('/api/agents/no-such-id/message', { text: 'hello' });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Agent not found');
  });

  it('PATCH /api/agents/:id updates model', async () => {
    const agent = createMockAgent();
    mockAgentManager.get.mockReturnValue(agent);

    const res = await patch('/api/agents/agent-123', { model: 'gpt-4o' });
    expect(res.status).toBe(200);
    expect(agent.model).toBe('gpt-4o');
    expect(agent.toJSON).toHaveBeenCalled();
  });
});

// ── Roles ─────────────────────────────────────────────────────────────

describe('Roles', () => {
  it('GET /api/roles returns all roles', async () => {
    const res = await get('/api/roles');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([mockRole]);
  });

  it('POST /api/roles registers new role (201)', async () => {
    const newRole = { id: 'tester', name: 'Tester' };
    mockRoleRegistry.register.mockReturnValue({ ...newRole, description: '', systemPrompt: '', color: '#888', icon: '🤖' });

    const res = await post('/api/roles', newRole);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe('tester');
    expect(mockRoleRegistry.register).toHaveBeenCalled();
  });

  it('DELETE /api/roles/:id removes role', async () => {
    const res = await del('/api/roles/developer');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(mockRoleRegistry.remove).toHaveBeenCalledWith('developer');
  });
});

// ── Config ────────────────────────────────────────────────────────────

describe('Config', () => {
  it('GET /api/config returns config', async () => {
    const res = await get('/api/config');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('maxConcurrentAgents', 10);
  });

  it('PATCH /api/config updates maxConcurrentAgents', async () => {
    const res = await patch('/api/config', { maxConcurrentAgents: 5 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.maxConcurrentAgents).toBe(5);
    expect(mockAgentManager.setMaxConcurrent).toHaveBeenCalledWith(5);
    expect(mockConfigStore.writePartial).toHaveBeenCalledWith({ server: { maxConcurrentAgents: 5 } });
  });
});

// ── Coordination ──────────────────────────────────────────────────────

describe('Coordination', () => {
  it('GET /api/coordination/status returns combined status', async () => {
    const res = await get('/api/coordination/status');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('agents');
    expect(body).toHaveProperty('locks');
    expect(body).toHaveProperty('recentActivity');
  });

  it('GET /api/coordination/locks returns locks', async () => {
    mockLockRegistry.getAll.mockReturnValue([{ filePath: 'src/a.ts', agentId: 'agent-1' }]);

    const res = await get('/api/coordination/locks');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([{ filePath: 'src/a.ts', agentId: 'agent-1' }]);
  });

  it('POST /api/coordination/locks acquires lock (201)', async () => {
    mockLockRegistry.acquire.mockReturnValue({ ok: true });
    mockAgentManager.get.mockReturnValue(createMockAgent());

    const res = await post('/api/coordination/locks', {
      agentId: 'agent-123',
      filePath: 'src/index.ts',
      reason: 'editing',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('POST /api/coordination/locks returns 409 when conflict', async () => {
    mockLockRegistry.acquire.mockReturnValue({ ok: false, holder: 'agent-other' });
    mockAgentManager.get.mockReturnValue(createMockAgent());

    const res = await post('/api/coordination/locks', {
      agentId: 'agent-123',
      filePath: 'src/index.ts',
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.holder).toBe('agent-other');
  });

  it('GET /api/coordination/activity returns recent activity', async () => {
    mockActivityLedger.getRecent.mockReturnValue([{ type: 'spawn', agentId: 'a1' }]);

    const res = await get('/api/coordination/activity');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([{ type: 'spawn', agentId: 'a1' }]);
  });
});

// ── Lead ──────────────────────────────────────────────────────────────

describe('Lead', () => {
  it('GET /api/lead returns lead agents', async () => {
    const lead = createLeadAgent();
    mockAgentManager.getAll.mockReturnValue([lead]);

    const res = await get('/api/lead');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([{ id: 'lead-001', role: 'lead', status: 'idle' }]);
  });

  it('GET /api/lead/:id returns specific lead', async () => {
    const lead = createLeadAgent();
    mockAgentManager.get.mockReturnValue(lead);

    const res = await get('/api/lead/lead-001');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: 'lead-001', role: 'lead', status: 'idle' });
  });

  it('GET /api/lead/:id/decisions returns decisions for lead', async () => {
    const lead = createLeadAgent();
    mockAgentManager.getAll.mockReturnValue([lead]);
    mockDecisionLog.getByLeadId.mockReturnValue([
      { id: 'dec-1', agentId: 'lead-001', agentRole: 'lead', title: 'Use React' },
    ]);

    const res = await get('/api/lead/lead-001/decisions');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].title).toBe('Use React');
  });

  it('GET /api/lead/:id/progress returns progress snapshot', async () => {
    const lead = createLeadAgent();
    mockAgentManager.get.mockReturnValue(lead);
    mockAgentManager.getAll.mockReturnValue([lead]);
    mockAgentManager.getDelegations.mockReturnValue([]);

    const res = await get('/api/lead/lead-001/progress');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('totalDelegations', 0);
    expect(body).toHaveProperty('completionPct', 0);
    expect(body).toHaveProperty('teamSize', 0);
    expect(body).toHaveProperty('leadTokens');
  });

  it('PATCH /api/lead/:id updates projectName', async () => {
    const lead = createLeadAgent();
    mockAgentManager.get.mockReturnValue(lead);

    const res = await patch('/api/lead/lead-001', { projectName: 'New Name' });
    expect(res.status).toBe(200);
    expect(lead.projectName).toBe('New Name');
  });
});

// ── Decisions ─────────────────────────────────────────────────────────

describe('Decisions', () => {
  it('GET /api/decisions returns all decisions', async () => {
    mockDecisionLog.getAll.mockReturnValue([{ id: 'dec-1', title: 'Test' }]);

    const res = await get('/api/decisions');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([{ id: 'dec-1', title: 'Test' }]);
  });

  it('GET /api/decisions?needs_confirmation=true filters pending', async () => {
    mockDecisionLog.getNeedingConfirmation.mockReturnValue([{ id: 'dec-2', needsConfirmation: true }]);

    const res = await get('/api/decisions?needs_confirmation=true');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([{ id: 'dec-2', needsConfirmation: true }]);
    expect(mockDecisionLog.getNeedingConfirmation).toHaveBeenCalled();
  });

  it('POST /api/decisions/:id/confirm confirms decision', async () => {
    const decision = { id: 'dec-1', status: 'confirmed', title: 'Use Postgres' };
    mockDecisionLog.confirm.mockReturnValue(decision);

    const res = await post('/api/decisions/dec-1/confirm');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('confirmed');
    expect(mockDecisionLog.confirm).toHaveBeenCalledWith('dec-1');
  });

  it('POST /api/decisions/:id/reject rejects decision', async () => {
    const decision = { id: 'dec-1', status: 'rejected', title: 'Use Postgres' };
    mockDecisionLog.reject.mockReturnValue(decision);

    const res = await post('/api/decisions/dec-1/reject');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('rejected');
    expect(mockDecisionLog.reject).toHaveBeenCalledWith('dec-1');
  });

  it('POST /api/decisions/:id/respond confirms + sends feedback to agent', async () => {
    const agent = createMockAgent({ status: 'running' });
    const decision = { id: 'dec-1', status: 'confirmed', title: 'Use Postgres', agentId: 'agent-123' };
    mockDecisionLog.confirm.mockReturnValue(decision);
    mockAgentManager.get.mockReturnValue(agent);

    const res = await post('/api/decisions/dec-1/respond', { message: 'Good call!' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('confirmed');
    expect(mockDecisionLog.confirm).toHaveBeenCalledWith('dec-1');
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Good call!'),
    );
  });

  it('POST /api/decisions/:id/respond without message returns 400', async () => {
    const res = await post('/api/decisions/dec-1/respond', {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/message required/);
  });
});

// ---------------------------------------------------------------------------
// Filesystem Browse — Security Tests
// ---------------------------------------------------------------------------

describe('GET /api/browse — security', () => {
  it('returns folders for cwd (default)', async () => {
    const res = await fetch(`${baseUrl}/api/browse`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.current).toBeTruthy();
    expect(Array.isArray(body.folders)).toBe(true);
  });

  it('rejects null byte injection', async () => {
    const res = await fetch(`${baseUrl}/api/browse?path=/tmp%00/etc`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid path/i);
  });

  it('rejects access to /etc (system directory)', async () => {
    const res = await fetch(`${baseUrl}/api/browse?path=/etc`);
    // Either 403 (blocked) or 403 (outside allowed roots)
    expect([400, 403]).toContain(res.status);
  });

  it('rejects access to /proc (system directory)', async () => {
    const res = await fetch(`${baseUrl}/api/browse?path=/proc`);
    expect([400, 403]).toContain(res.status);
  });

  it('rejects path traversal with ../', async () => {
    // Try to escape to root via path traversal
    const res = await fetch(`${baseUrl}/api/browse?path=${encodeURIComponent('/../../../etc')}`);
    expect([400, 403]).toContain(res.status);
  });

  it('rejects path outside allowed roots', async () => {
    const res = await fetch(`${baseUrl}/api/browse?path=/var/log`);
    expect([400, 403]).toContain(res.status);
  });

  it('returns 400 for non-existent path', async () => {
    const res = await fetch(`${baseUrl}/api/browse?path=/nonexistent_abc_xyz_123`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/does not exist/i);
  });

  it('does not return parent outside allowed roots', async () => {
    // Browse cwd — parent should be null or within allowed roots
    const res = await fetch(`${baseUrl}/api/browse?path=${encodeURIComponent(process.cwd())}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // parent is either null (at root boundary) or a valid path
    if (body.parent !== null) {
      // parent should not be a blocked system path
      expect(body.parent).not.toBe('/etc');
      expect(body.parent).not.toBe('/proc');
    }
  });

  // ── POST /lead/start — Auto-Secretary Spawn ─────────────────────────

  describe('POST /lead/start', () => {
    it('auto-spawns a Secretary agent alongside the Lead', async () => {
      const leadAgent = createLeadAgent({ projectName: 'Test Project' });
      const secretaryAgent = createMockAgent({
        id: 'secretary-001',
        role: { id: 'secretary', name: 'Secretary', model: 'gpt-4.1' },
        parentId: 'lead-001',
        isSystemAgent: true,
      });

      mockAgentManager.spawn.mockReturnValue(leadAgent);
      mockAgentManager.autoSpawnSecretary.mockReturnValue(secretaryAgent);

      const leadRole = { id: 'lead', name: 'Project Lead', model: 'claude-3-5-sonnet' };
      mockRoleRegistry.get.mockImplementation((id: string) => {
        if (id === 'lead') return leadRole;
        return mockRole;
      });

      const res = await post('/api/lead/start', { task: 'Build something' });
      expect(res.status).toBe(201);

      // Should call autoSpawnSecretary with the lead agent
      expect(mockAgentManager.autoSpawnSecretary).toHaveBeenCalledWith(leadAgent);
    });

    it('succeeds even if autoSpawnSecretary returns null', async () => {
      const leadAgent = createLeadAgent({ projectName: 'Test Project' });
      mockAgentManager.spawn.mockReturnValue(leadAgent);
      mockAgentManager.autoSpawnSecretary.mockReturnValue(null);

      const leadRole = { id: 'lead', name: 'Project Lead', model: 'claude-3-5-sonnet' };
      mockRoleRegistry.get.mockImplementation((id: string) => {
        if (id === 'lead') return leadRole;
        return mockRole;
      });

      const res = await post('/api/lead/start', { task: 'Build something' });
      expect(res.status).toBe(201);
    });
  });
});
