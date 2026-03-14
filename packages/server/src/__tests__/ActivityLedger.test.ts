import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../db/database.js';
import { ActivityLedger } from '../coordination/activity/ActivityLedger.js';

describe('ActivityLedger', () => {
  let db: Database;
  let ledger: ActivityLedger;

  beforeEach(() => {
    db = new Database(':memory:');
    ledger = new ActivityLedger(db);
  });

  afterEach(() => {
    ledger.stop();
    db.close();
  });

  it('can log an activity entry', () => {
    const entry = ledger.log('agent-1', 'developer', 'file_edit', 'Edited index.ts');
    expect(entry.id).toBeDefined();
    expect(entry.agentId).toBe('agent-1');
    expect(entry.agentRole).toBe('developer');
    expect(entry.actionType).toBe('file_edit');
    expect(entry.summary).toBe('Edited index.ts');
    expect(entry.timestamp).toBeDefined();
  });

  it('getRecent returns entries in reverse chronological order', () => {
    ledger.log('agent-1', 'developer', 'file_edit', 'First');
    ledger.log('agent-1', 'developer', 'file_read', 'Second');
    ledger.log('agent-1', 'developer', 'task_completed', 'Third');

    const recent = ledger.getRecent(10);
    expect(recent.length).toBe(3);
    expect(recent[0].summary).toBe('Third');
    expect(recent[1].summary).toBe('Second');
    expect(recent[2].summary).toBe('First');
  });

  it('getByAgent filters correctly', () => {
    ledger.log('agent-1', 'developer', 'file_edit', 'A edit');
    ledger.log('agent-2', 'reviewer', 'file_read', 'B read');
    ledger.log('agent-1', 'developer', 'task_completed', 'A task');

    const entries = ledger.getByAgent('agent-1');
    expect(entries.length).toBe(2);
    expect(entries.every((e) => e.agentId === 'agent-1')).toBe(true);
  });

  it('getByType filters correctly', () => {
    ledger.log('agent-1', 'developer', 'file_edit', 'Edit 1');
    ledger.log('agent-2', 'reviewer', 'file_read', 'Read 1');
    ledger.log('agent-1', 'developer', 'file_edit', 'Edit 2');

    const entries = ledger.getByType('file_edit');
    expect(entries.length).toBe(2);
    expect(entries.every((e) => e.actionType === 'file_edit')).toBe(true);
  });

  it('getSince filters by timestamp', () => {
    ledger.log('agent-1', 'developer', 'file_edit', 'Old entry');
    ledger.log('agent-1', 'developer', 'file_read', 'New entry');

    // Use a timestamp far in the past (SQLite datetime format: YYYY-MM-DD HH:MM:SS)
    const entries = ledger.getSince('2000-01-01 00:00:00');
    expect(entries.length).toBe(2);

    // Use a timestamp far in the future
    const none = ledger.getSince('2099-01-01 00:00:00');
    expect(none.length).toBe(0);
  });

  it('getSummary returns correct aggregated data', () => {
    ledger.log('agent-1', 'developer', 'file_edit', 'Edit file', { file: 'src/a.ts' });
    ledger.log('agent-1', 'developer', 'file_read', 'Read file', { file: 'src/b.ts' });
    ledger.log('agent-2', 'reviewer', 'file_edit', 'Edit file', { file: 'src/c.ts' });
    ledger.log('agent-2', 'reviewer', 'task_completed', 'Done');

    const summary = ledger.getSummary();
    expect(summary.totalActions).toBe(4);
    expect(summary.byAgent['agent-1']).toBe(2);
    expect(summary.byAgent['agent-2']).toBe(2);
    expect(summary.byType['file_edit']).toBe(2);
    expect(summary.byType['file_read']).toBe(1);
    expect(summary.byType['task_completed']).toBe(1);
    expect(summary.recentFiles).toContain('src/a.ts');
    expect(summary.recentFiles).toContain('src/b.ts');
    expect(summary.recentFiles).toContain('src/c.ts');
  });

  it('prune keeps only the specified count', () => {
    for (let i = 0; i < 10; i++) {
      ledger.log('agent-1', 'developer', 'file_edit', `Entry ${i}`);
    }

    ledger.prune(5);
    const remaining = ledger.getRecent(100);
    expect(remaining.length).toBe(5);
    // Should keep the most recent entries
    expect(remaining[0].summary).toBe('Entry 9');
  });

  it('version starts at 0 and increments on prune', () => {
    expect(ledger.version).toBe(0);

    ledger.log('agent-1', 'developer', 'file_edit', 'Entry 1');
    expect(ledger.version).toBe(0); // append does not increment

    ledger.prune(100);
    expect(ledger.version).toBe(1);

    ledger.prune(50);
    expect(ledger.version).toBe(2);
  });

  it('details are stored as JSON and parsed back correctly', () => {
    const details = { file: 'src/app.ts', lines: [1, 2, 3], nested: { key: 'value' } };
    const entry = ledger.log('agent-1', 'developer', 'file_edit', 'Complex edit', details);

    expect(entry.details).toEqual(details);

    const retrieved = ledger.getRecent(1);
    expect(retrieved[0].details).toEqual(details);
  });
});
