import BetterSqlite3 from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'queued',
  priority INTEGER DEFAULT 0,
  assigned_role TEXT,
  assigned_agent_id TEXT,
  parent_task_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_deps (
  task_id TEXT NOT NULL,
  depends_on TEXT NOT NULL,
  PRIMARY KEY (task_id, depends_on)
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  task_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  system_prompt TEXT DEFAULT '',
  color TEXT DEFAULT '#888',
  icon TEXT DEFAULT '🤖',
  built_in INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export class Database {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  run(sql: string, params?: any[]): BetterSqlite3.RunResult {
    const stmt = this.db.prepare(sql);
    return params ? stmt.run(...params) : stmt.run();
  }

  get<T = any>(sql: string, params?: any[]): T | undefined {
    const stmt = this.db.prepare(sql);
    return (params ? stmt.get(...params) : stmt.get()) as T | undefined;
  }

  all<T = any>(sql: string, params?: any[]): T[] {
    const stmt = this.db.prepare(sql);
    return (params ? stmt.all(...params) : stmt.all()) as T[];
  }

  close(): void {
    this.db.close();
  }
}
