import { describe, it, expect, vi } from 'vitest';
import { SessionReplay } from '../coordination/sessions/SessionReplay.js';
import type { ActivityLedger, ActivityEntry } from '../coordination/activity/ActivityLedger.js';
import type { TaskDAG, DagTask } from '../tasks/TaskDAG.js';
import type { DecisionLog, Decision } from '../coordination/decisions/DecisionLog.js';
import type { FileLockRegistry, FileLock } from '../coordination/files/FileLockRegistry.js';

// ── Helpers ───────────────────────────────────────────────────────

const T1 = '2026-03-05T10:00:00.000Z';
const T2 = '2026-03-05T10:05:00.000Z';
const T3 = '2026-03-05T10:10:00.000Z';

function makeActivity(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 1,
    agentId: 'agent-1',
    agentRole: 'developer',
    actionType: 'file_edit',
    summary: 'Edited src/index.ts',
    details: {},
    timestamp: T1,
    projectId: 'proj-1',
    ...overrides,
  };
}

function makeTask(overrides: Partial<DagTask> = {}): DagTask {
  return {
    id: 'task-1',
    leadId: 'lead-1',
    role: 'developer',
    description: 'Test task',
    files: [],
    dependsOn: [],
    dagStatus: 'pending',
    priority: 1,
    createdAt: T1,
    ...overrides,
  };
}

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'dec-1',
    agentId: 'agent-1',
    agentRole: 'developer',
    leadId: 'lead-1',
    projectId: 'proj-1',
    title: 'Use prettier',
    rationale: 'Consistent formatting',
    needsConfirmation: true,
    status: 'recorded',
    autoApproved: false,
    confirmedAt: null,
    timestamp: T1,
    category: 'style',
    ...overrides,
  };
}

function makeLock(overrides: Partial<FileLock> = {}): FileLock {
  return {
    filePath: 'src/index.ts',
    agentId: 'agent-1',
    agentRole: 'developer',
    projectId: 'proj-1',
    reason: 'editing',
    acquiredAt: T1,
    expiresAt: T3,
    ...overrides,
  };
}

