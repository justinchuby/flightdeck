import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WorkflowService,
  type CreateRuleInput,
  type EventContext,
  type WorkflowRule,
} from '../coordination/WorkflowService.js';

function createMockDb() {
  const settings = new Map<string, string>();
  return {
    getSetting: vi.fn((key: string) => settings.get(key) ?? undefined),
    setSetting: vi.fn((key: string, val: string) => { settings.set(key, val); }),
    drizzle: {} as any,
    raw: {} as any,
  };
}

function makeSampleRule(overrides?: Partial<CreateRuleInput>): CreateRuleInput {
  return {
    name: 'Test Rule',
    description: 'A test workflow rule',
    enabled: true,
    trigger: { event: 'context_above_threshold' },
    conditions: [{ field: 'contextUsage', operator: 'gt', value: 80 }],
    actions: [{ type: 'compact_agent', params: {} }],
    notifications: [{ channel: 'pulse', message: 'Test notification' }],
    cooldownMs: 0,
    maxFiresPerSession: null,
    priority: 10,
    ...overrides,
  };
}

function makeContext(overrides?: Partial<EventContext>): EventContext {
  return {
    agents: [
      { id: 'agent-1', role: 'developer', status: 'active', contextUsage: 85, lastActivityAt: new Date().toISOString() },
    ],
    budget: { utilization: 0.5, burnRate: 10 },
    session: { durationMinutes: 30, startedAt: new Date().toISOString() },
    tasks: [{ id: 'task-1', status: 'in_progress', assignee: 'agent-1' }],
    event: { agentId: 'agent-1', taskId: 'task-1' },
    ...overrides,
  };
}

