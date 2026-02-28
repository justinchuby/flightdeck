import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PerformanceTracker } from '../coordination/PerformanceScorecard.js';
import type { AgentScorecard } from '../coordination/PerformanceScorecard.js';
import type { ActivityLedger, ActivityEntry } from '../coordination/ActivityLedger.js';
import type { AgentManager } from '../agents/AgentManager.js';

// ── Test helpers ──────────────────────────────────────────────────────

function makeEntry(agentId: string, actionType: ActivityEntry['actionType'], minsAgo = 1): ActivityEntry {
  return {
    id: Math.floor(Math.random() * 10_000),
    agentId,
    agentRole: 'developer',
    actionType,
    summary: actionType,
    details: {},
    timestamp: new Date(Date.now() - minsAgo * 60_000).toISOString(),
  };
}

function makeAgent(id: string, roleId = 'developer', parentId?: string, contextWindowUsed = 0) {
  return {
    id,
    role: { id: roleId, name: roleId },
    status: 'running' as const,
    parentId,
    contextWindowUsed,
  };
}

function makeLedger(entries: ActivityEntry[]): ActivityLedger {
  return {
    getRecent: vi.fn(() => entries),
  } as unknown as ActivityLedger;
}

function makeAgentManager(agents: ReturnType<typeof makeAgent>[]): AgentManager {
  const map = new Map(agents.map((a) => [a.id, a]));
  return {
    get: (id: string) => map.get(id),
    getAll: () => Array.from(map.values()),
  } as unknown as AgentManager;
}

// ── Tests ─────────────────────────────────────────────────────────────

const LEAD_ID = 'lead-1';
const DEV_ID = 'dev-1';

