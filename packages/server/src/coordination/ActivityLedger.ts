import { EventEmitter } from 'events';
import { eq, desc, asc, gt, sql, inArray } from 'drizzle-orm';
import { Database } from '../db/database.js';
import { activityLog } from '../db/schema.js';
import { logger } from '../utils/logger.js';

export type ActionType =
  | 'file_edit'
  | 'file_read'
  | 'decision_made'
  | 'task_started'
  | 'task_completed'
  | 'sub_agent_spawned'
  | 'agent_killed'
  | 'agent_terminated'
  | 'lock_acquired'
  | 'lock_released'
  | 'lock_denied'
  | 'message_sent'
  | 'delegated'
  | 'delegation_cancelled'
  | 'heartbeat_halted'
  | 'limit_change_requested'
  | 'deferred_issue'
  | 'error';

export interface ActivityEntry {
  id: number;
  agentId: string;
  agentRole: string;
  actionType: ActionType;
  summary: string;
  details: Record<string, any>;
  timestamp: string;
}

export class ActivityLedger extends EventEmitter {
  private db: Database;
  private buffer: Array<{ agentId: string; agentRole: string; actionType: string; summary: string; details: string }> = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly FLUSH_INTERVAL_MS = 250;
  private readonly FLUSH_BATCH_SIZE = 64;

  constructor(db: Database) {
    super();
    this.db = db;
    this.flushTimer = setInterval(() => this.flush(), this.FLUSH_INTERVAL_MS);
  }

  log(
    agentId: string,
    agentRole: string,
    actionType: ActionType,
    summary: string,
    details: Record<string, any> = {},
  ): ActivityEntry {
    const detailsJson = JSON.stringify(details);
    this.buffer.push({ agentId, agentRole, actionType, summary, details: detailsJson });
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

  getRecent(limit: number = 50): ActivityEntry[] {
    this.flush();
    const rows = this.db.drizzle
      .select()
      .from(activityLog)
      .orderBy(desc(activityLog.id))
      .limit(limit)
      .all();
    return rows.map((row) => this._mapRow(row));
  }

  getByAgent(agentId: string, limit: number = 50): ActivityEntry[] {
    this.flush();
    const rows = this.db.drizzle
      .select()
      .from(activityLog)
      .where(eq(activityLog.agentId, agentId))
      .orderBy(desc(activityLog.id))
      .limit(limit)
      .all();
    return rows.map((row) => this._mapRow(row));
  }

  getByType(actionType: ActionType, limit: number = 50): ActivityEntry[] {
    this.flush();
    const rows = this.db.drizzle
      .select()
      .from(activityLog)
      .where(eq(activityLog.actionType, actionType))
      .orderBy(desc(activityLog.id))
      .limit(limit)
      .all();
    return rows.map((row) => this._mapRow(row));
  }

  getSince(timestamp: string): ActivityEntry[] {
    this.flush();
    const rows = this.db.drizzle
      .select()
      .from(activityLog)
      .where(gt(activityLog.timestamp, timestamp))
      .orderBy(asc(activityLog.id))
      .all();
    return rows.map((row) => this._mapRow(row));
  }

  getSummary(): {
    totalActions: number;
    byAgent: Record<string, number>;
    byType: Record<string, number>;
    recentFiles: string[];
  } {
    this.flush();
    const totalRow = this.db.drizzle
      .select({ count: sql<number>`count(*)` })
      .from(activityLog)
      .get();
    const totalActions = totalRow?.count ?? 0;

    const agentRows = this.db.drizzle
      .select({ agentId: activityLog.agentId, count: sql<number>`count(*)` })
      .from(activityLog)
      .groupBy(activityLog.agentId)
      .all();
    const byAgent: Record<string, number> = {};
    for (const row of agentRows) {
      byAgent[row.agentId] = row.count;
    }

    const typeRows = this.db.drizzle
      .select({ actionType: activityLog.actionType, count: sql<number>`count(*)` })
      .from(activityLog)
      .groupBy(activityLog.actionType)
      .all();
    const byType: Record<string, number> = {};
    for (const row of typeRows) {
      byType[row.actionType] = row.count;
    }

    const fileRows = this.db.drizzle
      .select({ details: activityLog.details })
      .from(activityLog)
      .where(inArray(activityLog.actionType, ['file_edit', 'file_read']))
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

  prune(keepCount: number = 10000): void {
    this.flush();
    this.db.run(
      'DELETE FROM activity_log WHERE id NOT IN (SELECT id FROM activity_log ORDER BY id DESC LIMIT ?)',
      [keepCount],
    );
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
    };
  }
}
