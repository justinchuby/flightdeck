import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { apiRouter } from '../api.js';
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks
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
// Mock agents for two projects
// ---------------------------------------------------------------------------

function createMockAgent(id: string, projectId: string | undefined, parentId: string | null = null) {
  return {
    id,
    role: { id: parentId ? 'developer' : 'lead', name: parentId ? 'Developer' : 'Project Lead', model: 'claude-sonnet-4.5' },
    status: 'running' as string,
    parentId,
    projectId,
    plan: null,
    model: 'claude-sonnet-4.5',
    task: 'test task',
    projectName: `Project ${projectId}`,
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
    toJSON: vi.fn().mockReturnValue({ id, role: parentId ? 'developer' : 'lead', status: 'running', projectId }),
  };
}

// Two projects with agents
const leadA = createMockAgent('lead-aaa', 'proj-a');
const devA1 = createMockAgent('dev-a1', 'proj-a', 'lead-aaa');
const leadB = createMockAgent('lead-bbb', 'proj-b');
const devB1 = createMockAgent('dev-b1', 'proj-b', 'lead-bbb');

const allAgents = [leadA, devA1, leadB, devB1];
const agentMap = new Map(allAgents.map(a => [a.id, a]));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDecisionLog = {
  getAll: vi.fn().mockReturnValue([
    { id: 'd1', title: 'Decision A', projectId: 'proj-a', agentId: 'lead-aaa', leadId: 'lead-aaa', agentRole: 'lead', status: 'recorded' },
    { id: 'd2', title: 'Decision B', projectId: 'proj-b', agentId: 'lead-bbb', leadId: 'lead-bbb', agentRole: 'lead', status: 'recorded' },
    { id: 'd3', title: 'Decision A2', projectId: 'proj-a', agentId: 'dev-a1', leadId: 'lead-aaa', agentRole: 'developer', status: 'confirmed' },
  ]),
  getNeedingConfirmation: vi.fn().mockReturnValue([
    { id: 'd1', title: 'Decision A', projectId: 'proj-a', agentId: 'lead-aaa', leadId: 'lead-aaa', agentRole: 'lead', status: 'recorded', needsConfirmation: 1 },
  ]),
  confirm: vi.fn().mockReturnValue(null),
  reject: vi.fn().mockReturnValue(null),
  getByLeadId: vi.fn().mockReturnValue([]),
  getById: vi.fn().mockReturnValue(null),
};

function getProjectIdForAgent(agentId: string): string | undefined {
  const agent = agentMap.get(agentId);
  if (!agent) return undefined;
  if (agent.projectId) return agent.projectId;
  if (agent.parentId) {
    return getProjectIdForAgent(agent.parentId);
  }
  return undefined;
}

const mockAgentManager = {
  getAll: vi.fn().mockReturnValue(allAgents),
  get: vi.fn((id: string) => agentMap.get(id)),
  getByProject: vi.fn((projectId: string) => {
    return allAgents.filter(a => getProjectIdForAgent(a.id) === projectId);
  }),
  getProjectIdForAgent: vi.fn((agentId: string) => getProjectIdForAgent(agentId)),
  spawn: vi.fn(),
  terminate: vi.fn().mockReturnValue(true),
  restart: vi.fn().mockReturnValue(null),
  resolvePermission: vi.fn().mockReturnValue(true),
  setMaxConcurrent: vi.fn(),
  getDecisionLog: vi.fn().mockReturnValue(mockDecisionLog),
  getChatGroupRegistry: vi.fn().mockReturnValue({ getGroups: vi.fn().mockReturnValue([]), getMessages: vi.fn().mockReturnValue([]) }),
  getDelegations: vi.fn().mockReturnValue([]),
  getTaskDAG: vi.fn().mockReturnValue({ getStatus: vi.fn().mockReturnValue({ tasks: [], edges: [] }) }),
  markHumanInterrupt: vi.fn(), haltHeartbeat: vi.fn(), resumeHeartbeat: vi.fn(),
  persistHumanMessage: vi.fn(),
  consumePendingSystemAction: vi.fn().mockReturnValue(undefined),
  autoSpawnSecretary: vi.fn().mockReturnValue(null),
  getMessageHistory: vi.fn().mockReturnValue([]),
};

const mockRoleRegistry = {
  get: vi.fn().mockReturnValue({ id: 'developer', name: 'Developer', description: '', systemPrompt: '', color: '#888', icon: '🤖', model: 'claude-sonnet-4.5' }),
  getAll: vi.fn().mockReturnValue([]),
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

const mockDb = {
  drizzle: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(null), all: vi.fn().mockReturnValue([]) }),
        groupBy: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }),
      }),
    }),
  },
  setSetting: vi.fn(),
} as any;

const allLocks = [
  { agentId: 'lead-aaa', filePath: 'src/a.ts', reason: 'editing', projectId: 'proj-a' },
  { agentId: 'dev-b1', filePath: 'src/b.ts', reason: 'editing', projectId: 'proj-b' },
];

