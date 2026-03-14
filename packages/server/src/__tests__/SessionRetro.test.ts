import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionRetro, type SessionRetroData } from '../coordination/sessions/SessionRetro.js';

// ── Mock helpers ──────────────────────────────────────────────────────────

function createMockDb() {
  const insertRun = vi.fn();
  const selectAll = vi.fn().mockReturnValue([]);
  return {
    drizzle: {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({ run: insertRun }),
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({ all: selectAll }),
          }),
        }),
      }),
    },
    _insertRun: insertRun,
    _selectAll: selectAll,
  };
}

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'agent-1',
    parentId: 'lead-1',
    role: { name: 'Developer' },
    model: 'claude-sonnet',
    status: 'running',
    createdAt: new Date(Date.now() - 300_000),
    contextWindowUsed: 50_000,
    contextWindowSize: 200_000,
    ...overrides,
  };
}

function makeEvent(overrides: Record<string, any> = {}) {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 6)}`,
    agentId: 'agent-1',
    actionType: 'status_change',
    timestamp: new Date().toISOString(),
    details: {},
    ...overrides,
  };
}

function createMockDeps() {
  const db = createMockDb();
  const agentManager = {
    getAll: vi.fn().mockReturnValue([]),
  };
  const activityLedger = {
    getRecent: vi.fn().mockReturnValue([]),
  };
  const decisionLog = {
    getByLeadId: vi.fn().mockReturnValue([]),
  };
  const taskDAG = {
    getTasks: vi.fn().mockReturnValue([]),
  };
  const lockRegistry = {};
  return { db, agentManager, activityLedger, decisionLog, taskDAG, lockRegistry };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('SessionRetro', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let retro: SessionRetro;

  beforeEach(() => {
    deps = createMockDeps();
    retro = new SessionRetro(
      deps.db as any,
      deps.agentManager as any,
      deps.activityLedger as any,
      deps.decisionLog as any,
      deps.taskDAG as any,
      deps.lockRegistry as any,
    );
  });

  // ── generateRetro ────────────────────────────────────────────────────

  describe('generateRetro', () => {
    it('generates retro with empty team', () => {
      const data = retro.generateRetro('lead-1');

      expect(data.generatedAt).toBeDefined();
      expect(data.summary.leadId).toBe('lead-1');
      expect(data.summary.totalAgents).toBe(0);
      expect(data.scorecards).toHaveLength(0);
      expect(data.bottlenecks).toHaveLength(0);
      expect(deps.db._insertRun).toHaveBeenCalled();
    });

    it('includes team agents (lead + children)', () => {
      const lead = makeAgent({ id: 'lead-1', parentId: undefined, role: { name: 'Lead' } });
      const dev1 = makeAgent({ id: 'dev-1', parentId: 'lead-1' });
      const dev2 = makeAgent({ id: 'dev-2', parentId: 'lead-1' });
      const otherAgent = makeAgent({ id: 'other-1', parentId: 'other-lead' });
      deps.agentManager.getAll.mockReturnValue([lead, dev1, dev2, otherAgent]);

      const data = retro.generateRetro('lead-1');

      expect(data.summary.totalAgents).toBe(3);
      expect(data.scorecards).toHaveLength(3);
      const ids = data.scorecards.map(s => s.agentId);
      expect(ids).toContain('lead-1');
      expect(ids).toContain('dev-1');
      expect(ids).toContain('dev-2');
      expect(ids).not.toContain('other-1');
    });

    it('stores retro in database', () => {
      const _data = retro.generateRetro('lead-1');

      expect(deps.db.drizzle.insert).toHaveBeenCalled();
      expect(deps.db._insertRun).toHaveBeenCalled();
    });
  });

  // ── getRetros ────────────────────────────────────────────────────────

  describe('getRetros', () => {
    it('returns parsed retro data', () => {
      const sampleRetro: SessionRetroData = {
        generatedAt: '2026-01-01T00:00:00.000Z',
        summary: {
          leadId: 'lead-1',
          timeSpan: { start: '2026-01-01T00:00:00.000Z', end: '2026-01-01T01:00:00.000Z', durationMs: 3600000 },
          totalAgents: 2, totalTokens: 100000, totalEvents: 50,
          totalDecisions: 5, decisionsConfirmed: 3, decisionsRejected: 1,
          dagTasksTotal: 10, dagTasksDone: 8, dagTasksFailed: 1,
        },
        scorecards: [],
        bottlenecks: [],
      };
      deps.db._selectAll.mockReturnValue([
        { id: 1, leadId: 'lead-1', createdAt: '2026-01-01T00:00:00.000Z', data: JSON.stringify(sampleRetro) },
      ]);

      const rows = retro.getRetros('lead-1');

      expect(rows).toHaveLength(1);
      expect(rows[0].data.summary.leadId).toBe('lead-1');
      expect(rows[0].data.summary.totalAgents).toBe(2);
    });

    it('returns empty array when no retros exist', () => {
      const rows = retro.getRetros('lead-1');
      expect(rows).toHaveLength(0);
    });
  });

  // ── buildScorecard (via generateRetro) ───────────────────────────────

  describe('scorecard building', () => {
    it('counts task events correctly', () => {
      const agent = makeAgent({ id: 'dev-1' });
      deps.agentManager.getAll.mockReturnValue([agent]);
      deps.activityLedger.getRecent.mockReturnValue([
        makeEvent({ agentId: 'dev-1', actionType: 'task_started' }),
        makeEvent({ agentId: 'dev-1', actionType: 'task_completed' }),
        makeEvent({ agentId: 'dev-1', actionType: 'task_started' }),
        makeEvent({ agentId: 'dev-1', actionType: 'task_completed' }),
        makeEvent({ agentId: 'dev-1', actionType: 'task_started' }),
      ]);

      const data = retro.generateRetro('lead-1');
      const sc = data.scorecards[0];

      expect(sc.tasksCompleted).toBe(2);
      expect(sc.tasksTotal).toBe(5); // 3 started + 2 completed
    });

    it('tracks files touched from lock events', () => {
      const agent = makeAgent({ id: 'dev-1' });
      deps.agentManager.getAll.mockReturnValue([agent]);
      deps.activityLedger.getRecent.mockReturnValue([
        makeEvent({ agentId: 'dev-1', actionType: 'lock_acquired', details: { filePath: 'src/a.ts' } }),
        makeEvent({ agentId: 'dev-1', actionType: 'lock_acquired', details: { filePath: 'src/b.ts' } }),
        makeEvent({ agentId: 'dev-1', actionType: 'lock_acquired', details: { filePath: 'src/a.ts' } }),
      ]);

      const data = retro.generateRetro('lead-1');
      const sc = data.scorecards[0];

      expect(sc.filesTouched).toHaveLength(2); // deduped
      expect(sc.filesTouched).toContain('src/a.ts');
      expect(sc.filesTouched).toContain('src/b.ts');
    });

    it('calculates context utilization', () => {
      const agent = makeAgent({ contextWindowUsed: 160_000, contextWindowSize: 200_000 });
      deps.agentManager.getAll.mockReturnValue([agent]);

      const data = retro.generateRetro('lead-1');
      expect(data.scorecards[0].contextUtilization).toBe(0.8);
    });

    it('handles zero context window size', () => {
      const agent = makeAgent({ contextWindowUsed: 0, contextWindowSize: 0 });
      deps.agentManager.getAll.mockReturnValue([agent]);

      const data = retro.generateRetro('lead-1');
      expect(data.scorecards[0].contextUtilization).toBe(0);
    });

    it('calculates active/idle time from status changes', () => {
      const agent = makeAgent({ id: 'dev-1' });
      deps.agentManager.getAll.mockReturnValue([agent]);

      const base = Date.now();
      deps.activityLedger.getRecent.mockReturnValue([
        makeEvent({ agentId: 'dev-1', actionType: 'status_change', timestamp: new Date(base).toISOString(), details: { status: 'running' } }),
        makeEvent({ agentId: 'dev-1', actionType: 'status_change', timestamp: new Date(base + 60_000).toISOString(), details: { status: 'idle' } }),
        makeEvent({ agentId: 'dev-1', actionType: 'status_change', timestamp: new Date(base + 90_000).toISOString(), details: { status: 'running' } }),
      ]);

      const data = retro.generateRetro('lead-1');
      const sc = data.scorecards[0];

      expect(sc.activeTimeMs).toBe(60_000);
      expect(sc.idleTimeMs).toBe(30_000);
    });
  });

  // ── Summary ──────────────────────────────────────────────────────────

  describe('summary building', () => {
    it('aggregates tokens across team', () => {
      const agents = [
        makeAgent({ id: 'lead-1', parentId: undefined, contextWindowUsed: 80_000 }),
        makeAgent({ id: 'dev-1', contextWindowUsed: 120_000 }),
      ];
      deps.agentManager.getAll.mockReturnValue(agents);

      const data = retro.generateRetro('lead-1');
      expect(data.summary.totalTokens).toBe(200_000);
    });

    it('counts decisions by status', () => {
      deps.agentManager.getAll.mockReturnValue([makeAgent({ id: 'lead-1', parentId: undefined })]);
      deps.decisionLog.getByLeadId.mockReturnValue([
        { status: 'confirmed' },
        { status: 'confirmed' },
        { status: 'rejected' },
        { status: 'pending' },
      ]);

      const data = retro.generateRetro('lead-1');
      expect(data.summary.totalDecisions).toBe(4);
      expect(data.summary.decisionsConfirmed).toBe(2);
      expect(data.summary.decisionsRejected).toBe(1);
    });

    it('counts DAG tasks by status', () => {
      deps.agentManager.getAll.mockReturnValue([makeAgent({ id: 'lead-1', parentId: undefined })]);
      deps.taskDAG.getTasks.mockReturnValue([
        { dagStatus: 'done' },
        { dagStatus: 'done' },
        { dagStatus: 'done' },
        { dagStatus: 'failed' },
        { dagStatus: 'running' },
      ]);

      const data = retro.generateRetro('lead-1');
      expect(data.summary.dagTasksTotal).toBe(5);
      expect(data.summary.dagTasksDone).toBe(3);
      expect(data.summary.dagTasksFailed).toBe(1);
    });

    it('computes correct time span from events', () => {
      const agent = makeAgent({ id: 'dev-1' });
      deps.agentManager.getAll.mockReturnValue([agent]);
      deps.activityLedger.getRecent.mockReturnValue([
        makeEvent({ agentId: 'dev-1', timestamp: '2026-01-01T10:00:00.000Z' }),
        makeEvent({ agentId: 'dev-1', timestamp: '2026-01-01T11:00:00.000Z' }),
        makeEvent({ agentId: 'dev-1', timestamp: '2026-01-01T10:30:00.000Z' }),
      ]);

      const data = retro.generateRetro('lead-1');
      expect(data.summary.timeSpan.start).toBe('2026-01-01T10:00:00.000Z');
      expect(data.summary.timeSpan.end).toBe('2026-01-01T11:00:00.000Z');
      expect(data.summary.timeSpan.durationMs).toBe(3_600_000);
    });
  });

  // ── Bottlenecks ──────────────────────────────────────────────────────

  describe('bottleneck detection', () => {
    it('detects idle agents (>1min)', () => {
      const agent = makeAgent({ id: 'dev-1' });
      deps.agentManager.getAll.mockReturnValue([agent]);

      const base = Date.now();
      deps.activityLedger.getRecent.mockReturnValue([
        makeEvent({ agentId: 'dev-1', actionType: 'status_change', timestamp: new Date(base).toISOString(), details: { status: 'idle' } }),
        makeEvent({ agentId: 'dev-1', actionType: 'status_change', timestamp: new Date(base + 120_000).toISOString(), details: { status: 'running' } }),
      ]);

      const data = retro.generateRetro('lead-1');
      const idleBottlenecks = data.bottlenecks.filter(b => b.type === 'idle_time');
      expect(idleBottlenecks.length).toBeGreaterThanOrEqual(1);
      expect(idleBottlenecks[0].value).toBe(120_000);
    });

    it('skips idle under 1 minute', () => {
      const agent = makeAgent({ id: 'dev-1' });
      deps.agentManager.getAll.mockReturnValue([agent]);

      const base = Date.now();
      deps.activityLedger.getRecent.mockReturnValue([
        makeEvent({ agentId: 'dev-1', actionType: 'status_change', timestamp: new Date(base).toISOString(), details: { status: 'idle' } }),
        makeEvent({ agentId: 'dev-1', actionType: 'status_change', timestamp: new Date(base + 30_000).toISOString(), details: { status: 'running' } }),
      ]);

      const data = retro.generateRetro('lead-1');
      const idleBottlenecks = data.bottlenecks.filter(b => b.type === 'idle_time');
      expect(idleBottlenecks).toHaveLength(0);
    });

    it('detects context pressure (>80%)', () => {
      const agent = makeAgent({ id: 'dev-1', contextWindowUsed: 180_000, contextWindowSize: 200_000 });
      deps.agentManager.getAll.mockReturnValue([agent]);

      const data = retro.generateRetro('lead-1');
      const pressured = data.bottlenecks.filter(b => b.type === 'context_pressure');
      expect(pressured).toHaveLength(1);
      expect(pressured[0].value).toBe(0.9);
      expect(pressured[0].description).toContain('90%');
    });

    it('does not flag context under 80%', () => {
      const agent = makeAgent({ id: 'dev-1', contextWindowUsed: 100_000, contextWindowSize: 200_000 });
      deps.agentManager.getAll.mockReturnValue([agent]);

      const data = retro.generateRetro('lead-1');
      const pressured = data.bottlenecks.filter(b => b.type === 'context_pressure');
      expect(pressured).toHaveLength(0);
    });

    it('detects stuck agents (running >10min, 0 tasks)', () => {
      const agent = makeAgent({ id: 'dev-1', status: 'running' });
      deps.agentManager.getAll.mockReturnValue([agent]);

      const base = Date.now();
      deps.activityLedger.getRecent.mockReturnValue([
        makeEvent({ agentId: 'dev-1', actionType: 'status_change', timestamp: new Date(base).toISOString(), details: { status: 'running' } }),
        makeEvent({ agentId: 'dev-1', actionType: 'status_change', timestamp: new Date(base + 900_000).toISOString(), details: { status: 'running' } }),
      ]);

      const data = retro.generateRetro('lead-1');
      const stuck = data.bottlenecks.filter(b => b.type === 'stuck');
      expect(stuck).toHaveLength(1);
      expect(stuck[0].description).toContain('no completed tasks');
    });

    it('limits idle bottlenecks to top 3', () => {
      const agents = Array.from({ length: 5 }, (_, i) =>
        makeAgent({ id: `dev-${i}`, parentId: 'lead-1' })
      );
      deps.agentManager.getAll.mockReturnValue(agents);

      const base = Date.now();
      const events = agents.flatMap((a, i) => [
        makeEvent({ agentId: a.id, actionType: 'status_change', timestamp: new Date(base).toISOString(), details: { status: 'idle' } }),
        makeEvent({ agentId: a.id, actionType: 'status_change', timestamp: new Date(base + (i + 2) * 60_000).toISOString(), details: { status: 'running' } }),
      ]);
      deps.activityLedger.getRecent.mockReturnValue(events);

      const data = retro.generateRetro('lead-1');
      const idleBottlenecks = data.bottlenecks.filter(b => b.type === 'idle_time');
      expect(idleBottlenecks.length).toBeLessThanOrEqual(3);
    });
  });
});
