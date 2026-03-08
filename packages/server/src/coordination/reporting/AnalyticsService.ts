import type { Database } from '../../db/database.js';
import { projectSessions, taskCostRecords, sessionRetros } from '../../db/schema.js';
import { eq, sql, desc, and, inArray } from 'drizzle-orm';
import { activityLog, dagTasks } from '../../db/schema.js';
// ── Types ─────────────────────────────────────────────────────────

export interface SessionListItem {
  id: string;
  leadId: string;
  projectId: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  taskCount: number;
  agentCount: number;
}

export interface SessionSummary {
  leadId: string;
  projectId: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  agentCount: number;
  taskCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface AnalyticsOverview {
  totalSessions: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  sessions: SessionSummary[];
  roleContributions: Array<{ role: string; taskCount: number; tokenUsage: number }>;
}

export interface SessionComparison {
  sessions: SessionSummary[];
  deltas: {
    tokenDelta: number;
    agentCountDelta: number;
  } | null;
}

// ── AnalyticsService ──────────────────────────────────────────────

export class AnalyticsService {
  constructor(private db: Database) {}

  /** List past sessions with summary data */
  getSessions(projectId?: string): SessionListItem[] {
    const sessionCondition = projectId
      ? eq(projectSessions.projectId, projectId)
      : undefined;

    const sessions = this.db.drizzle
      .select()
      .from(projectSessions)
      .where(sessionCondition)
      .orderBy(desc(projectSessions.startedAt))
      .all();

    // Batch-fetch cost data
    const costRows = this.db.drizzle
      .select({
        leadId: taskCostRecords.leadId,
        totalInput: sql<number>`sum(${taskCostRecords.inputTokens})`,
        totalOutput: sql<number>`sum(${taskCostRecords.outputTokens})`,
        taskCount: sql<number>`count(distinct ${taskCostRecords.dagTaskId})`,
      })
      .from(taskCostRecords)
      .groupBy(taskCostRecords.leadId)
      .all();
    const costByLead = new Map(costRows.map(r => [r.leadId, r]));

    // Batch-fetch agent counts — keyed by projectId (activity_log.project_id holds the project ID)
    const agentCountRows = this.db.drizzle
      .select({
        projectId: activityLog.projectId,
        agentCount: sql<number>`count(distinct ${activityLog.agentId})`,
      })
      .from(activityLog)
      .groupBy(activityLog.projectId)
      .all();
    const agentCountByProject = new Map(agentCountRows.map(r => [r.projectId, r.agentCount ?? 0]));

    // Batch-fetch task counts from dag_tasks (per lead)
    const dagTaskRows = this.db.drizzle
      .select({
        leadId: dagTasks.leadId,
        taskCount: sql<number>`count(*)`,
      })
      .from(dagTasks)
      .groupBy(dagTasks.leadId)
      .all();
    const dagTasksByLead = new Map(dagTaskRows.map(r => [r.leadId, r.taskCount ?? 0]));

    return sessions.map(s => {
      const cost = costByLead.get(s.leadId);
      const inputTokens = cost?.totalInput ?? 0;
      const outputTokens = cost?.totalOutput ?? 0;
      const startMs = s.startedAt ? new Date(s.startedAt).getTime() : 0;
      const endMs = s.endedAt ? new Date(s.endedAt).getTime() : null;
      // Use dag_tasks count, fall back to cost records count
      const taskCount = dagTasksByLead.get(s.leadId) ?? cost?.taskCount ?? 0;

      return {
        id: s.leadId,
        leadId: s.leadId,
        projectId: s.projectId,
        status: s.status ?? 'unknown',
        startedAt: s.startedAt ?? '',
        endedAt: s.endedAt ?? null,
        durationMs: endMs && startMs ? endMs - startMs : null,
        totalInputTokens: inputTokens,
        totalOutputTokens: outputTokens,
        taskCount,
        agentCount: agentCountByProject.get(s.projectId ?? '') ?? 0,
      };
    });
  }

