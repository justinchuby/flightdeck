import { EventEmitter } from 'events';
import { eq, asc, and, inArray, lte } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { decisions } from '../db/schema.js';

export type DecisionStatus = 'recorded' | 'confirmed' | 'rejected';

export const DECISION_CATEGORIES = ['style', 'architecture', 'tool_access', 'dependency', 'testing', 'general'] as const;
export type DecisionCategory = (typeof DECISION_CATEGORIES)[number];

export interface Decision {
  id: string;
  agentId: string;
  agentRole: string;
  leadId: string | null;
  projectId: string | null;
  title: string;
  rationale: string;
  needsConfirmation: boolean;
  status: DecisionStatus;
  autoApproved: boolean;
  confirmedAt: string | null;
  timestamp: string;
  category: DecisionCategory;
}

export type IntentAction = 'auto-approve' | 'queue' | 'alert';

export interface IntentRule {
  id: string;
  category: DecisionCategory;
  action: IntentAction;
  source: 'manual' | 'teach_me' | 'preset';
  approvalCount: number;
  createdAt: string;
  lastMatchedAt: string | null;
  // V2 fields
  description?: string;        // NL description e.g. "Auto-approve style decisions from developers"
  roleScopes?: string[];       // Only match if agent role is in this list (empty = all roles)
  conditions?: IntentCondition[];  // Additional conditions for matching
  priority?: number;           // Higher = checked first (default 0)
  effectiveness?: IntentEffectiveness; // Tracking match quality
  enabled: boolean;            // Toggle rule on/off without deleting
}

export interface IntentCondition {
  field: 'title' | 'rationale' | 'agentRole';
  operator: 'contains' | 'not_contains' | 'equals' | 'matches';
  value: string;
}

export interface IntentEffectiveness {
  totalMatches: number;
  autoApproved: number;
  overriddenByUser: number; // User rejected after auto-approve triggered
  lastEvaluatedAt: string | null;
  score: number | null;     // 0-100, null if < MIN_MATCHES_FOR_SCORE
}

export const MIN_MATCHES_FOR_SCORE = 5;

export type TrustPreset = 'conservative' | 'moderate' | 'autonomous';

export const TRUST_PRESETS: Record<TrustPreset, { name: string; description: string; rules: Array<{ category: DecisionCategory; action: IntentAction; roleScopes?: string[] }> }> = {
  conservative: {
    name: 'Conservative',
    description: 'Queue everything for manual approval. Only auto-approve style decisions.',
    rules: [
      { category: 'style', action: 'auto-approve' },
      { category: 'testing', action: 'queue' },
      { category: 'dependency', action: 'queue' },
      { category: 'tool_access', action: 'queue' },
      { category: 'architecture', action: 'queue' },
      { category: 'general', action: 'queue' },
    ],
  },
  moderate: {
    name: 'Moderate',
    description: 'Auto-approve style and testing. Alert on dependencies. Queue architecture.',
    rules: [
      { category: 'style', action: 'auto-approve' },
      { category: 'testing', action: 'auto-approve' },
      { category: 'dependency', action: 'alert' },
      { category: 'tool_access', action: 'auto-approve' },
      { category: 'architecture', action: 'queue' },
      { category: 'general', action: 'auto-approve' },
    ],
  },
  autonomous: {
    name: 'Autonomous',
    description: 'Auto-approve most categories. Alert on architecture and tool access.',
    rules: [
      { category: 'style', action: 'auto-approve' },
      { category: 'testing', action: 'auto-approve' },
      { category: 'dependency', action: 'auto-approve' },
      { category: 'tool_access', action: 'alert' },
      { category: 'architecture', action: 'alert' },
      { category: 'general', action: 'auto-approve' },
    ],
  },
};

export interface BatchResult {
  updated: number;
  results: Decision[];
  suggestedRule?: { category: DecisionCategory; count: number; prompt: string };
}

/** Classify a decision by keywords in the title */
export function classifyDecision(title: string): DecisionCategory {
  const lower = title.toLowerCase();
  if (/\bformat\b|\blint\b|\bstyle\b|\bprettier\b|\beslint\b/.test(lower)) return 'style';
  if (/\brefactor\b|\barchitect\b|\bdesign\b|\bpattern\b|\bstructure\b/.test(lower)) return 'architecture';
  if (/\bpermission\b|\btool\b|\baccess\b|\bexecute\b|\bcommand\b/.test(lower)) return 'tool_access';
  if (/\bdependency\b|\bpackage\b|\binstall\b|\bupgrade\b|\bversion\b/.test(lower)) return 'dependency';
  if (/\btest\b|\bcoverage\b|\bassertion\b|\bspec\b/.test(lower)) return 'testing';
  return 'general';
}

