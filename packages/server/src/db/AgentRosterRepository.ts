import { eq, and, isNull } from 'drizzle-orm';
import type { Database } from './database.js';
import { agentRoster } from './schema.js';

export type AgentStatus = 'idle' | 'busy' | 'terminated';

export interface AgentRecord {
  agentId: string;
  role: string;
  model: string;
  status: AgentStatus;
  sessionId?: string;
  projectId?: string;
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

  getAllAgents(status?: AgentStatus): AgentRecord[] {
    const query = this.db.drizzle.select().from(agentRoster);

    const rows = status
      ? query.where(eq(agentRoster.status, status)).all()
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

  private rowToRecord(row: typeof agentRoster.$inferSelect): AgentRecord {
    return {
      agentId: row.agentId,
      role: row.role,
      model: row.model,
      status: row.status as AgentStatus,
      sessionId: row.sessionId ?? undefined,
      projectId: row.projectId ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastTaskSummary: row.lastTaskSummary ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}
