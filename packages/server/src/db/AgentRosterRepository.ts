import { eq, and, isNull } from 'drizzle-orm';
import type { Database } from './database.js';
import { agentRoster } from './schema.js';

export type AgentStatus = 'idle' | 'busy' | 'terminated' | 'retired';

export interface AgentRecord {
  agentId: string;
  role: string;
  model: string;
  status: AgentStatus;
  sessionId?: string;
  projectId?: string;
  teamId: string;
  createdAt: string;
  updatedAt: string;
  lastTaskSummary?: string;
  metadata?: Record<string, unknown>;
}

export class AgentRosterRepository {
  constructor(private db: Database) {}

  upsertAgent(
    agentId: string,
    role: string,
    model: string,
    status: AgentStatus = 'idle',
    sessionId?: string,
    projectId?: string,
    metadata?: Record<string, unknown>,
    teamId: string = 'default',
  ): AgentRecord {
    const now = new Date().toISOString();
    this.db.drizzle
      .insert(agentRoster)
      .values({
        agentId,
        role,
        model,
        status,
        sessionId: sessionId ?? null,
        projectId: projectId ?? null,
        teamId,
        metadata: metadata ? JSON.stringify(metadata) : null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: agentRoster.agentId,
        set: {
          role,
          model,
          status,
          sessionId: sessionId ?? null,
          projectId: projectId ?? null,
          teamId,
          metadata: metadata ? JSON.stringify(metadata) : null,
          updatedAt: now,
        },
      })
      .run();

    return {
      agentId,
      role,
      model,
      status,
      sessionId,
      projectId,
      teamId,
      createdAt: now,
      updatedAt: now,
      metadata,
    };
  }

  getAgent(agentId: string): AgentRecord | undefined {
    const row = this.db.drizzle
      .select()
      .from(agentRoster)
      .where(eq(agentRoster.agentId, agentId))
      .get();

    if (!row) return undefined;
    return this.rowToRecord(row);
  }

  getAllAgents(status?: AgentStatus, teamId?: string): AgentRecord[] {
    const conditions = [];
    if (status) conditions.push(eq(agentRoster.status, status));
    if (teamId) conditions.push(eq(agentRoster.teamId, teamId));

    const query = this.db.drizzle.select().from(agentRoster);
    const rows = conditions.length > 0
      ? query.where(and(...conditions)).all()
      : query.all();

    return rows.map((r) => this.rowToRecord(r));
  }

  updateStatus(agentId: string, status: AgentStatus): boolean {
    const result = this.db.drizzle
      .update(agentRoster)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(agentRoster.agentId, agentId))
      .run();
    return result.changes > 0;
  }

  updateSessionId(agentId: string, sessionId: string): boolean {
    const result = this.db.drizzle
      .update(agentRoster)
      .set({ sessionId, updatedAt: new Date().toISOString() })
      .where(eq(agentRoster.agentId, agentId))
      .run();
    return result.changes > 0;
  }

  updateLastTaskSummary(agentId: string, summary: string): boolean {
    const result = this.db.drizzle
      .update(agentRoster)
      .set({ lastTaskSummary: summary, updatedAt: new Date().toISOString() })
      .where(eq(agentRoster.agentId, agentId))
      .run();
    return result.changes > 0;
  }

  removeAgent(agentId: string): boolean {
    const result = this.db.drizzle
      .update(agentRoster)
      .set({ status: 'terminated' as AgentStatus, updatedAt: new Date().toISOString() })
      .where(eq(agentRoster.agentId, agentId))
      .run();
    return result.changes > 0;
  }

  deleteAgent(agentId: string): boolean {
    const result = this.db.drizzle
      .delete(agentRoster)
      .where(eq(agentRoster.agentId, agentId))
      .run();
    return result.changes > 0;
  }

  retireAgent(agentId: string, reason?: string): boolean {
    const now = new Date().toISOString();
    const existing = this.getAgent(agentId);
    if (!existing) return false;

    const meta = existing.metadata ?? {};
    (meta as Record<string, unknown>).retiredAt = now;
    if (reason) (meta as Record<string, unknown>).retiredReason = reason;

    const result = this.db.drizzle
      .update(agentRoster)
      .set({
        status: 'retired' as AgentStatus,
        metadata: JSON.stringify(meta),
        updatedAt: now,
      })
      .where(eq(agentRoster.agentId, agentId))
      .run();
    return result.changes > 0;
  }

  cloneAgent(sourceAgentId: string, newAgentId: string): AgentRecord | undefined {
    const source = this.getAgent(sourceAgentId);
    if (!source) return undefined;

    const sourceMeta = source.metadata ?? {};
    const cloneMeta: Record<string, unknown> = { clonedFromId: sourceAgentId };

    // Track clone references on source
    const cloneIds = (Array.isArray((sourceMeta as any).cloneIds) ? (sourceMeta as any).cloneIds : []) as string[];
    cloneIds.push(newAgentId);
    (sourceMeta as Record<string, unknown>).cloneIds = cloneIds;
    this.db.drizzle
      .update(agentRoster)
      .set({ metadata: JSON.stringify(sourceMeta), updatedAt: new Date().toISOString() })
      .where(eq(agentRoster.agentId, sourceAgentId))
      .run();

    return this.upsertAgent(
      newAgentId,
      source.role,
      source.model,
      'idle',
      undefined,
      source.projectId,
      cloneMeta,
      source.teamId,
    );
  }

  getStatusCounts(teamId?: string): Record<string, number> {
    const agents = this.getAllAgents(undefined, teamId);
    const counts: Record<string, number> = { idle: 0, busy: 0, terminated: 0, retired: 0 };
    for (const a of agents) {
      counts[a.status] = (counts[a.status] ?? 0) + 1;
    }
    return counts;
  }

  private rowToRecord(row: typeof agentRoster.$inferSelect): AgentRecord {
    return {
      agentId: row.agentId,
      role: row.role,
      model: row.model,
      status: row.status as AgentStatus,
      sessionId: row.sessionId ?? undefined,
      projectId: row.projectId ?? undefined,
      teamId: row.teamId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastTaskSummary: row.lastTaskSummary ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}
