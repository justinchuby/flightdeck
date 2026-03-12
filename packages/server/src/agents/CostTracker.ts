import type { Database } from '../db/database.js';
import { taskCostRecords, agentRoster, utcNow } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';

export interface CostRecord {
  agentId: string;
  dagTaskId: string;
  leadId: string;
  projectId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentCostSummary {
  agentId: string;
  agentRole?: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  taskCount: number;
}

export interface TaskCostSummary {
  dagTaskId: string;
  leadId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  agentCount: number;
  agents: Array<{ agentId: string; inputTokens: number; outputTokens: number; costUsd: number }>;
}

export interface ProjectCostSummary {
  projectId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  sessionCount: number;
  agentCount: number;
}

export interface SessionCostSummary {
  leadId: string;
  projectId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  agentCount: number;
}

/**
 * Tracks token usage per agent per DAG task.
 *
 * Token values from ACP are cumulative per agent session. CostTracker stores
 * the last-seen cumulative values per agent and computes deltas when new
 * usage arrives, attributing the delta to the agent's current dagTaskId.
 */
export class CostTracker {
  private db: Database;
  /** Last-seen cumulative token values per agent, for computing deltas */
  private lastSeen = new Map<string, { inputTokens: number; outputTokens: number }>();

  constructor(db: Database) {
    this.db = db;
    this.initializeFromDb();
  }

  /**
   * Initialize lastSeen from DB so that a server restart doesn't cause
   * the entire session history to be re-attributed as a burst to the
   * current task. Sum of stored deltas per agent ≈ last cumulative ACP value.
   */
  private initializeFromDb(): void {
    const rows = this.db.drizzle
      .select({
        agentId: taskCostRecords.agentId,
        totalInput: sql<number>`sum(${taskCostRecords.inputTokens})`,
        totalOutput: sql<number>`sum(${taskCostRecords.outputTokens})`,
      })
      .from(taskCostRecords)
      .groupBy(taskCostRecords.agentId)
      .all();

    for (const row of rows) {
      this.lastSeen.set(row.agentId, {
        inputTokens: row.totalInput ?? 0,
        outputTokens: row.totalOutput ?? 0,
      });
    }
  }

  /**
   * Record a token usage event. `inputTokens` and `outputTokens` are
   * cumulative values from the ACP session. CostTracker computes the delta
   * and attributes it to the given dagTaskId.
   */
  recordUsage(
    agentId: string,
    dagTaskId: string,
    leadId: string,
    cumulativeInputTokens: number,
    cumulativeOutputTokens: number,
    extras?: { cacheReadTokens?: number; cacheWriteTokens?: number; costUsd?: number; projectId?: string },
  ): void {
    const prev = this.lastSeen.get(agentId) ?? { inputTokens: 0, outputTokens: 0 };
    const deltaInput = Math.max(0, cumulativeInputTokens - prev.inputTokens);
    const deltaOutput = Math.max(0, cumulativeOutputTokens - prev.outputTokens);

    this.lastSeen.set(agentId, {
      inputTokens: cumulativeInputTokens,
      outputTokens: cumulativeOutputTokens,
    });

    // Skip zero-delta updates
    if (deltaInput === 0 && deltaOutput === 0) return;

    const cacheRead = extras?.cacheReadTokens ?? 0;
    const cacheWrite = extras?.cacheWriteTokens ?? 0;
    const costUsd = extras?.costUsd ?? 0;
    const projectId = extras?.projectId ?? null;

    // Atomic upsert: insert or add delta to existing record
    this.db.drizzle
      .insert(taskCostRecords)
      .values({
        agentId,
        dagTaskId,
        leadId,
        projectId,
        inputTokens: deltaInput,
        outputTokens: deltaOutput,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        costUsd,
      })
      .onConflictDoUpdate({
        target: [taskCostRecords.agentId, taskCostRecords.dagTaskId, taskCostRecords.leadId],
        set: {
          inputTokens: sql`${taskCostRecords.inputTokens} + ${deltaInput}`,
          outputTokens: sql`${taskCostRecords.outputTokens} + ${deltaOutput}`,
          cacheReadTokens: sql`${taskCostRecords.cacheReadTokens} + ${cacheRead}`,
          cacheWriteTokens: sql`${taskCostRecords.cacheWriteTokens} + ${cacheWrite}`,
          costUsd: sql`${taskCostRecords.costUsd} + ${costUsd}`,
          projectId: projectId ?? sql`${taskCostRecords.projectId}`,
          updatedAt: utcNow,
        },
      })
      .run();
  }

  /** Get cost breakdown per agent (across all tasks). */
  getAgentCosts(): AgentCostSummary[] {
    const rows = this.db.drizzle
      .select({
        agentId: taskCostRecords.agentId,
        agentRole: agentRoster.role,
        totalInputTokens: sql<number>`sum(${taskCostRecords.inputTokens})`,
        totalOutputTokens: sql<number>`sum(${taskCostRecords.outputTokens})`,
        totalCostUsd: sql<number>`sum(${taskCostRecords.costUsd})`,
        taskCount: sql<number>`count(distinct ${taskCostRecords.dagTaskId})`,
      })
      .from(taskCostRecords)
      .leftJoin(agentRoster, eq(taskCostRecords.agentId, agentRoster.agentId))
      .groupBy(taskCostRecords.agentId)
      .all();

    return rows.map(r => ({
      agentId: r.agentId,
      agentRole: r.agentRole ?? undefined,
      totalInputTokens: r.totalInputTokens ?? 0,
      totalOutputTokens: r.totalOutputTokens ?? 0,
      totalCostUsd: r.totalCostUsd ?? 0,
      taskCount: r.taskCount ?? 0,
    }));
  }

