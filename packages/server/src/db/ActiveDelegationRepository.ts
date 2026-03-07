import { eq, and, isNull } from 'drizzle-orm';
import type { Database } from './database.js';
import { activeDelegations } from './schema.js';

export type DelegationStatus = 'active' | 'completed' | 'failed' | 'cancelled';

export interface DelegationRecord {
  delegationId: string;
  agentId: string;
  task: string;
  context?: string;
  dagTaskId?: string;
  status: DelegationStatus;
  createdAt: string;
  completedAt?: string;
  result?: Record<string, unknown>;
}

export class ActiveDelegationRepository {
  constructor(private db: Database) {}

  create(
    delegationId: string,
    agentId: string,
    task: string,
    context?: string,
    dagTaskId?: string,
  ): DelegationRecord {
    const now = new Date().toISOString();
    this.db.drizzle
      .insert(activeDelegations)
      .values({
        delegationId,
        agentId,
        task,
        context: context ?? null,
        dagTaskId: dagTaskId ?? null,
        status: 'active',
        createdAt: now,
      })
      .run();

    return {
      delegationId,
      agentId,
      task,
      context,
      dagTaskId,
      status: 'active',
      createdAt: now,
    };
  }

  complete(delegationId: string, result?: Record<string, unknown>): boolean {
    const now = new Date().toISOString();
    const res = this.db.drizzle
      .update(activeDelegations)
      .set({
        status: 'completed' as DelegationStatus,
        completedAt: now,
        result: result ? JSON.stringify(result) : null,
      })
      .where(eq(activeDelegations.delegationId, delegationId))
      .run();
    return res.changes > 0;
  }

  fail(delegationId: string, result?: Record<string, unknown>): boolean {
    const now = new Date().toISOString();
    const res = this.db.drizzle
      .update(activeDelegations)
      .set({
        status: 'failed' as DelegationStatus,
        completedAt: now,
        result: result ? JSON.stringify(result) : null,
      })
      .where(eq(activeDelegations.delegationId, delegationId))
      .run();
    return res.changes > 0;
  }

  cancel(delegationId: string): boolean {
    const now = new Date().toISOString();
    const res = this.db.drizzle
      .update(activeDelegations)
      .set({
        status: 'cancelled' as DelegationStatus,
        completedAt: now,
      })
      .where(eq(activeDelegations.delegationId, delegationId))
      .run();
    return res.changes > 0;
  }

  getActive(agentId?: string): DelegationRecord[] {
    const query = this.db.drizzle.select().from(activeDelegations);

    const rows = agentId
      ? query
          .where(and(eq(activeDelegations.agentId, agentId), eq(activeDelegations.status, 'active')))
          .all()
      : query.where(eq(activeDelegations.status, 'active')).all();

    return rows.map((r) => this.rowToRecord(r));
  }

  getByDagTask(dagTaskId: string): DelegationRecord | undefined {
    const row = this.db.drizzle
      .select()
      .from(activeDelegations)
      .where(eq(activeDelegations.dagTaskId, dagTaskId))
      .get();

    if (!row) return undefined;
    return this.rowToRecord(row);
  }

  getByDelegationId(delegationId: string): DelegationRecord | undefined {
    const row = this.db.drizzle
      .select()
      .from(activeDelegations)
      .where(eq(activeDelegations.delegationId, delegationId))
      .get();

    if (!row) return undefined;
    return this.rowToRecord(row);
  }

  getAllByAgent(agentId: string): DelegationRecord[] {
    const rows = this.db.drizzle
      .select()
      .from(activeDelegations)
      .where(eq(activeDelegations.agentId, agentId))
      .all();

    return rows.map((r) => this.rowToRecord(r));
  }

  private rowToRecord(row: typeof activeDelegations.$inferSelect): DelegationRecord {
    return {
      delegationId: row.delegationId,
      agentId: row.agentId,
      task: row.task,
      context: row.context ?? undefined,
      dagTaskId: row.dagTaskId ?? undefined,
      status: row.status as DelegationStatus,
      createdAt: row.createdAt,
      completedAt: row.completedAt ?? undefined,
      result: row.result ? JSON.parse(row.result) : undefined,
    };
  }
}
