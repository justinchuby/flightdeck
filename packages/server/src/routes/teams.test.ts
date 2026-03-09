/**
 * Teams route tests.
 *
 * Covers: export (JSON + directory), import stub, list teams,
 * team details, error handling, and missing dependencies.
 */
import { describe, it, expect, vi, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { Request, Response, NextFunction } from 'express';

// Bypass rate limiters in tests
vi.mock('../middleware/rateLimit.js', () => ({
  rateLimit: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

import { teamsRoutes } from './teams.js';
import type { AppContext } from './context.js';

// ── Mock Data ───────────────────────────────────────────────────────

const MOCK_AGENTS = [
  { agentId: 'a1', role: 'architect', model: 'gpt-4', status: 'idle', teamId: 'team-1' },
  { agentId: 'a2', role: 'developer', model: 'gpt-4', status: 'busy', teamId: 'team-1' },
  { agentId: 'a3', role: 'reviewer', model: 'gpt-4', status: 'idle', teamId: 'team-2' },
];

const MOCK_BUNDLE = {
  manifest: {
    bundleFormat: '1.0',
    exportedAt: '2026-01-01T00:00:00Z',
    checksum: 'a'.repeat(64),
    stats: { agentCount: 2, knowledgeCount: 1, correctionCount: 0, feedbackCount: 0 },
  },
  agents: [{ name: 'a1', role: 'architect', model: 'gpt-4', status: 'idle', config: {} }],
  knowledge: { core: [], procedural: [], semantic: [], episodic: [] },
  training: { corrections: [], feedback: [] },
};

const MOCK_EXPORT_RESULT = {
  bundle: MOCK_BUNDLE,
  outputDir: '/tmp/test.flightdeck-team',
  filesWritten: ['/tmp/test.flightdeck-team/manifest.json'],
};

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
    agentManager: {} as any,
    roleRegistry: {} as any,
    config: {} as any,
    db: {} as any,
    lockRegistry: {} as any,
    activityLedger: {} as any,
    decisionLog: {} as any,
    teamExporter: {
      exportBundle: vi.fn().mockReturnValue(MOCK_BUNDLE),
      exportToDirectory: vi.fn().mockReturnValue(MOCK_EXPORT_RESULT),
    } as any,
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
    teamImporter: {
      import: vi.fn().mockReturnValue({
        success: true,
        teamId: 'team-1',
        validation: { valid: true, issues: [] },
        agents: [{ name: 'a1', action: 'created', newAgentId: 'new-1' }],
        knowledge: { imported: 1, skipped: 0, conflicts: 0 },
        training: { correctionsImported: 0, feedbackImported: 0 },
        warnings: [],
      }),
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
  app.use(teamsRoutes(ctx));

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

describe('teamsRoutes', () => {
  // ── POST /teams/:teamId/export ──────────────────────────────────

  describe('POST /teams/:teamId/export', () => {
    it('exports team as JSON when no outputPath', async () => {
      const srv = createTestServer();
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/teams/team-1/export`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.bundle).toBeDefined();
        expect(body.bundle.manifest.bundleFormat).toBe('1.0');
      } finally {
        await srv.stop();
      }
    });

    it('exports team to directory when outputPath provided', async () => {
      const srv = createTestServer();
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/teams/team-1/export`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ outputPath: '/tmp/export' }),
        });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.bundlePath).toBe('/tmp/test.flightdeck-team');
        expect(body.filesWritten).toBe(1);
      } finally {
        await srv.stop();
      }
    });

    it('passes filter options to exporter', async () => {
      const srv = createTestServer();
      const base = await srv.start();
      try {
        await fetch(`${base}/teams/team-1/export`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agents: ['a1'],
            categories: ['core'],
            includeTraining: false,
            excludeEpisodic: true,
          }),
        });

        expect(srv.ctx.teamExporter!.exportBundle).toHaveBeenCalledWith('team-1', {
          agentIds: ['a1'],
          categories: ['core'],
          includeKnowledge: undefined,
          includeTraining: false,
          excludeEpisodic: true,
        });
      } finally {
        await srv.stop();
      }
    });

    it('returns 503 when exporter not available', async () => {
      const srv = createTestServer({ teamExporter: undefined });
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/teams/team-1/export`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(503);
      } finally {
        await srv.stop();
      }
    });

    it('returns 500 on export error', async () => {
      const srv = createTestServer({
        teamExporter: {
          exportBundle: vi.fn().mockImplementation(() => { throw new Error('disk full'); }),
          exportToDirectory: vi.fn(),
        } as any,
      });
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/teams/team-1/export`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const body = await res.json();
        expect(res.status).toBe(500);
        expect(body.error).toContain('disk full');
      } finally {
        await srv.stop();
      }
    });
  });

  // ── POST /teams/import ──────────────────────────────────────────

  describe('POST /teams/import', () => {
    it('imports a valid bundle', async () => {
      const srv = createTestServer();
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/teams/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bundle: MOCK_BUNDLE, projectId: 'proj-1' }),
        });
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.report.teamId).toBe('team-1');
      } finally {
        await srv.stop();
      }
    });

    it('returns 400 when bundle missing', async () => {
      const srv = createTestServer();
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/teams/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'proj-1' }),
        });
        expect(res.status).toBe(400);
      } finally {
        await srv.stop();
      }
    });

    it('returns 400 when projectId missing', async () => {
      const srv = createTestServer();
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/teams/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bundle: MOCK_BUNDLE }),
        });
        expect(res.status).toBe(400);
      } finally {
        await srv.stop();
      }
    });

    it('returns 422 when validation fails', async () => {
      const srv = createTestServer({
        teamImporter: {
          import: vi.fn().mockReturnValue({
            success: false,
            teamId: 'team-1',
            validation: { valid: false, issues: [{ phase: 'integrity', severity: 'error', message: 'bad checksum' }] },
            agents: [],
            knowledge: { imported: 0, skipped: 0, conflicts: 0 },
            training: { correctionsImported: 0, feedbackImported: 0 },
            warnings: [],
          }),
        } as any,
      });
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/teams/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bundle: MOCK_BUNDLE, projectId: 'proj-1' }),
        });
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.success).toBe(false);
      } finally {
        await srv.stop();
      }
    });

    it('returns 503 when importer not available', async () => {
      const srv = createTestServer({ teamImporter: undefined });
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/teams/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bundle: MOCK_BUNDLE, projectId: 'proj-1' }),
        });
        expect(res.status).toBe(503);
      } finally {
        await srv.stop();
      }
    });
  });

  // ── GET /teams ──────────────────────────────────────────────────

  describe('GET /teams', () => {
    it('returns grouped teams with agent counts', async () => {
      const srv = createTestServer();
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/teams`);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.teams).toHaveLength(2);

        const team1 = body.teams.find((t: any) => t.teamId === 'team-1');
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
        const res = await fetch(`${base}/teams`);
        expect(res.status).toBe(503);
      } finally {
        await srv.stop();
      }
    });
  });

  // ── GET /teams/:teamId ──────────────────────────────────────────

  describe('GET /teams/:teamId', () => {
    it('returns team details with agents and knowledge count', async () => {
      const srv = createTestServer();
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/teams/team-1`);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.teamId).toBe('team-1');
        expect(body.agentCount).toBe(2);
        expect(body.agents).toHaveLength(2);
        expect(body.knowledgeCount).toBe(10);
        expect(body.trainingSummary).toBeDefined();
      } finally {
        await srv.stop();
      }
    });

    it('returns 404 for unknown team', async () => {
      const srv = createTestServer();
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/teams/nonexistent`);
        expect(res.status).toBe(404);
      } finally {
        await srv.stop();
      }
    });

    it('returns 503 when roster not available', async () => {
      const srv = createTestServer({ agentRoster: undefined });
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/teams/team-1`);
        expect(res.status).toBe(503);
      } finally {
        await srv.stop();
      }
    });
  });

  // ── GET /teams/:teamId/health ───────────────────────────────────

  describe('GET /teams/:teamId/health', () => {
    it('returns health with status counts and agents', async () => {
      const srv = createTestServer({
        agentRoster: {
          getAllAgents: vi.fn().mockReturnValue(MOCK_AGENTS),
          getStatusCounts: vi.fn().mockReturnValue({ idle: 1, busy: 2, retired: 0, terminated: 0 }),
        } as any,
      });
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/teams/team-1/health`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.teamId).toBe('team-1');
        expect(body.totalAgents).toBe(3);
        expect(body.statusCounts).toEqual({ idle: 1, busy: 2, retired: 0, terminated: 0 });
        expect(body.massFailurePaused).toBe(false);
        expect(body.agents).toHaveLength(3);
        expect(body.agents[0]).toHaveProperty('uptimeMs');
      } finally {
        await srv.stop();
      }
    });

    it('shows mass failure paused when detector triggered', async () => {
      const srv = createTestServer({
        agentRoster: {
          getAllAgents: vi.fn().mockReturnValue(MOCK_AGENTS),
          getStatusCounts: vi.fn().mockReturnValue({ idle: 1, busy: 2 }),
        } as any,
        massFailureDetector: {
          get isPaused() { return true; },
        } as any,
      });
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/teams/team-1/health`);
        const body = await res.json();
        expect(body.massFailurePaused).toBe(true);
      } finally {
        await srv.stop();
      }
    });

    it('returns 404 for empty team', async () => {
      const srv = createTestServer({
        agentRoster: {
          getAllAgents: vi.fn().mockReturnValue([]),
          getStatusCounts: vi.fn().mockReturnValue({}),
        } as any,
      });
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/teams/nonexistent/health`);
        expect(res.status).toBe(404);
      } finally {
        await srv.stop();
      }
    });

    it('returns 503 when roster not available', async () => {
      const srv = createTestServer({ agentRoster: undefined });
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/teams/team-1/health`);
        expect(res.status).toBe(503);
      } finally {
        await srv.stop();
      }
    });
  });

  // ── POST /teams/:teamId/agents/:agentId/retire ─────────────────

  describe('POST /teams/:teamId/agents/:agentId/retire', () => {
    it('retires an agent', async () => {
      const srv = createTestServer({
        agentRoster: {
          getAgent: vi.fn().mockReturnValue({ agentId: 'a1', status: 'idle' }),
          retireAgent: vi.fn().mockReturnValue(true),
          getAllAgents: vi.fn().mockReturnValue(MOCK_AGENTS),
        } as any,
      });
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/teams/team-1/agents/a1/retire`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'end of project' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(body.status).toBe('retired');
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
        const res = await fetch(`${base}/teams/team-1/agents/unknown/retire`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(404);
      } finally {
        await srv.stop();
      }
    });

    it('returns 409 if already retired', async () => {
      const srv = createTestServer({
        agentRoster: {
          getAgent: vi.fn().mockReturnValue({ agentId: 'a1', status: 'retired' }),
          getAllAgents: vi.fn().mockReturnValue(MOCK_AGENTS),
        } as any,
      });
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/teams/team-1/agents/a1/retire`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toContain('already retired');
      } finally {
        await srv.stop();
      }
    });

    it('returns 503 when roster not available', async () => {
      const srv = createTestServer({ agentRoster: undefined });
      const base = await srv.start();
      try {
        const res = await fetch(`${base}/teams/team-1/agents/a1/retire`, {
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

  // ── POST /teams/:teamId/agents/:agentId/clone ──────────────────

  describe('POST /teams/:teamId/agents/:agentId/clone', () => {
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
        const res = await fetch(`${base}/teams/team-1/agents/a1/clone`, {
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
        const res = await fetch(`${base}/teams/team-1/agents/unknown/clone`, {
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
        const res = await fetch(`${base}/teams/team-1/agents/a1/clone`, {
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
        { agentId: devId, role: 'developer', model: 'gpt-4', status: 'busy', teamId: 'team-1', projectId: 'proj-1', metadata: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
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
        { agentId: 'lead-2', role: 'lead', model: 'gpt-4', status: 'idle', teamId: 'team-1', projectId: 'proj-1', metadata: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        { agentId: 'dev-2', role: 'developer', model: 'gpt-4', status: 'busy', teamId: 'team-1', projectId: 'proj-1', metadata: { parentId: 'lead-2' }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ];

      const srv = createTestServer({
        agentRoster: { getAllAgents: vi.fn().mockReturnValue(rosterAgents) } as any,
        agentManager: { getAll: vi.fn().mockReturnValue([]) } as any,
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
});
