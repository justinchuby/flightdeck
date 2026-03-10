import { EventEmitter } from 'events';
import { eq, desc, asc, gt, lte, sql, inArray, and } from 'drizzle-orm';
import { Database } from '../../db/database.js';
import { activityLog } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
import { redact, redactObject } from '../../utils/redaction.js';

import type { ActionType, ActivityEntry } from '@flightdeck/shared';
export type { ActionType, ActivityEntry } from '@flightdeck/shared';

export class ActivityLedger extends EventEmitter {
  private db: Database;
  private buffer: Array<{ agentId: string; agentRole: string; actionType: string; summary: string; details: string; projectId: string }> = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly FLUSH_INTERVAL_MS = 250;
  private readonly FLUSH_BATCH_SIZE = 64;
  /** Increments on any non-append mutation (prune, reorder, clear) for cache invalidation */
  private _version = 0;

  constructor(db: Database) {
    super();
    this.db = db;
    this.flushTimer = setInterval(() => this.flush(), this.FLUSH_INTERVAL_MS);
  }

  /** Current generation version — changes on prune/reorder/clear, not on append */
  get version(): number {
    return this._version;
  }

  log(
    agentId: string,
    agentRole: string,
    actionType: ActionType,
    summary: string,
    details: Record<string, any> = {},
    projectId = '',
  ): ActivityEntry {
    const detailsJson = JSON.stringify(redactObject(details).data);
    this.buffer.push({ agentId, agentRole, actionType, summary: redact(summary).text, details: detailsJson, projectId });
    if (this.buffer.length >= this.FLUSH_BATCH_SIZE) {
      this.flush();
    }

    // Construct a synthetic entry for the event (no DB id yet)
    const entry: ActivityEntry = {
      id: 0,
      agentId,
      agentRole,
      actionType,
      summary,
      details,
      timestamp: new Date().toISOString(),
      projectId,
    };
    this.emit('activity', entry);
    return entry;
  }

  /** Flush buffered entries to the database */
  flush(): void {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    for (const entry of batch) {
      this.db.drizzle
        .insert(activityLog)
        .values(entry)
        .run();
    }
  }

  /** Stop the flush timer (for graceful shutdown) */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  getRecent(limit: number = 50, projectId?: string): ActivityEntry[] {
    this.flush();
    const condition = projectId ? eq(activityLog.projectId, projectId) : undefined;
    const rows = this.db.drizzle
      .select()
      .from(activityLog)
      .where(condition)
      .orderBy(desc(activityLog.id))
      .limit(limit)
      .all();
    return rows.map((row) => this._mapRow(row));
  }

  getByAgent(agentId: string, limit: number = 50, projectId?: string): ActivityEntry[] {
    this.flush();
    const conditions = [eq(activityLog.agentId, agentId)];
    if (projectId) conditions.push(eq(activityLog.projectId, projectId));
    const rows = this.db.drizzle
      .select()
      .from(activityLog)
      .where(and(...conditions))
      .orderBy(desc(activityLog.id))
      .limit(limit)
      .all();
    return rows.map((row) => this._mapRow(row));
  }

  getByType(actionType: ActionType, limit: number = 50, projectId?: string): ActivityEntry[] {
    this.flush();
    const conditions = [eq(activityLog.actionType, actionType)];
    if (projectId) conditions.push(eq(activityLog.projectId, projectId));
    const rows = this.db.drizzle
      .select()
      .from(activityLog)
      .where(and(...conditions))
      .orderBy(desc(activityLog.id))
      .limit(limit)
      .all();
    return rows.map((row) => this._mapRow(row));
  }

  getSince(timestamp: string, projectId?: string, limit = 10_000): ActivityEntry[] {
    this.flush();
    const conditions = [gt(activityLog.timestamp, timestamp)];
    if (projectId) conditions.push(eq(activityLog.projectId, projectId));
    const rows = this.db.drizzle
      .select()
      .from(activityLog)
      .where(and(...conditions))
      .orderBy(asc(activityLog.id))
      .limit(limit)
      .all();
    return rows.map((row) => this._mapRow(row));
  }

