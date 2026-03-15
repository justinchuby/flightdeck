import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { tasksRoutes } from './tasks.js';
import type { AppContext } from './context.js';
import type { DagTask } from '../tasks/TaskDAG.js';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const SAMPLE_TASKS: DagTask[] = [
  {
    id: 'task-1', leadId: 'lead-1', projectId: 'proj-a', role: 'developer',
    title: 'Build API', description: 'Build the REST API', files: [], dependsOn: [],
    dagStatus: 'running', priority: 2, assignedAgentId: 'agent-1',
    createdAt: '2026-01-01T00:00:00Z', startedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  },
  {
    id: 'task-2', leadId: 'lead-1', projectId: 'proj-a', role: 'developer',
    title: 'Write tests', description: 'Write unit tests', files: [], dependsOn: ['task-1'],
    dagStatus: 'blocked', priority: 1, createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'task-3', leadId: 'lead-2', projectId: 'proj-b', role: 'designer',
    title: 'Design mockup', description: 'Create UI mockup', files: [], dependsOn: [],
    dagStatus: 'failed', priority: 0, failureReason: 'Agent exited with code 1',
    createdAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:15:00Z',
  },
  {
    id: 'task-4', leadId: 'lead-2', projectId: 'proj-b', role: 'developer',
    title: 'Fix bug', description: 'Fix the null pointer', files: [], dependsOn: [],
    dagStatus: 'done', priority: 0, createdAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-01-01T00:20:00Z',
  },
  {
    id: 'task-5', leadId: 'lead-1', projectId: 'proj-a', role: 'tester',
    title: 'Long runner', description: 'This task is long-running', files: [], dependsOn: [],
    dagStatus: 'running', priority: 1, assignedAgentId: 'agent-2',
    createdAt: '2026-01-01T00:00:00Z', startedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  },
];

const PENDING_DECISIONS = [
  {
    id: 'dec-1', title: 'Use JWT or sessions?', rationale: 'JWT is stateless',
    agentId: 'agent-1', agentRole: 'architect', projectId: 'proj-a',
    timestamp: '2026-01-01T00:12:00Z', category: 'architecture',
    needsConfirmation: true, status: 'recorded', autoApproved: false,
    confirmedAt: null, leadId: 'lead-1',
  },
];

function createMockTaskDAG() {
  return {
    getAll: vi.fn().mockReturnValue(SAMPLE_TASKS),
    getTasksByProject: vi.fn().mockImplementation((projectId: string) =>
      SAMPLE_TASKS.filter(t => t.projectId === projectId),
    ),
    unarchiveTask: vi.fn(),
  };
}

function createMockDecisionLog() {
  return {
    getNeedingConfirmation: vi.fn().mockReturnValue(PENDING_DECISIONS),
  };
}

function createTestServer(ctx: Partial<AppContext>) {
  const app = express();
  app.use(express.json());
  app.use(tasksRoutes(ctx as AppContext));
  let server: Server;
  return {
    app,
    start: () => new Promise<string>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    }),
    stop: () => new Promise<void>((resolve) => { server?.close(() => resolve()); }),
  };
}

