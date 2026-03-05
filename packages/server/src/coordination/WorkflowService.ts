import type { Database } from '../db/database.js';
import { logger } from '../utils/logger.js';

// ── Types ─────────────────────────────────────────────────────────

export type WorkflowEvent =
  | 'context_above_threshold'
  | 'context_exhaustion_predicted'
  | 'agent_stalled'
  | 'agent_crashed'
  | 'agent_idle'
  | 'task_completed'
  | 'all_tasks_completed'
  | 'task_overdue'
  | 'budget_threshold'
  | 'decision_pending'
  | 'file_conflict_detected'
  | 'session_duration';

export type WorkflowActionType =
  | 'compact_agent'
  | 'restart_agent'
  | 'pause_agent'
  | 'pause_all'
  | 'resume_agent'
  | 'switch_model'
  | 'reassign_task'
  | 'reprioritize_task'
  | 'generate_summary'
  | 'create_checkpoint'
  | 'approve_decisions'
  | 'set_deadline'
  | 'custom_webhook';

export interface WorkflowTrigger {
  event: WorkflowEvent;
  scope?: {
    agentId?: string;
    role?: string;
    taskId?: string;
  };
}

export interface WorkflowCondition {
  field: string;
  operator: 'gt' | 'lt' | 'eq' | 'between' | 'contains';
  value: number | string;
  value2?: number;
}

export interface WorkflowAction {
  type: WorkflowActionType;
  params: Record<string, unknown>;
}

export interface WorkflowNotification {
  channel: 'pulse' | 'desktop' | 'slack' | 'email';
  message: string;
}

export interface WorkflowRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: WorkflowTrigger;
  conditions: WorkflowCondition[];   // AND-combined
  actions: WorkflowAction[];         // execute in order
  notifications: WorkflowNotification[];
  cooldownMs: number;                // minimum time between firings
  maxFiresPerSession: number | null; // null = unlimited
  priority: number;                  // lower = higher priority for ordering
  metadata: {
    source: 'manual' | 'template' | 'suggested';
    firedCount: number;
    lastFiredAt: string | null;
    createdAt: string;
    lastEditedAt: string;
  };
}

export interface WorkflowActivityEntry {
  id: string;
  ruleId: string;
  ruleName: string;
  event: WorkflowEvent;
  actionsExecuted: string[];   // action type names
  success: boolean;
  error?: string;
  timestamp: string;
}

export interface WorkflowDryRunResult {
  ruleId: string;
  ruleName: string;
  wouldFire: boolean;
  reason: string;
  matchedConditions: string[];
  actionsPreview: string[];
}

export type WorkflowTemplateCategory = 'context' | 'cost' | 'session' | 'reliability';

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: WorkflowTemplateCategory;
  rule: Omit<WorkflowRule, 'id' | 'metadata'>;
}

export interface EventContext {
  agents: Array<{
    id: string;
    role: string;
    status: string;
    contextUsage: number;     // 0-100
    lastActivityAt: string;
  }>;
  budget?: {
    utilization: number;      // 0-1
    burnRate: number;
  };
  session?: {
    durationMinutes: number;
    startedAt: string;
  };
  tasks?: Array<{
    id: string;
    status: string;
    assignee?: string;
  }>;
  event?: {
    agentId?: string;
    taskId?: string;
    [key: string]: unknown;
  };
}

export interface EvaluationResult {
  rule: WorkflowRule;
  matchedConditions: string[];
  actions: WorkflowAction[];
  notifications: WorkflowNotification[];
}

export type CreateRuleInput = Omit<WorkflowRule, 'id' | 'metadata'>;

// ── Constants ─────────────────────────────────────────────────────

const RULES_KEY = 'workflows';
const ACTIVITY_KEY = 'workflow_activity';
const MAX_RULES = 100;
const MAX_ACTIVITY = 500;

// ── Templates ─────────────────────────────────────────────────────