describe('PerformanceTracker', () => {
  let tracker: PerformanceTracker;

  beforeEach(() => {
    const entries: ActivityEntry[] = [
      makeEntry(DEV_ID, 'task_completed', 10),
      makeEntry(DEV_ID, 'task_completed', 5),
      makeEntry(DEV_ID, 'file_edit', 3),
      makeEntry(DEV_ID, 'message_sent', 2),
      makeEntry(DEV_ID, 'message_sent', 1),
    ];
    const agent = makeAgent(DEV_ID, 'developer', LEAD_ID, 12_000);
    tracker = new PerformanceTracker(makeLedger(entries), makeAgentManager([agent]));
  });

  it('generates scorecard for agent with activity', () => {
    const card = tracker.getScorecard(DEV_ID);
    expect(card).not.toBeNull();
    expect(card!.agentId).toBe(DEV_ID);
    expect(card!.agentRole).toBe('developer');
    expect(card!.stats.tasksCompleted).toBe(2);
    expect(card!.stats.filesEdited).toBe(1);
    expect(card!.stats.messagesSent).toBe(2);
  });

  it('overall score is weighted average of metrics', () => {
    const card = tracker.getScorecard(DEV_ID)!;
    const { speed, quality, tokenEfficiency, reliability, collaboration } = card.metrics;
    const expected = Math.round(
      speed.score * 0.2 +
        quality.score * 0.3 +
        tokenEfficiency.score * 0.2 +
        reliability.score * 0.2 +
        collaboration.score * 0.1,
    );
    expect(card.overallScore).toBe(expected);
  });

  it('speed score reflects avg task duration', () => {
    // Events at 10m ago, 5m ago, 3m ago, 2m ago, 1m ago.
    // Active time gaps (all < 5min): 2m + 1m + 1m = 240s.
    // The 5m gap (10m→5m) equals exactly 5*60_000 and is excluded by strict <.
    // avgTaskDuration = 240_000ms / 2 tasks = 120_000ms → < 180_000 bracket → score 85
    const card = tracker.getScorecard(DEV_ID)!;
    expect(card.metrics.speed.score).toBe(85);
  });

  it('quality score reflects error rate', () => {
    const entries = [
      makeEntry(DEV_ID, 'task_completed', 5),
      makeEntry(DEV_ID, 'task_completed', 4),
      makeEntry(DEV_ID, 'task_completed', 3),
      makeEntry(DEV_ID, 'error', 2),
    ];
    const agent = makeAgent(DEV_ID, 'developer', LEAD_ID, 0);
    const t = new PerformanceTracker(makeLedger(entries), makeAgentManager([agent]));
    const card = t.getScorecard(DEV_ID)!;
    // 1 error / 4 total = 25% → errorRate >= 0.25 → score 40
    expect(card.metrics.quality.score).toBe(40);
  });

  it('token efficiency rewards fewer tokens per task', () => {
    // 12000 tokens / 2 tasks = 6000 tokens/task → 5k-15k bracket → score 80
    const card = tracker.getScorecard(DEV_ID)!;
    expect(card.metrics.tokenEfficiency.score).toBe(80);
  });

  it('reliability reflects completion rate', () => {
    const entries = [
      makeEntry(DEV_ID, 'task_completed', 3),
      makeEntry(DEV_ID, 'task_completed', 2),
      makeEntry(DEV_ID, 'task_completed', 1),
      makeEntry(DEV_ID, 'error', 1),
    ];
    const agent = makeAgent(DEV_ID, 'developer', LEAD_ID, 0);
    const t = new PerformanceTracker(makeLedger(entries), makeAgentManager([agent]));
    const card = t.getScorecard(DEV_ID)!;
    // 3 completed / (3+1) total = 75%
    expect(card.metrics.reliability.score).toBe(75);
  });

  it('handles agent with no activity (defaults to 50 for most metrics)', () => {
    const emptyLedger = makeLedger([]);
    const agent = makeAgent(DEV_ID, 'developer', LEAD_ID, 0);
    const t = new PerformanceTracker(emptyLedger, makeAgentManager([agent]));
    const card = t.getScorecard(DEV_ID)!;
    // All metrics default to 50 except collaboration (30 for zero messages)
    expect(card.metrics.speed.score).toBe(50);
    expect(card.metrics.quality.score).toBe(50);
    expect(card.metrics.tokenEfficiency.score).toBe(50);
    expect(card.metrics.reliability.score).toBe(50);
    expect(card.metrics.collaboration.score).toBe(30);
  });

  it('getTeamScorecards returns all non-terminal team members', () => {
    const agents = [
      makeAgent(LEAD_ID, 'lead', undefined, 0),
      makeAgent(DEV_ID, 'developer', LEAD_ID, 5000),
      makeAgent('qa-1', 'qa', LEAD_ID, 2000),
    ];
    const entries = [
      makeEntry(LEAD_ID, 'task_completed', 5),
      makeEntry(DEV_ID, 'task_completed', 3),
      makeEntry('qa-1', 'task_completed', 2),
    ];
    const t = new PerformanceTracker(makeLedger(entries), makeAgentManager(agents));
    const cards = t.getTeamScorecards(LEAD_ID);
    // lead itself + dev + qa (all have parentId===leadId or id===leadId)
    expect(cards.length).toBe(3);
    const ids = cards.map((c) => c.agentId);
    expect(ids).toContain(LEAD_ID);
    expect(ids).toContain(DEV_ID);
    expect(ids).toContain('qa-1');
  });

  it('getLeaderboard sorts by overall score descending', () => {
    // Create agents with different histories so scores differ
    const agents = [
      makeAgent(DEV_ID, 'developer', LEAD_ID, 1000),
      makeAgent('qa-1', 'qa', LEAD_ID, 100_000),
    ];
    const entries = [
      // dev: 3 completions, no errors → high quality + reliability
      makeEntry(DEV_ID, 'task_completed', 10),
      makeEntry(DEV_ID, 'task_completed', 7),
      makeEntry(DEV_ID, 'task_completed', 4),
      makeEntry(DEV_ID, 'message_sent', 1),
      makeEntry(DEV_ID, 'message_sent', 1),
      makeEntry(DEV_ID, 'message_sent', 1),
      // qa: many errors → low quality
      makeEntry('qa-1', 'error', 5),
      makeEntry('qa-1', 'error', 4),
      makeEntry('qa-1', 'error', 3),
    ];
    const t = new PerformanceTracker(makeLedger(entries), makeAgentManager(agents));
    const board = t.getLeaderboard(LEAD_ID);
    expect(board.length).toBe(2);
    expect(board[0].overallScore).toBeGreaterThanOrEqual(board[1].overallScore);
  });

  it('returns null for unknown agent', () => {
    const card = tracker.getScorecard('no-such-agent');
    expect(card).toBeNull();
  });

  it('scorecard metric labels match score tiers', () => {
    const entries = [
      makeEntry(DEV_ID, 'task_completed', 5),
    ];
    const agent = makeAgent(DEV_ID, 'developer', LEAD_ID, 100);
    const t = new PerformanceTracker(makeLedger(entries), makeAgentManager([agent]));
    const card = t.getScorecard(DEV_ID)!;
    // quality score = 95 (no errors, 1 task) → label 'Excellent'
    expect(card.metrics.quality.label).toBe('Excellent');
    expect(card.metrics.quality.score).toBe(95);
  });
});
