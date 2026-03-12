import { Router } from 'express';
import { sql, inArray, or, isNull } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import fs from 'node:fs';
import type { AppContext } from './context.js';
import {
  projects,
  projectSessions,
  activityLog,
  dagTasks,
  chatGroups,
  chatGroupMembers,
  chatGroupMessages,
  conversations,
  messages,
  agentMemory,
  decisions,
  fileLocks,
  agentFileHistory,
  collectiveMemory,
  taskCostRecords,
  sessionRetros,
  timers,
  agentPlans,
} from '../db/schema.js';

// ── Table Cleanup Configuration ──────────────────────────────────────
//
// Single source of truth for all data tables.
// Drives: stats display, purge-all wipe, and selective cleanup.
// To add a new table, add one entry here — it's automatically included
// in all cleanup operations.

/** How a table is scoped during selective (session-based) cleanup.
 *  `nullable: true` means the column can be NULL in the schema.
 *  NULL rows are treated as orphaned and included in cleanup
 *  (SQL IN never matches NULL, so we add an explicit OR IS NULL). */
type SelectiveFilter =
  | { by: 'leadId'; column: any; nullable?: boolean }
  | { by: 'projectId'; column: any; nullable?: boolean }
  | { by: 'allAgentIds'; column: any }
  | { by: 'conversationId'; column: any }
  | { by: 'sessionId' }
  | { by: 'orphanCheck' };

/**
 * All data tables in deletion-safe order (FK children before parents).
 * Config tables (roles, settings) are intentionally excluded.
 *
 * selectiveFilter defines how each table is scoped during session-based cleanup:
 *   - leadId:         DELETE WHERE leadId IN (...) [OR leadId IS NULL if nullable]
 *   - projectId:      DELETE WHERE projectId IN (...) [OR projectId IS NULL if nullable]
 *   - allAgentIds:    DELETE WHERE agentId IN (leads + sub-agents from activity log)
 *   - conversationId: DELETE WHERE conversationId IN (conversations matching allAgentIds)
 *   - sessionId:      DELETE WHERE id IN (selected session IDs)
 *   - orphanCheck:    DELETE projects with no remaining sessions
 */
const DATA_TABLES: { name: string; table: any; selectiveFilter: SelectiveFilter }[] = [
  // FK children first
  { name: 'messages', table: messages, selectiveFilter: { by: 'conversationId', column: messages.conversationId } },
  { name: 'conversations', table: conversations, selectiveFilter: { by: 'allAgentIds', column: conversations.agentId } },
  { name: 'chat_group_messages', table: chatGroupMessages, selectiveFilter: { by: 'leadId', column: chatGroupMessages.leadId } },
  { name: 'chat_group_members', table: chatGroupMembers, selectiveFilter: { by: 'leadId', column: chatGroupMembers.leadId } },
  { name: 'chat_groups', table: chatGroups, selectiveFilter: { by: 'leadId', column: chatGroups.leadId } },
  { name: 'dag_tasks', table: dagTasks, selectiveFilter: { by: 'leadId', column: dagTasks.leadId } },
  { name: 'agent_file_history', table: agentFileHistory, selectiveFilter: { by: 'leadId', column: agentFileHistory.leadId } },
  { name: 'task_cost_records', table: taskCostRecords, selectiveFilter: { by: 'leadId', column: taskCostRecords.leadId } },
  { name: 'session_retros', table: sessionRetros, selectiveFilter: { by: 'leadId', column: sessionRetros.leadId } },
  // decisions.leadId, agentPlans.leadId, timers.leadId are nullable in the schema.
  // NULL means the record was created without a session context (orphaned).
  // We include NULL rows in cleanup so they don't accumulate silently.
  { name: 'decisions', table: decisions, selectiveFilter: { by: 'leadId', column: decisions.leadId, nullable: true } },
  { name: 'agent_memory', table: agentMemory, selectiveFilter: { by: 'leadId', column: agentMemory.leadId } },
  { name: 'agent_plans', table: agentPlans, selectiveFilter: { by: 'leadId', column: agentPlans.leadId, nullable: true } },
  { name: 'timers', table: timers, selectiveFilter: { by: 'leadId', column: timers.leadId, nullable: true } },
  { name: 'file_locks', table: fileLocks, selectiveFilter: { by: 'projectId', column: fileLocks.projectId } },
  { name: 'collective_memory', table: collectiveMemory, selectiveFilter: { by: 'projectId', column: collectiveMemory.projectId } },
  { name: 'activity_log', table: activityLog, selectiveFilter: { by: 'projectId', column: activityLog.projectId } },
  // Parents last
  { name: 'project_sessions', table: projectSessions, selectiveFilter: { by: 'sessionId' } },
  { name: 'projects', table: projects, selectiveFilter: { by: 'orphanCheck' } },
];

