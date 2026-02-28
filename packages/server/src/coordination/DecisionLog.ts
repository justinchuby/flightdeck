import { EventEmitter } from 'events';
import { eq, asc, and, inArray } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { decisions } from '../db/schema.js';

export type DecisionStatus = 'recorded' | 'confirmed' | 'rejected';

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
  };
}

export class DecisionLog extends EventEmitter {
  private db: Database;
  /** Decision IDs that require human approval (system settings changes) — no auto-approve */
  private systemDecisionIds = new Set<string>();
  private autoApproveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private static AUTO_APPROVE_MS = 60_000;

  constructor(db: Database) {
    super();
    this.db = db;
  }

  add(agentId: string, agentRole: string, title: string, rationale: string, needsConfirmation = false, leadId?: string, projectId?: string): Decision {
    const id = `dec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = new Date().toISOString();

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

    const decision: Decision = { id, agentId, agentRole, leadId: leadId || null, projectId: projectId || null, title, rationale, needsConfirmation, status: 'recorded', autoApproved: false, confirmedAt: null, timestamp };
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

  private scheduleAutoApprove(id: string): void {
    const timer = setTimeout(() => {
      this.autoApproveTimers.delete(id);
      const existing = this.getById(id);
      if (existing && existing.status === 'recorded') {
        this.autoApprove(id);
      }
    }, DecisionLog.AUTO_APPROVE_MS);
    this.autoApproveTimers.set(id, timer);
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

  clear(): void {
    // Cancel all pending timers
    for (const timer of this.autoApproveTimers.values()) clearTimeout(timer);
    this.autoApproveTimers.clear();
    this.systemDecisionIds.clear();
    this.db.drizzle.delete(decisions).run();
  }
}
