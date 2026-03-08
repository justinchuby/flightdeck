import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SearchEngine } from '../coordination/knowledge/SearchEngine.js';
import type { ActivityLedger, ActivityEntry } from '../coordination/activity/ActivityLedger.js';
import type { DecisionLog, Decision } from '../coordination/decisions/DecisionLog.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 1,
    agentId: 'agent-1',
    agentRole: 'developer',
    actionType: 'file_edit',
    summary: 'Edited src/index.ts to fix the authentication bug',
    details: {},
    timestamp: '2024-01-15T10:00:00.000Z',
    projectId: '',
    ...overrides,
  };
}

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'dec-001',
    agentId: 'agent-1',
    agentRole: 'lead',
    leadId: 'lead-1',
    projectId: null,
    title: 'Use PostgreSQL for persistence',
    rationale: 'Better support for concurrent writes and ACID transactions',
    needsConfirmation: false,
    status: 'recorded',
    autoApproved: false,
    confirmedAt: null,
    timestamp: '2024-01-15T09:00:00.000Z',
    category: 'general',
    ...overrides,
  };
}

function createMockLedger(entries: ActivityEntry[]): ActivityLedger {
  return {
    getRecent: vi.fn(() => entries),
  } as unknown as ActivityLedger;
}

function createMockDecisionLog(
  allDecisions: Decision[] = [],
  byLeadId: Decision[] = [],
): DecisionLog {
  return {
    getAll: vi.fn(() => allDecisions),
    getByLeadId: vi.fn(() => byLeadId),
  } as unknown as DecisionLog;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SearchEngine', () => {
  let engine: SearchEngine;

  beforeEach(() => {
    const ledger = createMockLedger([
      makeEntry({ summary: 'Fixed authentication bug in login module', agentId: 'agent-1' }),
      makeEntry({ id: 2, summary: 'Refactored database connection pool', agentId: 'agent-2', agentRole: 'architect' }),
      makeEntry({ id: 3, summary: 'Added unit tests for user service', agentId: 'agent-1' }),
    ]);
    const decisionLog = createMockDecisionLog(
      [
        makeDecision({ id: 'dec-1', title: 'Use PostgreSQL for persistence', rationale: 'Better concurrent writes' }),
        makeDecision({ id: 'dec-2', title: 'Migrate to TypeScript', rationale: 'Improved type safety and IDE support' }),
      ],
      [
        makeDecision({ id: 'dec-lead', leadId: 'lead-42', title: 'Deploy to production', rationale: 'Feature complete' }),
      ],
    );
    engine = new SearchEngine(ledger, decisionLog);
  });

  it('finds activities matching search terms', () => {
    const results = engine.search({ query: 'authentication', types: ['activity'] });
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('activity');
    expect(results[0].content).toContain('authentication');
  });

  it('finds decisions matching search terms', () => {
    const results = engine.search({ query: 'PostgreSQL', types: ['decision'] });
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('decision');
    expect(results[0].content).toContain('PostgreSQL');
  });

  it('searches both activities and decisions by default', () => {
    const results = engine.search({ query: 'database' });
    // "Refactored database connection pool" matches in activity
    // "PostgreSQL for persistence" doesn't contain "database"
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.type === 'activity')).toBe(true);
  });

  it('scores exact word matches higher than substring matches', () => {
    // 'bug' appears as an exact word in "Fixed authentication bug in login module"
    // Use a query that will match both as exact word and substring differently
    const ledger = createMockLedger([
      makeEntry({ id: 10, summary: 'debugging the system components' }),
      makeEntry({ id: 11, summary: 'fixed the bug in the system' }),
    ]);
    const decisionLog = createMockDecisionLog();
    const eng = new SearchEngine(ledger, decisionLog);

    const results = eng.search({ query: 'bug', types: ['activity'] });
    expect(results).toHaveLength(2);
    // Exact word "bug" should score higher than "debug" (where bug is a substring)
    expect(results[0].content).toContain('fixed the bug');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('requires all terms to match (AND semantics)', () => {
    const results = engine.search({ query: 'authentication database', types: ['activity'] });
    // No single entry contains both "authentication" AND "database"
    expect(results).toHaveLength(0);
  });

  it('respects agentId filter', () => {
    const results = engine.search({ query: 'database', agentId: 'agent-1', types: ['activity'] });
    // "database" only appears in agent-2's entry
    expect(results).toHaveLength(0);

    const results2 = engine.search({ query: 'authentication', agentId: 'agent-1', types: ['activity'] });
    expect(results2).toHaveLength(1);
    expect(results2[0].agentId).toBe('agent-1');
  });

  it('respects limit parameter', () => {
    const manyEntries: ActivityEntry[] = Array.from({ length: 20 }, (_, i) =>
      makeEntry({ id: i + 1, summary: `Fixed bug number ${i + 1}` }),
    );
    const ledger = createMockLedger(manyEntries);
    const eng = new SearchEngine(ledger, createMockDecisionLog());

    const results = eng.search({ query: 'bug', types: ['activity'], limit: 5 });
    expect(results).toHaveLength(5);
  });

  it('returns highlights with context surrounding the match', () => {
    const results = engine.search({ query: 'authentication', types: ['activity'] });
    expect(results).toHaveLength(1);
    expect(results[0].highlights).toHaveLength(1);
    expect(results[0].highlights[0]).toContain('authentication');
  });

  it('handles empty query — returns no results', () => {
    const results = engine.search({ query: '' });
    expect(results).toHaveLength(0);
  });

  it('handles whitespace-only query — returns no results', () => {
    const results = engine.search({ query: '   ' });
    expect(results).toHaveLength(0);
  });

  it('handles no results gracefully', () => {
    const results = engine.search({ query: 'xyznonexistentterm', types: ['activity'] });
    expect(results).toHaveLength(0);
  });

  it('sorts by relevance score descending', () => {
    // "unit tests" — both words appear in one entry, only one in others
    const ledger = createMockLedger([
      makeEntry({ id: 1, summary: 'Added unit tests for user service' }),
      makeEntry({ id: 2, summary: 'unit work in progress' }),
      makeEntry({ id: 3, summary: 'Wrote unit tests and integration tests' }),
    ]);
    const eng = new SearchEngine(ledger, createMockDecisionLog());

    const results = eng.search({ query: 'unit tests', types: ['activity'] });
    // All have both terms, but verify scores are sorted descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('tokenizes and normalizes query (case-insensitive)', () => {
    const results = engine.search({ query: 'AUTHENTICATION', types: ['activity'] });
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('authentication');
  });

  it('handles special characters in query without throwing', () => {
    expect(() =>
      engine.search({ query: 'file.ts (test) [broken]', types: ['activity'] }),
    ).not.toThrow();
  });

  it('filters decisions by leadId when provided', () => {
    const mockDecisionLog = createMockDecisionLog(
      [],
      [makeDecision({ id: 'dec-lead', leadId: 'lead-42', title: 'Deploy to production', rationale: 'Feature complete' })],
    );
    const ledger = createMockLedger([]);
    const eng = new SearchEngine(ledger, mockDecisionLog);

    const results = eng.search({ query: 'Deploy', types: ['decision'], leadId: 'lead-42' });
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('Deploy');
    expect(mockDecisionLog.getByLeadId).toHaveBeenCalledWith('lead-42');
  });

  it('searches all decisions when no leadId provided', () => {
    const results = engine.search({ query: 'TypeScript', types: ['decision'] });
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('TypeScript');
  });

  it('respects since timestamp filter on activities', () => {
    const ledger = createMockLedger([
      makeEntry({ id: 1, summary: 'Old authentication fix', timestamp: '2024-01-01T00:00:00.000Z' }),
      makeEntry({ id: 2, summary: 'New authentication update', timestamp: '2024-06-01T00:00:00.000Z' }),
    ]);
    const eng = new SearchEngine(ledger, createMockDecisionLog());

    const results = eng.search({
      query: 'authentication',
      types: ['activity'],
      since: '2024-03-01T00:00:00.000Z',
    });
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('New authentication update');
  });

  it('includes agentRole in activity results', () => {
    const results = engine.search({ query: 'database', types: ['activity'] });
    expect(results).toHaveLength(1);
    expect(results[0].agentRole).toBe('architect');
  });

  it('defaults limit to 50', () => {
    const manyEntries: ActivityEntry[] = Array.from({ length: 60 }, (_, i) =>
      makeEntry({ id: i + 1, summary: `Fixed bug number ${i + 1}` }),
    );
    const ledger = createMockLedger(manyEntries);
    const eng = new SearchEngine(ledger, createMockDecisionLog());

    const results = eng.search({ query: 'bug', types: ['activity'] });
    expect(results).toHaveLength(50);
  });

  it('returns at most 3 highlights per result', () => {
    const ledger = createMockLedger([
      makeEntry({
        id: 1,
        summary: 'auth check',
        details: { note: 'auth middleware auth handler' },
      }),
    ]);
    const eng = new SearchEngine(ledger, createMockDecisionLog());

    const results = eng.search({ query: 'auth', types: ['activity'] });
    expect(results).toHaveLength(1);
    expect(results[0].highlights.length).toBeLessThanOrEqual(3);
  });
});