const mockLockRegistry = {
  getAll: vi.fn().mockReturnValue(allLocks),
  getByProject: vi.fn((projectId: string) => allLocks.filter((l) => l.projectId === projectId)),
  acquire: vi.fn().mockReturnValue({ ok: true }),
  release: vi.fn().mockReturnValue(true),
};

const allActivity = [
  { id: 1, agentId: 'lead-aaa', agentRole: 'lead', actionType: 'status_change', summary: 'Status: running', timestamp: '2026-03-04T00:00:00Z', projectId: 'proj-a' },
  { id: 2, agentId: 'dev-a1', agentRole: 'developer', actionType: 'status_change', summary: 'Status: running', timestamp: '2026-03-04T00:01:00Z', projectId: 'proj-a' },
  { id: 3, agentId: 'lead-bbb', agentRole: 'lead', actionType: 'status_change', summary: 'Status: running', timestamp: '2026-03-04T00:02:00Z', projectId: 'proj-b' },
  { id: 4, agentId: 'dev-b1', agentRole: 'developer', actionType: 'status_change', summary: 'Status: running', timestamp: '2026-03-04T00:03:00Z', projectId: 'proj-b' },
];

function filterActivity(entries: typeof allActivity, projectId?: string) {
  return projectId ? entries.filter((e) => e.projectId === projectId) : entries;
}