function rowToDecision(row: typeof decisions.$inferSelect): Decision {
  return {
    id: row.id,
    agentId: row.agentId,
    agentRole: row.agentRole,
    leadId: row.leadId,
    projectId: row.projectId,
    title: row.title,
    rationale: row.rationale ?? '',
    needsConfirmation: row.needsConfirmation === 1,
    status: row.status as DecisionStatus,
    autoApproved: row.autoApproved === 1,
    confirmedAt: row.confirmedAt,
    timestamp: row.createdAt!,
    category: (row as any).category ?? classifyDecision(row.title),
  };
}

export class DecisionLog extends EventEmitter {
  private db: Database;
  /** Decision IDs that require human approval (system settings changes) — no auto-approve */
  private systemDecisionIds = new Set<string>();
  private autoApproveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private static AUTO_APPROVE_MS = 60_000;
  private intentRules: IntentRule[] = [];
  /** When true, auto-approve timers are paused (user has approval queue open) */
  private timersPaused = false;
  /** Decision IDs whose timers were paused — will be resumed with remaining time */
  private pausedTimers = new Map<string, { remaining: number; pausedAt: number }>();
  /** Tracks when each timer was started (for calculating remaining time on pause) */
  private timerStartTimes = new Map<string, number>();

  constructor(db: Database) {
    super();
    this.db = db;
    this.loadIntentRules();
  }

  private loadIntentRules(): void {
    try {
      const raw = this.db.getSetting('intent_rules');
      if (raw) {
        this.intentRules = JSON.parse(raw).map((r: any) => ({
          ...r,
          enabled: r.enabled ?? true,   // backward compat for rules saved before V2.1
          action: r.action ?? 'auto-approve',
        }));
      }
    } catch {
      this.intentRules = [];
    }
  }

  private saveIntentRules(): void {
    this.db.setSetting('intent_rules', JSON.stringify(this.intentRules));
  }

  // ── Intent Rules CRUD ─────────────────────────────────────────────

  getIntentRules(): IntentRule[] {
    return [...this.intentRules];
  }

  addIntentRule(category: DecisionCategory, source: 'manual' | 'teach_me' | 'preset', options?: {
    description?: string;
    roleScopes?: string[];
    conditions?: IntentCondition[];
    priority?: number;
    action?: IntentAction;
    enabled?: boolean;
  }): IntentRule {
    const rule: IntentRule = {
      id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      category,
      action: options?.action ?? 'auto-approve',
      source,
      approvalCount: 0,
      createdAt: new Date().toISOString(),
      lastMatchedAt: null,
      description: options?.description,
      roleScopes: options?.roleScopes,
      conditions: options?.conditions,
      priority: options?.priority ?? 0,
      effectiveness: { totalMatches: 0, autoApproved: 0, overriddenByUser: 0, lastEvaluatedAt: null, score: null },
      enabled: options?.enabled ?? true,
    };
    this.intentRules.push(rule);
    // Sort by priority descending so higher-priority rules match first
    this.intentRules.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    this.saveIntentRules();
    return rule;
  }

  deleteIntentRule(ruleId: string): boolean {
    const index = this.intentRules.findIndex(r => r.id === ruleId);
    if (index === -1) return false;
    this.intentRules.splice(index, 1);
    this.saveIntentRules();
    return true;
  }

  /** Reorder rules — ids array defines the new order (index = priority, lower index = higher priority) */
  reorderIntentRules(ids: string[]): number {
    let updated = 0;
    for (let i = 0; i < ids.length; i++) {
      const rule = this.intentRules.find(r => r.id === ids[i]);
      if (rule) {
        // Higher index in ids = lower priority number (checked later)
        rule.priority = ids.length - i;
        updated++;
      }
    }
    this.intentRules.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    this.saveIntentRules();
    return updated;
  }

