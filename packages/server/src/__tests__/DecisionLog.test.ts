import { describe, it, expect, beforeEach } from 'vitest';
import { DecisionLog } from '../coordination/DecisionLog.js';

describe('DecisionLog', () => {
  let log: DecisionLog;

  beforeEach(() => {
    log = new DecisionLog();
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
});