  /** Get cost breakdown per DAG task (across all agents). */
  getTaskCosts(leadId?: string): TaskCostSummary[] {
    const condition = leadId ? eq(taskCostRecords.leadId, leadId) : undefined;

    // Get per-task totals
    const taskTotals = this.db.drizzle
      .select({
        dagTaskId: taskCostRecords.dagTaskId,
        leadId: taskCostRecords.leadId,
        totalInputTokens: sql<number>`sum(${taskCostRecords.inputTokens})`,
        totalOutputTokens: sql<number>`sum(${taskCostRecords.outputTokens})`,
        totalCostUsd: sql<number>`sum(${taskCostRecords.costUsd})`,
        agentCount: sql<number>`count(distinct ${taskCostRecords.agentId})`,
      })
      .from(taskCostRecords)
      .where(condition)
      .groupBy(taskCostRecords.dagTaskId, taskCostRecords.leadId)
      .all();

    // Get per-task per-agent breakdown
    const allRecords = this.db.drizzle
      .select()
      .from(taskCostRecords)
      .where(condition)
      .all();

    // Look up agent roles for the breakdown
    const agentRoleMap = new Map<string, string>();
    const rosterRows = this.db.drizzle
      .select({ agentId: agentRoster.agentId, role: agentRoster.role })
      .from(agentRoster)
      .all();
    for (const row of rosterRows) {
      if (row.role) agentRoleMap.set(row.agentId, row.role);
    }

    const agentsByTask = new Map<string, Array<{ agentId: string; agentRole?: string; inputTokens: number; outputTokens: number; costUsd: number }>>();
    for (const r of allRecords) {
      const key = `${r.leadId}:${r.dagTaskId}`;
      if (!agentsByTask.has(key)) agentsByTask.set(key, []);
      agentsByTask.get(key)!.push({
        agentId: r.agentId,
        agentRole: agentRoleMap.get(r.agentId),
        inputTokens: r.inputTokens ?? 0,
        outputTokens: r.outputTokens ?? 0,
        costUsd: r.costUsd ?? 0,
      });
    }

    return taskTotals.map(t => ({
      dagTaskId: t.dagTaskId,
      leadId: t.leadId,
      totalInputTokens: t.totalInputTokens ?? 0,
      totalOutputTokens: t.totalOutputTokens ?? 0,
      totalCostUsd: t.totalCostUsd ?? 0,
      agentCount: t.agentCount ?? 0,
      agents: agentsByTask.get(`${t.leadId}:${t.dagTaskId}`) ?? [],
    }));
  }

  /** Get cost records for a specific agent. */
  getAgentTaskCosts(agentId: string): CostRecord[] {
    return this.db.drizzle
      .select()
      .from(taskCostRecords)
      .where(eq(taskCostRecords.agentId, agentId))
      .all()
      .map(r => ({
        agentId: r.agentId,
        dagTaskId: r.dagTaskId,
        leadId: r.leadId,
        projectId: r.projectId ?? undefined,
        inputTokens: r.inputTokens ?? 0,
        outputTokens: r.outputTokens ?? 0,
        cacheReadTokens: r.cacheReadTokens ?? 0,
        cacheWriteTokens: r.cacheWriteTokens ?? 0,
        costUsd: r.costUsd ?? 0,
        createdAt: r.createdAt!,
        updatedAt: r.updatedAt!,
      }));
  }

  /** Get cost totals per project (across all sessions and agents). */
  getProjectCosts(): ProjectCostSummary[] {
    const rows = this.db.drizzle
      .select({
        projectId: taskCostRecords.projectId,
        totalInputTokens: sql<number>`sum(${taskCostRecords.inputTokens})`,
        totalOutputTokens: sql<number>`sum(${taskCostRecords.outputTokens})`,
        totalCostUsd: sql<number>`sum(${taskCostRecords.costUsd})`,
        sessionCount: sql<number>`count(distinct ${taskCostRecords.leadId})`,
        agentCount: sql<number>`count(distinct ${taskCostRecords.agentId})`,
      })
      .from(taskCostRecords)
      .groupBy(taskCostRecords.projectId)
      .all();

    return rows
      .filter(r => r.projectId != null)
      .map(r => ({
        projectId: r.projectId!,
        totalInputTokens: r.totalInputTokens ?? 0,
        totalOutputTokens: r.totalOutputTokens ?? 0,
        totalCostUsd: r.totalCostUsd ?? 0,
        sessionCount: r.sessionCount ?? 0,
        agentCount: r.agentCount ?? 0,
      }));
  }

  /** Get cost totals per session (leadId) within a project. */
  getSessionCosts(projectId: string): SessionCostSummary[] {
    const rows = this.db.drizzle
      .select({
        leadId: taskCostRecords.leadId,
        projectId: taskCostRecords.projectId,
        totalInputTokens: sql<number>`sum(${taskCostRecords.inputTokens})`,
        totalOutputTokens: sql<number>`sum(${taskCostRecords.outputTokens})`,
        totalCostUsd: sql<number>`sum(${taskCostRecords.costUsd})`,
        agentCount: sql<number>`count(distinct ${taskCostRecords.agentId})`,
      })
      .from(taskCostRecords)
      .where(eq(taskCostRecords.projectId, projectId))
      .groupBy(taskCostRecords.leadId)
      .all();

    return rows.map(r => ({
      leadId: r.leadId,
      projectId: r.projectId ?? projectId,
      totalInputTokens: r.totalInputTokens ?? 0,
      totalOutputTokens: r.totalOutputTokens ?? 0,
      totalCostUsd: r.totalCostUsd ?? 0,
      agentCount: r.agentCount ?? 0,
    }));
  }

  /** Reset last-seen state (useful for testing). */
  resetLastSeen(): void {
    this.lastSeen.clear();
  }
}