describe('GET /tasks — global task query', () => {
  let baseUrl: string;
  let stop: () => Promise<void>;
  const mockTaskDAG = createMockTaskDAG();
  const mockAgentManager = { getTaskDAG: () => mockTaskDAG, getAll: vi.fn().mockReturnValue([]) } as any;
  const mockDecisionLog = createMockDecisionLog();

  beforeAll(async () => {
    const srv = createTestServer({
      agentManager: mockAgentManager,
      decisionLog: mockDecisionLog as any,
    });
    baseUrl = await srv.start();
    stop = srv.stop;
  });
  afterAll(async () => { await stop?.(); });

  it('returns all tasks with scope=global (default)', async () => {
    const res = await fetch(`${baseUrl}/tasks`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toHaveLength(5);
    expect(body.scope).toBe('global');
    expect(body.total).toBe(5);
  });

  it('returns project-scoped tasks', async () => {
    const res = await fetch(`${baseUrl}/tasks?scope=project&projectId=proj-a`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toHaveLength(3);
    expect(body.projectId).toBe('proj-a');
    expect(body.scope).toBe('project');
  });

  it('rejects scope=project without projectId', async () => {
    const res = await fetch(`${baseUrl}/tasks?scope=project`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('projectId is required');
  });

  it('filters by status', async () => {
    const res = await fetch(`${baseUrl}/tasks?status=failed`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].id).toBe('task-3');
  });

  it('filters by comma-separated statuses', async () => {
    const res = await fetch(`${baseUrl}/tasks?status=failed,done`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toHaveLength(2);
  });

  it('filters by role', async () => {
    const res = await fetch(`${baseUrl}/tasks?role=designer`);
    const body = await res.json();
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].role).toBe('designer');
  });

  it('filters by assignedAgentId', async () => {
    const res = await fetch(`${baseUrl}/tasks?assignedAgentId=agent-1`);
    const body = await res.json();
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].assignedAgentId).toBe('agent-1');
  });

  it('paginates with limit and offset', async () => {
    const res = await fetch(`${baseUrl}/tasks?limit=2&offset=0`);
    const body = await res.json();
    expect(body.tasks).toHaveLength(2);
    expect(body.total).toBe(5);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(0);
    expect(body.hasMore).toBe(true);
  });

  it('returns second page with offset', async () => {
    const res = await fetch(`${baseUrl}/tasks?limit=2&offset=2`);
    const body = await res.json();
    expect(body.tasks).toHaveLength(2);
    expect(body.offset).toBe(2);
    expect(body.hasMore).toBe(true);
  });

  it('returns last page with hasMore=false', async () => {
    const res = await fetch(`${baseUrl}/tasks?limit=2&offset=4`);
    const body = await res.json();
    expect(body.tasks).toHaveLength(1);
    expect(body.hasMore).toBe(false);
  });

  it('defaults to limit=200 when not specified', async () => {
    const res = await fetch(`${baseUrl}/tasks`);
    const body = await res.json();
    expect(body.limit).toBe(200);
    expect(body.offset).toBe(0);
  });

  it('caps limit at 1000', async () => {
    const res = await fetch(`${baseUrl}/tasks?limit=5000`);
    const body = await res.json();
    expect(body.limit).toBe(1000);
  });

  it('paginates after filtering', async () => {
    const res = await fetch(`${baseUrl}/tasks?status=running&limit=1&offset=0`);
    const body = await res.json();
    expect(body.tasks).toHaveLength(1);
    expect(body.total).toBe(2); // 2 running tasks
    expect(body.hasMore).toBe(true);
  });

  it('passes includeArchived to getAll', async () => {
    await fetch(`${baseUrl}/tasks?includeArchived=true`);
    expect(mockTaskDAG.getAll).toHaveBeenCalledWith({ includeArchived: true });
  });

  it('passes includeArchived to getTasksByProject', async () => {
    await fetch(`${baseUrl}/tasks?scope=project&projectId=proj-a&includeArchived=true`);
    expect(mockTaskDAG.getTasksByProject).toHaveBeenCalledWith('proj-a', { includeArchived: true });
  });

  it('defaults includeArchived to false', async () => {
    await fetch(`${baseUrl}/tasks`);
    expect(mockTaskDAG.getAll).toHaveBeenCalledWith({ includeArchived: false });
  });

  it('PATCH /tasks/:leadId/:taskId/unarchive calls unarchiveTask', async () => {
    const restoredTask = { ...SAMPLE_TASKS[0], archivedAt: undefined };
    mockTaskDAG.unarchiveTask.mockReturnValue(restoredTask);
    const res = await fetch(`${baseUrl}/tasks/lead-1/task-1/unarchive`, { method: 'PATCH' });
    expect(res.status).toBe(200);
    expect(mockTaskDAG.unarchiveTask).toHaveBeenCalledWith('lead-1', 'task-1');
    const body = await res.json();
    expect(body.id).toBe('task-1');
  });

  it('PATCH /tasks/:leadId/:taskId/unarchive returns 404 for non-archived task', async () => {
    mockTaskDAG.unarchiveTask.mockReturnValue(null);
    const res = await fetch(`${baseUrl}/tasks/lead-1/task-99/unarchive`, { method: 'PATCH' });
    expect(res.status).toBe(404);
  });
});

