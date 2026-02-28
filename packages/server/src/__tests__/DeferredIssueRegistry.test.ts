import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DeferredIssueRegistry } from '../tasks/DeferredIssueRegistry.js';
import { Database } from '../db/database.js';

describe('DeferredIssueRegistry', () => {
  let registry: DeferredIssueRegistry;
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    registry = new DeferredIssueRegistry(db);
  });

  afterEach(() => {
    db.close();
  });

  it('starts empty for a lead', () => {
    expect(registry.list('lead-1')).toHaveLength(0);
  });

  it('adds a deferred issue with all fields', () => {
    const issue = registry.add('lead-1', 'reviewer-1', 'Critical Reviewer', 'Race condition in kill()', 'P1', 'AgentManager.ts');
    expect(issue.id).toBeGreaterThan(0);
    expect(issue.leadId).toBe('lead-1');
    expect(issue.reviewerAgentId).toBe('reviewer-1');
    expect(issue.reviewerRole).toBe('Critical Reviewer');
    expect(issue.severity).toBe('P1');
    expect(issue.description).toBe('Race condition in kill()');
    expect(issue.sourceFile).toBe('AgentManager.ts');
    expect(issue.status).toBe('open');
    expect(issue.createdAt).toBeTruthy();
  });

  it('defaults severity to P1', () => {
    const issue = registry.add('lead-1', 'reviewer-1', 'Code Reviewer', 'Minor issue');
    expect(issue.severity).toBe('P1');
  });

  it('lists issues for a specific lead', () => {
    registry.add('lead-1', 'r1', 'Reviewer', 'Issue A');
    registry.add('lead-2', 'r2', 'Reviewer', 'Issue B');
    registry.add('lead-1', 'r1', 'Reviewer', 'Issue C');

    expect(registry.list('lead-1')).toHaveLength(2);
    expect(registry.list('lead-2')).toHaveLength(1);
    expect(registry.list('lead-3')).toHaveLength(0);
  });

  it('filters by status', () => {
    const issue1 = registry.add('lead-1', 'r1', 'Reviewer', 'Open issue');
    registry.add('lead-1', 'r1', 'Reviewer', 'Another open issue');
    registry.resolve('lead-1', issue1.id);

    expect(registry.list('lead-1', 'open')).toHaveLength(1);
    expect(registry.list('lead-1', 'resolved')).toHaveLength(1);
    expect(registry.list('lead-1')).toHaveLength(2);
  });

  it('resolves an issue', () => {
    const issue = registry.add('lead-1', 'r1', 'Reviewer', 'To resolve');
    const ok = registry.resolve('lead-1', issue.id);
    expect(ok).toBe(true);

    const resolved = registry.list('lead-1', 'resolved');
    expect(resolved).toHaveLength(1);
    expect(resolved[0].status).toBe('resolved');
    expect(resolved[0].resolvedAt).toBeTruthy();
  });

  it('dismisses an issue', () => {
    const issue = registry.add('lead-1', 'r1', 'Reviewer', 'To dismiss');
    const ok = registry.dismiss('lead-1', issue.id);
    expect(ok).toBe(true);

    const dismissed = registry.list('lead-1', 'dismissed');
    expect(dismissed).toHaveLength(1);
    expect(dismissed[0].status).toBe('dismissed');
  });

  it('returns false when resolving non-existent issue', () => {
    expect(registry.resolve('lead-1', 999)).toBe(false);
  });

  it('returns false when resolving issue from wrong lead', () => {
    const issue = registry.add('lead-1', 'r1', 'Reviewer', 'Wrong lead test');
    expect(registry.resolve('lead-2', issue.id)).toBe(false);
  });

  it('clears all issues for a lead', () => {
    registry.add('lead-1', 'r1', 'Reviewer', 'Issue A');
    registry.add('lead-1', 'r1', 'Reviewer', 'Issue B');
    registry.add('lead-2', 'r1', 'Reviewer', 'Other lead issue');

    const cleared = registry.clear('lead-1');
    expect(cleared).toBe(2);
    expect(registry.list('lead-1')).toHaveLength(0);
    expect(registry.list('lead-2')).toHaveLength(1);
  });

  it('emits deferred_issue event on add', () => {
    let emitted: any = null;
    registry.on('deferred_issue', (issue) => { emitted = issue; });
    const issue = registry.add('lead-1', 'r1', 'Reviewer', 'Event test');
    expect(emitted).toBeTruthy();
    expect(emitted.id).toBe(issue.id);
    expect(emitted.description).toBe('Event test');
  });

  it('lists issues in reverse order (newest first)', () => {
    registry.add('lead-1', 'r1', 'Reviewer', 'First');
    registry.add('lead-1', 'r1', 'Reviewer', 'Second');
    registry.add('lead-1', 'r1', 'Reviewer', 'Third');

    const issues = registry.list('lead-1');
    expect(issues[0].description).toBe('Third');
    expect(issues[2].description).toBe('First');
  });
});