  /** Get analytics overview across all sessions */
  getOverview(projectId?: string): AnalyticsOverview {
    // Get sessions
    const sessionCondition = projectId
      ? eq(projectSessions.projectId, projectId)
      : undefined;

    const sessions = this.db.drizzle
      .select()
      .from(projectSessions)
      .where(sessionCondition)
      .orderBy(desc(projectSessions.startedAt))
      .all();

    // Get cost data per lead
    const costRows = this.db.drizzle
      .select({
        leadId: taskCostRecords.leadId,
        totalInput: sql<number>`sum(${taskCostRecords.inputTokens})`,
        totalOutput: sql<number>`sum(${taskCostRecords.outputTokens})`,
        taskCount: sql<number>`count(distinct ${taskCostRecords.dagTaskId})`,
      })
      .from(taskCostRecords)
      .groupBy(taskCostRecords.leadId)
      .all();

    const costByLead = new Map(costRows.map(r => [r.leadId, r]));

    // Get agent counts per project from activity log
    const agentCountRows = this.db.drizzle
      .select({
        projectId: activityLog.projectId,
        agentCount: sql<number>`count(distinct ${activityLog.agentId})`,
      })
      .from(activityLog)
      .groupBy(activityLog.projectId)
      .all();

    const agentCountByProject = new Map(agentCountRows.map(r => [r.projectId, r.agentCount ?? 0]));

    // Get task counts from dag_tasks per lead
    const dagTaskRows = this.db.drizzle
      .select({
        leadId: dagTasks.leadId,
        taskCount: sql<number>`count(*)`,
      })
      .from(dagTasks)
      .groupBy(dagTasks.leadId)
      .all();
    const dagTasksByLead = new Map(dagTaskRows.map(r => [r.leadId, r.taskCount ?? 0]));

    // Build session summaries
    const summaries: SessionSummary[] = sessions.map(s => {
      const cost = costByLead.get(s.leadId);
      const inputTokens = cost?.totalInput ?? 0;
      const outputTokens = cost?.totalOutput ?? 0;
      const taskCount = dagTasksByLead.get(s.leadId) ?? cost?.taskCount ?? 0;
      return {
        leadId: s.leadId,
        projectId: s.projectId,
        status: s.status ?? 'unknown',
        startedAt: s.startedAt ?? '',
        endedAt: s.endedAt ?? null,
        agentCount: agentCountByProject.get(s.projectId ?? '') ?? 0,
        taskCount,
        totalInputTokens: inputTokens,
        totalOutputTokens: outputTokens,
      };
    });

    // Compute totals
    const totalInputTokens = summaries.reduce((sum, s) => sum + s.totalInputTokens, 0);
    const totalOutputTokens = summaries.reduce((sum, s) => sum + s.totalOutputTokens, 0);

    // Role contributions from activity log
    const roleRows = this.db.drizzle
      .select({
        role: activityLog.agentRole,
        actionCount: sql<number>`count(*)`,
      })
      .from(activityLog)
      .groupBy(activityLog.agentRole)
      .all();

    const roleContributions = roleRows.map(r => ({
      role: r.role,
      taskCount: r.actionCount ?? 0,
      tokenUsage: 0, // Would need per-agent token data join
    }));

    return {
      totalSessions: summaries.length,
      totalInputTokens,
      totalOutputTokens,
      sessions: summaries,
      roleContributions,
    };
  }

  /** Compare two sessions side-by-side */
  compare(leadIds: string[]): SessionComparison {
    const summaries: SessionSummary[] = [];

    for (const leadId of leadIds) {
      const session = this.db.drizzle
        .select()
        .from(projectSessions)
        .where(eq(projectSessions.leadId, leadId))
        .get();

      const cost = this.db.drizzle
        .select({
          totalInput: sql<number>`sum(${taskCostRecords.inputTokens})`,
          totalOutput: sql<number>`sum(${taskCostRecords.outputTokens})`,
        })
        .from(taskCostRecords)
        .where(eq(taskCostRecords.leadId, leadId))
        .get();

      // Task count from dag_tasks (more reliable than cost records)
      const dagTaskCount = this.db.drizzle
        .select({ count: sql<number>`count(*)` })
        .from(dagTasks)
        .where(eq(dagTasks.leadId, leadId))
        .get();

      // Agent count — match on projectId, not leadId
      const projectId = session?.projectId ?? '';
      const agentCount = this.db.drizzle
        .select({ count: sql<number>`count(distinct ${activityLog.agentId})` })
        .from(activityLog)
        .where(eq(activityLog.projectId, projectId))
        .get();

      const inputTokens = cost?.totalInput ?? 0;
      const outputTokens = cost?.totalOutput ?? 0;

      summaries.push({
        leadId,
        projectId: session?.projectId ?? null,
        status: session?.status ?? 'unknown',
        startedAt: session?.startedAt ?? '',
        endedAt: session?.endedAt ?? null,
        agentCount: agentCount?.count ?? 0,
        taskCount: dagTaskCount?.count ?? 0,
        totalInputTokens: inputTokens,
        totalOutputTokens: outputTokens,
      });
    }

    // Compute deltas if exactly 2 sessions
    const deltas = summaries.length === 2 ? {
      tokenDelta: (summaries[1].totalInputTokens + summaries[1].totalOutputTokens) -
                  (summaries[0].totalInputTokens + summaries[0].totalOutputTokens),
      agentCountDelta: summaries[1].agentCount - summaries[0].agentCount,
    } : null;

    return { sessions: summaries, deltas };
  }
}
