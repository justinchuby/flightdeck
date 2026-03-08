import { describe, it, expect, beforeEach } from 'vitest';
import { DecisionLog, DECISION_CATEGORIES, TRUST_PRESETS, MIN_MATCHES_FOR_SCORE } from '../coordination/decisions/DecisionLog.js';
import type { IntentRule, IntentCondition, TrustPreset, IntentAction } from '../coordination/decisions/DecisionLog.js';
import { Database } from '../db/database.js';

describe('Intent Rules', () => {
  let db: Database;
  let log: DecisionLog;

  beforeEach(() => {
    db = new Database(':memory:');
    log = new DecisionLog(db);
  });

  describe('CRUD', () => {
    it('creates rule with unified type shape', () => {
      const rule = log.addIntentRule('style', 'manual', {
        name: 'Allow style from developers',
        roles: ['Developer'],
        priority: 10,
      });
      expect(rule.name).toBe('Allow style from developers');
      expect(rule.match.categories).toEqual(['style']);
      expect(rule.match.roles).toEqual(['Developer']);
      expect(rule.priority).toBe(10);
      expect(rule.metadata.matchCount).toBe(0);
      expect(rule.metadata.source).toBe('manual');
    });

    it('sorts rules by priority descending', () => {
      log.addIntentRule('style', 'manual', { priority: 5 });
      log.addIntentRule('testing', 'manual', { priority: 20 });
      log.addIntentRule('general', 'manual', { priority: 1 });
      const rules = log.getIntentRules();
      expect(rules[0].match.categories).toContain('testing');
      expect(rules[1].match.categories).toContain('style');
      expect(rules[2].match.categories).toContain('general');
    });

    it('defaults to allow action when no options', () => {
      const rule = log.addIntentRule('style', 'manual');
      expect(rule.action).toBe('allow');
      expect(rule.priority).toBe(0);
      expect(rule.enabled).toBe(true);
    });

    it('deletes a rule', () => {
      const rule = log.addIntentRule('style', 'manual');
      expect(log.deleteIntentRule(rule.id)).toBe(true);
      expect(log.getIntentRules()).toHaveLength(0);
    });

    it('returns false for unknown rule deletion', () => {
      expect(log.deleteIntentRule('nonexistent')).toBe(false);
    });
  });

  describe('enabled toggle', () => {
    it('rules default to enabled=true', () => {
      const rule = log.addIntentRule('style', 'manual');
      expect(rule.enabled).toBe(true);
    });

    it('can create disabled rule', () => {
      const rule = log.addIntentRule('style', 'manual', { enabled: false });
      expect(rule.enabled).toBe(false);
    });

    it('disabled rules are skipped during matching', () => {
      log.addIntentRule('style', 'manual', { enabled: false });
      expect(log.matchIntentRule('style')).toBeUndefined();
    });
  });

  describe('action types', () => {
    it('defaults to allow action', () => {
      const rule = log.addIntentRule('style', 'manual');
      expect(rule.action).toBe('allow');
    });

    it('can create require-review action rule', () => {
      const rule = log.addIntentRule('style', 'manual', { action: 'require-review' });
      expect(rule.action).toBe('require-review');
    });

    it('can create alert action rule', () => {
      const rule = log.addIntentRule('style', 'manual', { action: 'alert' });
      expect(rule.action).toBe('alert');
    });

    it('matchIntentRule returns rules of any action type', () => {
      log.addIntentRule('style', 'manual', { action: 'require-review' });
      const match = log.matchIntentRule('style');
      expect(match).toBeDefined();
      expect(match!.action).toBe('require-review');
    });
  });

  describe('reorder', () => {
    it('reorderIntentRules sets priority by array index', () => {
      const r1 = log.addIntentRule('style', 'manual');
      const r2 = log.addIntentRule('testing', 'manual');
      const r3 = log.addIntentRule('general', 'manual');

      const updated = log.reorderIntentRules([r3.id, r1.id, r2.id]);
      expect(updated).toBe(3);
      const rules = log.getIntentRules();
      expect(rules[0].id).toBe(r3.id);
      expect(rules[1].id).toBe(r1.id);
      expect(rules[2].id).toBe(r2.id);
    });
  });

  describe('matching with role scopes', () => {
    it('matches when agent role is in scope', () => {
      log.addIntentRule('style', 'manual', { roles: ['Developer'] });
      expect(log.matchIntentRule('style', { agentRole: 'Developer' })).toBeDefined();
    });

    it('does not match when agent role is out of scope', () => {
      log.addIntentRule('style', 'manual', { roles: ['Developer'] });
      expect(log.matchIntentRule('style', { agentRole: 'Architect' })).toBeUndefined();
    });

    it('matches when roles is empty (all roles)', () => {
      log.addIntentRule('style', 'manual', { roles: [] });
      expect(log.matchIntentRule('style', { agentRole: 'Architect' })).toBeDefined();
    });
  });

  describe('effectiveness tracking', () => {
    it('recordMatch increments matchCount', () => {
      const rule = log.addIntentRule('style', 'manual');
      log.recordMatch(rule.id, true);
      log.recordMatch(rule.id, true);
      const updated = log.getIntentRules().find(r => r.id === rule.id)!;
      expect(updated.metadata.matchCount).toBe(2);
      expect(updated.metadata.effectivenessScore).toBeNull(); // < MIN_MATCHES
    });

    it('computes score after MIN_MATCHES_FOR_SCORE', () => {
      const rule = log.addIntentRule('style', 'manual');
      for (let i = 0; i < MIN_MATCHES_FOR_SCORE; i++) {
        log.recordMatch(rule.id, true);
      }
      const updated = log.getIntentRules().find(r => r.id === rule.id)!;
      expect(updated.metadata.effectivenessScore).toBe(100);
    });

    it('recordOverride decreases effectiveness score', () => {
      const rule = log.addIntentRule('style', 'manual');
      for (let i = 0; i < MIN_MATCHES_FOR_SCORE; i++) {
        log.recordMatch(rule.id, true);
      }
      log.recordOverride(rule.id);
      log.recordOverride(rule.id);
      const updated = log.getIntentRules().find(r => r.id === rule.id)!;
      // 5 matches - 2 issues = 3 effective, score = 60%
      expect(updated.metadata.effectivenessScore).toBe(60);
    });
  });

  describe('trust presets', () => {
    it('conservative preset: allow style, require-review everything else', () => {
      const rules = log.applyTrustPreset('conservative');
      expect(rules).toHaveLength(6);
      const allow = rules.filter(r => r.action === 'allow');
      const review = rules.filter(r => r.action === 'require-review');
      expect(allow).toHaveLength(1);
      expect(allow[0].match.categories).toContain('style');
      expect(review).toHaveLength(5);
    });

    it('moderate preset: mix of allow, alert, require-review', () => {
      const rules = log.applyTrustPreset('moderate');
      expect(rules).toHaveLength(6);
      expect(rules.filter(r => r.action === 'allow').length).toBeGreaterThan(0);
      expect(rules.filter(r => r.action === 'alert')).toHaveLength(1);
      expect(rules.filter(r => r.action === 'require-review')).toHaveLength(1);
    });

    it('autonomous preset: allow most, alert on architecture + dependency', () => {
      const rules = log.applyTrustPreset('autonomous');
      expect(rules).toHaveLength(6);
      const alert = rules.filter(r => r.action === 'alert');
      expect(alert).toHaveLength(2);
    });

    it('all preset rules have enabled=true and source=preset', () => {
      const rules = log.applyTrustPreset('moderate');
      for (const rule of rules) {
        expect(rule.enabled).toBe(true);
        expect(rule.metadata.source).toBe('preset');
      }
    });

    it('applying preset replaces previous preset rules but keeps manual rules', () => {
      log.addIntentRule('general', 'manual', { name: 'My custom rule' });
      log.applyTrustPreset('conservative');
      expect(log.getIntentRules()).toHaveLength(7);

      log.applyTrustPreset('moderate');
      const rules = log.getIntentRules();
      expect(rules.filter(r => r.metadata.source === 'manual')).toHaveLength(1);
      expect(rules.filter(r => r.metadata.source === 'preset')).toHaveLength(6);
    });

    it('preset rules have lower priority than manual rules', () => {
      log.addIntentRule('style', 'manual', { priority: 0 });
      log.applyTrustPreset('conservative');
      const rules = log.getIntentRules();
      const manual = rules.find(r => r.metadata.source === 'manual')!;
      const preset = rules.find(r => r.metadata.source === 'preset')!;
      expect(manual.priority).toBeGreaterThan(preset.priority);
    });
  });
});