describe('GET /attention — attention items', () => {
  let baseUrl: string;
  let stop: () => Promise<void>;
  const mockTaskDAG = createMockTaskDAG();
  const mockAgentManager = { getTaskDAG: () => mockTaskDAG, getAll: vi.fn().mockReturnValue([]) } as any;
  const mockDecisionLog = createMockDecisionLog();

  beforeAll(async () => {
    const srv = createTestServer({
      agentManager: mockAgentManager,
      decisionLog: mockDecisionLog as any,
    });
    baseUrl = await srv.start();
    stop = srv.stop;
  });
  afterAll(async () => { await stop?.(); });

  it('returns attention items with escalation level', async () => {
    const res = await fetch(`${baseUrl}/attention`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.escalation).toBe('red'); // has failed task
    expect(body.summary.failedCount).toBe(1);
    expect(body.summary.blockedCount).toBe(1);
    expect(body.summary.decisionCount).toBe(1);
    expect(body.summary.totalCount).toBeGreaterThanOrEqual(3);
  });

  it('includes failed tasks with failureReason', async () => {
    const res = await fetch(`${baseUrl}/attention`);
    const body = await res.json();
    const failedItem = body.items.find((i: any) => i.type === 'failed');
    expect(failedItem).toBeDefined();
    expect(failedItem.task.id).toBe('task-3');
    expect(failedItem.reason).toBe('Agent exited with code 1');
    expect(failedItem.severity).toBe('critical');
  });

  it('includes blocked tasks', async () => {
    const res = await fetch(`${baseUrl}/attention`);
    const body = await res.json();
    const blockedItem = body.items.find((i: any) => i.type === 'blocked');
    expect(blockedItem).toBeDefined();
    expect(blockedItem.task.id).toBe('task-2');
  });

  it('includes pending decisions', async () => {
    const res = await fetch(`${baseUrl}/attention`);
    const body = await res.json();
    const decisionItem = body.items.find((i: any) => i.type === 'decision');
    expect(decisionItem).toBeDefined();
    expect(decisionItem.decision.title).toBe('Use JWT or sessions?');
    expect(decisionItem.severity).toBe('warning');
  });

  it('scopes to project when requested', async () => {
    const res = await fetch(`${baseUrl}/attention?scope=project&projectId=proj-b`);
    const body = await res.json();
    // proj-b has: 1 failed task, 0 blocked, 0 decisions (dec-1 is proj-a)
    expect(body.summary.failedCount).toBe(1);
    expect(body.summary.blockedCount).toBe(0);
    expect(body.summary.decisionCount).toBe(0);
  });

  it('returns green escalation when no issues', async () => {
    // Use a fresh mock with no issues
    const cleanTaskDAG = {
      getAll: vi.fn().mockReturnValue([{
        id: 'task-ok', leadId: 'lead-1', projectId: 'proj-a', role: 'developer',
        title: 'All good', description: 'Running fine', files: [], dependsOn: [],
        dagStatus: 'done', priority: 0, createdAt: '2026-01-01T00:00:00Z',
        completedAt: '2026-01-01T00:05:00Z',
      }]),
      getTasksByProject: vi.fn().mockReturnValue([]),
    };
    const cleanDecisionLog = { getNeedingConfirmation: vi.fn().mockReturnValue([]) };

    const srv = createTestServer({
      agentManager: { getTaskDAG: () => cleanTaskDAG } as any,
      decisionLog: cleanDecisionLog as any,
    });
    const url = await srv.start();
    try {
      const res = await fetch(`${url}/attention`);
      const body = await res.json();
      expect(body.escalation).toBe('green');
      expect(body.summary.totalCount).toBe(0);
    } finally {
      await srv.stop();
    }
  });

  it('orders items by severity: critical first', async () => {
    const res = await fetch(`${baseUrl}/attention`);
    const body = await res.json();
    const types = body.items.map((i: any) => i.type);
    // Failed (critical) should come before blocked (info/warning)
    const failedIdx = types.indexOf('failed');
    const blockedIdx = types.indexOf('blocked');
    expect(failedIdx).toBeLessThan(blockedIdx);
  });
});
