import { describe, it, expect, beforeEach } from 'vitest';
import { DecisionLog, DECISION_CATEGORIES, TRUST_PRESETS, MIN_MATCHES_FOR_SCORE } from '../coordination/DecisionLog.js';
import type { IntentRule, IntentCondition, TrustPreset, IntentAction } from '../coordination/DecisionLog.js';
import { Database } from '../db/database.js';

describe('Intent Rules V2', () => {
  let db: Database;
  let log: DecisionLog;

  beforeEach(() => {
    db = new Database(':memory:');
    log = new DecisionLog(db);
  });

  describe('V2 fields', () => {
    it('creates rule with description, roleScopes, conditions, priority', () => {
      const rule = log.addIntentRule('style', 'manual', {
        description: 'Auto-approve style from developers',
        roleScopes: ['Developer'],
        conditions: [{ field: 'title', operator: 'contains', value: 'format' }],
        priority: 10,
      });
      expect(rule.description).toBe('Auto-approve style from developers');
      expect(rule.roleScopes).toEqual(['Developer']);
      expect(rule.conditions).toHaveLength(1);
      expect(rule.priority).toBe(10);
      expect(rule.effectiveness).toBeDefined();
      expect(rule.effectiveness!.totalMatches).toBe(0);
    });

    it('sorts rules by priority descending', () => {
      log.addIntentRule('style', 'manual', { priority: 5 });
      log.addIntentRule('testing', 'manual', { priority: 20 });
      log.addIntentRule('general', 'manual', { priority: 1 });
      const rules = log.getIntentRules();
      expect(rules[0].category).toBe('testing');
      expect(rules[1].category).toBe('style');
      expect(rules[2].category).toBe('general');
    });

    it('backward compatible — no V2 fields still works', () => {
      const rule = log.addIntentRule('style', 'manual');
      expect(rule.priority).toBe(0);
      expect(rule.roleScopes).toBeUndefined();
      expect(rule.conditions).toBeUndefined();
      expect(rule.enabled).toBe(true);
      expect(rule.action).toBe('auto-approve');
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

    it('re-enabling rule allows matching again', () => {
      const rule = log.addIntentRule('style', 'manual', { enabled: false });
      // Manually re-enable via direct mutation + save
      const rules = log.getIntentRules();
      rules.find(r => r.id === rule.id)!.enabled = true;
      (log as any).saveIntentRules();
      expect(log.matchIntentRule('style')).toBeDefined();
    });
  });

  describe('action types', () => {
    it('defaults to auto-approve action', () => {
      const rule = log.addIntentRule('style', 'manual');
      expect(rule.action).toBe('auto-approve');
    });

    it('can create queue action rule', () => {
      const rule = log.addIntentRule('style', 'manual', { action: 'queue' });
      expect(rule.action).toBe('queue');
    });

    it('can create alert action rule', () => {
      const rule = log.addIntentRule('style', 'manual', { action: 'alert' });
      expect(rule.action).toBe('alert');
    });

    it('matchIntentRule returns rules of any action type', () => {
      log.addIntentRule('style', 'manual', { action: 'queue' });
      const match = log.matchIntentRule('style');
      expect(match).toBeDefined();
      expect(match!.action).toBe('queue');
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
      // r3 should be first (highest priority), r2 should be last
      expect(rules[0].id).toBe(r3.id);
      expect(rules[1].id).toBe(r1.id);
      expect(rules[2].id).toBe(r2.id);
    });

    it('reorder ignores unknown IDs', () => {
      const r1 = log.addIntentRule('style', 'manual');
      const updated = log.reorderIntentRules([r1.id, 'nonexistent']);
      expect(updated).toBe(1);
    });
  });

  describe('V2 matching with role scopes', () => {
    it('matches when agent role is in scope', () => {
      log.addIntentRule('style', 'manual', { roleScopes: ['Developer'] });
      const match = log.matchIntentRule('style', { agentRole: 'Developer' });
      expect(match).toBeDefined();
    });

    it('does not match when agent role is out of scope', () => {
      log.addIntentRule('style', 'manual', { roleScopes: ['Developer'] });
      const match = log.matchIntentRule('style', { agentRole: 'Architect' });
      expect(match).toBeUndefined();
    });

    it('matches when roleScopes is empty (all roles)', () => {
      log.addIntentRule('style', 'manual', { roleScopes: [] });
      const match = log.matchIntentRule('style', { agentRole: 'Architect' });
      expect(match).toBeDefined();
    });
  });

  describe('V2 matching with conditions', () => {
    it('contains condition matches', () => {
      log.addIntentRule('style', 'manual', {
        conditions: [{ field: 'title', operator: 'contains', value: 'format' }],
      });
      expect(log.matchIntentRule('style', { title: 'Auto-format code' })).toBeDefined();
      expect(log.matchIntentRule('style', { title: 'Refactor module' })).toBeUndefined();
    });

    it('not_contains condition matches', () => {
      log.addIntentRule('general', 'manual', {
        conditions: [{ field: 'title', operator: 'not_contains', value: 'delete' }],
      });
      expect(log.matchIntentRule('general', { title: 'Add feature' })).toBeDefined();
      expect(log.matchIntentRule('general', { title: 'Delete all files' })).toBeUndefined();
    });

    it('equals condition matches', () => {
      log.addIntentRule('testing', 'manual', {
        conditions: [{ field: 'agentRole', operator: 'equals', value: 'qa tester' }],
      });
      expect(log.matchIntentRule('testing', { agentRole: 'QA Tester' })).toBeDefined();
      expect(log.matchIntentRule('testing', { agentRole: 'Developer' })).toBeUndefined();
    });

    it('matches condition is regex-based', () => {
      log.addIntentRule('style', 'manual', {
        conditions: [{ field: 'title', operator: 'matches', value: 'format|lint|prettier' }],
      });
      expect(log.matchIntentRule('style', { title: 'Run prettier' })).toBeDefined();
      expect(log.matchIntentRule('style', { title: 'Refactor logic' })).toBeUndefined();
    });

    it('multiple conditions all must match (AND)', () => {
      log.addIntentRule('style', 'manual', {
        roleScopes: ['Developer'],
        conditions: [
          { field: 'title', operator: 'contains', value: 'lint' },
        ],
      });
      // Both role + condition match
      expect(log.matchIntentRule('style', { agentRole: 'Developer', title: 'Fix lint errors' })).toBeDefined();
      // Role matches, condition doesn't
      expect(log.matchIntentRule('style', { agentRole: 'Developer', title: 'Refactor module' })).toBeUndefined();
      // Condition matches, role doesn't
      expect(log.matchIntentRule('style', { agentRole: 'Architect', title: 'Fix lint errors' })).toBeUndefined();
    });
  });

  describe('effectiveness tracking', () => {
    it('recordMatch increments totalMatches and autoApproved', () => {
      const rule = log.addIntentRule('style', 'manual');
      log.recordMatch(rule.id, true);
      log.recordMatch(rule.id, true);
      const updated = log.getIntentRules().find(r => r.id === rule.id)!;
      expect(updated.effectiveness!.totalMatches).toBe(2);
      expect(updated.effectiveness!.autoApproved).toBe(2);
      expect(updated.effectiveness!.score).toBeNull(); // < MIN_MATCHES
    });

    it('computes score after MIN_MATCHES_FOR_SCORE', () => {
      const rule = log.addIntentRule('style', 'manual');
      for (let i = 0; i < MIN_MATCHES_FOR_SCORE; i++) {
        log.recordMatch(rule.id, true);
      }
      const updated = log.getIntentRules().find(r => r.id === rule.id)!;
      expect(updated.effectiveness!.score).toBe(100);
    });

    it('recordOverride decreases effectiveness score', () => {
      const rule = log.addIntentRule('style', 'manual');
      for (let i = 0; i < MIN_MATCHES_FOR_SCORE; i++) {
        log.recordMatch(rule.id, true);
      }
      log.recordOverride(rule.id);
      log.recordOverride(rule.id);
      const updated = log.getIntentRules().find(r => r.id === rule.id)!;
      // 5 auto-approved - 2 overridden = 3 effective, score = 60%
      expect(updated.effectiveness!.score).toBe(60);
    });
  });

  describe('trust presets', () => {
    it('conservative preset adds rules with queue action for most categories', () => {
      const rules = log.applyTrustPreset('conservative');
      expect(rules).toHaveLength(6);
      const autoApprove = rules.filter(r => r.action === 'auto-approve');
      const queue = rules.filter(r => r.action === 'queue');
      expect(autoApprove).toHaveLength(1);
      expect(autoApprove[0].category).toBe('style');
      expect(queue).toHaveLength(5);
    });

    it('moderate preset has mix of auto-approve, queue, alert', () => {
      const rules = log.applyTrustPreset('moderate');
      expect(rules).toHaveLength(6);
      const autoApprove = rules.filter(r => r.action === 'auto-approve');
      const alert = rules.filter(r => r.action === 'alert');
      const queue = rules.filter(r => r.action === 'queue');
      expect(autoApprove.length).toBeGreaterThan(0);
      expect(alert).toHaveLength(1);
      expect(queue).toHaveLength(1);
    });

    it('autonomous preset auto-approves most, alerts on architecture', () => {
      const rules = log.applyTrustPreset('autonomous');
      expect(rules).toHaveLength(6);
      const alert = rules.filter(r => r.action === 'alert');
      expect(alert).toHaveLength(2); // architecture + tool_access
    });

    it('all preset rules have enabled=true', () => {
      const rules = log.applyTrustPreset('moderate');
      for (const rule of rules) {
        expect(rule.enabled).toBe(true);
        expect(rule.source).toBe('preset');
      }
    });

    it('applying preset replaces previous preset rules but keeps manual rules', () => {
      log.addIntentRule('general', 'manual', { description: 'My custom rule' });
      log.applyTrustPreset('conservative');
      expect(log.getIntentRules()).toHaveLength(7); // 1 manual + 6 preset

      log.applyTrustPreset('moderate'); // replaces preset rules
      const rules = log.getIntentRules();
      const manualRules = rules.filter(r => r.source === 'manual');
      const presetRules = rules.filter(r => r.source === 'preset');
      expect(manualRules).toHaveLength(1);
      expect(presetRules).toHaveLength(6);
    });

    it('preset rules have lower priority than manual rules', () => {
      log.addIntentRule('style', 'manual', { priority: 0 });
      log.applyTrustPreset('conservative');
      const rules = log.getIntentRules();
      const manual = rules.find(r => r.source === 'manual')!;
      const preset = rules.find(r => r.source === 'preset')!;
      expect(manual.priority).toBeGreaterThan(preset.priority!);
    });
  });
});