const mockActivityLedger = {
  getRecent: vi.fn((_limit?: number, projectId?: string) => filterActivity(allActivity, projectId)),
  getByAgent: vi.fn().mockReturnValue([]),
  getByType: vi.fn().mockReturnValue([]),
  getSince: vi.fn().mockReturnValue([]),
  getSummary: vi.fn().mockReturnValue({}),
  version: 1,
  on: vi.fn(),
  off: vi.fn(),
};

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());

  const router = apiRouter({
    agentManager: mockAgentManager,
    roleRegistry: mockRoleRegistry,
    config: mockConfig,
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
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default return values after clearAllMocks
  mockAgentManager.getAll.mockReturnValue(allAgents);
  mockAgentManager.get.mockImplementation((id: string) => agentMap.get(id));
  mockAgentManager.getByProject.mockImplementation((projectId: string) =>
    allAgents.filter(a => getProjectIdForAgent(a.id) === projectId),
  );
  mockAgentManager.getProjectIdForAgent.mockImplementation((agentId: string) => getProjectIdForAgent(agentId));
  mockLockRegistry.getAll.mockReturnValue(allLocks);
  mockLockRegistry.getByProject.mockImplementation((projectId: string) => allLocks.filter((l) => l.projectId === projectId));
  mockActivityLedger.getRecent.mockImplementation((_limit?: number, projectId?: string) => filterActivity(allActivity, projectId));
  mockDecisionLog.getAll.mockReturnValue([
    { id: 'd1', title: 'Decision A', projectId: 'proj-a', agentId: 'lead-aaa', leadId: 'lead-aaa', agentRole: 'lead', status: 'recorded' },
    { id: 'd2', title: 'Decision B', projectId: 'proj-b', agentId: 'lead-bbb', leadId: 'lead-bbb', agentRole: 'lead', status: 'recorded' },
    { id: 'd3', title: 'Decision A2', projectId: 'proj-a', agentId: 'dev-a1', leadId: 'lead-aaa', agentRole: 'developer', status: 'confirmed' },
  ]);
  mockDecisionLog.getNeedingConfirmation.mockReturnValue([
    { id: 'd1', title: 'Decision A', projectId: 'proj-a', agentId: 'lead-aaa', leadId: 'lead-aaa', agentRole: 'lead', status: 'recorded', needsConfirmation: 1 },
  ]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('API Route Isolation (Issue #69 Step 3)', () => {
  describe('GET /api/agents', () => {
    it('returns all agents when no projectId filter', async () => {
      const res = await fetch(`${baseUrl}/api/agents`);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data).toHaveLength(4);
      expect(mockAgentManager.getAll).toHaveBeenCalled();
      expect(mockAgentManager.getByProject).not.toHaveBeenCalled();
    });

    it('returns only project A agents when projectId=proj-a', async () => {
      const res = await fetch(`${baseUrl}/api/agents?projectId=proj-a`);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data).toHaveLength(2);
      expect(mockAgentManager.getByProject).toHaveBeenCalledWith('proj-a');
      // Verify each returned agent belongs to proj-a
      for (const agent of data) {
        expect(agent.projectId).toBe('proj-a');
      }
    });

    it('returns only project B agents when projectId=proj-b', async () => {
      const res = await fetch(`${baseUrl}/api/agents?projectId=proj-b`);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data).toHaveLength(2);
      expect(mockAgentManager.getByProject).toHaveBeenCalledWith('proj-b');
      for (const agent of data) {
        expect(agent.projectId).toBe('proj-b');
      }
    });

    it('returns empty array for unknown projectId', async () => {
      const res = await fetch(`${baseUrl}/api/agents?projectId=proj-unknown`);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data).toEqual([]);
    });
  });

  describe('GET /api/coordination/status', () => {
    it('returns all agents when no projectId filter', async () => {
      const res = await fetch(`${baseUrl}/api/coordination/status`);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.agents).toHaveLength(4);
      expect(mockAgentManager.getAll).toHaveBeenCalled();
    });

    it('returns only project A agents with projectId filter', async () => {
      const res = await fetch(`${baseUrl}/api/coordination/status?projectId=proj-a`);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.agents).toHaveLength(2);
      expect(mockAgentManager.getByProject).toHaveBeenCalledWith('proj-a');
    });

    it('returns only project-scoped locks when projectId filter is provided', async () => {
      const res = await fetch(`${baseUrl}/api/coordination/status?projectId=proj-a`);
      const data = await res.json();
      expect(data.locks).toHaveLength(1);
      expect(data.locks[0].projectId).toBe('proj-a');
    });
  });

  describe('GET /api/coordination/activity', () => {
    it('returns all activity when no projectId filter', async () => {
      const res = await fetch(`${baseUrl}/api/coordination/activity`);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data).toHaveLength(4);
    });

    it('returns only project A activity when projectId=proj-a', async () => {
      const res = await fetch(`${baseUrl}/api/coordination/activity?projectId=proj-a`);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data).toHaveLength(2);
      for (const entry of data) {
        expect(['lead-aaa', 'dev-a1']).toContain(entry.agentId);
      }
    });

    it('returns only project B activity when projectId=proj-b', async () => {
      const res = await fetch(`${baseUrl}/api/coordination/activity?projectId=proj-b`);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data).toHaveLength(2);
      for (const entry of data) {
        expect(['lead-bbb', 'dev-b1']).toContain(entry.agentId);
      }
    });

    it('returns empty for unknown project', async () => {
      const res = await fetch(`${baseUrl}/api/coordination/activity?projectId=proj-unknown`);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data).toEqual([]);
    });

    it('projectId filter combines with other filters', async () => {
      // When agentId is specified alongside projectId, both filters apply
      mockActivityLedger.getByAgent.mockReturnValue([
        { id: 1, agentId: 'lead-aaa', agentRole: 'lead', actionType: 'status_change', summary: 'Status: running', timestamp: '2026-03-04T00:00:00Z' },
      ]);
      const res = await fetch(`${baseUrl}/api/coordination/activity?agentId=lead-aaa&projectId=proj-a`);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data).toHaveLength(1);
      expect(data[0].agentId).toBe('lead-aaa');
    });
  });

  describe('GET /api/coordination/locks', () => {
    it('returns all locks (intentionally global for file conflict prevention)', async () => {
      const res = await fetch(`${baseUrl}/api/coordination/locks`);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data).toHaveLength(2);
    });
  });

  describe('GET /api/decisions', () => {
    it('returns all decisions when no projectId filter', async () => {
      const res = await fetch(`${baseUrl}/api/decisions`);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data).toHaveLength(3);
    });

    it('returns only project A decisions when projectId=proj-a', async () => {
      const res = await fetch(`${baseUrl}/api/decisions?projectId=proj-a`);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data).toHaveLength(2);
      for (const d of data) {
        expect(d.projectId).toBe('proj-a');
      }
    });

    it('returns only project B decisions when projectId=proj-b', async () => {
      const res = await fetch(`${baseUrl}/api/decisions?projectId=proj-b`);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data).toHaveLength(1);
      expect(data[0].projectId).toBe('proj-b');
    });

    it('filters needs_confirmation AND projectId together', async () => {
      const res = await fetch(`${baseUrl}/api/decisions?needs_confirmation=true&projectId=proj-a`);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('d1');
    });

    it('needs_confirmation with non-matching projectId returns empty', async () => {
      const res = await fetch(`${baseUrl}/api/decisions?needs_confirmation=true&projectId=proj-b`);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data).toEqual([]);
    });
  });

  describe('backward compatibility', () => {
    it('all routes work identically when no projectId is provided', async () => {
      const [agentsRes, statusRes, activityRes, decisionsRes] = await Promise.all([
        fetch(`${baseUrl}/api/agents`),
        fetch(`${baseUrl}/api/coordination/status`),
        fetch(`${baseUrl}/api/coordination/activity`),
        fetch(`${baseUrl}/api/decisions`),
      ]);

      const agents = await agentsRes.json();
      const status = await statusRes.json();
      const activity = await activityRes.json();
      const decisions = await decisionsRes.json();

      // All return full unfiltered data
      expect(agents).toHaveLength(4);
      expect(status.agents).toHaveLength(4);
      expect(activity).toHaveLength(4);
      expect(decisions).toHaveLength(3);
    });
  });
});
