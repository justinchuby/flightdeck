import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DecisionRecordStore } from '../coordination/decisions/DecisionRecords.js';
import { DecisionLog } from '../coordination/decisions/DecisionLog.js';
import type { Decision } from '../coordination/decisions/DecisionLog.js';
import { Database } from '../db/database.js';

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'dec-123',
    agentId: 'agent-1',
    agentRole: 'developer',
    leadId: 'lead-1',
    projectId: null,
    title: 'Use PostgreSQL for persistence',
    rationale: 'Better for concurrent writes and has strong ACID guarantees',
    needsConfirmation: false,
    status: 'recorded',
    autoApproved: false,
    confirmedAt: null,
    timestamp: '2024-01-15T10:00:00.000Z',
    category: 'general',
    ...overrides,
  };
}

describe('DecisionRecordStore', () => {
  let store: DecisionRecordStore;

  beforeEach(() => {
    store = new DecisionRecordStore();
  });

  it('creates record from Decision object', () => {
    const decision = makeDecision();
    const record = store.createFromDecision(decision);

    expect(record.id).toMatch(/^adr-/);
    expect(record.title).toBe('Use PostgreSQL for persistence');
    expect(record.status).toBe('proposed');
    expect(record.rationale).toBe('Better for concurrent writes and has strong ACID guarantees');
    expect(record.proposedBy).toBe('agent-1');
    expect(record.proposedByRole).toBe('developer');
    expect(record.decidedAt).toBe('2024-01-15T10:00:00.000Z');
    expect(record.chosen).toBe('Use PostgreSQL for persistence');
    expect(record.consequences).toEqual([]);
    expect(record.options).toEqual([]);
  });

  it('maps confirmed Decision status to accepted', () => {
    const decision = makeDecision({ status: 'confirmed' });
    const record = store.createFromDecision(decision);
    expect(record.status).toBe('accepted');
  });

  it('maps rejected Decision status to rejected', () => {
    const decision = makeDecision({ status: 'rejected' });
    const record = store.createFromDecision(decision);
    expect(record.status).toBe('rejected');
  });

  it('uses provided context string', () => {
    const decision = makeDecision();
    const record = store.createFromDecision(decision, 'We need to choose a database for the project');
    expect(record.context).toBe('We need to choose a database for the project');
  });

  it('defaults context when not provided', () => {
    const record = store.createFromDecision(makeDecision());
    expect(record.context).toBe('No context provided');
  });

  it('auto-extracts tags from text', () => {
    const decision = makeDecision({
      title: 'Use PostgreSQL for database persistence',
      rationale: 'Better performance and supports our API design patterns',
    });
    const record = store.createFromDecision(decision);
    expect(record.tags).toContain('database');
    expect(record.tags).toContain('performance');
    expect(record.tags).toContain('api');
    expect(record.tags).toContain('pattern');
  });

  it('extracts tags from all text fields in create()', () => {
    const record = store.create({
      title: 'Auth service design',
      status: 'accepted',
      context: 'We need to handle security for the frontend',
      options: [],
      chosen: 'JWT',
      rationale: 'Simple and stateless',
      consequences: [],
      proposedBy: 'agent-1',
      proposedByRole: 'architect',
      decidedAt: new Date().toISOString(),
    });
    expect(record.tags).toContain('auth');
    expect(record.tags).toContain('security');
    expect(record.tags).toContain('frontend');
  });

  it('getAll returns sorted records (newest first)', () => {
    store.createFromDecision(makeDecision({ timestamp: '2024-01-10T00:00:00.000Z', title: 'Old decision' }));
    store.createFromDecision(makeDecision({ timestamp: '2024-01-20T00:00:00.000Z', title: 'New decision' }));
    store.createFromDecision(makeDecision({ timestamp: '2024-01-15T00:00:00.000Z', title: 'Mid decision' }));

    const all = store.getAll();
    expect(all).toHaveLength(3);
    expect(all[0].title).toBe('New decision');
    expect(all[1].title).toBe('Mid decision');
    expect(all[2].title).toBe('Old decision');
  });

  it('getAll filters by status', () => {
    store.createFromDecision(makeDecision({ status: 'confirmed', title: 'Accepted decision' }));
    store.createFromDecision(makeDecision({ status: 'rejected', title: 'Rejected decision' }));
    store.createFromDecision(makeDecision({ status: 'recorded', title: 'Proposed decision' }));

    const accepted = store.getAll({ status: 'accepted' });
    expect(accepted).toHaveLength(1);
    expect(accepted[0].title).toBe('Accepted decision');

    const rejected = store.getAll({ status: 'rejected' });
    expect(rejected).toHaveLength(1);
    expect(rejected[0].title).toBe('Rejected decision');
  });

  it('getAll filters by tag', () => {
    store.createFromDecision(makeDecision({ title: 'Database schema design', rationale: 'Normalization' }));
    store.createFromDecision(makeDecision({ title: 'API versioning', rationale: 'REST best practices' }));

    const dbRecords = store.getAll({ tag: 'database' });
    expect(dbRecords).toHaveLength(1);
    expect(dbRecords[0].title).toBe('Database schema design');
  });

  it('getAll filters by since', () => {
    store.createFromDecision(makeDecision({ timestamp: '2024-01-05T00:00:00.000Z', title: 'Before cutoff' }));
    store.createFromDecision(makeDecision({ timestamp: '2024-01-15T00:00:00.000Z', title: 'After cutoff' }));

    const recent = store.getAll({ since: '2024-01-10T00:00:00.000Z' });
    expect(recent).toHaveLength(1);
    expect(recent[0].title).toBe('After cutoff');
  });

  it('get returns single record by id', () => {
    const record = store.createFromDecision(makeDecision());
    expect(store.get(record.id)).toEqual(record);
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('search finds records by query terms', () => {
    store.createFromDecision(makeDecision({
      title: 'Use Redis for caching',
      rationale: 'Low latency in-memory storage',
    }));
    store.createFromDecision(makeDecision({
      title: 'Adopt TypeScript',
      rationale: 'Type safety reduces runtime errors',
    }));

    const results = store.search('redis caching');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Use Redis for caching');
  });

  it('search requires all terms to match', () => {
    store.createFromDecision(makeDecision({
      title: 'Use Redis for caching',
      rationale: 'Low latency',
    }));

    expect(store.search('redis postgresql')).toHaveLength(0);
    expect(store.search('redis latency')).toHaveLength(1);
  });

  it('search returns empty for blank or single-char query', () => {
    store.createFromDecision(makeDecision());
    expect(store.search('')).toHaveLength(0);
    expect(store.search('a')).toHaveLength(0);
  });

  it('updateStatus changes record status', () => {
    const record = store.createFromDecision(makeDecision());
    expect(record.status).toBe('proposed');

    const updated = store.updateStatus(record.id, 'accepted');
    expect(updated).toBe(true);
    expect(store.get(record.id)?.status).toBe('accepted');
  });

  it('updateStatus returns false for unknown id', () => {
    expect(store.updateStatus('nonexistent', 'accepted')).toBe(false);
  });

  it('addConsequence appends to record', () => {
    const record = store.createFromDecision(makeDecision());
    expect(record.consequences).toHaveLength(0);

    store.addConsequence(record.id, 'Required migration from SQLite');
    store.addConsequence(record.id, 'Improved query performance by 3x');

    const updated = store.get(record.id)!;
    expect(updated.consequences).toEqual([
      'Required migration from SQLite',
      'Improved query performance by 3x',
    ]);
  });

  it('addConsequence returns false for unknown id', () => {
    expect(store.addConsequence('nonexistent', 'Some consequence')).toBe(false);
  });

  it('getTags returns unique sorted tags', () => {
    store.createFromDecision(makeDecision({ title: 'API design', rationale: 'REST patterns' }));
    store.createFromDecision(makeDecision({ title: 'Database schema', rationale: 'Normalization' }));
    store.createFromDecision(makeDecision({ title: 'Frontend performance', rationale: 'Bundle size' }));

    const tags = store.getTags();
    expect(tags).toContain('api');
    expect(tags).toContain('database');
    expect(tags).toContain('frontend');
    expect(tags).toContain('performance');
    expect(tags).toContain('pattern');
    // Verify sorted
    expect(tags).toEqual([...tags].sort());
    // Verify unique
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('getTags returns empty array when no records', () => {
    expect(store.getTags()).toEqual([]);
  });

  it('count reflects number of records', () => {
    expect(store.count).toBe(0);
    store.createFromDecision(makeDecision());
    expect(store.count).toBe(1);
    store.createFromDecision(makeDecision({ timestamp: '2024-01-20T00:00:00.000Z' }));
    expect(store.count).toBe(2);
  });

  describe('syncFromDecisionLog', () => {
    let db: Database;
    let decisionLog: DecisionLog;

    beforeEach(() => {
      db = new Database(':memory:');
      decisionLog = new DecisionLog(db);
    });

    afterEach(() => {
      decisionLog.clear();
      db.close();
    });

    it('syncFromDecisionLog imports decisions', () => {
      decisionLog.add('agent-1', 'developer', 'Use TypeScript', 'Type safety', false, 'lead-1');
      decisionLog.add('agent-2', 'architect', 'Use monorepo', 'Easier refactoring', false, 'lead-1');

      const synced = store.syncFromDecisionLog(decisionLog, 'lead-1');
      expect(synced).toBe(2);
      expect(store.count).toBe(2);
    });

    it('deduplicates on sync', () => {
      decisionLog.add('agent-1', 'developer', 'Use TypeScript', 'Type safety', false, 'lead-1');

      // First sync
      const firstSync = store.syncFromDecisionLog(decisionLog, 'lead-1');
      expect(firstSync).toBe(1);
      expect(store.count).toBe(1);

      // Second sync — should not duplicate
      const secondSync = store.syncFromDecisionLog(decisionLog, 'lead-1');
      expect(secondSync).toBe(0);
      expect(store.count).toBe(1);
    });

    it('only imports decisions for the given leadId', () => {
      decisionLog.add('agent-1', 'developer', 'Decision for lead-1', '', false, 'lead-1');
      decisionLog.add('agent-2', 'developer', 'Decision for lead-2', '', false, 'lead-2');

      const synced = store.syncFromDecisionLog(decisionLog, 'lead-1');
      expect(synced).toBe(1);
      expect(store.getAll()[0].title).toBe('Decision for lead-1');
    });
  });
});
