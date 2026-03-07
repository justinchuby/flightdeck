import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DecisionLog, classifyDecision } from '../coordination/DecisionLog.js';
import type { DecisionCategory } from '../coordination/DecisionLog.js';
import { Database } from '../db/database.js';

describe('DecisionLog — Batch Operations', () => {
  let log: DecisionLog;
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    log = new DecisionLog(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── classifyDecision ──────────────────────────────────────────────

  describe('classifyDecision', () => {
    it('classifies formatting decisions as style', () => {
      expect(classifyDecision('Use prettier for formatting')).toBe('style');
      expect(classifyDecision('Apply ESLint rules')).toBe('style');
    });

    it('classifies architecture decisions', () => {
      expect(classifyDecision('Refactor module structure')).toBe('architecture');
      expect(classifyDecision('New design pattern for services')).toBe('architecture');
    });

    it('classifies tool access decisions', () => {
      expect(classifyDecision('Grant permission to execute command')).toBe('tool_access');
      expect(classifyDecision('Allow tool access for builds')).toBe('tool_access');
    });

    it('classifies dependency decisions', () => {
      expect(classifyDecision('Upgrade package lodash')).toBe('dependency');
      expect(classifyDecision('Install new dependency')).toBe('dependency');
    });

    it('classifies testing decisions', () => {
      expect(classifyDecision('Add test coverage for auth')).toBe('testing');
      expect(classifyDecision('Write spec for API')).toBe('testing');
    });

    it('returns general for unrecognized titles', () => {
      expect(classifyDecision('Do something random')).toBe('general');
    });

    it('does not false-positive on substrings (word boundary)', () => {
      expect(classifyDecision('Get latest information')).toBe('general');
      expect(classifyDecision('Contest this decision')).toBe('general');
      expect(classifyDecision('Lifestyle choices')).toBe('general');
    });
  });

  // ── Batch confirm/reject ──────────────────────────────────────────

  describe('confirmBatch', () => {
    it('confirms multiple decisions at once', () => {
      const d1 = log.add('a1', 'dev', 'D1', '', true);
      const d2 = log.add('a1', 'dev', 'D2', '', true);
      const d3 = log.add('a1', 'dev', 'D3', '', true);

      const result = log.confirmBatch([d1.id, d2.id, d3.id]);
      expect(result.updated).toBe(3);
      expect(result.results).toHaveLength(3);
      expect(result.results.every(d => d.status === 'confirmed')).toBe(true);
    });

    it('skips already-confirmed decisions without re-emitting', () => {
      let confirmCount = 0;
      log.on('decision:confirmed', () => { confirmCount++; });
      const d1 = log.add('a1', 'dev', 'D1', '', true);
      log.confirm(d1.id);
      expect(confirmCount).toBe(1);
      log.confirmBatch([d1.id]);
      // Should not emit an additional confirm event
      expect(confirmCount).toBe(1);
    });

    it('emits batch event', () => {
      let emitted: any = null;
      log.on('decisions:batch_confirmed', (d) => { emitted = d; });
      const d1 = log.add('a1', 'dev', 'D1', '', true);
      log.confirmBatch([d1.id]);
      expect(emitted).toHaveLength(1);
    });
  });

  describe('rejectBatch', () => {
    it('rejects multiple decisions at once', () => {
      const d1 = log.add('a1', 'dev', 'D1', '', true);
      const d2 = log.add('a1', 'dev', 'D2', '', true);
      const result = log.rejectBatch([d1.id, d2.id]);
      expect(result.updated).toBe(2);
      expect(result.results.every(d => d.status === 'rejected')).toBe(true);
    });

    it('emits batch rejected event', () => {
      let emitted: any = null;
      log.on('decisions:batch_rejected', (d) => { emitted = d; });
      const d1 = log.add('a1', 'dev', 'D1', '', true);
      log.rejectBatch([d1.id]);
      expect(emitted).toHaveLength(1);
    });
  });

  describe('dismissBatch', () => {
    it('dismisses multiple decisions at once', () => {
      const d1 = log.add('a1', 'dev', 'D1', '', true);
      const d2 = log.add('a1', 'dev', 'D2', '', true);
      const d3 = log.add('a1', 'dev', 'D3', '', true);

      const result = log.dismissBatch([d1.id, d2.id, d3.id]);
      expect(result.updated).toBe(3);
      expect(result.results).toHaveLength(3);
      expect(result.results.every(d => d.status === 'dismissed')).toBe(true);
    });

    it('skips already-dismissed decisions without re-emitting', () => {
      let dismissCount = 0;
      log.on('decision:dismissed', () => { dismissCount++; });
      const d1 = log.add('a1', 'dev', 'D1', '', true);
      log.dismiss(d1.id);
      expect(dismissCount).toBe(1);
      log.dismissBatch([d1.id]);
      expect(dismissCount).toBe(1);
    });

    it('emits batch dismissed event', () => {
      let emitted: any = null;
      log.on('decisions:batch_dismissed', (d) => { emitted = d; });
      const d1 = log.add('a1', 'dev', 'D1', '', true);
      log.dismissBatch([d1.id]);
      expect(emitted).toHaveLength(1);
    });

    it('skips confirmed/rejected decisions in batch', () => {
      const d1 = log.add('a1', 'dev', 'D1', '', true);
      const d2 = log.add('a1', 'dev', 'D2', '', true);
      const d3 = log.add('a1', 'dev', 'D3', '', true);
      log.confirm(d1.id);
      log.reject(d2.id);

      const result = log.dismissBatch([d1.id, d2.id, d3.id]);
      // Only d3 is actually dismissed; d1 and d2 are returned as-is (confirmed/rejected)
      expect(result.updated).toBe(3);
      expect(result.results).toHaveLength(3);
      // Only d3 should have 'dismissed' status
      const dismissed = result.results.filter(d => d.status === 'dismissed');
      expect(dismissed).toHaveLength(1);
      expect(dismissed[0].id).toBe(d3.id);
    });
  });

  // ── Teach Me suggestion ───────────────────────────────────────────

  describe('Teach Me suggestion', () => {
    it('suggests rule when 3+ decisions share a category', () => {
      const d1 = log.add('a1', 'dev', 'Format with prettier', '', true);
      const d2 = log.add('a1', 'dev', 'Apply lint fix', '', true);
      const d3 = log.add('a1', 'dev', 'Use eslint autofix', '', true);

      const result = log.confirmBatch([d1.id, d2.id, d3.id]);
      expect(result.suggestedRule).toBeDefined();
      expect(result.suggestedRule!.category).toBe('style');
      expect(result.suggestedRule!.count).toBe(3);
    });

    it('does not suggest rule when fewer than 3 share a category', () => {
      const d1 = log.add('a1', 'dev', 'Format with prettier', '', true);
      const d2 = log.add('a1', 'dev', 'Refactor auth module', '', true);

      const result = log.confirmBatch([d1.id, d2.id]);
      expect(result.suggestedRule).toBeUndefined();
    });

    it('does not suggest rule if one already exists for the category', () => {
      log.addIntentRule('style', 'manual');
      const d1 = log.add('a1', 'dev', 'Format with prettier', '', true);
      const d2 = log.add('a1', 'dev', 'Apply lint fix', '', true);
      const d3 = log.add('a1', 'dev', 'Use eslint autofix', '', true);

      const result = log.confirmBatch([d1.id, d2.id, d3.id]);
      expect(result.suggestedRule).toBeUndefined();
    });
  });

  // ── Intent Rules ──────────────────────────────────────────────────

  describe('Intent Rules', () => {
    it('starts with no rules', () => {
      expect(log.getIntentRules()).toHaveLength(0);
    });

    it('adds and retrieves a rule', () => {
      const rule = log.addIntentRule('style', 'manual');
      expect(rule.id).toMatch(/^rule-/);
      expect(rule.match.categories).toContain('style');
      expect(rule.metadata.source).toBe('manual');
      expect(log.getIntentRules()).toHaveLength(1);
    });

    it('deletes a rule', () => {
      const rule = log.addIntentRule('style', 'manual');
      expect(log.deleteIntentRule(rule.id)).toBe(true);
      expect(log.getIntentRules()).toHaveLength(0);
    });

    it('returns false when deleting non-existent rule', () => {
      expect(log.deleteIntentRule('nonexistent')).toBe(false);
    });

    it('persists rules across DecisionLog instances', () => {
      log.addIntentRule('style', 'manual');
      const log2 = new DecisionLog(db);
      expect(log2.getIntentRules()).toHaveLength(1);
      expect(log2.getIntentRules()[0].match.categories).toContain('style');
    });

    it('auto-approves decisions matching an intent rule', () => {
      log.addIntentRule('style', 'manual');
      const d = log.add('a1', 'dev', 'Apply prettier formatting', '', true);
      expect(d.status).toBe('confirmed');
      expect(d.autoApproved).toBe(true);
    });

    it('does not auto-approve decisions not matching any rule', () => {
      log.addIntentRule('style', 'manual');
      const d = log.add('a1', 'dev', 'Refactor auth module', '', true);
      expect(d.status).toBe('recorded');
    });

    it('increments matchCount when a rule matches', () => {
      const rule = log.addIntentRule('style', 'manual');
      log.add('a1', 'dev', 'Format code with prettier', '', true);
      const rules = log.getIntentRules();
      expect(rules[0].metadata.matchCount).toBe(1);
      expect(rules[0].metadata.lastMatchedAt).toBeTruthy();
    });
  });

  // ── Category on decisions ─────────────────────────────────────────

  describe('Decision category', () => {
    it('adds category to new decisions', () => {
      const d = log.add('a1', 'dev', 'Apply prettier formatting', '');
      expect(d.category).toBe('style');
    });

    it('returns category on all getter methods', () => {
      log.add('a1', 'dev', 'Install new package', '');
      const all = log.getAll();
      expect(all[0].category).toBe('dependency');
    });
  });

  // ── getPendingGrouped ─────────────────────────────────────────────

  describe('getPendingGrouped', () => {
    it('groups pending decisions by category', () => {
      log.add('a1', 'dev', 'Format file', '', true);
      log.add('a1', 'dev', 'Lint error', '', true);
      log.add('a1', 'dev', 'Upgrade lodash', '', true);

      const grouped = log.getPendingGrouped();
      expect(grouped.style).toHaveLength(2);
      expect(grouped.dependency).toHaveLength(1);
    });
  });

  // ── Timer Pause/Resume ──────────────────────────────────────────

  describe('pauseTimers / resumeTimers', () => {
    it('pauseTimers stops auto-approve from firing', async () => {
      const decision = log.add('a1', 'dev', 'Format imports', 'Cleaner imports', true);

      log.pauseTimers();
      expect(log.isTimersPaused).toBe(true);

      // Even after a short wait, decision should remain pending
      await new Promise(r => setTimeout(r, 50));
      const d = log.getById(decision.id);
      expect(d!.status).toBe('recorded');
    });

    it('resumeTimers restarts paused timers', () => {
      log.add('a1', 'dev', 'Format imports', 'Cleaner imports', true);

      log.pauseTimers();
      log.resumeTimers();
      expect(log.isTimersPaused).toBe(false);
    });

    it('pauseTimers is idempotent', () => {
      log.add('a1', 'dev', 'Format imports', 'Cleaner imports', true);

      log.pauseTimers();
      log.pauseTimers(); // second call is no-op
      expect(log.isTimersPaused).toBe(true);
    });

    it('resumeTimers is idempotent', () => {
      log.resumeTimers(); // no-op when not paused
      expect(log.isTimersPaused).toBe(false);
    });

    it('new decisions added while paused are also paused', () => {
      log.pauseTimers();
      const decision = log.add('a1', 'dev', 'Format code', 'Style fix', true);
      expect(decision.status).toBe('recorded');
      expect(log.getById(decision.id)!.status).toBe('recorded');
    });

    it('emits timers:paused and timers:resumed events', () => {
      const events: string[] = [];
      log.on('timers:paused', () => events.push('paused'));
      log.on('timers:resumed', () => events.push('resumed'));

      log.add('a1', 'dev', 'Format code', 'Style', true);
      log.pauseTimers();
      log.resumeTimers();

      expect(events).toEqual(['paused', 'resumed']);
    });
  });
});
