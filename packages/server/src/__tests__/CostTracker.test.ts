import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../db/database.js';
import { CostTracker } from '../agents/CostTracker.js';

const TEST_DB = ':memory:';

describe('CostTracker', () => {
  let db: Database;
  let tracker: CostTracker;

  beforeEach(() => {
    db = new Database(TEST_DB);
    tracker = new CostTracker(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── recordUsage: basic delta computation ─────────────────────────────

  it('records first usage as the full cumulative value', () => {
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 1000, 500);

    const costs = tracker.getAgentCosts();
    expect(costs).toHaveLength(1);
    expect(costs[0].agentId).toBe('agent-1');
    expect(costs[0].totalInputTokens).toBe(1000);
    expect(costs[0].totalOutputTokens).toBe(500);
  });

  it('computes delta from cumulative values on subsequent calls', () => {
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 1000, 500);
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 3000, 1200);

    const costs = tracker.getAgentCosts();
    expect(costs).toHaveLength(1);
    expect(costs[0].totalInputTokens).toBe(3000); // 1000 + (3000-1000)
    expect(costs[0].totalOutputTokens).toBe(1200); // 500 + (1200-500)
  });

  it('skips zero-delta updates', () => {
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 1000, 500);
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 1000, 500); // same values

    const costs = tracker.getAgentCosts();
    expect(costs).toHaveLength(1);
    expect(costs[0].totalInputTokens).toBe(1000);
  });

  it('handles negative deltas gracefully (clamped to 0)', () => {
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 5000, 2000);
    // Cumulative values decrease (e.g. session reset)
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 1000, 500);

    const costs = tracker.getAgentCosts();
    // Original 5000 stays, negative delta is ignored (max(0, -4000) = 0)
    expect(costs[0].totalInputTokens).toBe(5000);
    expect(costs[0].totalOutputTokens).toBe(2000);
  });

  // ── recordUsage: task switching ──────────────────────────────────────

  it('attributes delta to the correct task when agent switches tasks', () => {
    // Agent works on task-a
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 1000, 500);

    // Agent switches to task-b — cumulative values continue rising
    tracker.recordUsage('agent-1', 'task-b', 'lead-1', 2500, 1000);

    const taskCosts = tracker.getTaskCosts();
    expect(taskCosts).toHaveLength(2);

    const taskA = taskCosts.find(t => t.dagTaskId === 'task-a')!;
    const taskB = taskCosts.find(t => t.dagTaskId === 'task-b')!;

    expect(taskA.totalInputTokens).toBe(1000);
    expect(taskA.totalOutputTokens).toBe(500);
    expect(taskB.totalInputTokens).toBe(1500); // 2500 - 1000
    expect(taskB.totalOutputTokens).toBe(500);  // 1000 - 500
  });

  // ── recordUsage: multiple agents ─────────────────────────────────────

  it('tracks costs independently per agent', () => {
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 1000, 500);
    tracker.recordUsage('agent-2', 'task-a', 'lead-1', 2000, 800);

    const agentCosts = tracker.getAgentCosts();
    expect(agentCosts).toHaveLength(2);

    const agent1 = agentCosts.find(c => c.agentId === 'agent-1')!;
    const agent2 = agentCosts.find(c => c.agentId === 'agent-2')!;

    expect(agent1.totalInputTokens).toBe(1000);
    expect(agent2.totalInputTokens).toBe(2000);
  });

  // ── getAgentCosts: aggregation across tasks ──────────────────────────

  it('aggregates costs across multiple tasks per agent', () => {
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 1000, 500);
    tracker.recordUsage('agent-1', 'task-b', 'lead-1', 3000, 1500);

    const agentCosts = tracker.getAgentCosts();
    expect(agentCosts).toHaveLength(1);
    expect(agentCosts[0].totalInputTokens).toBe(3000); // 1000 + (3000-1000)
    expect(agentCosts[0].totalOutputTokens).toBe(1500); // 500 + (1500-500)
    expect(agentCosts[0].taskCount).toBe(2);
  });

  // ── getTaskCosts: per-task view ──────────────────────────────────────

  it('provides per-task cost breakdown with agent details', () => {
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 1000, 500);
    tracker.recordUsage('agent-2', 'task-a', 'lead-1', 2000, 800);

    const taskCosts = tracker.getTaskCosts();
    expect(taskCosts).toHaveLength(1);
    expect(taskCosts[0].dagTaskId).toBe('task-a');
    expect(taskCosts[0].totalInputTokens).toBe(3000);
    expect(taskCosts[0].totalOutputTokens).toBe(1300);
    expect(taskCosts[0].agentCount).toBe(2);
    expect(taskCosts[0].agents).toHaveLength(2);
  });

  it('filters task costs by leadId', () => {
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 1000, 500);
    tracker.recordUsage('agent-2', 'task-b', 'lead-2', 2000, 800);

    const lead1Costs = tracker.getTaskCosts('lead-1');
    expect(lead1Costs).toHaveLength(1);
    expect(lead1Costs[0].dagTaskId).toBe('task-a');

    const lead2Costs = tracker.getTaskCosts('lead-2');
    expect(lead2Costs).toHaveLength(1);
    expect(lead2Costs[0].dagTaskId).toBe('task-b');
  });

  // ── getAgentTaskCosts: per-agent detail ──────────────────────────────

  it('returns all cost records for a specific agent', () => {
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 1000, 500);
    tracker.recordUsage('agent-1', 'task-b', 'lead-1', 3000, 1500);

    const records = tracker.getAgentTaskCosts('agent-1');
    expect(records).toHaveLength(2);
    expect(records.map(r => r.dagTaskId).sort()).toEqual(['task-a', 'task-b']);
  });

  it('returns empty array for unknown agent', () => {
    const records = tracker.getAgentTaskCosts('unknown');
    expect(records).toHaveLength(0);
  });

  // ── resetLastSeen ────────────────────────────────────────────────────

  it('resetLastSeen causes next usage to be treated as first call', () => {
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 5000, 2000);
    tracker.resetLastSeen();

    // After reset, cumulative 3000 is treated as first call (full value)
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 3000, 1000);

    const costs = tracker.getAgentCosts();
    // 5000 (from first recording) + 3000 (from post-reset recording)
    expect(costs[0].totalInputTokens).toBe(8000);
    expect(costs[0].totalOutputTokens).toBe(3000);
  });

  // ── Server restart recovery ─────────────────────────────────────────

  it('new CostTracker instance initializes lastSeen from DB (restart recovery)', () => {
    // Simulate pre-restart: agent accumulated 5000 input, 2000 output
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 5000, 2000);

    // Simulate restart: create a new CostTracker (same DB)
    const tracker2 = new CostTracker(db);

    // Post-restart: agent reports cumulative 7000 (grew by 2000 during restart)
    tracker2.recordUsage('agent-1', 'task-a', 'lead-1', 7000, 3000);

    const costs = tracker2.getAgentCosts();
    // Should be 5000 + 2000 = 7000, NOT 5000 + 7000 = 12000
    expect(costs[0].totalInputTokens).toBe(7000);
    expect(costs[0].totalOutputTokens).toBe(3000);
  });

  it('restart recovery: same cumulative values produce zero delta', () => {
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 5000, 2000);

    const tracker2 = new CostTracker(db);
    // Same cumulative values as before restart — no new usage
    tracker2.recordUsage('agent-1', 'task-a', 'lead-1', 5000, 2000);

    const costs = tracker2.getAgentCosts();
    // Should still be 5000, not 10000
    expect(costs[0].totalInputTokens).toBe(5000);
    expect(costs[0].totalOutputTokens).toBe(2000);
  });

  // ── Edge cases ───────────────────────────────────────────────────────

  it('handles empty state gracefully', () => {
    expect(tracker.getAgentCosts()).toEqual([]);
    expect(tracker.getTaskCosts()).toEqual([]);
    expect(tracker.getAgentTaskCosts('any')).toEqual([]);
  });

  it('handles multiple leads with same task IDs', () => {
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 1000, 500);
    tracker.recordUsage('agent-2', 'task-a', 'lead-2', 2000, 800);

    const allTaskCosts = tracker.getTaskCosts();
    expect(allTaskCosts).toHaveLength(2);
    // Same task ID, different leads
    expect(allTaskCosts.map(t => t.leadId).sort()).toEqual(['lead-1', 'lead-2']);
  });

  // ── project_id tracking ──────────────────────────────────────────────

  it('persists project_id when provided in extras', () => {
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 1000, 500, { projectId: 'proj-1' });

    const costs = tracker.getAgentTaskCosts('agent-1');
    expect(costs).toHaveLength(1);
    expect(costs[0].projectId).toBe('proj-1');
  });

  it('uses _session sentinel when dagTaskId is not assigned', () => {
    tracker.recordUsage('lead-1', '_session', 'lead-1', 5000, 2000, { projectId: 'proj-1' });

    const costs = tracker.getAgentTaskCosts('lead-1');
    expect(costs).toHaveLength(1);
    expect(costs[0].dagTaskId).toBe('_session');
    expect(costs[0].inputTokens).toBe(5000);
  });

  // ── getProjectCosts ──────────────────────────────────────────────────

  it('aggregates costs by project', () => {
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 1000, 500, { projectId: 'proj-1' });
    tracker.recordUsage('agent-2', 'task-b', 'lead-1', 2000, 800, { projectId: 'proj-1' });
    tracker.recordUsage('agent-3', 'task-c', 'lead-2', 3000, 1200, { projectId: 'proj-2' });

    const projectCosts = tracker.getProjectCosts();
    expect(projectCosts).toHaveLength(2);

    const proj1 = projectCosts.find(p => p.projectId === 'proj-1')!;
    expect(proj1.totalInputTokens).toBe(3000);
    expect(proj1.totalOutputTokens).toBe(1300);
    expect(proj1.agentCount).toBe(2);
    expect(proj1.sessionCount).toBe(1);

    const proj2 = projectCosts.find(p => p.projectId === 'proj-2')!;
    expect(proj2.totalInputTokens).toBe(3000);
    expect(proj2.totalOutputTokens).toBe(1200);
    expect(proj2.agentCount).toBe(1);
  });

  it('excludes records without project_id from getProjectCosts', () => {
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 1000, 500); // no projectId
    tracker.recordUsage('agent-2', 'task-b', 'lead-2', 2000, 800, { projectId: 'proj-1' });

    const projectCosts = tracker.getProjectCosts();
    expect(projectCosts).toHaveLength(1);
    expect(projectCosts[0].projectId).toBe('proj-1');
  });

  // ── getSessionCosts ──────────────────────────────────────────────────

  it('aggregates costs by session within a project', () => {
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 1000, 500, { projectId: 'proj-1' });
    tracker.recordUsage('agent-2', 'task-b', 'lead-1', 2000, 800, { projectId: 'proj-1' });
    tracker.recordUsage('agent-3', 'task-c', 'lead-2', 3000, 1200, { projectId: 'proj-1' });
    tracker.recordUsage('agent-4', 'task-d', 'lead-3', 4000, 1600, { projectId: 'proj-2' });

    const sessionCosts = tracker.getSessionCosts('proj-1');
    expect(sessionCosts).toHaveLength(2);

    const session1 = sessionCosts.find(s => s.leadId === 'lead-1')!;
    expect(session1.totalInputTokens).toBe(3000);
    expect(session1.totalOutputTokens).toBe(1300);
    expect(session1.agentCount).toBe(2);

    const session2 = sessionCosts.find(s => s.leadId === 'lead-2')!;
    expect(session2.totalInputTokens).toBe(3000);
    expect(session2.totalOutputTokens).toBe(1200);
    expect(session2.agentCount).toBe(1);
  });

  it('returns empty array for unknown project', () => {
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 1000, 500, { projectId: 'proj-1' });

    const sessionCosts = tracker.getSessionCosts('unknown-project');
    expect(sessionCosts).toHaveLength(0);
  });

  // ── project costs across multiple sessions ───────────────────────────

  it('counts sessions correctly in project costs', () => {
    // Two sessions (lead-1 and lead-2) for same project
    tracker.recordUsage('agent-1', 'task-a', 'lead-1', 1000, 500, { projectId: 'proj-1' });
    tracker.recordUsage('agent-2', 'task-b', 'lead-2', 2000, 800, { projectId: 'proj-1' });

    const projectCosts = tracker.getProjectCosts();
    expect(projectCosts).toHaveLength(1);
    expect(projectCosts[0].sessionCount).toBe(2);
    expect(projectCosts[0].agentCount).toBe(2);
    expect(projectCosts[0].totalInputTokens).toBe(3000);
  });
});