  getSummary(projectId?: string): {
    totalActions: number;
    byAgent: Record<string, number>;
    byType: Record<string, number>;
    recentFiles: string[];
  } {
    this.flush();
    const projectFilter = projectId ? eq(activityLog.projectId, projectId) : undefined;

    const totalRow = this.db.drizzle
      .select({ count: sql<number>`count(*)` })
      .from(activityLog)
      .where(projectFilter)
      .get();
    const totalActions = totalRow?.count ?? 0;

    const agentRows = this.db.drizzle
      .select({ agentId: activityLog.agentId, count: sql<number>`count(*)` })
      .from(activityLog)
      .where(projectFilter)
      .groupBy(activityLog.agentId)
      .all();
    const byAgent: Record<string, number> = {};
    for (const row of agentRows) {
      byAgent[row.agentId] = row.count;
    }

    const typeRows = this.db.drizzle
      .select({ actionType: activityLog.actionType, count: sql<number>`count(*)` })
      .from(activityLog)
      .where(projectFilter)
      .groupBy(activityLog.actionType)
      .all();
    const byType: Record<string, number> = {};
    for (const row of typeRows) {
      byType[row.actionType] = row.count;
    }

    const fileConditions = [inArray(activityLog.actionType, ['file_edit', 'file_read'])];
    if (projectFilter) fileConditions.push(projectFilter);
    const fileRows = this.db.drizzle
      .select({ details: activityLog.details })
      .from(activityLog)
      .where(and(...fileConditions))
      .orderBy(desc(activityLog.id))
      .limit(50)
      .all();
    const recentFiles: string[] = [];
    const seen = new Set<string>();
    for (const row of fileRows) {
      try {
        const parsed = JSON.parse(row.details ?? '{}');
        const file = parsed.file ?? parsed.path;
        if (file && !seen.has(file)) {
          seen.add(file);
          recentFiles.push(file);
        }
      } catch (err) {
        logger.debug('activity', 'Failed to parse activity details JSON', { error: (err as Error).message });
      }
    }

    return { totalActions, byAgent, byType, recentFiles };
  }

  prune(keepCount: number = 10000): number {
    this.flush();
    const result = this.db.drizzle
      .delete(activityLog)
      .where(sql`${activityLog.id} NOT IN (SELECT id FROM ${activityLog} ORDER BY id DESC LIMIT ${keepCount})`)
      .run();
    this._version++;
    return result.changes;
  }

  /** Remove entries older than the given number of days */
  pruneByAge(maxAgeDays: number = 7): number {
    this.flush();
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db.drizzle
      .delete(activityLog)
      .where(lte(activityLog.timestamp, cutoff))
      .run();
    if (result.changes > 0) this._version++;
    return result.changes;
  }

  private _mapRow(row: any): ActivityEntry {
    let details: Record<string, any> = {};
    try {
      details = JSON.parse(row.details ?? '{}');
    } catch (err) {
      logger.debug('activity', 'Failed to parse activity row details', { error: (err as Error).message });
      details = {};
    }
    return {
      id: row.id,
      agentId: row.agentId,
      agentRole: row.agentRole,
      actionType: row.actionType as ActionType,
      summary: row.summary,
      details,
      timestamp: row.timestamp,
      projectId: row.projectId ?? '',
    };
  }

  /** Get all activity entries up to (inclusive) a given timestamp */
  getUntil(timestamp: string, projectId?: string, limit = 500): ActivityEntry[] {
    this.flush();
    const conditions = [lte(activityLog.timestamp, timestamp)];
    if (projectId) conditions.push(eq(activityLog.projectId, projectId));
    const rows = this.db.drizzle
      .select()
      .from(activityLog)
      .where(and(...conditions))
      .orderBy(asc(activityLog.id))
      .limit(limit)
      .all();
    return rows.map((row) => this._mapRow(row));
  }
}