/**
 * Build a WHERE condition for a column-based filter.
 * Handles nullable columns by adding OR column IS NULL, since SQL IN
 * never matches NULL values and those rows would otherwise silently survive.
 */
function buildFilterCondition(
  column: any,
  ids: (string | number)[],
  nullable?: boolean,
): SQL | undefined {
  const inCondition = ids.length > 0 ? inArray(column, ids) : undefined;
  if (nullable) {
    return inCondition ? or(inCondition, isNull(column)) : isNull(column);
  }
  return inCondition;
}

export function dataRoutes(ctx: AppContext): Router {
  const { db: _db, config } = ctx;
  const router = Router();

  /** Count rows in a table matching a WHERE condition */
  const countWhere = (table: any, condition: SQL): number => {
    const row = _db.drizzle.select({ count: sql<number>`count(*)` }).from(table).where(condition).get();
    return Number(row?.count ?? 0);
  };

  // ── GET /data/stats — database statistics ──────────────────────────
  router.get('/data/stats', (_req, res) => {
    try {
      let fileSizeBytes = 0;
      try {
        const stat = fs.statSync(config.dbPath);
        fileSizeBytes = stat.size;
        try {
          const walStat = fs.statSync(config.dbPath + '-wal');
          fileSizeBytes += walStat.size;
        } catch { /* no WAL file */ }
      } catch { /* can't stat */ }

      const tableCounts: Record<string, number> = {};
      for (const { name, table } of DATA_TABLES) {
        const row = _db.drizzle.select({ count: sql<number>`count(*)` }).from(table).get();
        tableCounts[name] = Number(row?.count ?? 0);
      }

      const oldest = _db.drizzle
        .select({ startedAt: projectSessions.startedAt })
        .from(projectSessions)
        .orderBy(projectSessions.startedAt)
        .limit(1)
        .get();

      res.json({
        fileSizeBytes,
        tableCounts,
        totalRecords: Object.values(tableCounts).reduce((a, b) => a + b, 0),
        oldestSession: oldest?.startedAt ?? null,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load database stats', detail: (err as Error).message });
    }
  });

  // ── POST /data/cleanup — purge old data ─────────────────────────────
  router.post('/data/cleanup', (req, res) => {
    try {
      const { olderThanDays, dryRun = false } = req.body ?? {};
      if (olderThanDays === undefined || typeof olderThanDays !== 'number' || olderThanDays < 0) {
        return res.status(400).json({ error: 'olderThanDays must be a non-negative number (0 = all data)' });
      }

      // ── Purge ALL data (olderThanDays === 0) ────────────────────────
      // Direct table wipe — bypasses session-based filtering entirely.
      // Handles orphaned data (records with no project_sessions entry).
      if (olderThanDays === 0) {
        const counts: Record<string, number> = {};
        for (const { name, table } of DATA_TABLES) {
          const row = _db.drizzle.select({ count: sql<number>`count(*)` }).from(table).get();
          counts[name] = Number(row?.count ?? 0);
        }
        const totalDeleted = Object.values(counts).reduce((a, b) => a + b, 0);

        if (dryRun) {
          return res.json({
            deleted: counts, totalDeleted,
            sessionsDeleted: counts.project_sessions ?? 0,
            dryRun: true, cutoffDate: 'all',
          });
        }

        _db.drizzle.transaction((tx) => {
          for (const { table } of DATA_TABLES) {
            tx.delete(table).run();
          }
        });

        return res.json({
          deleted: counts, totalDeleted,
          sessionsDeleted: counts.project_sessions ?? 0,
          dryRun: false, cutoffDate: 'all',
        });
      }

      // ── Selective purge (olderThanDays > 0) ─────────────────────────
      const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();

      const oldSessions = _db.drizzle
        .select({ id: projectSessions.id, leadId: projectSessions.leadId, projectId: projectSessions.projectId })
        .from(projectSessions)
        .where(sql`${projectSessions.endedAt} IS NOT NULL AND ${projectSessions.endedAt} < ${cutoff}`)
        .all();

      if (oldSessions.length === 0) {
        return res.json({ deleted: {}, totalDeleted: 0, sessionsDeleted: 0, dryRun, cutoffDate: cutoff });
      }

      // Phase 1: Resolve all ID sets upfront
      const leadIds = [...new Set(oldSessions.map(s => s.leadId))];
      const projectIds = [...new Set(oldSessions.map(s => s.projectId))];
      const sessionIds = oldSessions.map(s => s.id);

      // Discover ALL agent IDs via activity log (leads + their sub-agents)
      const subAgentRows = projectIds.length > 0
        ? _db.drizzle.selectDistinct({ agentId: activityLog.agentId })
            .from(activityLog).where(inArray(activityLog.projectId, projectIds)).all()
        : [];
      const allAgentIds = [...new Set([...leadIds, ...subAgentRows.map(r => r.agentId)])];

      // Resolve conversation IDs (needed for message cleanup)
      const conversationIds = allAgentIds.length > 0
        ? _db.drizzle.select({ id: conversations.id })
            .from(conversations).where(inArray(conversations.agentId, allAgentIds)).all()
            .map(c => c.id)
        : [];

      // Map filter groups → resolved ID sets
      const filterIds: Record<string, (string | number)[]> = {
        leadId: leadIds,
        projectId: projectIds,
        allAgentIds: allAgentIds,
        conversationId: conversationIds,
      };

      // Phase 2: Count what would be deleted
      const counts: Record<string, number> = {};
      for (const { name, table, selectiveFilter: f } of DATA_TABLES) {
        if (f.by === 'sessionId') {
          counts[name] = oldSessions.length;
        } else if (f.by === 'orphanCheck') {
          let orphaned = 0;
          for (const pid of projectIds) {
            const total = _db.drizzle.select({ count: sql<number>`count(*)` }).from(projectSessions)
              .where(sql`${projectSessions.projectId} = ${pid}`).get();
            if (oldSessions.filter(s => s.projectId === pid).length >= Number(total?.count ?? 0)) {
              orphaned++;
            }
          }
          counts[name] = orphaned;
        } else {
          const condition = buildFilterCondition(f.column, filterIds[f.by] ?? [], 'nullable' in f ? f.nullable : false);
          counts[name] = condition ? countWhere(table, condition) : 0;
        }
      }

      const totalDeleted = Object.values(counts).reduce((a, b) => a + b, 0);

      if (dryRun) {
        return res.json({ deleted: counts, totalDeleted, sessionsDeleted: oldSessions.length, dryRun: true, cutoffDate: cutoff });
      }

      // Phase 3: Delete in transaction (DATA_TABLES order ensures FK safety)
      _db.drizzle.transaction((tx) => {
        for (const { table, selectiveFilter: f } of DATA_TABLES) {
          if (f.by === 'sessionId') {
            tx.delete(projectSessions).where(inArray(projectSessions.id, sessionIds)).run();
          } else if (f.by === 'orphanCheck') {
            for (const pid of projectIds) {
              const remaining = tx.select({ count: sql<number>`count(*)` }).from(projectSessions)
                .where(sql`${projectSessions.projectId} = ${pid}`).get();
              if (Number(remaining?.count ?? 0) === 0) {
                tx.delete(projects).where(sql`${projects.id} = ${pid}`).run();
              }
            }
          } else {
            const condition = buildFilterCondition(f.column, filterIds[f.by] ?? [], 'nullable' in f ? f.nullable : false);
            if (condition) {
              tx.delete(table).where(condition).run();
            }
          }
        }
      });

      res.json({ deleted: counts, totalDeleted, sessionsDeleted: oldSessions.length, dryRun: false, cutoffDate: cutoff });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to purge data', detail: (err as Error).message });
    }
  });

  return router;
}