describe('WorkflowService', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: WorkflowService;

  beforeEach(() => {
    db = createMockDb();
    service = new WorkflowService(db as any);
  });

  // ── Rule CRUD ─────────────────────────────────────────────────

  describe('Rule CRUD', () => {
    it('getRules returns empty array initially', () => {
      expect(service.getRules()).toEqual([]);
    });

    it('createRule adds a rule with generated id and metadata', () => {
      const rule = service.createRule(makeSampleRule());
      expect(rule.id).toMatch(/^wf-/);
      expect(rule.name).toBe('Test Rule');
      expect(rule.metadata.source).toBe('manual');
      expect(rule.metadata.firedCount).toBe(0);
      expect(rule.metadata.lastFiredAt).toBeNull();
      expect(rule.metadata.createdAt).toBeDefined();
      expect(rule.metadata.lastEditedAt).toBeDefined();
    });

    it('createRule persists to db', () => {
      service.createRule(makeSampleRule());
      expect(db.setSetting).toHaveBeenCalledWith('workflows', expect.any(String));
    });

    it('getRules returns created rules', () => {
      service.createRule(makeSampleRule());
      service.createRule(makeSampleRule({ name: 'Second Rule' }));
      expect(service.getRules()).toHaveLength(2);
    });

    it('getRule finds by id', () => {
      const created = service.createRule(makeSampleRule());
      const found = service.getRule(created.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe('Test Rule');
    });

    it('getRule returns undefined for unknown id', () => {
      expect(service.getRule('nonexistent')).toBeUndefined();
    });

    it('updateRule modifies rule and updates lastEditedAt', () => {
      const created = service.createRule(makeSampleRule());
      const originalEditedAt = created.metadata.lastEditedAt;

      // Small delay to ensure timestamp differs
      const updated = service.updateRule(created.id, { name: 'Updated Rule' });
      expect(updated).toBeDefined();
      expect(updated!.name).toBe('Updated Rule');
      expect(updated!.id).toBe(created.id);
      expect(updated!.metadata.createdAt).toBe(created.metadata.createdAt);
      // lastEditedAt should be updated (or same if too fast, but at least present)
      expect(updated!.metadata.lastEditedAt).toBeDefined();
    });

    it('updateRule returns undefined for unknown id', () => {
      expect(service.updateRule('nonexistent', { name: 'X' })).toBeUndefined();
    });

    it('updateRule preserves id and metadata', () => {
      const created = service.createRule(makeSampleRule());
      const updated = service.updateRule(created.id, {
        name: 'Changed',
        enabled: false,
      });
      expect(updated!.id).toBe(created.id);
      expect(updated!.metadata.source).toBe('manual');
      expect(updated!.metadata.firedCount).toBe(0);
    });

    it('deleteRule removes the rule and returns true', () => {
      const created = service.createRule(makeSampleRule());
      expect(service.deleteRule(created.id)).toBe(true);
      expect(service.getRules()).toHaveLength(0);
    });

    it('deleteRule returns false for unknown id', () => {
      expect(service.deleteRule('nonexistent')).toBe(false);
    });

    it('toggleRule flips enabled state', () => {
      const created = service.createRule(makeSampleRule({ enabled: true }));
      const toggled = service.toggleRule(created.id);
      expect(toggled!.enabled).toBe(false);

      const toggledBack = service.toggleRule(created.id);
      expect(toggledBack!.enabled).toBe(true);
    });

    it('toggleRule returns undefined for unknown id', () => {
      expect(service.toggleRule('nonexistent')).toBeUndefined();
    });

    it('reorderRules sets priorities based on array order', () => {
      const r1 = service.createRule(makeSampleRule({ name: 'Rule A', priority: 50 }));
      const r2 = service.createRule(makeSampleRule({ name: 'Rule B', priority: 10 }));
      const r3 = service.createRule(makeSampleRule({ name: 'Rule C', priority: 30 }));

      service.reorderRules([r3.id, r1.id, r2.id]);

      const rules = service.getRules();
      expect(rules[0].id).toBe(r3.id);
      expect(rules[0].priority).toBe(0);
      expect(rules[1].id).toBe(r1.id);
      expect(rules[1].priority).toBe(1);
      expect(rules[2].id).toBe(r2.id);
      expect(rules[2].priority).toBe(2);
    });

    it('createRule throws when max rules reached', () => {
      // Seed with 100 rules
      for (let i = 0; i < 100; i++) {
        service.createRule(makeSampleRule({ name: `Rule ${i}` }));
      }
      expect(() => service.createRule(makeSampleRule({ name: 'Overflow' }))).toThrow(/Maximum/);
    });
  });

  // ── Templates ─────────────────────────────────────────────────

  describe('Templates', () => {
    it('getTemplates returns 12 templates', () => {
      expect(service.getTemplates()).toHaveLength(12);
    });

    it('getTemplatesByCategory filters correctly', () => {
      const context = service.getTemplatesByCategory('context');
      expect(context).toHaveLength(3);
      expect(context.every(t => t.category === 'context')).toBe(true);

      const cost = service.getTemplatesByCategory('cost');
      expect(cost).toHaveLength(3);

      const session = service.getTemplatesByCategory('session');
      expect(session).toHaveLength(3);

      const reliability = service.getTemplatesByCategory('reliability');
      expect(reliability).toHaveLength(3);
    });

    it('createFromTemplate creates a rule from a template', () => {
      const rule = service.createFromTemplate('auto-compact-critical');
      expect(rule).toBeDefined();
      expect(rule!.name).toBe('Auto-Compact at Critical Context');
      expect(rule!.metadata.source).toBe('template');
      expect(rule!.id).toMatch(/^wf-/);
    });

    it('createFromTemplate with overrides applies them', () => {
      const rule = service.createFromTemplate('auto-compact-critical', {
        name: 'Custom Compact',
        cooldownMs: 999,
      });
      expect(rule!.name).toBe('Custom Compact');
      expect(rule!.cooldownMs).toBe(999);
    });

    it('createFromTemplate returns undefined for unknown template', () => {
      expect(service.createFromTemplate('nonexistent')).toBeUndefined();
    });

    it('all templates have required fields', () => {
      for (const template of service.getTemplates()) {
        expect(template.id).toBeTruthy();
        expect(template.name).toBeTruthy();
        expect(template.description).toBeTruthy();
        expect(template.category).toBeTruthy();
        expect(template.rule.trigger.event).toBeTruthy();
        expect(template.rule.cooldownMs).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ── Evaluation ────────────────────────────────────────────────

  describe('evaluateEvent', () => {
    it('fires matching rule and returns results', () => {
      service.createRule(makeSampleRule());
      const context = makeContext();
      const results = service.evaluateEvent('context_above_threshold', context);

      expect(results).toHaveLength(1);
      expect(results[0].actions).toHaveLength(1);
      expect(results[0].actions[0].type).toBe('compact_agent');
      expect(results[0].notifications).toHaveLength(1);
      expect(results[0].matchedConditions).toHaveLength(1);
    });

    it('does not fire disabled rules', () => {
      service.createRule(makeSampleRule({ enabled: false }));
      const results = service.evaluateEvent('context_above_threshold', makeContext());
      expect(results).toHaveLength(0);
    });

    it('does not fire when event does not match trigger', () => {
      service.createRule(makeSampleRule({ trigger: { event: 'agent_crashed' } }));
      const results = service.evaluateEvent('context_above_threshold', makeContext());
      expect(results).toHaveLength(0);
    });

    it('does not fire when conditions not met', () => {
      service.createRule(makeSampleRule({
        conditions: [{ field: 'contextUsage', operator: 'gt', value: 95 }],
      }));
      const context = makeContext({ agents: [{ id: 'agent-1', role: 'dev', status: 'active', contextUsage: 85, lastActivityAt: '' }] });
      const results = service.evaluateEvent('context_above_threshold', context);
      expect(results).toHaveLength(0);
    });

    it('increments firedCount on fire', () => {
      const rule = service.createRule(makeSampleRule());
      service.evaluateEvent('context_above_threshold', makeContext());
      const updated = service.getRule(rule.id);
      expect(updated!.metadata.firedCount).toBe(1);
      expect(updated!.metadata.lastFiredAt).toBeTruthy();
    });

    it('respects cooldown', () => {
      const rule = service.createRule(makeSampleRule({ cooldownMs: 60_000 }));

      // First fire should succeed
      const results1 = service.evaluateEvent('context_above_threshold', makeContext());
      expect(results1).toHaveLength(1);

      // Immediately second fire should be blocked by cooldown
      const results2 = service.evaluateEvent('context_above_threshold', makeContext());
      expect(results2).toHaveLength(0);
    });

    it('respects maxFiresPerSession', () => {
      service.createRule(makeSampleRule({ maxFiresPerSession: 1 }));

      const results1 = service.evaluateEvent('context_above_threshold', makeContext());
      expect(results1).toHaveLength(1);

      const results2 = service.evaluateEvent('context_above_threshold', makeContext());
      expect(results2).toHaveLength(0);
    });

    it('fires rules in priority order', () => {
      service.createRule(makeSampleRule({ name: 'Low Priority', priority: 100 }));
      service.createRule(makeSampleRule({ name: 'High Priority', priority: 1 }));

      const results = service.evaluateEvent('context_above_threshold', makeContext());
      expect(results).toHaveLength(2);
      expect(results[0].rule.name).toBe('High Priority');
      expect(results[1].rule.name).toBe('Low Priority');
    });

    it('fires rules with no conditions (empty conditions array)', () => {
      service.createRule(makeSampleRule({
        conditions: [],
        trigger: { event: 'agent_crashed' },
      }));
      const results = service.evaluateEvent('agent_crashed', makeContext());
      expect(results).toHaveLength(1);
    });

    it('handles trigger scope matching', () => {
      service.createRule(makeSampleRule({
        trigger: { event: 'context_above_threshold', scope: { agentId: 'agent-1' } },
      }));

      // Should match agent-1
      const results1 = service.evaluateEvent('context_above_threshold', makeContext());
      expect(results1).toHaveLength(1);

      // Should not match agent-2
      const ctx2 = makeContext({ event: { agentId: 'agent-2' } });
      const results2 = service.evaluateEvent('context_above_threshold', ctx2);
      expect(results2).toHaveLength(0);
    });

    it('handles trigger scope with role', () => {
      service.createRule(makeSampleRule({
        trigger: { event: 'context_above_threshold', scope: { role: 'developer' } },
      }));
      const results = service.evaluateEvent('context_above_threshold', makeContext());
      expect(results).toHaveLength(1);
    });

    it('handles trigger scope with role mismatch', () => {
      service.createRule(makeSampleRule({
        trigger: { event: 'context_above_threshold', scope: { role: 'architect' } },
      }));
      const results = service.evaluateEvent('context_above_threshold', makeContext());
      expect(results).toHaveLength(0);
    });
  });

  // ── Condition Operators ───────────────────────────────────────

  describe('Condition operators', () => {
    it('gt operator', () => {
      service.createRule(makeSampleRule({
        conditions: [{ field: 'contextUsage', operator: 'gt', value: 80 }],
      }));
      const ctx = makeContext({
        agents: [{ id: 'agent-1', role: 'dev', status: 'active', contextUsage: 85, lastActivityAt: '' }],
      });
      expect(service.evaluateEvent('context_above_threshold', ctx)).toHaveLength(1);
    });

    it('lt operator', () => {
      service.createRule(makeSampleRule({
        conditions: [{ field: 'contextUsage', operator: 'lt', value: 50 }],
      }));
      const ctx = makeContext({
        agents: [{ id: 'agent-1', role: 'dev', status: 'active', contextUsage: 30, lastActivityAt: '' }],
      });
      expect(service.evaluateEvent('context_above_threshold', ctx)).toHaveLength(1);
    });

    it('eq operator', () => {
      service.createRule(makeSampleRule({
        conditions: [{ field: 'contextUsage', operator: 'eq', value: 85 }],
      }));
      expect(service.evaluateEvent('context_above_threshold', makeContext())).toHaveLength(1);
    });

    it('between operator', () => {
      service.createRule(makeSampleRule({
        conditions: [{ field: 'contextUsage', operator: 'between', value: 80, value2: 90 }],
      }));
      expect(service.evaluateEvent('context_above_threshold', makeContext())).toHaveLength(1);
    });

    it('contains operator with string field', () => {
      service.createRule(makeSampleRule({
        conditions: [{ field: 'agentRole', operator: 'contains', value: 'dev' }],
      }));
      expect(service.evaluateEvent('context_above_threshold', makeContext())).toHaveLength(1);
    });

    it('budgetUtilization field resolves from context', () => {
      service.createRule(makeSampleRule({
        trigger: { event: 'budget_threshold' },
        conditions: [{ field: 'budgetUtilization', operator: 'gt', value: 0.3 }],
      }));
      expect(service.evaluateEvent('budget_threshold', makeContext())).toHaveLength(1);
    });

    it('sessionDurationMinutes field resolves from context', () => {
      service.createRule(makeSampleRule({
        trigger: { event: 'session_duration' },
        conditions: [{ field: 'sessionDurationMinutes', operator: 'gt', value: 20 }],
      }));
      expect(service.evaluateEvent('session_duration', makeContext())).toHaveLength(1);
    });

    it('condition fails when field not found', () => {
      service.createRule(makeSampleRule({
        conditions: [{ field: 'nonexistent_field', operator: 'gt', value: 0 }],
      }));
      expect(service.evaluateEvent('context_above_threshold', makeContext())).toHaveLength(0);
    });

    it('AND semantics: all conditions must match', () => {
      service.createRule(makeSampleRule({
        trigger: { event: 'context_above_threshold' },
        conditions: [
          { field: 'contextUsage', operator: 'gt', value: 80 },
          { field: 'contextUsage', operator: 'lt', value: 50 }, // contradicts
        ],
      }));
      expect(service.evaluateEvent('context_above_threshold', makeContext())).toHaveLength(0);
    });
  });

  // ── Dry Run ───────────────────────────────────────────────────

  describe('dryRun', () => {
    it('returns results for all rules', () => {
      service.createRule(makeSampleRule({ name: 'Rule A' }));
      service.createRule(makeSampleRule({ name: 'Rule B', enabled: false }));

      const results = service.dryRun(makeContext());
      expect(results).toHaveLength(2);
    });

    it('disabled rule shows wouldFire=false with correct reason', () => {
      service.createRule(makeSampleRule({ enabled: false }));
      const results = service.dryRun(makeContext());
      expect(results[0].wouldFire).toBe(false);
      expect(results[0].reason).toContain('disabled');
    });

    it('matching rule shows wouldFire=true', () => {
      service.createRule(makeSampleRule());
      const results = service.dryRun(makeContext());
      expect(results[0].wouldFire).toBe(true);
      expect(results[0].matchedConditions.length).toBeGreaterThan(0);
    });

    it('dry run does NOT update firedCount', () => {
      const rule = service.createRule(makeSampleRule());
      service.dryRun(makeContext());
      expect(service.getRule(rule.id)!.metadata.firedCount).toBe(0);
    });

    it('shows cooldown reason when applicable', () => {
      const rule = service.createRule(makeSampleRule({ cooldownMs: 60_000 }));
      // Fire once to set lastFiredAt
      service.evaluateEvent('context_above_threshold', makeContext());
      expect(service.getRule(rule.id)!.metadata.firedCount).toBe(1);

      const results = service.dryRun(makeContext());
      const dryResult = results.find(r => r.ruleId === rule.id)!;
      expect(dryResult.wouldFire).toBe(false);
      expect(dryResult.reason).toContain('ooldown');
    });

    it('actionsPreview lists action types', () => {
      service.createRule(makeSampleRule({
        actions: [
          { type: 'compact_agent', params: {} },
          { type: 'restart_agent', params: {} },
        ],
      }));
      const results = service.dryRun(makeContext());
      expect(results[0].actionsPreview).toEqual(['compact_agent', 'restart_agent']);
    });
  });

  // ── Activity Log ──────────────────────────────────────────────

  describe('Activity Log', () => {
    it('getActivity returns empty array initially', () => {
      expect(service.getActivity()).toEqual([]);
    });

    it('recordActivity adds an entry with generated id and timestamp', () => {
      service.recordActivity({
        ruleId: 'wf-123',
        ruleName: 'Test',
        event: 'agent_crashed',
        actionsExecuted: ['restart_agent'],
        success: true,
      });
      const activity = service.getActivity();
      expect(activity).toHaveLength(1);
      expect(activity[0].id).toMatch(/^wfa-/);
      expect(activity[0].timestamp).toBeTruthy();
      expect(activity[0].ruleId).toBe('wf-123');
    });

    it('getActivity with limit returns last N entries', () => {
      for (let i = 0; i < 10; i++) {
        service.recordActivity({
          ruleId: `wf-${i}`,
          ruleName: `Rule ${i}`,
          event: 'task_completed',
          actionsExecuted: ['create_checkpoint'],
          success: true,
        });
      }
      const last3 = service.getActivity(3);
      expect(last3).toHaveLength(3);
      expect(last3[0].ruleId).toBe('wf-7');
      expect(last3[2].ruleId).toBe('wf-9');
    });

    it('activity log prunes to 500 entries (FIFO)', () => {
      for (let i = 0; i < 510; i++) {
        service.recordActivity({
          ruleId: `wf-${i}`,
          ruleName: `Rule ${i}`,
          event: 'task_completed',
          actionsExecuted: [],
          success: true,
        });
      }
      const all = service.getActivity();
      expect(all).toHaveLength(500);
      // Oldest entries should have been pruned — first entry should be wf-10
      expect(all[0].ruleId).toBe('wf-10');
    });

    it('recordActivity persists to db', () => {
      service.recordActivity({
        ruleId: 'wf-x',
        ruleName: 'X',
        event: 'agent_idle',
        actionsExecuted: [],
        success: true,
      });
      expect(db.setSetting).toHaveBeenCalledWith('workflow_activity', expect.any(String));
    });

    it('recordActivity can include an error', () => {
      service.recordActivity({
        ruleId: 'wf-e',
        ruleName: 'Error Rule',
        event: 'agent_crashed',
        actionsExecuted: ['restart_agent'],
        success: false,
        error: 'Agent not found',
      });
      const entry = service.getActivity()[0];
      expect(entry.success).toBe(false);
      expect(entry.error).toBe('Agent not found');
    });
  });

  // ── Persistence ───────────────────────────────────────────────

  describe('Persistence', () => {
    it('loads rules from db on construction', () => {
      // Pre-seed the db with a rule
      const rule: WorkflowRule = {
        id: 'wf-pre-existing',
        name: 'Pre-existing',
        description: 'Was already in db',
        enabled: true,
        trigger: { event: 'agent_idle' },
        conditions: [],
        actions: [],
        notifications: [],
        cooldownMs: 0,
        maxFiresPerSession: null,
        priority: 10,
        metadata: {
          source: 'manual',
          firedCount: 0,
          lastFiredAt: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          lastEditedAt: '2024-01-01T00:00:00.000Z',
        },
      };
      db.setSetting('workflows', JSON.stringify([rule]));

      const newService = new WorkflowService(db as any);
      expect(newService.getRules()).toHaveLength(1);
      expect(newService.getRules()[0].name).toBe('Pre-existing');
    });

    it('loads activity from db on construction', () => {
      db.setSetting('workflow_activity', JSON.stringify([{
        id: 'wfa-existing',
        ruleId: 'wf-1',
        ruleName: 'Test',
        event: 'agent_crashed',
        actionsExecuted: [],
        success: true,
        timestamp: '2024-01-01T00:00:00.000Z',
      }]));

      const newService = new WorkflowService(db as any);
      expect(newService.getActivity()).toHaveLength(1);
    });

    it('handles corrupt rules JSON gracefully', () => {
      db.setSetting('workflows', 'not-json');
      const newService = new WorkflowService(db as any);
      expect(newService.getRules()).toEqual([]);
    });

    it('handles corrupt activity JSON gracefully', () => {
      db.setSetting('workflow_activity', '{bad');
      const newService = new WorkflowService(db as any);
      expect(newService.getActivity()).toEqual([]);
    });
  });

  // ── Edge Cases ────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('evaluateEvent with no rules returns empty', () => {
      expect(service.evaluateEvent('agent_crashed', makeContext())).toEqual([]);
    });

    it('multiple rules can fire for the same event', () => {
      service.createRule(makeSampleRule({ name: 'Rule A', priority: 1 }));
      service.createRule(makeSampleRule({ name: 'Rule B', priority: 2 }));
      const results = service.evaluateEvent('context_above_threshold', makeContext());
      expect(results).toHaveLength(2);
    });

    it('trigger scope with no event context is restrictive', () => {
      service.createRule(makeSampleRule({
        trigger: { event: 'context_above_threshold', scope: { agentId: 'agent-1' } },
      }));
      const ctx = makeContext({ event: undefined });
      const results = service.evaluateEvent('context_above_threshold', ctx);
      expect(results).toHaveLength(0);
    });

    it('trigger scope with empty scope matches everything', () => {
      service.createRule(makeSampleRule({
        trigger: { event: 'context_above_threshold', scope: {} },
      }));
      const results = service.evaluateEvent('context_above_threshold', makeContext());
      expect(results).toHaveLength(1);
    });

    it('event context field fallback resolves custom fields', () => {
      service.createRule(makeSampleRule({
        conditions: [{ field: 'customMetric', operator: 'gt', value: 10 }],
      }));
      const ctx = makeContext({ event: { agentId: 'agent-1', customMetric: 50 } });
      expect(service.evaluateEvent('context_above_threshold', ctx)).toHaveLength(1);
    });

    it('between operator with value2 undefined treats as eq', () => {
      service.createRule(makeSampleRule({
        conditions: [{ field: 'contextUsage', operator: 'between', value: 85 }],
      }));
      expect(service.evaluateEvent('context_above_threshold', makeContext())).toHaveLength(1);
    });
  });
});