  /** Check if a decision matches an intent rule. Returns the matching rule or undefined. */
  matchIntentRule(category: DecisionCategory, context?: { agentRole?: string; title?: string; rationale?: string }): IntentRule | undefined {
    // Rules are already sorted by priority (descending)
    return this.intentRules.find(r => {
      if (!r.enabled) return false;
      if (r.category !== category) return false;
      // Check role scopes
      if (r.roleScopes && r.roleScopes.length > 0 && context?.agentRole) {
        if (!r.roleScopes.some(scope => context.agentRole!.toLowerCase().includes(scope.toLowerCase()))) {
          return false;
        }
      }
      // Check conditions
      if (r.conditions && r.conditions.length > 0 && context) {
        for (const cond of r.conditions) {
          const fieldValue = context[cond.field]?.toLowerCase() ?? '';
          const condValue = cond.value.toLowerCase();
          switch (cond.operator) {
            case 'contains': if (!fieldValue.includes(condValue)) return false; break;
            case 'not_contains': if (fieldValue.includes(condValue)) return false; break;
            case 'equals': if (fieldValue !== condValue) return false; break;
            case 'matches': if (!new RegExp(cond.value, 'i').test(fieldValue)) return false; break;
          }
        }
      }
      return true;
    });
  }

  /** Record a match for effectiveness tracking */
  recordMatch(ruleId: string, wasAutoApproved: boolean): void {
    const rule = this.intentRules.find(r => r.id === ruleId);
    if (!rule) return;
    rule.lastMatchedAt = new Date().toISOString();
    rule.approvalCount++;
    if (!rule.effectiveness) {
      rule.effectiveness = { totalMatches: 0, autoApproved: 0, overriddenByUser: 0, lastEvaluatedAt: null, score: null };
    }
    rule.effectiveness.totalMatches++;
    if (wasAutoApproved) rule.effectiveness.autoApproved++;
    rule.effectiveness.lastEvaluatedAt = new Date().toISOString();
    // Compute score only after MIN_MATCHES_FOR_SCORE
    if (rule.effectiveness.totalMatches >= MIN_MATCHES_FOR_SCORE) {
      rule.effectiveness.score = Math.round(
        (rule.effectiveness.autoApproved / rule.effectiveness.totalMatches) * 100,
      );
    }
    this.saveIntentRules();
  }

  /** Record that a user overrode an auto-approved decision */
  recordOverride(ruleId: string): void {
    const rule = this.intentRules.find(r => r.id === ruleId);
    if (!rule?.effectiveness) return;
    rule.effectiveness.overriddenByUser++;
    if (rule.effectiveness.totalMatches >= MIN_MATCHES_FOR_SCORE) {
      const effectiveApprovals = rule.effectiveness.autoApproved - rule.effectiveness.overriddenByUser;
      rule.effectiveness.score = Math.round(
        Math.max(0, effectiveApprovals / rule.effectiveness.totalMatches) * 100,
      );
    }
    this.saveIntentRules();
  }

  /** Apply a trust preset — replaces all rules with the preset's rules */
  applyTrustPreset(preset: TrustPreset): IntentRule[] {
    const config = TRUST_PRESETS[preset];
    if (!config) throw new Error(`Unknown trust preset: ${preset}`);

    // Remove existing preset rules but keep manual/teach_me rules
    this.intentRules = this.intentRules.filter(r => r.source !== 'preset');

    // Add preset rules
    const newRules: IntentRule[] = [];
    for (const ruleDef of config.rules) {
      const rule = this.addIntentRule(ruleDef.category, 'preset', {
        description: `${config.name} preset: ${ruleDef.action} ${ruleDef.category}`,
        action: ruleDef.action,
        roleScopes: ruleDef.roleScopes,
        priority: -1, // Preset rules are lower priority than manual rules
      });
      newRules.push(rule);
    }
    return newRules;
  }