function makeMocks(overrides: {
  activities?: ActivityEntry[];
  tasks?: DagTask[];
  decisions?: Decision[];
  locks?: FileLock[];
  agents?: Array<{ id: string; parentId?: string; projectId?: string }>;
} = {}) {
  const activityLedger = {
    getUntil: vi.fn(() => overrides.activities ?? []),
  } as unknown as ActivityLedger;

  const taskDAG = {
    getTasksAt: vi.fn(() => overrides.tasks ?? []),
  } as unknown as TaskDAG;

  const decisionLog = {
    getDecisionsAt: vi.fn(() => overrides.decisions ?? []),
  } as unknown as DecisionLog;

  const lockRegistry = {
    getLocksAt: vi.fn(() => overrides.locks ?? []),
  } as unknown as FileLockRegistry;

  const agentSource = {
    getAll: vi.fn(() => overrides.agents ?? []),
  };

  return { activityLedger, taskDAG, decisionLog, lockRegistry, agentSource };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('SessionReplay', () => {
  it('returns empty world state when no data exists', () => {
    const mocks = makeMocks();
    const replay = new SessionReplay(mocks.activityLedger, mocks.taskDAG, mocks.decisionLog, mocks.lockRegistry, mocks.agentSource);

    const state = replay.getWorldStateAt('lead-1', T2);
    expect(state.timestamp).toBe(T2);
    expect(state.agents).toEqual([]);
    expect(state.dagTasks).toEqual([]);
    expect(state.decisions).toEqual([]);
    expect(state.locks).toEqual([]);
    expect(state.recentActivity).toEqual([]);
  });

  it('passes correct parameters to data sources', () => {
    const mocks = makeMocks();
    const replay = new SessionReplay(mocks.activityLedger, mocks.taskDAG, mocks.decisionLog, mocks.lockRegistry, mocks.agentSource);

    replay.getWorldStateAt('lead-1', T2);

    // resolveActivities tries projectId first, then falls back to unfiltered
    expect(mocks.activityLedger.getUntil).toHaveBeenCalledWith(T2, 'lead-1', 10_000);
    expect(mocks.activityLedger.getUntil).toHaveBeenCalledWith(T2, undefined, 10_000);
    expect(mocks.taskDAG.getTasksAt).toHaveBeenCalledWith('lead-1', T2);
    expect(mocks.decisionLog.getDecisionsAt).toHaveBeenCalledWith('lead-1', T2);
    expect(mocks.lockRegistry.getLocksAt).toHaveBeenCalledWith(T2);
  });

  it('extracts agent roster from spawn events', () => {
    const activities = [
      makeActivity({
        actionType: 'sub_agent_spawned',
        summary: 'Spawned developer',
        details: { childId: 'dev-1', role: 'developer' },
        timestamp: T1,
      }),
      makeActivity({
        actionType: 'sub_agent_spawned',
        summary: 'Spawned architect',
        details: { childId: 'arch-1', role: 'architect' },
        timestamp: T2,
      }),
    ];
    const mocks = makeMocks({ activities });
    const replay = new SessionReplay(mocks.activityLedger, mocks.taskDAG, mocks.decisionLog, mocks.lockRegistry, mocks.agentSource);

    const state = replay.getWorldStateAt('lead-1', T3);
    expect(state.agents).toHaveLength(2);
    expect(state.agents[0].id).toBe('dev-1');
    expect(state.agents[0].role).toBe('developer');
    expect(state.agents[0].status).toBe('running');
    expect(state.agents[1].id).toBe('arch-1');
  });

  it('marks agents as completed/terminated from events', () => {
    const activities = [
      makeActivity({
        actionType: 'sub_agent_spawned',
        agentId: 'dev-1',
        details: { childId: 'dev-1', role: 'developer' },
        timestamp: T1,
      }),
      makeActivity({
        actionType: 'task_completed',
        agentId: 'dev-1',
        timestamp: T2,
      }),
    ];
    const mocks = makeMocks({ activities });
    const replay = new SessionReplay(mocks.activityLedger, mocks.taskDAG, mocks.decisionLog, mocks.lockRegistry, mocks.agentSource);

    const state = replay.getWorldStateAt('lead-1', T3);
    expect(state.agents[0].status).toBe('completed');
  });

  it('includes tasks, decisions, and locks in state', () => {
    const mocks = makeMocks({
      tasks: [makeTask()],
      decisions: [makeDecision()],
      locks: [makeLock()],
    });
    const replay = new SessionReplay(mocks.activityLedger, mocks.taskDAG, mocks.decisionLog, mocks.lockRegistry, mocks.agentSource);

    const state = replay.getWorldStateAt('lead-1', T2);
    expect(state.dagTasks).toHaveLength(1);
    expect(state.decisions).toHaveLength(1);
    expect(state.locks).toHaveLength(1);
  });

  it('limits recentActivity to last 20 entries', () => {
    const activities = Array.from({ length: 30 }, (_, i) =>
      makeActivity({ id: i + 1, timestamp: `2026-03-05T10:${String(i).padStart(2, '0')}:00.000Z` }),
    );
    const mocks = makeMocks({ activities });
    const replay = new SessionReplay(mocks.activityLedger, mocks.taskDAG, mocks.decisionLog, mocks.lockRegistry, mocks.agentSource);

    const state = replay.getWorldStateAt('lead-1', T3);
    expect(state.recentActivity).toHaveLength(20);
  });

  it('caches results for the same leadId + timestamp', () => {
    const mocks = makeMocks();
    const replay = new SessionReplay(mocks.activityLedger, mocks.taskDAG, mocks.decisionLog, mocks.lockRegistry, mocks.agentSource);

    const s1 = replay.getWorldStateAt('lead-1', T2);
    const s2 = replay.getWorldStateAt('lead-1', T2);
    expect(s1).toBe(s2); // same reference = cached
    // resolveActivities: projectId-filtered (empty) + unfiltered (empty) = 2 calls
    // Second call: served from cache = 0 additional calls
    const callCount = (mocks.activityLedger.getUntil as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callCount).toBe(2);
  });

  describe('getKeyframes', () => {
    it('extracts keyframes from significant events', () => {
      const activities = [
        makeActivity({ actionType: 'sub_agent_spawned', summary: 'Spawned dev', timestamp: T1 }),
        makeActivity({ actionType: 'file_edit', summary: 'Edited file', timestamp: T1 }), // not a keyframe
        makeActivity({ actionType: 'task_completed', summary: 'Task done', timestamp: T2 }),
        makeActivity({ actionType: 'error', summary: 'Something broke', timestamp: T3 }),
      ];
      const mocks = makeMocks({ activities });
      // getKeyframes calls resolveActivities → getUntil internally
      (mocks.activityLedger.getUntil as ReturnType<typeof vi.fn>).mockReturnValue(activities);
      const replay = new SessionReplay(mocks.activityLedger, mocks.taskDAG, mocks.decisionLog, mocks.lockRegistry, mocks.agentSource);

      const keyframes = replay.getKeyframes('lead-1');
      expect(keyframes).toHaveLength(3); // spawn, milestone, error — not file_edit
      expect(keyframes[0].type).toBe('spawn');
      expect(keyframes[1].type).toBe('milestone');
      expect(keyframes[2].type).toBe('error');
    });

    it('emits spawn keyframe with correct child agentId from delegation details', () => {
      const delegation = makeActivity({
        agentId: 'lead-1', actionType: 'delegated',
        summary: 'Created & delegated to Developer: implement feature',
        details: { toAgentId: 'dev-1', toRole: 'developer', childId: 'dev-1', childRole: 'developer', delegationId: 'del-1' },
        timestamp: T1,
      });
      const mocks = makeMocks({ activities: [delegation] });
      (mocks.activityLedger.getUntil as ReturnType<typeof vi.fn>).mockReturnValue([delegation]);
      const replay = new SessionReplay(mocks.activityLedger, mocks.taskDAG, mocks.decisionLog, mocks.lockRegistry, mocks.agentSource);

      const keyframes = replay.getKeyframes('lead-1');
      // Should emit both a spawn and a delegation keyframe
      const spawnKf = keyframes.find(k => k.type === 'spawn');
      const delegationKf = keyframes.find(k => k.type === 'delegation');
      expect(spawnKf).toBeDefined();
      expect(delegationKf).toBeDefined();
      // The spawn keyframe must use the CHILD agent ID, not the lead's ID
      expect(spawnKf!.agentId).toBe('dev-1');
      expect(spawnKf!.agentId).not.toBe('lead-1');
    });

    it('only emits keyframes for team members when using team resolution', () => {
      const teamSpawn = makeActivity({
        agentId: 'dev-1', actionType: 'sub_agent_spawned', projectId: '',
        summary: 'Spawned dev', timestamp: T1,
      });
      const teamMilestone = makeActivity({
        id: 2, agentId: 'dev-1', actionType: 'task_completed', projectId: '',
        summary: 'Task done', timestamp: T2,
      });
      const foreignError = makeActivity({
        id: 3, agentId: 'foreign-1', actionType: 'error', projectId: '',
        summary: 'Foreign error', timestamp: T3,
      });

      const mocks = makeMocks({
        agents: [
          { id: 'lead-1', parentId: undefined },
          { id: 'dev-1', parentId: 'lead-1' },
          { id: 'foreign-1', parentId: 'other-lead' },
        ],
      });

      // First call (projectId filter) → empty; second call (unfiltered) → all events
      (mocks.activityLedger.getUntil as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce([])
        .mockReturnValueOnce([teamSpawn, teamMilestone, foreignError]);

      const replay = new SessionReplay(mocks.activityLedger, mocks.taskDAG, mocks.decisionLog, mocks.lockRegistry, mocks.agentSource);
      const keyframes = replay.getKeyframes('lead-1');

      // Should only have team keyframes (spawn + milestone), NOT the foreign error
      expect(keyframes).toHaveLength(2);
      expect(keyframes[0].type).toBe('spawn');
      expect(keyframes[1].type).toBe('milestone');
    });

    it('resolves crew via projectId when leadId is a project slug', () => {
      const devSpawn = makeActivity({
        id: 1, agentId: 'dev-1', actionType: 'sub_agent_spawned', projectId: 'proj-abc',
        summary: 'Dev spawned', timestamp: T1,
      });
      const devMilestone = makeActivity({
        id: 2, agentId: 'dev-2', actionType: 'task_completed', projectId: 'proj-abc',
        summary: 'Dev 2 milestone', timestamp: T2,
      });
      const foreignEvent = makeActivity({
        id: 3, agentId: 'foreign-1', actionType: 'error', projectId: 'other-proj',
        summary: 'Foreign error', timestamp: T3,
      });

      const mocks = makeMocks({
        agents: [
          { id: 'dev-1', parentId: 'lead-uuid', projectId: 'proj-abc' },
          { id: 'dev-2', parentId: 'lead-uuid', projectId: 'proj-abc' },
          { id: 'foreign-1', parentId: 'other-lead', projectId: 'other-proj' },
        ],
      });

      (mocks.activityLedger.getUntil as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce([])
        .mockReturnValueOnce([devSpawn, devMilestone, foreignEvent]);

      const replay = new SessionReplay(mocks.activityLedger, mocks.taskDAG, mocks.decisionLog, mocks.lockRegistry, mocks.agentSource);
      // leadId is a project slug, not a UUID — should match via projectId
      const keyframes = replay.getKeyframes('proj-abc');

      expect(keyframes).toHaveLength(2);
      expect(keyframes[0].agentId).toBe('dev-1');
      expect(keyframes[1].agentId).toBe('dev-2');
    });
  });

  describe('getEventsInRange', () => {
    it('returns events within time range', () => {
      const activities = [
        makeActivity({ timestamp: T1 }),
        makeActivity({ id: 2, timestamp: T2 }),
        makeActivity({ id: 3, timestamp: T3 }),
      ];
      const mocks = makeMocks();
      (mocks.activityLedger.getUntil as ReturnType<typeof vi.fn>).mockReturnValue(activities);
      const replay = new SessionReplay(mocks.activityLedger, mocks.taskDAG, mocks.decisionLog, mocks.lockRegistry, mocks.agentSource);

      const events = replay.getEventsInRange('lead-1', T2, T3);
      expect(events).toHaveLength(2); // T2 and T3 (T1 < from)
    });

    it('filters by event types', () => {
      const activities = [
        makeActivity({ actionType: 'file_edit', timestamp: T1 }),
        makeActivity({ id: 2, actionType: 'sub_agent_spawned', timestamp: T1 }),
      ];
      const mocks = makeMocks();
      (mocks.activityLedger.getUntil as ReturnType<typeof vi.fn>).mockReturnValue(activities);
      const replay = new SessionReplay(mocks.activityLedger, mocks.taskDAG, mocks.decisionLog, mocks.lockRegistry, mocks.agentSource);

      const events = replay.getEventsInRange('lead-1', T1, T3, ['sub_agent_spawned']);
      expect(events).toHaveLength(1);
      expect(events[0].actionType).toBe('sub_agent_spawned');
    });
  });

  // ── Team-resolution / untitled project tests ─────────────────────

  describe('resolveActivities', () => {
    it('returns projectId-matched activities when available (historical)', () => {
      const projectActivities = [
        makeActivity({ agentId: 'dev-1', projectId: 'proj-1' }),
        makeActivity({ id: 2, agentId: 'dev-2', projectId: 'proj-1' }),
      ];
      const mocks = makeMocks();
      (mocks.activityLedger.getUntil as ReturnType<typeof vi.fn>).mockReturnValueOnce(projectActivities);

      const replay = new SessionReplay(mocks.activityLedger, mocks.taskDAG, mocks.decisionLog, mocks.lockRegistry, mocks.agentSource);
      const result = replay.resolveActivities('proj-1', T3, 10_000);

      expect(result).toEqual(projectActivities);
      // Should only call getUntil once — projectId filter succeeded
      expect(mocks.activityLedger.getUntil).toHaveBeenCalledTimes(1);
      expect(mocks.activityLedger.getUntil).toHaveBeenCalledWith(T3, 'proj-1', 10_000);
    });

    it('uses agentSource to resolve team when projectId filter returns empty (live session)', () => {
      const teamActivity = makeActivity({ agentId: 'dev-1', projectId: '', timestamp: T1 });
      const otherProjectActivity = makeActivity({ agentId: 'other-1', projectId: 'proj-other', timestamp: T2 });

      const mocks = makeMocks({
        agents: [
          { id: 'lead-1', parentId: undefined },
          { id: 'dev-1', parentId: 'lead-1' },
          { id: 'other-1', parentId: 'other-lead' },
        ],
      });

      // First call (projectId filter) → empty; second call (unfiltered) → all events
      (mocks.activityLedger.getUntil as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce([])
        .mockReturnValueOnce([teamActivity, otherProjectActivity]);

      const replay = new SessionReplay(mocks.activityLedger, mocks.taskDAG, mocks.decisionLog, mocks.lockRegistry, mocks.agentSource);
      const result = replay.resolveActivities('lead-1', T3, 10_000);

      expect(result).toHaveLength(1);
      expect(result[0].agentId).toBe('dev-1');
    });

    it('handles untitled projects with empty projectId', () => {
      // Untitled project: all activities have projectId: ''
      const leadActivity = makeActivity({ agentId: 'lead-1', projectId: '', actionType: 'status_change', summary: 'Status: running' });
      const devActivity = makeActivity({ id: 2, agentId: 'dev-1', projectId: '', timestamp: T2 });
      const foreignActivity = makeActivity({ id: 3, agentId: 'foreign-1', projectId: '', timestamp: T2 });

      const mocks = makeMocks({
        agents: [
          { id: 'lead-1', parentId: undefined, projectId: undefined },
          { id: 'dev-1', parentId: 'lead-1', projectId: undefined },
          { id: 'foreign-1', parentId: 'foreign-lead', projectId: undefined },
        ],
      });

      (mocks.activityLedger.getUntil as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce([])  // projectId='lead-1' → no match
        .mockReturnValueOnce([leadActivity, devActivity, foreignActivity]);

      const replay = new SessionReplay(mocks.activityLedger, mocks.taskDAG, mocks.decisionLog, mocks.lockRegistry, mocks.agentSource);
      const result = replay.resolveActivities('lead-1', T3, 10_000);

      // Should include lead-1 and dev-1 (team), but NOT foreign-1
      expect(result).toHaveLength(2);
      expect(result.map(a => a.agentId).sort()).toEqual(['dev-1', 'lead-1']);
    });

    it('never returns unscoped data — returns empty when no team can be resolved', () => {
      const foreignActivity = makeActivity({ agentId: 'foreign-1', projectId: '' });

      const mocks = makeMocks({
        agents: [
          { id: 'foreign-1', parentId: 'foreign-lead' },
        ],
      });

      (mocks.activityLedger.getUntil as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce([])  // projectId filter → empty
        .mockReturnValueOnce([foreignActivity]);  // unfiltered → only foreign data

      const replay = new SessionReplay(mocks.activityLedger, mocks.taskDAG, mocks.decisionLog, mocks.lockRegistry, mocks.agentSource);
      const result = replay.resolveActivities('lead-1', T3, 10_000);

      expect(result).toEqual([]);
    });

    it('returns empty without agentSource when projectId filter fails', () => {
      const mocks = makeMocks();
      (mocks.activityLedger.getUntil as ReturnType<typeof vi.fn>).mockReturnValue([]);

      // No agentSource passed
      const replay = new SessionReplay(mocks.activityLedger, mocks.taskDAG, mocks.decisionLog, mocks.lockRegistry);
      const result = replay.resolveActivities('lead-1', T3, 10_000);

      expect(result).toEqual([]);
      // Should only call getUntil once (projectId attempt), then return empty
      expect(mocks.activityLedger.getUntil).toHaveBeenCalledTimes(1);
    });

    it('discovers team via delegation chains when lead has events but no live agents', () => {
      // Lead delegated to dev-1, who delegated to dev-2
      const leadDelegation = makeActivity({
        agentId: 'lead-1', actionType: 'delegated', projectId: '',
        summary: 'Created & delegated to dev-1',
        details: { childId: 'dev-1', role: 'developer' },
        timestamp: T1,
      });
      const devDelegation = makeActivity({
        id: 2, agentId: 'dev-1', actionType: 'delegated', projectId: '',
        summary: 'Created & delegated to dev-2',
        details: { childId: 'dev-2', role: 'developer' },
        timestamp: T2,
      });
      const devActivity = makeActivity({
        id: 3, agentId: 'dev-2', projectId: '',
        timestamp: T3,
      });
      const foreignActivity = makeActivity({
        id: 4, agentId: 'foreign-1', projectId: '',
        timestamp: T3,
      });

      const mocks = makeMocks({
        agents: [],  // No live agents (historical replay)
      });

      (mocks.activityLedger.getUntil as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce([])  // projectId filter
        .mockReturnValueOnce([leadDelegation, devDelegation, devActivity, foreignActivity]);

      const replay = new SessionReplay(mocks.activityLedger, mocks.taskDAG, mocks.decisionLog, mocks.lockRegistry, mocks.agentSource);
      const result = replay.resolveActivities('lead-1', T3, 10_000);

      expect(result).toHaveLength(3);
      expect(result.map(a => a.agentId).sort()).toEqual(['dev-1', 'dev-2', 'lead-1']);
    });

    it('discovers team via projectId references when lead has no events but events reference leadId as projectId', () => {
      // Historical scenario: leadId matches projectId on events, but lead
      // itself has no events in the log (only its children do).
      const devEvent = makeActivity({
        agentId: 'dev-1', projectId: 'lead-1', timestamp: T1,
      });
      const archEvent = makeActivity({
        id: 2, agentId: 'arch-1', projectId: 'lead-1', timestamp: T2,
      });
      const foreignEvent = makeActivity({
        id: 3, agentId: 'foreign-1', projectId: 'other-proj', timestamp: T3,
      });

      const mocks = makeMocks({
        agents: [],  // No live agents
      });

      (mocks.activityLedger.getUntil as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce([])  // tier 1: projectId SQL filter
        .mockReturnValueOnce([devEvent, archEvent, foreignEvent]);

      const replay = new SessionReplay(mocks.activityLedger, mocks.taskDAG, mocks.decisionLog, mocks.lockRegistry, mocks.agentSource);
      const result = replay.resolveActivities('lead-1', T3, 10_000);

      // Should discover dev-1 and arch-1 via projectId='lead-1', exclude foreign-1
      expect(result).toHaveLength(2);
      expect(result.map(a => a.agentId).sort()).toEqual(['arch-1', 'dev-1']);
    });

    it('includes events matching projectId in team-filtered results', () => {
      // Some events have projectId matching the leadId (cross-referenced)
      const teamEvent = makeActivity({ agentId: 'dev-1', projectId: '' });
      const projectRefEvent = makeActivity({ id: 2, agentId: 'unknown-1', projectId: 'lead-1' });

      const mocks = makeMocks({
        agents: [
          { id: 'lead-1', parentId: undefined },
          { id: 'dev-1', parentId: 'lead-1' },
        ],
      });

      (mocks.activityLedger.getUntil as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce([])
        .mockReturnValueOnce([teamEvent, projectRefEvent]);

      const replay = new SessionReplay(mocks.activityLedger, mocks.taskDAG, mocks.decisionLog, mocks.lockRegistry, mocks.agentSource);
      const result = replay.resolveActivities('lead-1', T3, 10_000);

      // Both should be included: dev-1 is team, unknown-1's event has projectId=lead-1
      expect(result).toHaveLength(2);
    });
  });

  describe('getWorldStateAt with team resolution', () => {
    it('scopes world state to team members for untitled projects', () => {
      const teamActivity = makeActivity({
        actionType: 'sub_agent_spawned', agentId: 'lead-1', projectId: '',
        details: { childId: 'dev-1', role: 'developer' },
      });
      const foreignActivity = makeActivity({
        id: 2, agentId: 'foreign-1', projectId: '',
        actionType: 'sub_agent_spawned',
        details: { childId: 'foreign-2', role: 'architect' },
      });

      const mocks = makeMocks({
        agents: [
          { id: 'lead-1', parentId: undefined },
          { id: 'dev-1', parentId: 'lead-1' },
          { id: 'foreign-1', parentId: 'foreign-lead' },
        ],
      });

      (mocks.activityLedger.getUntil as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce([])  // projectId filter
        .mockReturnValueOnce([teamActivity, foreignActivity]);

      const replay = new SessionReplay(mocks.activityLedger, mocks.taskDAG, mocks.decisionLog, mocks.lockRegistry, mocks.agentSource);
      const state = replay.getWorldStateAt('lead-1', T3);

      // Should only contain the team's spawn, not the foreign spawn
      // extractAgentRoster creates entries for spawned agents (dev-1) and
      // auto-discovers lead-1 from its agentId on the spawn event
      expect(state.agents).toHaveLength(1); // dev-1 from the spawn event
      const agentIds = state.agents.map(a => a.id);
      expect(agentIds).toContain('dev-1');
      expect(agentIds).not.toContain('foreign-1');
      expect(agentIds).not.toContain('foreign-2');
    });
  });
});
