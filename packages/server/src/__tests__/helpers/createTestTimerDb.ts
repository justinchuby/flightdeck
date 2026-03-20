import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema.js';

/** Create an in-memory SQLite DB with the timers table for testing. */
export function createTestTimerDb() {
  const sqlite = new BetterSqlite3(':memory:');
  sqlite.exec(`CREATE TABLE timers (
    id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL,
    agent_role TEXT NOT NULL,
    lead_id TEXT,
    project_id TEXT,
    label TEXT NOT NULL,
    message TEXT NOT NULL,
    delay_seconds INTEGER NOT NULL,
    fire_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'pending',
    repeat INTEGER DEFAULT 0
  )`);
  return drizzle(sqlite, { schema });
}