  add(agentId: string, agentRole: string, title: string, rationale: string, needsConfirmation = false, leadId?: string, projectId?: string): Decision {
    const id = `dec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = new Date().toISOString();
    const category = classifyDecision(title);

    this.db.drizzle.insert(decisions).values({
      id,
      agentId,
      agentRole,
      leadId: leadId || null,
      projectId: projectId || null,
      title,
      rationale,
      needsConfirmation: needsConfirmation ? 1 : 0,
      status: 'recorded',
      createdAt: timestamp,
    }).run();

    const decision: Decision = { id, agentId, agentRole, leadId: leadId || null, projectId: projectId || null, title, rationale, needsConfirmation, status: 'recorded', autoApproved: false, confirmedAt: null, timestamp, category };
    this.emit('decision', decision);

    // Check intent rules (only for non-system decisions needing confirmation)
    if (needsConfirmation && !this.systemDecisionIds.has(id)) {
      const matchedRule = this.matchIntentRule(category, { agentRole, title, rationale });
      if (matchedRule) {
        this.recordMatch(matchedRule.id, matchedRule.action === 'auto-approve');
        if (matchedRule.action === 'auto-approve') {
          return this.autoApprove(id) ?? decision;
        }
        if (matchedRule.action === 'alert') {
          // Emit alert but don't auto-approve — decision stays pending
          this.emit('intent:alert', { decision, rule: matchedRule });
        }
        // 'queue' action: do nothing extra — decision stays pending (no auto-approve timer)
        if (matchedRule.action === 'queue') {
          return decision;
        }
      }
    }

    // Schedule auto-approve after 60s unless it's a system-level decision
    if (!this.systemDecisionIds.has(id)) {
      this.scheduleAutoApprove(id);
    }
    return decision;
  }

  /** Mark a decision as system-level (requires human approval, no auto-approve) */
  markSystemDecision(id: string): void {
    this.systemDecisionIds.add(id);
    // Cancel any pending auto-approve timer
    const timer = this.autoApproveTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.autoApproveTimers.delete(id);
    }
  }

  private scheduleAutoApprove(id: string, delayMs?: number): void {
    const delay = delayMs ?? DecisionLog.AUTO_APPROVE_MS;

    // If timers are paused, store the decision for later resumption
    if (this.timersPaused) {
      this.pausedTimers.set(id, { remaining: delay, pausedAt: Date.now() });
      return;
    }

    const timer = setTimeout(() => {
      this.autoApproveTimers.delete(id);
      this.timerStartTimes.delete(id);
      const existing = this.getById(id);
      if (existing && existing.status === 'recorded') {
        this.autoApprove(id);
      }
    }, delay);
    this.autoApproveTimers.set(id, timer);
    this.timerStartTimes.set(id, Date.now());
  }

  private autoApprove(id: string): Decision | undefined {
    const confirmedAt = new Date().toISOString();
    this.db.drizzle
      .update(decisions)
      .set({ status: 'confirmed', autoApproved: 1, confirmedAt })
      .where(eq(decisions.id, id))
      .run();
    const decision = this.getById(id);
    if (decision) this.emit('decision:confirmed', decision);
    return decision;
  }

  getAll(): Decision[] {
    return this.db.drizzle
      .select()
      .from(decisions)
      .orderBy(asc(decisions.createdAt))
      .all()
      .map(rowToDecision);
  }

  getByAgent(agentId: string): Decision[] {
    return this.db.drizzle
      .select()
      .from(decisions)
      .where(eq(decisions.agentId, agentId))
      .orderBy(asc(decisions.createdAt))
      .all()
      .map(rowToDecision);
  }

  getByAgents(agentIds: string[]): Decision[] {
    if (agentIds.length === 0) return [];
    return this.db.drizzle
      .select()
      .from(decisions)
      .where(inArray(decisions.agentId, agentIds))
      .orderBy(asc(decisions.createdAt))
      .all()
      .map(rowToDecision);
  }

  getByLeadId(leadId: string): Decision[] {
    return this.db.drizzle
      .select()
      .from(decisions)
      .where(eq(decisions.leadId, leadId))
      .orderBy(asc(decisions.createdAt))
      .all()
      .map(rowToDecision);
  }

  getNeedingConfirmation(): Decision[] {
    return this.db.drizzle
      .select()
      .from(decisions)
      .where(and(eq(decisions.needsConfirmation, 1), eq(decisions.status, 'recorded')))
      .orderBy(asc(decisions.createdAt))
      .all()
      .map(rowToDecision);
  }

  getById(id: string): Decision | undefined {
    const row = this.db.drizzle
      .select()
      .from(decisions)
      .where(eq(decisions.id, id))
      .get();
    return row ? rowToDecision(row) : undefined;
  }

  confirm(id: string): Decision | undefined {
    this.cancelAutoApproveTimer(id);
    const existing = this.getById(id);
    if (!existing || existing.status !== 'recorded') return existing;
    const confirmedAt = new Date().toISOString();
    this.db.drizzle
      .update(decisions)
      .set({ status: 'confirmed', confirmedAt })
      .where(eq(decisions.id, id))
      .run();
    const decision = this.getById(id);
    if (decision) this.emit('decision:confirmed', decision);
    return decision;
  }

  reject(id: string): Decision | undefined {
    this.cancelAutoApproveTimer(id);
    const existing = this.getById(id);
    if (!existing || existing.status !== 'recorded') return existing;
    const confirmedAt = new Date().toISOString();
    this.db.drizzle
      .update(decisions)
      .set({ status: 'rejected', confirmedAt })
      .where(eq(decisions.id, id))
      .run();
    const decision = this.getById(id);
    if (decision) this.emit('decision:rejected', decision);
    return decision;
  }

  private cancelAutoApproveTimer(id: string): void {
    const timer = this.autoApproveTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.autoApproveTimers.delete(id);
    }
    this.systemDecisionIds.delete(id);
  }

  // ── Batch operations ─────────────────────────────────────────────

  confirmBatch(ids: string[]): BatchResult {
    const results: Decision[] = [];
    for (const id of ids) {
      const confirmed = this.confirm(id);
      if (confirmed) results.push(confirmed);
    }

    // Generate 'Teach Me' suggestion if 3+ decisions share a category
    const categoryCounts = new Map<DecisionCategory, number>();
    for (const d of results) {
      const count = (categoryCounts.get(d.category) ?? 0) + 1;
      categoryCounts.set(d.category, count);
    }

    let suggestedRule: BatchResult['suggestedRule'];
    for (const [category, count] of categoryCounts) {
      if (count >= 3 && !this.matchIntentRule(category)) {
        suggestedRule = {
          category,
          count,
          prompt: `You approved ${count} ${category} decisions. Auto-approve these in the future?`,
        };
        break;
      }
    }

    this.emit('decisions:batch_confirmed', results);
    return { updated: results.length, results, suggestedRule };
  }

  rejectBatch(ids: string[]): BatchResult {
    const results: Decision[] = [];
    for (const id of ids) {
      const rejected = this.reject(id);
      if (rejected) results.push(rejected);
    }
    this.emit('decisions:batch_rejected', results);
    return { updated: results.length, results };
  }

  /** Get pending decisions grouped by category */
  getPendingGrouped(): Record<DecisionCategory, Decision[]> {
    const pending = this.getNeedingConfirmation();
    const grouped: Record<string, Decision[]> = {};
    for (const d of pending) {
      if (!grouped[d.category]) grouped[d.category] = [];
      grouped[d.category].push(d);
    }
    return grouped as Record<DecisionCategory, Decision[]>;
  }

  /** Pause all auto-approve timers (user opened the approval queue) */
  pauseTimers(): void {
    if (this.timersPaused) return; // idempotent
    this.timersPaused = true;
    const now = Date.now();

    for (const [id, timer] of this.autoApproveTimers) {
      clearTimeout(timer);
      const startTime = this.timerStartTimes.get(id) ?? now;
      const elapsed = now - startTime;
      const remaining = Math.max(0, DecisionLog.AUTO_APPROVE_MS - elapsed);
      this.pausedTimers.set(id, { remaining, pausedAt: now });
    }
    this.autoApproveTimers.clear();
    this.timerStartTimes.clear();
    this.emit('timers:paused');
  }

  /** Resume all paused auto-approve timers (user closed the approval queue) */
  resumeTimers(): void {
    if (!this.timersPaused) return; // idempotent
    this.timersPaused = false;

    for (const [id, { remaining }] of this.pausedTimers) {
      const existing = this.getById(id);
      if (existing && existing.status === 'recorded') {
        this.scheduleAutoApprove(id, remaining);
      }
    }
    this.pausedTimers.clear();
    this.emit('timers:resumed');
  }

  /** Whether auto-approve timers are currently paused */
  get isTimersPaused(): boolean {
    return this.timersPaused;
  }

  clear(): void {
    // Cancel all pending timers
    for (const timer of this.autoApproveTimers.values()) clearTimeout(timer);
    this.autoApproveTimers.clear();
    this.timerStartTimes.clear();
    this.pausedTimers.clear();
    this.timersPaused = false;
    this.systemDecisionIds.clear();
    this.db.drizzle.delete(decisions).run();
  }

  /** Get decisions as they existed at a given timestamp (for replay) */
  getDecisionsAt(leadId: string, timestamp: string): Decision[] {
    const rows = this.db.drizzle
      .select()
      .from(decisions)
      .where(and(
        lte(decisions.createdAt, timestamp),
        decisions.leadId ? eq(decisions.leadId, leadId) : undefined,
      ))
      .orderBy(asc(decisions.createdAt))
      .all();

    return rows.map(row => {
      const d = rowToDecision(row);
      // Reconstruct status at timestamp T: if confirmedAt > T, revert to 'recorded'
      if (d.confirmedAt && d.confirmedAt > timestamp) {
        return { ...d, status: 'recorded' as const, confirmedAt: null, autoApproved: false };
      }
      return d;
    });
  }
}
