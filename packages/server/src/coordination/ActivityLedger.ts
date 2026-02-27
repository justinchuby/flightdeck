import { EventEmitter } from 'events';
import { Database } from '../db/database.js';

export type ActionType =
  | 'file_edit'
  | 'file_read'
  | 'decision_made'
  | 'task_started'
  | 'task_completed'
  | 'sub_agent_spawned'
  | 'agent_killed'
  | 'lock_acquired'
  | 'lock_released'
  | 'lock_denied'
  | 'message_sent'
  | 'delegated'
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

  constructor(db: Database) {
    super();
    this.db = db;
  }

  log(
    agentId: string,
    agentRole: string,
    actionType: ActionType,
    summary: string,
    details: Record<string, any> = {},
  ): ActivityEntry {
    const detailsJson = JSON.stringify(details);
    const result = this.db.run(
      'INSERT INTO activity_log (agent_id, agent_role, action_type, summary, details) VALUES (?, ?, ?, ?, ?)',
      [agentId, agentRole, actionType, summary, detailsJson],
    );
    const row = this.db.get(
      'SELECT * FROM activity_log WHERE id = ?',
      [result.lastInsertRowid],
    );
    const entry = this._mapRow(row);
    this.emit('activity', entry);
    return entry;
  }

  getRecent(limit: number = 50): ActivityEntry[] {
    const rows = this.db.all(
      'SELECT * FROM activity_log ORDER BY id DESC LIMIT ?',
      [limit],
    );
    return rows.map((row) => this._mapRow(row));
  }

  getByAgent(agentId: string, limit: number = 50): ActivityEntry[] {
    const rows = this.db.all(
      'SELECT * FROM activity_log WHERE agent_id = ? ORDER BY id DESC LIMIT ?',
      [agentId, limit],
    );
    return rows.map((row) => this._mapRow(row));
  }

  getByType(actionType: ActionType, limit: number = 50): ActivityEntry[] {
    const rows = this.db.all(
      'SELECT * FROM activity_log WHERE action_type = ? ORDER BY id DESC LIMIT ?',
      [actionType, limit],
    );
    return rows.map((row) => this._mapRow(row));
  }

  getSince(timestamp: string): ActivityEntry[] {
    const rows = this.db.all(
      'SELECT * FROM activity_log WHERE timestamp > ? ORDER BY id ASC',
      [timestamp],
    );
    return rows.map((row) => this._mapRow(row));
  }

  getSummary(): {
    totalActions: number;
    byAgent: Record<string, number>;
    byType: Record<string, number>;
    recentFiles: string[];
  } {
    const totalRow = this.db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM activity_log',
    );
    const totalActions = totalRow?.count ?? 0;

    const agentRows = this.db.all<{ agent_id: string; count: number }>(
      'SELECT agent_id, COUNT(*) as count FROM activity_log GROUP BY agent_id',
    );
    const byAgent: Record<string, number> = {};
    for (const row of agentRows) {
      byAgent[row.agent_id] = row.count;
    }

    const typeRows = this.db.all<{ action_type: string; count: number }>(
      'SELECT action_type, COUNT(*) as count FROM activity_log GROUP BY action_type',
    );
    const byType: Record<string, number> = {};
    for (const row of typeRows) {
      byType[row.action_type] = row.count;
    }

    const fileRows = this.db.all<{ details: string }>(
      "SELECT details FROM activity_log WHERE action_type IN ('file_edit', 'file_read') ORDER BY id DESC LIMIT 50",
    );
    const recentFiles: string[] = [];
    const seen = new Set<string>();
    for (const row of fileRows) {
      try {
        const parsed = JSON.parse(row.details);
        const file = parsed.file ?? parsed.path;
        if (file && !seen.has(file)) {
          seen.add(file);
          recentFiles.push(file);
        }
      } catch {
        // skip malformed JSON
      }
    }

    return { totalActions, byAgent, byType, recentFiles };
  }

  prune(keepCount: number = 10000): void {
    this.db.run(
      'DELETE FROM activity_log WHERE id NOT IN (SELECT id FROM activity_log ORDER BY id DESC LIMIT ?)',
      [keepCount],
    );
  }

  private _mapRow(row: any): ActivityEntry {
    let details: Record<string, any> = {};
    try {
      details = JSON.parse(row.details ?? '{}');
    } catch {
      details = {};
    }
    return {
      id: row.id,
      agentId: row.agent_id,
      agentRole: row.agent_role,
      actionType: row.action_type as ActionType,
      summary: row.summary,
      details,
      timestamp: row.timestamp,
    };
  }
}
