import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DecisionLog } from '../coordination/DecisionLog.js';
import { Database } from '../db/database.js';

describe('DecisionLog', () => {
  let log: DecisionLog;
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    log = new DecisionLog(db);
  });

  afterEach(() => {
    db.close();
  });

  it('starts empty', () => {
    expect(log.getAll()).toHaveLength(0);
  });

  it('adds a decision with all fields', () => {
    const d = log.add('agent-1', 'lead', 'Use PostgreSQL', 'Better for concurrent writes');
    expect(d.id).toMatch(/^dec-/);
    expect(d.agentId).toBe('agent-1');
    expect(d.agentRole).toBe('lead');
    expect(d.title).toBe('Use PostgreSQL');
    expect(d.rationale).toBe('Better for concurrent writes');
    expect(d.timestamp).toBeTruthy();
  });

  it('returns all decisions in order', () => {
    log.add('a1', 'lead', 'Decision 1', 'Rationale 1');
    log.add('a1', 'lead', 'Decision 2', 'Rationale 2');
    log.add('a1', 'lead', 'Decision 3', 'Rationale 3');
    expect(log.getAll()).toHaveLength(3);
    expect(log.getAll()[0].title).toBe('Decision 1');
    expect(log.getAll()[2].title).toBe('Decision 3');
  });

  it('filters by agent ID', () => {
    log.add('a1', 'lead', 'D1', '');
    log.add('a2', 'developer', 'D2', '');
    log.add('a1', 'lead', 'D3', '');

    expect(log.getByAgent('a1')).toHaveLength(2);
    expect(log.getByAgent('a2')).toHaveLength(1);
    expect(log.getByAgent('a3')).toHaveLength(0);
  });

  it('emits decision event on add', () => {
    let emitted: any = null;
    log.on('decision', (d) => { emitted = d; });
    const d = log.add('a1', 'lead', 'Test', 'reason');
    expect(emitted).toEqual(d);
  });

  it('clears all decisions', () => {
    log.add('a1', 'lead', 'D1', '');
    log.add('a1', 'lead', 'D2', '');
    log.clear();
    expect(log.getAll()).toHaveLength(0);
  });

  it('supports needsConfirmation flag', () => {
    const d = log.add('a1', 'lead', 'Delete module', 'No longer needed', true);
    expect(d.needsConfirmation).toBe(true);
    expect(d.status).toBe('recorded');
  });

  it('returns decisions needing confirmation', () => {
    log.add('a1', 'lead', 'D1', '', false);
    log.add('a1', 'lead', 'D2', '', true);
    log.add('a1', 'lead', 'D3', '', true);
    expect(log.getNeedingConfirmation()).toHaveLength(2);
    expect(log.getNeedingConfirmation()[0].title).toBe('D2');
  });

  it('confirms a decision', () => {
    const d = log.add('a1', 'lead', 'D1', '', true);
    const confirmed = log.confirm(d.id);
    expect(confirmed?.status).toBe('confirmed');
    expect(confirmed?.confirmedAt).toBeTruthy();
    expect(log.getNeedingConfirmation()).toHaveLength(0);
  });

  it('rejects a decision', () => {
    const d = log.add('a1', 'lead', 'D1', '', true);
    const rejected = log.reject(d.id);
    expect(rejected?.status).toBe('rejected');
    expect(rejected?.confirmedAt).toBeTruthy();
  });

  it('emits events on confirm and reject', () => {
    let confirmed: any = null;
    let rejected: any = null;
    log.on('decision:confirmed', (d) => { confirmed = d; });
    log.on('decision:rejected', (d) => { rejected = d; });

    const d1 = log.add('a1', 'lead', 'D1', '', true);
    const d2 = log.add('a1', 'lead', 'D2', '', true);
    log.confirm(d1.id);
    log.reject(d2.id);

    expect(confirmed?.id).toBe(d1.id);
    expect(rejected?.id).toBe(d2.id);
  });

  it('gets decision by id', () => {
    const d = log.add('a1', 'lead', 'D1', 'rationale');
    const found = log.getById(d.id);
    expect(found?.title).toBe('D1');
    expect(log.getById('nonexistent')).toBeUndefined();
  });

  it('persists to SQLite (survives re-instantiation)', () => {
    log.add('a1', 'lead', 'Persisted decision', 'reason');
    const log2 = new DecisionLog(db);
    expect(log2.getAll()).toHaveLength(1);
    expect(log2.getAll()[0].title).toBe('Persisted decision');
  });

  it('double-confirm is idempotent (no duplicate events)', () => {
    let confirmCount = 0;
    log.on('decision:confirmed', () => { confirmCount++; });
    const d = log.add('a1', 'lead', 'D1', '', true);
    log.confirm(d.id);
    log.confirm(d.id);
    expect(confirmCount).toBe(1);
    expect(log.getById(d.id)?.status).toBe('confirmed');
  });

  it('double-reject is idempotent (no duplicate events)', () => {
    let rejectCount = 0;
    log.on('decision:rejected', () => { rejectCount++; });
    const d = log.add('a1', 'lead', 'D1', '', true);
    log.reject(d.id);
    log.reject(d.id);
    expect(rejectCount).toBe(1);
    expect(log.getById(d.id)?.status).toBe('rejected');
  });

  it('cannot confirm an already-rejected decision', () => {
    let confirmCount = 0;
    log.on('decision:confirmed', () => { confirmCount++; });
    const d = log.add('a1', 'lead', 'D1', '', true);
    log.reject(d.id);
    log.confirm(d.id);
    expect(confirmCount).toBe(0);
    expect(log.getById(d.id)?.status).toBe('rejected');
  });

  // ── Dismiss ──────────────────────────────────────────────────────

  it('dismisses a recorded decision', () => {
    const d = log.add('a1', 'lead', 'D1', '', true);
    const dismissed = log.dismiss(d.id);
    expect(dismissed?.status).toBe('dismissed');
    expect(dismissed?.confirmedAt).toBeTruthy();
    expect(log.getNeedingConfirmation()).toHaveLength(0);
  });

  it('emits decision:dismissed event', () => {
    let emitted: any = null;
    log.on('decision:dismissed', (d) => { emitted = d; });
    const d = log.add('a1', 'lead', 'D1', '', true);
    log.dismiss(d.id);
    expect(emitted?.id).toBe(d.id);
    expect(emitted?.status).toBe('dismissed');
  });

  it('double-dismiss is idempotent (no duplicate events)', () => {
    let dismissCount = 0;
    log.on('decision:dismissed', () => { dismissCount++; });
    const d = log.add('a1', 'lead', 'D1', '', true);
    log.dismiss(d.id);
    log.dismiss(d.id);
    expect(dismissCount).toBe(1);
    expect(log.getById(d.id)?.status).toBe('dismissed');
  });

  it('cannot dismiss already-confirmed decision', () => {
    let dismissCount = 0;
    log.on('decision:dismissed', () => { dismissCount++; });
    const d = log.add('a1', 'lead', 'D1', '', true);
    log.confirm(d.id);
    log.dismiss(d.id);
    expect(dismissCount).toBe(0);
    expect(log.getById(d.id)?.status).toBe('confirmed');
  });

  it('cannot dismiss already-rejected decision', () => {
    let dismissCount = 0;
    log.on('decision:dismissed', () => { dismissCount++; });
    const d = log.add('a1', 'lead', 'D1', '', true);
    log.reject(d.id);
    log.dismiss(d.id);
    expect(dismissCount).toBe(0);
    expect(log.getById(d.id)?.status).toBe('rejected');
  });

  it('cannot confirm already-dismissed decision', () => {
    let confirmCount = 0;
    log.on('decision:confirmed', () => { confirmCount++; });
    const d = log.add('a1', 'lead', 'D1', '', true);
    log.dismiss(d.id);
    log.confirm(d.id);
    expect(confirmCount).toBe(0);
    expect(log.getById(d.id)?.status).toBe('dismissed');
  });

  it('cannot reject already-dismissed decision', () => {
    let rejectCount = 0;
    log.on('decision:rejected', () => { rejectCount++; });
    const d = log.add('a1', 'lead', 'D1', '', true);
    log.dismiss(d.id);
    log.reject(d.id);
    expect(rejectCount).toBe(0);
    expect(log.getById(d.id)?.status).toBe('dismissed');
  });
});
