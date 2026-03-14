/**
 * Crew route tests.
 *
 * Covers: list crews, crew details, agent profiles, health,
 * clone, crews summary, error handling, and missing dependencies.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { Request, Response, NextFunction } from 'express';

// Bypass rate limiters in tests
vi.mock('../middleware/rateLimit.js', () => ({
  rateLimit: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

import { crewRoutes } from './crew.js';
import type { AppContext } from './context.js';

// ── Mock Data ───────────────────────────────────────────────────────

const MOCK_AGENTS = [
  { agentId: 'a1', role: 'architect', model: 'gpt-4', status: 'idle', teamId: 'team-1', sessionId: 'sess-current' },
  { agentId: 'a2', role: 'developer', model: 'gpt-4', status: 'running', teamId: 'team-1', sessionId: 'sess-current' },
  { agentId: 'a3', role: 'reviewer', model: 'gpt-4', status: 'idle', teamId: 'team-2', sessionId: 'sess-current' },
];

const MOCK_TRAINING_SUMMARY = {
  totalCorrections: 3,
  totalFeedback: 5,
  positiveFeedback: 4,
  negativeFeedback: 1,
  topCorrectionTags: [],
  topFeedbackTags: [],
  agentStats: [],
};

// ── Helpers ─────────────────────────────────────────────────────────

function minimalCtx(overrides: Partial<AppContext> = {}): AppContext {
  return {
    agentManager: {
      getAll: vi.fn().mockReturnValue(
        MOCK_AGENTS.map(a => ({ id: a.agentId, sessionId: a.sessionId, status: a.status })),
      ),
    } as any,
    roleRegistry: {} as any,
    config: {} as any,
    db: {} as any,
    lockRegistry: {} as any,
    activityLedger: {} as any,
    decisionLog: {} as any,
    agentRoster: {
      getAllAgents: vi.fn((_status?: any, teamId?: string) => {
        if (teamId) return MOCK_AGENTS.filter((a) => a.teamId === teamId);
        return MOCK_AGENTS;
      }),
    } as any,
    knowledgeStore: {
      count: vi.fn().mockReturnValue(10),
    } as any,
    trainingCapture: {
      getTrainingSummary: vi.fn().mockReturnValue(MOCK_TRAINING_SUMMARY),
    } as any,
    ...overrides,
  } as AppContext;
}

function createTestServer(ctxOverrides: Partial<AppContext> = {}): {
  start: () => Promise<string>;
  stop: () => Promise<void>;
  ctx: AppContext;
} {
  const ctx = minimalCtx(ctxOverrides);
  const app = express();
  app.use(express.json());
  app.use(crewRoutes(ctx));

  let server: Server;
  return {
    ctx,
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

// ── Tests ───────────────────────────────────────────────────────────

describe('crewRoutes', () => {
  // ── GET /crews ──────────────────────────────────────────────────

  describe('GET /crews', () => {
    it('returns grouped crews with agent counts', async () => {
      const srv = createTestServer();
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews`);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.crews).toHaveLength(2);

        const team1 = body.crews.find((t: any) => t.crewId === 'team-1');
        expect(team1.agentCount).toBe(2);
        expect(team1.roles).toContain('architect');
        expect(team1.roles).toContain('developer');
      } finally {
        await srv.stop();
      }
    });

    it('returns 503 when roster not available', async () => {
      const srv = createTestServer({ agentRoster: undefined });
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews`);
        expect(res.status).toBe(503);
      } finally {
        await srv.stop();
      }
    });
  });

  // ── GET /crews/:crewId ──────────────────────────────────────────

  describe('GET /crews/:crewId', () => {
    it('returns crew details with agents and knowledge count', async () => {
      const srv = createTestServer();
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews/team-1`);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.crewId).toBe('team-1');
        expect(body.agentCount).toBe(2);
        expect(body.agents).toHaveLength(2);
        expect(body.knowledgeCount).toBe(10);
        expect(body.trainingSummary).toBeDefined();
      } finally {
        await srv.stop();
      }
    });

    it('returns 404 for unknown crew', async () => {
      const srv = createTestServer();
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews/nonexistent`);
        expect(res.status).toBe(404);
      } finally {
        await srv.stop();
      }
    });

    it('returns 503 when roster not available', async () => {
      const srv = createTestServer({ agentRoster: undefined });
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews/team-1`);
        expect(res.status).toBe(503);
      } finally {
        await srv.stop();
      }
    });
  });

  // ── GET /crews/:crewId/health ───────────────────────────────────

  describe('GET /crews/:crewId/health', () => {
    it('returns health with status counts and agents', async () => {
      const srv = createTestServer({
        agentRoster: {
          getAllAgents: vi.fn().mockReturnValue(MOCK_AGENTS),
          getStatusCounts: vi.fn().mockReturnValue({ idle: 1, busy: 2, terminated: 0 }),
        } as any,
      });
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews/team-1/health`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.crewId).toBe('team-1');
        expect(body.totalAgents).toBe(3);
        expect(body.statusCounts).toEqual({ idle: 1, busy: 2, terminated: 0 });
        expect(body.agents).toHaveLength(3);
        expect(body.agents[0]).toHaveProperty('uptimeMs');
      } finally {
        await srv.stop();
      }
    });

    it('returns 404 for empty crew', async () => {
      const srv = createTestServer({
        agentRoster: {
          getAllAgents: vi.fn().mockReturnValue([]),
          getStatusCounts: vi.fn().mockReturnValue({}),
        } as any,
      });
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews/nonexistent/health`);
        expect(res.status).toBe(404);
      } finally {
        await srv.stop();
      }
    });

    it('returns 503 when roster not available', async () => {
      const srv = createTestServer({ agentRoster: undefined });
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews/team-1/health`);
        expect(res.status).toBe(503);
      } finally {
        await srv.stop();
      }
    });
  });

  // ── POST /crews/:crewId/agents/:agentId/clone ──────────────────

  describe('POST /crews/:crewId/agents/:agentId/clone', () => {
    it('clones an agent', async () => {
      const mockClone = { agentId: 'a1-clone-xxx', role: 'architect', model: 'gpt-4', status: 'idle', teamId: 'team-1' };
      const srv = createTestServer({
        agentRoster: {
          getAgent: vi.fn().mockReturnValue({ agentId: 'a1', status: 'idle' }),
          cloneAgent: vi.fn().mockReturnValue(mockClone),
          getAllAgents: vi.fn().mockReturnValue(MOCK_AGENTS),
        } as any,
      });
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews/team-1/agents/a1/clone`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(body.clone).toEqual(mockClone);
      } finally {
        await srv.stop();
      }
    });

    it('returns 404 for unknown agent', async () => {
      const srv = createTestServer({
        agentRoster: {
          getAgent: vi.fn().mockReturnValue(undefined),
          getAllAgents: vi.fn().mockReturnValue(MOCK_AGENTS),
        } as any,
      });
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews/team-1/agents/unknown/clone`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(404);
      } finally {
        await srv.stop();
      }
    });

    it('returns 503 when roster not available', async () => {
      const srv = createTestServer({ agentRoster: undefined });
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews/team-1/agents/a1/clone`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(503);
      } finally {
        await srv.stop();
      }
    });
  });

  // ── GET /crews/summary — parentId fallback ──────────────────────

  describe('GET /crews/summary', () => {
    it('groups crew members under their lead using live parentId fallback', async () => {
      const leadId = 'lead-1';
      const devId = 'dev-1';
      // Roster entries: lead has no metadata, dev has no metadata (simulates pre-fix data)
      const rosterAgents = [
        { agentId: leadId, role: 'lead', model: 'gpt-4', status: 'idle', teamId: 'team-1', projectId: 'proj-1', metadata: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        { agentId: devId, role: 'developer', model: 'gpt-4', status: 'running', teamId: 'team-1', projectId: 'proj-1', metadata: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ];
      // Live agents have parentId set
      const liveAgents = [
        { id: leadId, parentId: undefined, status: 'running', projectId: 'proj-1', projectName: 'Test', toJSON: () => ({}) },
        { id: devId, parentId: leadId, status: 'running', projectId: 'proj-1', toJSON: () => ({}) },
      ];

      const srv = createTestServer({
        agentRoster: { getAllAgents: vi.fn().mockReturnValue(rosterAgents) } as any,
        agentManager: { getAll: vi.fn().mockReturnValue(liveAgents) } as any,
        projectRegistry: { get: vi.fn().mockReturnValue(null), getSessions: vi.fn().mockReturnValue([]) } as any,
      });

      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews/summary`);
        expect(res.status).toBe(200);
        const data = await res.json();
        // Both agents should be grouped under lead-1
        expect(data).toHaveLength(1);
        expect(data[0].leadId).toBe(leadId);
        expect(data[0].agentCount).toBe(2);
      } finally {
        await srv.stop();
      }
    });

    it('groups crew members using metadata parentId when available', async () => {
      const rosterAgents = [
        { agentId: 'lead-2', role: 'lead', model: 'gpt-4', status: 'idle', teamId: 'team-1', projectId: 'proj-1', sessionId: 'sess-meta', metadata: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        { agentId: 'dev-2', role: 'developer', model: 'gpt-4', status: 'running', teamId: 'team-1', projectId: 'proj-1', sessionId: 'sess-meta', metadata: { parentId: 'lead-2' }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ];
      // At least one live agent with matching sessionId so the filter includes these roster entries
      const liveAgents = [
        { id: 'lead-2', sessionId: 'sess-meta', status: 'idle', toJSON: () => ({}) },
      ];

      const srv = createTestServer({
        agentRoster: { getAllAgents: vi.fn().mockReturnValue(rosterAgents) } as any,
        agentManager: { getAll: vi.fn().mockReturnValue(liveAgents) } as any,
        projectRegistry: { get: vi.fn().mockReturnValue(null), getSessions: vi.fn().mockReturnValue([]) } as any,
      });

      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews/summary`);
        const data = await res.json();
        expect(data).toHaveLength(1);
        expect(data[0].leadId).toBe('lead-2');
        expect(data[0].agentCount).toBe(2);
      } finally {
        await srv.stop();
      }
    });
  });

  // ── DELETE /crews/:leadId ───────────────────────────────────────

  describe('DELETE /crews/:leadId', () => {
    it('deletes a crew and returns count', async () => {
      const mockDeleteCrew = vi.fn().mockReturnValue(3);
      const mockGetAgent = vi.fn().mockReturnValue({ agentId: 'lead-1', role: 'lead', status: 'terminated' });
      const srv = createTestServer({
        agentRoster: { deleteCrew: mockDeleteCrew, getAgent: mockGetAgent } as any,
        agentManager: { getAll: vi.fn().mockReturnValue([]) } as any,
      });

      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews/lead-1`, { method: 'DELETE' });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);
        expect(data.deleted).toBe(3);
        expect(mockDeleteCrew).toHaveBeenCalledWith('lead-1');
      } finally {
        await srv.stop();
      }
    });

    it('returns 404 when lead not in roster', async () => {
      const srv = createTestServer({
        agentRoster: { getAgent: vi.fn().mockReturnValue(null) } as any,
        agentManager: { getAll: vi.fn().mockReturnValue([]) } as any,
      });

      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews/nonexistent`, { method: 'DELETE' });
        expect(res.status).toBe(404);
      } finally {
        await srv.stop();
      }
    });

    it('returns 409 when crew is still active', async () => {
      const mockGetAgent = vi.fn().mockReturnValue({ agentId: 'lead-1', role: 'lead' });
      const srv = createTestServer({
        agentRoster: { getAgent: mockGetAgent } as any,
        agentManager: { getAll: vi.fn().mockReturnValue([{ id: 'lead-1', status: 'running' }]) } as any,
      });

      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews/lead-1`, { method: 'DELETE' });
        expect(res.status).toBe(409);
      } finally {
        await srv.stop();
      }
    });

    it('returns 503 when roster unavailable', async () => {
      const srv = createTestServer({ agentRoster: undefined });

      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews/lead-1`, { method: 'DELETE' });
        expect(res.status).toBe(503);
      } finally {
        await srv.stop();
      }
    });
  });

  // ── GET /crews/:crewId/agents — provider fallback ─────────────────

  describe('GET /crews/:crewId/agents', () => {
    it('returns provider from roster when live agent is gone (terminated)', async () => {
      const rosterAgents = [
        {
          agentId: 'term-1',
          role: 'developer',
          model: 'gpt-4',
          status: 'terminated',
          teamId: 'team-1',
          provider: 'copilot',
          projectId: 'proj-1',
          sessionId: 'sess-active',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          lastTaskSummary: null,
          metadata: {},
        },
      ];
      // A peer agent from the same session is still live, so the terminated agent passes the session filter
      const srv = createTestServer({
        agentRoster: {
          getAllAgents: vi.fn().mockReturnValue(rosterAgents),
        } as any,
        agentManager: {
          getAll: vi.fn().mockReturnValue([
            { id: 'live-peer', sessionId: 'sess-active', status: 'running' },
          ]),
        } as any,
      });

      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews/team-1/agents`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveLength(1);
        expect(body[0].provider).toBe('copilot');
      } finally {
        await srv.stop();
      }
    });

    it('prefers live provider over roster provider', async () => {
      const rosterAgents = [
        {
          agentId: 'live-1',
          role: 'developer',
          model: 'gpt-4',
          status: 'running',
          teamId: 'team-1',
          provider: 'copilot',
          projectId: null,
          sessionId: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          lastTaskSummary: null,
          metadata: {},
        },
      ];
      const liveAgents = [
        {
          id: 'live-1',
          status: 'running',
          provider: 'claude',
          parentId: undefined,
          toJSON: () => ({
            inputTokens: 100,
            outputTokens: 50,
            contextWindowSize: 200000,
            contextWindowUsed: 1000,
            task: 'test task',
            outputPreview: 'hello',
            provider: 'claude',
          }),
        },
      ];
      const srv = createTestServer({
        agentRoster: {
          getAllAgents: vi.fn().mockReturnValue(rosterAgents),
        } as any,
        agentManager: {
          getAll: vi.fn().mockReturnValue(liveAgents),
        } as any,
      });

      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews/team-1/agents`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveLength(1);
        expect(body[0].provider).toBe('claude');
      } finally {
        await srv.stop();
      }
    });

    it('returns 503 when roster not available', async () => {
      const srv = createTestServer({ agentRoster: undefined });
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews/team-1/agents`);
        expect(res.status).toBe(503);
      } finally {
        await srv.stop();
      }
    });
  });

  // ── Stale agent session filtering ─────────────────────────────────

  describe('stale agent filtering', () => {
    const staleAgent = {
      agentId: 'stale-1', role: 'developer', model: 'gpt-4', status: 'terminated',
      teamId: 'team-1', sessionId: 'sess-old', projectId: 'proj-1',
      metadata: { parentId: 'old-lead' },
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z',
    };
    const currentLead = {
      agentId: 'lead-cur', role: 'lead', model: 'gpt-4', status: 'running',
      teamId: 'team-1', sessionId: 'sess-new', projectId: 'proj-1',
      metadata: null,
      createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z',
    };
    const currentDev = {
      agentId: 'dev-cur', role: 'developer', model: 'gpt-4', status: 'idle',
      teamId: 'team-1', sessionId: 'sess-new', projectId: 'proj-1',
      metadata: { parentId: 'lead-cur' },
      createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z',
    };
    const terminatedCurrent = {
      agentId: 'term-cur', role: 'reviewer', model: 'gpt-4', status: 'terminated',
      teamId: 'team-1', sessionId: 'sess-new', projectId: 'proj-1',
      metadata: { parentId: 'lead-cur' },
      createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z',
    };

    const allRoster = [staleAgent, currentLead, currentDev, terminatedCurrent];
    const liveAgents = [
      { id: 'lead-cur', sessionId: 'sess-new', status: 'running', parentId: undefined, projectId: 'proj-1', projectName: 'Test', toJSON: () => ({}) },
      { id: 'dev-cur', sessionId: 'sess-new', status: 'idle', parentId: 'lead-cur', projectId: 'proj-1', toJSON: () => ({}) },
    ];

    it('GET /crews/summary excludes stale agents from previous sessions', async () => {
      const srv = createTestServer({
        agentRoster: { getAllAgents: vi.fn().mockReturnValue(allRoster) } as any,
        agentManager: { getAll: vi.fn().mockReturnValue(liveAgents) } as any,
        projectRegistry: { get: vi.fn().mockReturnValue(null), getSessions: vi.fn().mockReturnValue([]) } as any,
      });

      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews/summary`);
        expect(res.status).toBe(200);
        const data = await res.json();
        // Only the current session's crew (lead-cur) should appear; stale-1 is excluded
        expect(data).toHaveLength(1);
        expect(data[0].leadId).toBe('lead-cur');
        // Should include lead-cur, dev-cur, and terminated term-cur (same session) but NOT stale-1
        expect(data[0].agentCount).toBe(3);
        const agentIds = data[0].agents.map((a: any) => a.agentId);
        expect(agentIds).toContain('lead-cur');
        expect(agentIds).toContain('dev-cur');
        expect(agentIds).toContain('term-cur');
        expect(agentIds).not.toContain('stale-1');
      } finally {
        await srv.stop();
      }
    });

    it('GET /crews/:crewId/agents excludes stale agents from previous sessions', async () => {
      const srv = createTestServer({
        agentRoster: {
          getAllAgents: vi.fn().mockReturnValue(allRoster.filter(a => a.teamId === 'team-1')),
        } as any,
        agentManager: { getAll: vi.fn().mockReturnValue(liveAgents) } as any,
      });

      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews/team-1/agents`);
        expect(res.status).toBe(200);
        const body = await res.json();
        // 3 current-session agents, stale-1 excluded
        expect(body).toHaveLength(3);
        const ids = body.map((a: any) => a.agentId);
        expect(ids).not.toContain('stale-1');
        expect(ids).toContain('term-cur');
      } finally {
        await srv.stop();
      }
    });

    it('GET /crews returns empty crews list when no agents are live', async () => {
      const srv = createTestServer({
        agentRoster: { getAllAgents: vi.fn().mockReturnValue(allRoster) } as any,
        agentManager: { getAll: vi.fn().mockReturnValue([]) } as any,
      });

      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.crews).toHaveLength(0);
      } finally {
        await srv.stop();
      }
    });

    it('GET /crews/summary returns empty when no agents are live', async () => {
      const srv = createTestServer({
        agentRoster: { getAllAgents: vi.fn().mockReturnValue(allRoster) } as any,
        agentManager: { getAll: vi.fn().mockReturnValue([]) } as any,
        projectRegistry: { get: vi.fn().mockReturnValue(null), getSessions: vi.fn().mockReturnValue([]) } as any,
      });

      const base = await srv.start();
      try {
        const res = await fetch(`${base}/crews/summary`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toHaveLength(0);
      } finally {
        await srv.stop();
      }
    });
  });
});
