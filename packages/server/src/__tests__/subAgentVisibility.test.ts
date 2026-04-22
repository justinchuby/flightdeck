/**
 * Sub-agent visibility integration tests.
 *
 * Verifies that route handlers use recursive `getCrewDescendants()` from
 * @flightdeck/shared so agents nested 2+ levels deep are included in
 * API responses (the fix from PR #211).
 *
 * Routes tested:
 *   1. GET /lead/:id/progress            — live agent hierarchy
 *   2. GET /lead/:id/progress             — roster fallback path
 *   3. GET /coordination/timeline         — two-pass crew filtering
 *   4. GET /comms/:leadId/flows           — getCrewIds helper
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { Request, Response, NextFunction } from 'express';

// Bypass rate limiters in tests
vi.mock('../middleware/rateLimit.js', () => ({
  rateLimit: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

import { leadRoutes } from '../routes/lead.js';
import { coordinationRoutes } from '../routes/coordination.js';
import { commsRoutes } from '../routes/comms.js';
import type { AppContext } from '../routes/context.js';

// ── Shared Test Hierarchy ───────────────────────────────────────────
//
//  lead-1 (lead, running)
//  ├── dev-1        (developer, running,      parentId: lead-1)
//  ├── sub-lead-1   (lead, running,           parentId: lead-1)
//  │   ├── reviewer-1 (code-reviewer, idle,   parentId: sub-lead-1)  ← depth 2
//  │   └── writer-1   (tech-writer, running,  parentId: sub-lead-1)  ← depth 2
//  └── arch-1       (architect, idle,          parentId: lead-1)
//      └── deep-dev-1 (developer, running,    parentId: arch-1)      ← depth 2

function makeAgent(overrides: Record<string, any>) {
  return {
    id: overrides.id,
    parentId: overrides.parentId ?? undefined,
    projectId: overrides.projectId ?? 'proj-1',
    projectName: overrides.projectName ?? 'Test Project',
    status: overrides.status ?? 'running',
    role: overrides.role ?? { id: 'developer', name: 'Developer', model: 'test-model' },
    model: overrides.model ?? 'test-model',
    task: overrides.task ?? undefined,
    inputTokens: overrides.inputTokens ?? 100,
    outputTokens: overrides.outputTokens ?? 200,
    contextWindowSize: overrides.contextWindowSize ?? 128_000,
    contextWindowUsed: overrides.contextWindowUsed ?? 5_000,
    toJSON() {
      return { id: this.id, parentId: this.parentId, status: this.status, role: this.role, model: this.model };
    },
    ...overrides,
  };
}

const DEPTH_2_IDS = ['reviewer-1', 'writer-1', 'deep-dev-1'];

function buildHierarchy() {
  return [
    makeAgent({ id: 'lead-1', role: { id: 'lead', name: 'Project Lead', model: 'test-model' }, status: 'running' }),
    makeAgent({ id: 'dev-1', parentId: 'lead-1', status: 'running' }),
    makeAgent({ id: 'sub-lead-1', parentId: 'lead-1', role: { id: 'lead', name: 'Sub-Lead', model: 'test-model' }, status: 'running' }),
    makeAgent({ id: 'reviewer-1', parentId: 'sub-lead-1', role: { id: 'code-reviewer', name: 'Code Reviewer', model: 'test-model' }, status: 'idle' }),
    makeAgent({ id: 'writer-1', parentId: 'sub-lead-1', role: { id: 'tech-writer', name: 'Tech Writer', model: 'test-model' }, status: 'running' }),
    makeAgent({ id: 'arch-1', parentId: 'lead-1', role: { id: 'architect', name: 'Architect', model: 'test-model' }, status: 'idle' }),
    makeAgent({ id: 'deep-dev-1', parentId: 'arch-1', role: { id: 'developer', name: 'Developer', model: 'test-model' }, status: 'running' }),
  ];
}

// ── Minimal AppContext factory ───────────────────────────────────────

function minimalCtx(overrides: Partial<AppContext> = {}): AppContext {
  const agents = buildHierarchy();
  return {
    agentManager: {
      getAll: vi.fn().mockReturnValue(agents),
      get: vi.fn((id: string) => agents.find((a) => a.id === id) ?? null),
      getByProject: vi.fn((pid: string) => agents.filter((a) => a.projectId === pid)),
      getDelegations: vi.fn().mockReturnValue([]),
      getDecisionLog: vi.fn().mockReturnValue({ getByLeadId: vi.fn().mockReturnValue([]) }),
      getChatGroupRegistry: vi.fn().mockReturnValue({ getGroups: vi.fn().mockReturnValue([]) }),
      getCostTracker: vi.fn().mockReturnValue(null),
      getTimerRegistry: vi.fn().mockReturnValue(null),
      getProjectIdForAgent: vi.fn().mockReturnValue('proj-1'),
      getTaskDAG: vi.fn().mockReturnValue({ getStatus: vi.fn().mockReturnValue({}) }),
      persistHumanMessage: vi.fn(),
      markHumanInterrupt: vi.fn(),
      autoSpawnSecretary: vi.fn(),
      spawn: vi.fn(),
    } as any,
    roleRegistry: { get: vi.fn() } as any,
    config: {} as any,
    db: {} as any,
    lockRegistry: {
      getAll: vi.fn().mockReturnValue([]),
      getByProject: vi.fn().mockReturnValue([]),
      on: vi.fn(),
      off: vi.fn(),
    } as any,
    activityLedger: {
      getRecent: vi.fn().mockReturnValue([]),
      getSince: vi.fn().mockReturnValue([]),
      getByAgent: vi.fn().mockReturnValue([]),
      getByType: vi.fn().mockReturnValue([]),
      getSummary: vi.fn().mockReturnValue({}),
      getCommEvents: vi.fn().mockReturnValue([]),
      on: vi.fn(),
      off: vi.fn(),
      version: 1,
    } as any,
    decisionLog: {} as any,
    projectRegistry: undefined,
    ...overrides,
  } as AppContext;
}

// ── Test server helper ──────────────────────────────────────────────

function createTestServer(
  routeFactory: (ctx: AppContext) => express.Router,
  ctxOverrides: Partial<AppContext> = {},
): { start: () => Promise<string>; stop: () => Promise<void>; ctx: AppContext } {
  const ctx = minimalCtx(ctxOverrides);
  const app = express();
  app.use(express.json());
  app.use(routeFactory(ctx));

  let server: Server;
  return {
    ctx,
    start: () =>
      new Promise<string>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
          const { port } = server.address() as AddressInfo;
          resolve(`http://127.0.0.1:${port}`);
        });
      }),
    stop: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve());
      }),
  };
}

// =====================================================================
// 1. GET /lead/:id/progress — live agents
// =====================================================================
describe('GET /lead/:id/progress — sub-agent visibility', () => {
  it('includes depth-2 agents from live agent manager', async () => {
    const srv = createTestServer(leadRoutes);
    const base = await srv.start();
    try {
      const res = await fetch(`${base}/lead/lead-1/progress`);
      expect(res.status).toBe(200);
      const body = await res.json();

      const agentIds = body.teamAgents.map((a: any) => a.id);

      // All depth-2 agents must appear
      for (const id of DEPTH_2_IDS) {
        expect(agentIds).toContain(id);
      }

      // Direct children must also be present
      expect(agentIds).toContain('dev-1');
      expect(agentIds).toContain('sub-lead-1');
      expect(agentIds).toContain('arch-1');

      // teamSize accounts for all descendants (6 total, excluding lead)
      expect(body.teamSize).toBe(6);
    } finally {
      await srv.stop();
    }
  });

  it('preserves role and token data for depth-2 agents', async () => {
    const srv = createTestServer(leadRoutes);
    const base = await srv.start();
    try {
      const res = await fetch(`${base}/lead/lead-1/progress`);
      const body = await res.json();

      const reviewer = body.teamAgents.find((a: any) => a.id === 'reviewer-1');
      expect(reviewer).toBeDefined();
      expect(reviewer.role).toEqual({ id: 'code-reviewer', name: 'Code Reviewer', model: 'test-model' });
      expect(reviewer.status).toBe('idle');
      expect(reviewer.inputTokens).toBe(100);
      expect(reviewer.outputTokens).toBe(200);
    } finally {
      await srv.stop();
    }
  });
});

// =====================================================================
// 2. GET /lead/:id/progress — roster fallback
// =====================================================================
describe('GET /lead/:id/progress — roster fallback', () => {
  it('falls back to agentRoster and still finds depth-2 agents', async () => {
    const rosterAgents = [
      { agentId: 'dev-1', role: 'developer', model: 'test-model', status: 'completed', lastTaskSummary: 'build UI', metadata: { parentId: 'lead-1' }, createdAt: new Date(), updatedAt: new Date() },
      { agentId: 'sub-lead-1', role: 'lead', model: 'test-model', status: 'completed', lastTaskSummary: null, metadata: { parentId: 'lead-1' }, createdAt: new Date(), updatedAt: new Date() },
      { agentId: 'reviewer-1', role: 'code-reviewer', model: 'test-model', status: 'completed', lastTaskSummary: 'review PR', metadata: { parentId: 'sub-lead-1' }, createdAt: new Date(), updatedAt: new Date() },
      { agentId: 'writer-1', role: 'tech-writer', model: 'test-model', status: 'completed', lastTaskSummary: 'write docs', metadata: { parentId: 'sub-lead-1' }, createdAt: new Date(), updatedAt: new Date() },
      { agentId: 'arch-1', role: 'architect', model: 'test-model', status: 'completed', lastTaskSummary: null, metadata: { parentId: 'lead-1' }, createdAt: new Date(), updatedAt: new Date() },
      { agentId: 'deep-dev-1', role: 'developer', model: 'test-model', status: 'completed', lastTaskSummary: 'implement feature', metadata: { parentId: 'arch-1' }, createdAt: new Date(), updatedAt: new Date() },
    ];

    const srv = createTestServer(leadRoutes, {
      agentManager: {
        // Return empty so the route uses roster fallback
        getAll: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue(null),
        getByProject: vi.fn().mockReturnValue([]),
        getDelegations: vi.fn().mockReturnValue([]),
        getDecisionLog: vi.fn().mockReturnValue({ getByLeadId: vi.fn().mockReturnValue([]) }),
        getChatGroupRegistry: vi.fn().mockReturnValue({ getGroups: vi.fn().mockReturnValue([]) }),
        getCostTracker: vi.fn().mockReturnValue(null),
        getTimerRegistry: vi.fn().mockReturnValue(null),
        getProjectIdForAgent: vi.fn().mockReturnValue('proj-1'),
        getTaskDAG: vi.fn().mockReturnValue({ getStatus: vi.fn().mockReturnValue({}) }),
        persistHumanMessage: vi.fn(),
        markHumanInterrupt: vi.fn(),
        autoSpawnSecretary: vi.fn(),
        spawn: vi.fn(),
      } as any,
      agentRoster: {
        getAllAgents: vi.fn().mockReturnValue(rosterAgents),
      } as any,
    });

    const base = await srv.start();
    try {
      const res = await fetch(`${base}/lead/lead-1/progress`);
      expect(res.status).toBe(200);
      const body = await res.json();

      const agentIds = body.teamAgents.map((a: any) => a.id);

      // Depth-2 agents discovered via roster + recursive lookup
      for (const id of DEPTH_2_IDS) {
        expect(agentIds).toContain(id);
      }

      expect(body.teamSize).toBe(6);

      // Verify roster data is properly mapped
      const deepDev = body.teamAgents.find((a: any) => a.id === 'deep-dev-1');
      expect(deepDev).toBeDefined();
      expect(deepDev.task).toBe('implement feature');
      expect(deepDev.model).toBe('test-model');
    } finally {
      await srv.stop();
    }
  });

  it('maps string roles to { id, name } objects in roster fallback', async () => {
    const rosterAgents = [
      { agentId: 'dev-1', role: 'developer', model: 'test-model', status: 'completed', lastTaskSummary: null, metadata: { parentId: 'lead-1' }, createdAt: new Date(), updatedAt: new Date() },
      { agentId: 'arch-1', role: 'architect', model: 'test-model', status: 'completed', lastTaskSummary: null, metadata: { parentId: 'lead-1' }, createdAt: new Date(), updatedAt: new Date() },
      { agentId: 'deep-dev-1', role: 'developer', model: 'test-model', status: 'completed', lastTaskSummary: null, metadata: { parentId: 'arch-1' }, createdAt: new Date(), updatedAt: new Date() },
    ];

    const srv = createTestServer(leadRoutes, {
      agentManager: {
        getAll: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue(null),
        getByProject: vi.fn().mockReturnValue([]),
        getDelegations: vi.fn().mockReturnValue([]),
        getDecisionLog: vi.fn().mockReturnValue({ getByLeadId: vi.fn().mockReturnValue([]) }),
        getChatGroupRegistry: vi.fn().mockReturnValue({ getGroups: vi.fn().mockReturnValue([]) }),
        getCostTracker: vi.fn().mockReturnValue(null),
        getTimerRegistry: vi.fn().mockReturnValue(null),
        getProjectIdForAgent: vi.fn().mockReturnValue('proj-1'),
        getTaskDAG: vi.fn().mockReturnValue({ getStatus: vi.fn().mockReturnValue({}) }),
        persistHumanMessage: vi.fn(),
        markHumanInterrupt: vi.fn(),
        autoSpawnSecretary: vi.fn(),
        spawn: vi.fn(),
      } as any,
      agentRoster: {
        getAllAgents: vi.fn().mockReturnValue(rosterAgents),
      } as any,
    });

    const base = await srv.start();
    try {
      const res = await fetch(`${base}/lead/lead-1/progress`);
      const body = await res.json();

      const deepDev = body.teamAgents.find((a: any) => a.id === 'deep-dev-1');
      expect(deepDev).toBeDefined();
      // String role should be wrapped into { id, name } shape
      expect(deepDev.role).toEqual({ id: 'developer', name: 'developer' });
    } finally {
      await srv.stop();
    }
  });
});

// =====================================================================
// 3. GET /coordination/timeline — two-pass crew filtering
// =====================================================================
describe('GET /coordination/timeline — sub-agent visibility', () => {
  function makeActivityEntry(id: number, agentId: string, actionType: string, extra: Record<string, any> = {}) {
    return {
      id,
      agentId,
      agentRole: 'developer',
      actionType,
      summary: `${actionType} by ${agentId}`,
      timestamp: new Date(Date.now() - (100 - id) * 1000).toISOString(),
      projectId: 'proj-1',
      details: {},
      ...extra,
    };
  }

  it('includes activity from depth-2 agents when filtering by leadId', async () => {
    const activities = [
      makeActivityEntry(1, 'lead-1', 'status_change', { agentRole: 'lead', summary: 'Status: running' }),
      makeActivityEntry(2, 'dev-1', 'status_change', { summary: 'Status: running' }),
      makeActivityEntry(3, 'sub-lead-1', 'status_change', { agentRole: 'lead', summary: 'Status: running' }),
      makeActivityEntry(4, 'reviewer-1', 'status_change', { agentRole: 'code-reviewer', summary: 'Status: idle' }),
      makeActivityEntry(5, 'writer-1', 'status_change', { agentRole: 'tech-writer', summary: 'Status: running' }),
      makeActivityEntry(6, 'arch-1', 'status_change', { agentRole: 'architect', summary: 'Status: idle' }),
      makeActivityEntry(7, 'deep-dev-1', 'status_change', { summary: 'Status: running' }),
    ];

    const srv = createTestServer(coordinationRoutes, {
      activityLedger: {
        getRecent: vi.fn().mockReturnValue(activities),
        getSince: vi.fn().mockReturnValue(activities),
        getByAgent: vi.fn().mockReturnValue([]),
        getByType: vi.fn().mockReturnValue([]),
        getSummary: vi.fn().mockReturnValue({}),
        on: vi.fn(),
        off: vi.fn(),
        version: 1,
      } as any,
    });

    const base = await srv.start();
    try {
      const res = await fetch(`${base}/coordination/timeline?leadId=lead-1`);
      expect(res.status).toBe(200);
      const body = await res.json();

      const agentIds = body.agents.map((a: any) => a.id);

      // Depth-2 agents must appear in the timeline agents
      for (const id of DEPTH_2_IDS) {
        expect(agentIds).toContain(id);
      }

      // Direct children too
      expect(agentIds).toContain('dev-1');
      expect(agentIds).toContain('sub-lead-1');
      expect(agentIds).toContain('arch-1');

      // Lead itself
      expect(agentIds).toContain('lead-1');
    } finally {
      await srv.stop();
    }
  });

  it('filters out agents not in the crew', async () => {
    const outsider = makeAgent({
      id: 'outsider-1',
      parentId: undefined,
      projectId: 'other-proj',
      role: { id: 'developer', name: 'Developer', model: 'test-model' },
      status: 'running',
    });

    const agents = [...buildHierarchy(), outsider];

    const activities = [
      makeActivityEntry(1, 'lead-1', 'status_change', { agentRole: 'lead', summary: 'Status: running' }),
      makeActivityEntry(2, 'deep-dev-1', 'status_change', { summary: 'Status: running' }),
      makeActivityEntry(3, 'outsider-1', 'status_change', { projectId: 'other-proj', summary: 'Status: running' }),
    ];

    const srv = createTestServer(coordinationRoutes, {
      agentManager: {
        getAll: vi.fn().mockReturnValue(agents),
        get: vi.fn((id: string) => agents.find((a) => a.id === id) ?? null),
        getByProject: vi.fn((pid: string) => agents.filter((a) => a.projectId === pid)),
        getDelegations: vi.fn().mockReturnValue([]),
        getDecisionLog: vi.fn().mockReturnValue({ getByLeadId: vi.fn().mockReturnValue([]) }),
        getChatGroupRegistry: vi.fn().mockReturnValue({ getGroups: vi.fn().mockReturnValue([]) }),
        getCostTracker: vi.fn().mockReturnValue(null),
        getProjectIdForAgent: vi.fn().mockReturnValue('proj-1'),
      } as any,
      activityLedger: {
        getRecent: vi.fn().mockReturnValue(activities),
        getSince: vi.fn().mockReturnValue(activities),
        getByAgent: vi.fn().mockReturnValue([]),
        getByType: vi.fn().mockReturnValue([]),
        getSummary: vi.fn().mockReturnValue({}),
        on: vi.fn(),
        off: vi.fn(),
        version: 1,
      } as any,
    });

    const base = await srv.start();
    try {
      const res = await fetch(`${base}/coordination/timeline?leadId=lead-1`);
      const body = await res.json();

      const agentIds = body.agents.map((a: any) => a.id);

      // Depth-2 included
      expect(agentIds).toContain('deep-dev-1');
      // Outsider excluded
      expect(agentIds).not.toContain('outsider-1');
    } finally {
      await srv.stop();
    }
  });
});

// =====================================================================
// 4. GET /comms/:leadId/flows — getCrewIds uses getCrewDescendants
// =====================================================================
describe('GET /comms/:leadId/flows — sub-agent visibility', () => {
  function makeCommEvent(id: number, agentId: string, toAgentId: string) {
    return {
      id,
      agentId,
      agentRole: 'developer',
      actionType: 'message_sent',
      summary: `Message from ${agentId} to ${toAgentId}`,
      timestamp: new Date(Date.now() - (100 - id) * 1000).toISOString(),
      projectId: 'proj-1',
      details: { toAgentId },
    };
  }

  it('includes depth-2 agents as nodes in the flow graph', async () => {
    const commEvents = [
      makeCommEvent(1, 'lead-1', 'dev-1'),
      makeCommEvent(2, 'sub-lead-1', 'reviewer-1'),
      makeCommEvent(3, 'reviewer-1', 'sub-lead-1'),
      makeCommEvent(4, 'arch-1', 'deep-dev-1'),
      makeCommEvent(5, 'deep-dev-1', 'arch-1'),
    ];

    const srv = createTestServer(commsRoutes, {
      activityLedger: {
        getRecent: vi.fn().mockReturnValue(commEvents),
        getSince: vi.fn().mockReturnValue(commEvents),
        getByAgent: vi.fn().mockReturnValue([]),
        getByType: vi.fn().mockReturnValue([]),
        getSummary: vi.fn().mockReturnValue({}),
        on: vi.fn(),
        off: vi.fn(),
        version: 1,
      } as any,
    });

    const base = await srv.start();
    try {
      const res = await fetch(`${base}/comms/lead-1/flows`);
      expect(res.status).toBe(200);
      const body = await res.json();

      const nodeIds = body.nodes.map((n: any) => n.id);

      // Depth-2 agents must appear as nodes
      for (const id of DEPTH_2_IDS) {
        expect(nodeIds).toContain(id);
      }

      // Direct children
      expect(nodeIds).toContain('dev-1');
      expect(nodeIds).toContain('sub-lead-1');
      expect(nodeIds).toContain('arch-1');
    } finally {
      await srv.stop();
    }
  });

  it('includes comm events involving depth-2 agents in the timeline', async () => {
    const commEvents = [
      makeCommEvent(1, 'reviewer-1', 'sub-lead-1'),
      makeCommEvent(2, 'deep-dev-1', 'arch-1'),
    ];

    const srv = createTestServer(commsRoutes, {
      activityLedger: {
        getRecent: vi.fn().mockReturnValue(commEvents),
        getSince: vi.fn().mockReturnValue(commEvents),
        getByAgent: vi.fn().mockReturnValue([]),
        getByType: vi.fn().mockReturnValue([]),
        getSummary: vi.fn().mockReturnValue({}),
        on: vi.fn(),
        off: vi.fn(),
        version: 1,
      } as any,
    });

    const base = await srv.start();
    try {
      const res = await fetch(`${base}/comms/lead-1/flows`);
      const body = await res.json();

      // Timeline should contain events from depth-2 agents
      const timelineFromAgents = body.timeline.map((e: any) => e.from);
      expect(timelineFromAgents).toContain('reviewer-1');
      expect(timelineFromAgents).toContain('deep-dev-1');

      // Edges should exist for these communications
      expect(body.edges.length).toBeGreaterThanOrEqual(2);
    } finally {
      await srv.stop();
    }
  });

  it('includes depth-2 agents in stats endpoint', async () => {
    const commEvents = [
      makeCommEvent(1, 'reviewer-1', 'sub-lead-1'),
      makeCommEvent(2, 'deep-dev-1', 'arch-1'),
      makeCommEvent(3, 'lead-1', 'dev-1'),
    ];

    const srv = createTestServer(commsRoutes, {
      activityLedger: {
        getRecent: vi.fn().mockReturnValue(commEvents),
        getSince: vi.fn().mockReturnValue(commEvents),
        getByAgent: vi.fn().mockReturnValue([]),
        getByType: vi.fn().mockReturnValue([]),
        getSummary: vi.fn().mockReturnValue({}),
        on: vi.fn(),
        off: vi.fn(),
        version: 1,
      } as any,
    });

    const base = await srv.start();
    try {
      const res = await fetch(`${base}/comms/lead-1/stats`);
      expect(res.status).toBe(200);
      const body = await res.json();

      // All 3 comm events should be counted (depth-2 agents are in crew)
      expect(body.totalMessages).toBe(3);
    } finally {
      await srv.stop();
    }
  });
});
