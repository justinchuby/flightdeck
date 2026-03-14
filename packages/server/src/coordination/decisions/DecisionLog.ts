import { EventEmitter } from 'events';
import { eq, asc, desc, and, inArray, lte, sql } from 'drizzle-orm';
import type { Database } from '../../db/database.js';
import { decisions } from '../../db/schema.js';

import { type Decision, type DecisionStatus, type DecisionCategory } from '@flightdeck/shared';
export { DECISION_CATEGORIES, type Decision, type DecisionStatus, type DecisionCategory } from '@flightdeck/shared';

export interface BatchResult {
  updated: number;
  results: Decision[];
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
  /** When true, auto-approve timers are paused (user has approval queue open) */
  private timersPaused = false;
  /** Decision IDs whose timers were paused — will be resumed with remaining time */
  private pausedTimers = new Map<string, { remaining: number; pausedAt: number }>();
  /** Tracks when each timer was started (for calculating remaining time on pause) */
  private timerStartTimes = new Map<string, number>();

  constructor(db: Database) {
    super();
    this.db = db;
  }

  // ── Decision CRUD ─────────────────────────────────────────────

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

  // UI-facing methods use DESC (newest-first) for the decisions panel display.
  // Agent-facing methods (getByAgent, getByAgents) use ASC for chronological context.

  getAll(): Decision[] {
    return this.db.drizzle
      .select()
      .from(decisions)
      .orderBy(desc(decisions.createdAt), sql`rowid DESC`)
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
      .orderBy(desc(decisions.createdAt), sql`rowid DESC`)
      .all()
      .map(rowToDecision);
  }

  getNeedingConfirmation(): Decision[] {
    return this.db.drizzle
      .select()
      .from(decisions)
      .where(and(eq(decisions.needsConfirmation, 1), eq(decisions.status, 'recorded')))
      .orderBy(desc(decisions.createdAt), sql`rowid DESC`)
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

  dismiss(id: string): Decision | undefined {
    this.cancelAutoApproveTimer(id);
    const existing = this.getById(id);
    if (!existing || existing.status !== 'recorded') return existing;
    const confirmedAt = new Date().toISOString();
    this.db.drizzle
      .update(decisions)
      .set({ status: 'dismissed', confirmedAt })
      .where(eq(decisions.id, id))
      .run();
    const decision = this.getById(id);
    if (decision) this.emit('decision:dismissed', decision);
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

    this.emit('decisions:batch_confirmed', results);
    return { updated: results.length, results };
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

  dismissBatch(ids: string[]): BatchResult {
    const results: Decision[] = [];
    for (const id of ids) {
      const dismissed = this.dismiss(id);
      if (dismissed) results.push(dismissed);
    }
    this.emit('decisions:batch_dismissed', results);
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