const TEMPLATES: WorkflowTemplate[] = [
  // ── Context Management ──────────────────────────
  {
    id: 'auto-compact-critical',
    name: 'Auto-Compact at Critical Context',
    description: 'Automatically compact an agent when context usage exceeds 90%',
    category: 'context',
    rule: {
      name: 'Auto-Compact at Critical Context',
      description: 'Automatically compact an agent when context usage exceeds 90%',
      enabled: true,
      trigger: { event: 'context_above_threshold' },
      conditions: [{ field: 'contextUsage', operator: 'gt', value: 90 }],
      actions: [{ type: 'compact_agent', params: {} }],
      notifications: [],
      cooldownMs: 5 * 60 * 1000,
      maxFiresPerSession: null,
      priority: 10,
    },
  },
  {
    id: 'alert-high-context',
    name: 'Alert on High Context Usage',
    description: 'Send a pulse notification when any agent exceeds 80% context usage',
    category: 'context',
    rule: {
      name: 'Alert on High Context Usage',
      description: 'Send a pulse notification when any agent exceeds 80% context usage',
      enabled: true,
      trigger: { event: 'context_above_threshold' },
      conditions: [{ field: 'contextUsage', operator: 'gt', value: 80 }],
      actions: [],
      notifications: [{ channel: 'pulse', message: 'Agent context usage is above 80%' }],
      cooldownMs: 10 * 60 * 1000,
      maxFiresPerSession: null,
      priority: 20,
    },
  },
  {
    id: 'prevent-exhaustion',
    name: 'Prevent Context Exhaustion',
    description: 'Compact agent when context exhaustion is predicted before it happens',
    category: 'context',
    rule: {
      name: 'Prevent Context Exhaustion',
      description: 'Compact agent when context exhaustion is predicted before it happens',
      enabled: true,
      trigger: { event: 'context_exhaustion_predicted' },
      conditions: [],
      actions: [{ type: 'compact_agent', params: {} }],
      notifications: [{ channel: 'pulse', message: 'Context exhaustion predicted — compacting agent' }],
      cooldownMs: 5 * 60 * 1000,
      maxFiresPerSession: null,
      priority: 5,
    },
  },

  // ── Cost Control ────────────────────────────────
  {
    id: 'budget-warning-80',
    name: 'Budget Warning at 80%',
    description: 'Notify when budget utilization exceeds 80%',
    category: 'cost',
    rule: {
      name: 'Budget Warning at 80%',
      description: 'Notify when budget utilization exceeds 80%',
      enabled: true,
      trigger: { event: 'budget_threshold' },
      conditions: [{ field: 'budgetUtilization', operator: 'gt', value: 0.8 }],
      actions: [],
      notifications: [{ channel: 'pulse', message: 'Budget utilization has exceeded 80%' }],
      cooldownMs: 15 * 60 * 1000,
      maxFiresPerSession: null,
      priority: 30,
    },
  },
  {
    id: 'budget-pause-95',
    name: 'Pause All at 95% Budget',
    description: 'Pause all agents when budget utilization exceeds 95%',
    category: 'cost',
    rule: {
      name: 'Pause All at 95% Budget',
      description: 'Pause all agents when budget utilization exceeds 95%',
      enabled: true,
      trigger: { event: 'budget_threshold' },
      conditions: [{ field: 'budgetUtilization', operator: 'gt', value: 0.95 }],
      actions: [{ type: 'pause_all', params: {} }],
      notifications: [{ channel: 'pulse', message: 'Budget critical (95%) — all agents paused' }],
      cooldownMs: 0,
      maxFiresPerSession: 1,
      priority: 1,
    },
  },
  {
    id: 'cost-optimization',
    name: 'Cost Optimization — Switch Model',
    description: 'Switch to a cheaper model when budget exceeds 60%',
    category: 'cost',
    rule: {
      name: 'Cost Optimization — Switch Model',
      description: 'Switch to a cheaper model when budget exceeds 60%',
      enabled: true,
      trigger: { event: 'budget_threshold' },
      conditions: [{ field: 'budgetUtilization', operator: 'gt', value: 0.6 }],
      actions: [{ type: 'switch_model', params: { model: 'cheaper' } }],
      notifications: [],
      cooldownMs: 30 * 60 * 1000,
      maxFiresPerSession: null,
      priority: 40,
    },
  },

  // ── Session Management ──────────────────────────
  {
    id: 'session-2hr-wind-down',
    name: 'Session 2hr Wind-Down',
    description: 'Set a 10-minute deadline after 2 hours of session time',
    category: 'session',
    rule: {
      name: 'Session 2hr Wind-Down',
      description: 'Set a 10-minute deadline after 2 hours of session time',
      enabled: true,
      trigger: { event: 'session_duration' },
      conditions: [{ field: 'sessionDurationMinutes', operator: 'gt', value: 120 }],
      actions: [{ type: 'set_deadline', params: { minutes: 10 } }],
      notifications: [{ channel: 'pulse', message: 'Session has exceeded 2 hours — winding down in 10 minutes' }],
      cooldownMs: 0,
      maxFiresPerSession: 1,
      priority: 15,
    },
  },
  {
    id: 'auto-checkpoint',
    name: 'Auto-Checkpoint on Task Completion',
    description: 'Create a checkpoint every time a task is completed',
    category: 'session',
    rule: {
      name: 'Auto-Checkpoint on Task Completion',
      description: 'Create a checkpoint every time a task is completed',
      enabled: true,
      trigger: { event: 'task_completed' },
      conditions: [],
      actions: [{ type: 'create_checkpoint', params: {} }],
      notifications: [],
      cooldownMs: 5 * 60 * 1000,
      maxFiresPerSession: null,
      priority: 50,
    },
  },
  {
    id: 'session-summary-hourly',
    name: 'Hourly Session Summary',
    description: 'Generate a session summary every hour',
    category: 'session',
    rule: {
      name: 'Hourly Session Summary',
      description: 'Generate a session summary every hour',
      enabled: true,
      trigger: { event: 'session_duration' },
      conditions: [{ field: 'sessionDurationMinutes', operator: 'gt', value: 60 }],
      actions: [{ type: 'generate_summary', params: {} }],
      notifications: [],
      cooldownMs: 60 * 60 * 1000,
      maxFiresPerSession: null,
      priority: 60,
    },
  },

  // ── Reliability ─────────────────────────────────
  {
    id: 'auto-restart-crash',
    name: 'Auto-Restart on Crash',
    description: 'Automatically restart an agent that crashes, up to 3 times per session',
    category: 'reliability',
    rule: {
      name: 'Auto-Restart on Crash',
      description: 'Automatically restart an agent that crashes, up to 3 times per session',
      enabled: true,
      trigger: { event: 'agent_crashed' },
      conditions: [],
      actions: [{ type: 'restart_agent', params: {} }],
      notifications: [{ channel: 'pulse', message: 'Agent crashed and was automatically restarted' }],
      cooldownMs: 5 * 60 * 1000,
      maxFiresPerSession: 3,
      priority: 2,
    },
  },
  {
    id: 'stall-recovery',
    name: 'Stall Recovery',
    description: 'Restart a stalled agent, up to 2 times per session',
    category: 'reliability',
    rule: {
      name: 'Stall Recovery',
      description: 'Restart a stalled agent, up to 2 times per session',
      enabled: true,
      trigger: { event: 'agent_stalled' },
      conditions: [],
      actions: [{ type: 'restart_agent', params: {} }],
      notifications: [{ channel: 'pulse', message: 'Stalled agent detected and restarted' }],
      cooldownMs: 10 * 60 * 1000,
      maxFiresPerSession: 2,
      priority: 3,
    },
  },
  {
    id: 'auto-approve',
    name: 'Auto-Approve Decisions',
    description: 'Automatically approve pending decisions without human intervention',
    category: 'reliability',
    rule: {
      name: 'Auto-Approve Decisions',
      description: 'Automatically approve pending decisions without human intervention',
      enabled: true,
      trigger: { event: 'decision_pending' },
      conditions: [],
      actions: [{ type: 'approve_decisions', params: {} }],
      notifications: [],
      cooldownMs: 0,
      maxFiresPerSession: null,
      priority: 25,
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────

function generateRuleId(): string {
  return `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateActivityId(): string {
  return `wfa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── WorkflowService ───────────────────────────────────────────────

export class WorkflowService {
  private rules: WorkflowRule[] = [];
  private activity: WorkflowActivityEntry[] = [];

  constructor(private db: Database) {
    this.rules = this.loadRules();
    this.activity = this.loadActivity();
  }

  // ── Rule CRUD ─────────────────────────────────────────────────

  getRules(): WorkflowRule[] {
    return [...this.rules];
  }

  getRule(id: string): WorkflowRule | undefined {
    return this.rules.find(r => r.id === id);
  }

  createRule(input: CreateRuleInput): WorkflowRule {
    if (this.rules.length >= MAX_RULES) {
      throw new Error(`Maximum number of workflow rules (${MAX_RULES}) reached`);
    }

    const now = new Date().toISOString();
    const rule: WorkflowRule = {
      ...input,
      id: generateRuleId(),
      metadata: {
        source: 'manual',
        firedCount: 0,
        lastFiredAt: null,
        createdAt: now,
        lastEditedAt: now,
      },
    };

    this.rules.push(rule);
    this.saveRules();
    logger.info('workflow', `Created rule "${rule.name}"`, { ruleId: rule.id });
    return rule;
  }

  updateRule(id: string, updates: Partial<Omit<WorkflowRule, 'id' | 'metadata'>>): WorkflowRule | undefined {
    const idx = this.rules.findIndex(r => r.id === id);
    if (idx === -1) return undefined;

    this.rules[idx] = {
      ...this.rules[idx],
      ...updates,
      id, // preserve id
      metadata: {
        ...this.rules[idx].metadata,
        lastEditedAt: new Date().toISOString(),
      },
    };

    this.saveRules();
    logger.info('workflow', `Updated rule "${this.rules[idx].name}"`, { ruleId: id });
    return this.rules[idx];
  }

  deleteRule(id: string): boolean {
    const idx = this.rules.findIndex(r => r.id === id);
    if (idx === -1) return false;

    const removed = this.rules.splice(idx, 1)[0];
    this.saveRules();
    logger.info('workflow', `Deleted rule "${removed.name}"`, { ruleId: id });
    return true;
  }

  toggleRule(id: string): WorkflowRule | undefined {
    const idx = this.rules.findIndex(r => r.id === id);
    if (idx === -1) return undefined;

    this.rules[idx].enabled = !this.rules[idx].enabled;
    this.rules[idx].metadata.lastEditedAt = new Date().toISOString();
    this.saveRules();

    const state = this.rules[idx].enabled ? 'enabled' : 'disabled';
    logger.info('workflow', `Toggled rule "${this.rules[idx].name}" → ${state}`, { ruleId: id });
    return this.rules[idx];
  }

  reorderRules(ruleIds: string[]): void {
    for (let i = 0; i < ruleIds.length; i++) {
      const rule = this.rules.find(r => r.id === ruleIds[i]);
      if (rule) {
        rule.priority = i;
      }
    }
    this.rules.sort((a, b) => a.priority - b.priority);
    this.saveRules();
    logger.info('workflow', `Reordered ${ruleIds.length} rules`);
  }

  // ── Templates ─────────────────────────────────────────────────

  getTemplates(): WorkflowTemplate[] {
    return TEMPLATES;
  }

  getTemplatesByCategory(category: WorkflowTemplateCategory): WorkflowTemplate[] {
    return TEMPLATES.filter(t => t.category === category);
  }

  createFromTemplate(
    templateId: string,
    overrides?: Partial<Omit<WorkflowRule, 'id' | 'metadata'>>,
  ): WorkflowRule | undefined {
    const template = TEMPLATES.find(t => t.id === templateId);
    if (!template) return undefined;

    const now = new Date().toISOString();
    const rule: WorkflowRule = {
      ...template.rule,
      ...overrides,
      id: generateRuleId(),
      metadata: {
        source: 'template',
        firedCount: 0,
        lastFiredAt: null,
        createdAt: now,
        lastEditedAt: now,
      },
    };

    if (this.rules.length >= MAX_RULES) {
      throw new Error(`Maximum number of workflow rules (${MAX_RULES}) reached`);
    }

    this.rules.push(rule);
    this.saveRules();
    logger.info('workflow', `Created rule from template "${template.name}"`, { ruleId: rule.id, templateId });
    return rule;
  }

  // ── Execution ─────────────────────────────────────────────────

  evaluateEvent(event: WorkflowEvent, context: EventContext): EvaluationResult[] {
    const results: EvaluationResult[] = [];
    const sorted = [...this.rules].sort((a, b) => a.priority - b.priority);

    for (const rule of sorted) {
      if (!rule.enabled) continue;

      if (!this.matchesTrigger(rule, event, context)) continue;

      const { matches, matched } = this.evaluateConditions(rule.conditions, context);
      if (!matches) continue;

      const fireCheck = this.canFire(rule);
      if (!fireCheck.allowed) {
        logger.debug('workflow', `Rule "${rule.name}" blocked: ${fireCheck.reason}`, { ruleId: rule.id });
        continue;
      }

      // Update metadata — rule has fired
      rule.metadata.firedCount++;
      rule.metadata.lastFiredAt = new Date().toISOString();

      results.push({
        rule,
        matchedConditions: matched,
        actions: rule.actions,
        notifications: rule.notifications,
      });
    }

    if (results.length > 0) {
      this.saveRules();
      logger.info('workflow', `Event "${event}" fired ${results.length} rule(s)`, {
        rules: results.map(r => r.rule.name),
      });
    }

    return results;
  }

  dryRun(context: EventContext): WorkflowDryRunResult[] {
    const results: WorkflowDryRunResult[] = [];
    const sorted = [...this.rules].sort((a, b) => a.priority - b.priority);

    for (const rule of sorted) {
      if (!rule.enabled) {
        results.push({
          ruleId: rule.id,
          ruleName: rule.name,
          wouldFire: false,
          reason: 'Rule is disabled',
          matchedConditions: [],
          actionsPreview: rule.actions.map(a => a.type),
        });
        continue;
      }

      // For dry run, we check all possible events the rule listens for
      const triggerEvent = rule.trigger.event;
      const triggerMatches = this.matchesTrigger(rule, triggerEvent, context);
      if (!triggerMatches) {
        results.push({
          ruleId: rule.id,
          ruleName: rule.name,
          wouldFire: false,
          reason: 'Trigger scope does not match current context',
          matchedConditions: [],
          actionsPreview: rule.actions.map(a => a.type),
        });
        continue;
      }

      const { matches, matched } = this.evaluateConditions(rule.conditions, context);
      if (!matches) {
        results.push({
          ruleId: rule.id,
          ruleName: rule.name,
          wouldFire: false,
          reason: 'Conditions not met',
          matchedConditions: matched,
          actionsPreview: rule.actions.map(a => a.type),
        });
        continue;
      }

      const fireCheck = this.canFire(rule);
      if (!fireCheck.allowed) {
        results.push({
          ruleId: rule.id,
          ruleName: rule.name,
          wouldFire: false,
          reason: fireCheck.reason ?? 'Cooldown or max fires reached',
          matchedConditions: matched,
          actionsPreview: rule.actions.map(a => a.type),
        });
        continue;
      }

      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        wouldFire: true,
        reason: 'All conditions met and rule is eligible to fire',
        matchedConditions: matched,
        actionsPreview: rule.actions.map(a => a.type),
      });
    }

    return results;
  }

  // ── Activity Log ──────────────────────────────────────────────

  getActivity(limit?: number): WorkflowActivityEntry[] {
    if (limit !== undefined) {
      return this.activity.slice(-limit);
    }
    return [...this.activity];
  }

  recordActivity(entry: Omit<WorkflowActivityEntry, 'id' | 'timestamp'>): void {
    const record: WorkflowActivityEntry = {
      ...entry,
      id: generateActivityId(),
      timestamp: new Date().toISOString(),
    };

    this.activity.push(record);

    // FIFO pruning
    if (this.activity.length > MAX_ACTIVITY) {
      this.activity = this.activity.slice(-MAX_ACTIVITY);
    }

    this.saveActivity();
  }

  // ── Private ───────────────────────────────────────────────────

  private matchesTrigger(rule: WorkflowRule, event: WorkflowEvent, context: EventContext): boolean {
    if (rule.trigger.event !== event) return false;

    const scope = rule.trigger.scope;
    if (!scope) return true;

    const eventCtx = context.event;
    if (!eventCtx) {
      // Scope is defined but no event context to match against — no match
      return !scope.agentId && !scope.taskId && !scope.role;
    }

    if (scope.agentId && eventCtx.agentId !== scope.agentId) return false;
    if (scope.taskId && eventCtx.taskId !== scope.taskId) return false;

    if (scope.role) {
      // Check if the agent from the event context has the specified role
      const agent = context.agents.find(a => a.id === eventCtx.agentId);
      if (!agent || agent.role !== scope.role) return false;
    }

    return true;
  }

  private evaluateConditions(
    conditions: WorkflowCondition[],
    context: EventContext,
  ): { matches: boolean; matched: string[] } {
    if (conditions.length === 0) {
      return { matches: true, matched: [] };
    }

    const matched: string[] = [];

    for (const condition of conditions) {
      const fieldValue = this.resolveField(condition.field, context);
      if (fieldValue === undefined) {
        // Field not found → condition fails
        return { matches: false, matched };
      }

      const passes = this.applyOperator(fieldValue, condition.operator, condition.value, condition.value2);
      if (!passes) {
        return { matches: false, matched };
      }

      matched.push(`${condition.field} ${condition.operator} ${condition.value}${condition.value2 !== undefined ? ` and ${condition.value2}` : ''}`);
    }

    return { matches: true, matched };
  }

  private resolveField(field: string, context: EventContext): number | string | undefined {
    switch (field) {
      case 'contextUsage': {
        // Use the agent from event context, or first agent
        const agentId = context.event?.agentId;
        const agent = agentId
          ? context.agents.find(a => a.id === agentId)
          : context.agents[0];
        return agent?.contextUsage;
      }
      case 'budgetUtilization':
        return context.budget?.utilization;
      case 'burnRate':
        return context.budget?.burnRate;
      case 'sessionDurationMinutes':
        return context.session?.durationMinutes;
      case 'agentStatus': {
        const aid = context.event?.agentId;
        const a = aid ? context.agents.find(ag => ag.id === aid) : context.agents[0];
        return a?.status;
      }
      case 'agentRole': {
        const rid = context.event?.agentId;
        const ra = rid ? context.agents.find(ag => ag.id === rid) : context.agents[0];
        return ra?.role;
      }
      case 'taskStatus': {
        const tid = context.event?.taskId;
        if (!tid || !context.tasks) return undefined;
        const task = context.tasks.find(t => t.id === tid);
        return task?.status;
      }
      default: {
        // Try resolving from event context as a fallback
        const eventVal = context.event?.[field];
        if (eventVal !== undefined && (typeof eventVal === 'number' || typeof eventVal === 'string')) {
          return eventVal;
        }
        return undefined;
      }
    }
  }

  private applyOperator(
    fieldValue: number | string,
    operator: WorkflowCondition['operator'],
    value: number | string,
    value2?: number,
  ): boolean {
    switch (operator) {
      case 'gt':
        return Number(fieldValue) > Number(value);
      case 'lt':
        return Number(fieldValue) < Number(value);
      case 'eq':
        // eslint-disable-next-line eqeqeq
        return fieldValue == value;
      case 'between': {
        const num = Number(fieldValue);
        return num >= Number(value) && num <= Number(value2 ?? value);
      }
      case 'contains':
        return String(fieldValue).includes(String(value));
      default:
        return false;
    }
  }

  private canFire(rule: WorkflowRule): { allowed: boolean; reason?: string } {
    // Check max fires per session
    if (rule.maxFiresPerSession !== null && rule.metadata.firedCount >= rule.maxFiresPerSession) {
      return {
        allowed: false,
        reason: `Max fires per session reached (${rule.metadata.firedCount}/${rule.maxFiresPerSession})`,
      };
    }

    // Check cooldown
    if (rule.cooldownMs > 0 && rule.metadata.lastFiredAt) {
      const lastFired = new Date(rule.metadata.lastFiredAt).getTime();
      const elapsed = Date.now() - lastFired;
      if (elapsed < rule.cooldownMs) {
        const remainingSec = Math.ceil((rule.cooldownMs - elapsed) / 1000);
        return {
          allowed: false,
          reason: `Cooldown active (${remainingSec}s remaining)`,
        };
      }
    }

    return { allowed: true };
  }

  private loadRules(): WorkflowRule[] {
    const raw = this.db.getSetting(RULES_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      logger.warn('workflow', 'Failed to parse stored workflow rules, starting fresh');
      return [];
    }
  }

  private saveRules(): void {
    this.db.setSetting(RULES_KEY, JSON.stringify(this.rules));
  }

  private loadActivity(): WorkflowActivityEntry[] {
    const raw = this.db.getSetting(ACTIVITY_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      logger.warn('workflow', 'Failed to parse stored workflow activity, starting fresh');
      return [];
    }
  }

  private saveActivity(): void {
    this.db.setSetting(ACTIVITY_KEY, JSON.stringify(this.activity));
  }
}
