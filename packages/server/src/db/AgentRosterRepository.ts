import { eq, and, isNull } from 'drizzle-orm';
import type { Database } from './database.js';
import { agentRoster } from './schema.js';

export type RosterAgentStatus = 'idle' | 'running' | 'terminated';

export interface AgentRecord {
  agentId: string;
  role: string;
  model: string;
  status: RosterAgentStatus;
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
    status: RosterAgentStatus = 'idle',
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

  getAllAgents(status?: RosterAgentStatus, teamId?: string): AgentRecord[] {
    const conditions = [];
    if (status) conditions.push(eq(agentRoster.status, status));
    if (teamId) conditions.push(eq(agentRoster.teamId, teamId));

    const query = this.db.drizzle.select().from(agentRoster);
    const rows = conditions.length > 0
      ? query.where(and(...conditions)).all()
      : query.all();

    return rows.map((r) => this.rowToRecord(r));
  }

  /** Get all agents for a specific project (uses idx_agent_roster_project index). */
  getByProject(projectId: string): AgentRecord[] {
    const rows = this.db.drizzle
      .select()
      .from(agentRoster)
      .where(eq(agentRoster.projectId, projectId))
      .all();
    return rows.map((r) => this.rowToRecord(r));
  }

  updateStatus(agentId: string, status: RosterAgentStatus): boolean {
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
      .set({ status: 'terminated' as RosterAgentStatus, updatedAt: new Date().toISOString() })
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

  /** Hard-delete all roster entries for a project (used when project is deleted) */
  deleteByProject(projectId: string): number {
    const result = this.db.drizzle
      .delete(agentRoster)
      .where(eq(agentRoster.projectId, projectId))
      .run();
    return result.changes;
  }

  /** Hard-delete all roster entries for a specific crew (lead + all descendants).
   *  Walks the parent chain recursively to catch grandchildren spawned by sub-agents. */
  deleteCrew(leadId: string): number {
    const lead = this.getAgent(leadId);
    if (!lead) return 0;

    // Scope to the lead's project (uses idx_agent_roster_project index, avoids full table scan)
    const projectAgents = lead.projectId
      ? this.getByProject(lead.projectId)
      : this.getAllAgents();

    // Build set of all descendant IDs via BFS on metadata.parentId
    const toDelete = new Set<string>([leadId]);
    let frontier = [leadId];
    while (frontier.length > 0) {
      const nextFrontier: string[] = [];
      for (const agent of projectAgents) {
        if (toDelete.has(agent.agentId)) continue;
        const meta = agent.metadata as Record<string, unknown> | undefined;
        if (meta?.parentId && frontier.includes(meta.parentId as string)) {
          toDelete.add(agent.agentId);
          nextFrontier.push(agent.agentId);
        }
      }
      frontier = nextFrontier;
    }

    // Delete all in one pass
    let deleted = 0;
    for (const agentId of toDelete) {
      if (this.deleteAgent(agentId)) deleted++;
    }
    return deleted;
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
    const counts: Record<string, number> = { idle: 0, running: 0, terminated: 0 };
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
      status: row.status as RosterAgentStatus,
      sessionId: row.sessionId ?? undefined,
      projectId: row.projectId ?? undefined,
      teamId: row.teamId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastTaskSummary: row.lastTaskSummary ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  /**
   * Reconcile stale roster entries on server startup.
   * Marks agents showing as 'running' or 'idle' as 'terminated' when they
   * have no live process (e.g. after a server crash).
   *
   * @param isAgentAlive - callback to check if an agent actually has a live process
   * @returns count of agents reconciled
   */
  reconcileStaleAgents(isAgentAlive: (agentId: string) => boolean): number {
    const busy = this.getAllAgents('running');
    const idle = this.getAllAgents('idle');
    const candidates = [...busy, ...idle];

    let reconciled = 0;
    const now = new Date().toISOString();
    for (const agent of candidates) {
      if (!isAgentAlive(agent.agentId)) {
        this.db.drizzle
          .update(agentRoster)
          .set({ status: 'terminated', updatedAt: now })
          .where(eq(agentRoster.agentId, agent.agentId))
          .run();
        reconciled++;
      }
    }
    return reconciled;
  }
}
