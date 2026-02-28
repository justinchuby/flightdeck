import BetterSqlite3 from 'better-sqlite3';

const SCHEMA = `
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
  built_in INTEGER DEFAULT 0,
  model TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS file_locks (
  file_path TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  reason TEXT DEFAULT '',
  acquired_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  action_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  details TEXT DEFAULT '{}',
  timestamp TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_agent ON activity_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_log(action_type);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  lead_id TEXT,
  title TEXT NOT NULL,
  rationale TEXT DEFAULT '',
  needs_confirmation INTEGER DEFAULT 0,
  status TEXT DEFAULT 'recorded',
  confirmed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);
CREATE INDEX IF NOT EXISTS idx_decisions_needs_confirmation ON decisions(needs_confirmation);
CREATE INDEX IF NOT EXISTS idx_decisions_lead_id ON decisions(lead_id);

CREATE TABLE IF NOT EXISTS agent_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_memory_lead ON agent_memory(lead_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_agent ON agent_memory(agent_id);

CREATE TABLE IF NOT EXISTS chat_groups (
  name TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (name, lead_id)
);

CREATE TABLE IF NOT EXISTS chat_group_members (
  group_name TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  added_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (group_name, lead_id, agent_id)
);

CREATE TABLE IF NOT EXISTS chat_group_messages (
  id TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  from_agent_id TEXT NOT NULL,
  from_role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_group_messages_group ON chat_group_messages(group_name, lead_id);

CREATE TABLE IF NOT EXISTS dag_tasks (
  id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  role TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  files TEXT DEFAULT '[]',
  depends_on TEXT DEFAULT '[]',
  dag_status TEXT DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  model TEXT,
  assigned_agent_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  PRIMARY KEY (id, lead_id)
);
CREATE INDEX IF NOT EXISTS idx_dag_tasks_lead ON dag_tasks(lead_id);
CREATE INDEX IF NOT EXISTS idx_dag_tasks_status ON dag_tasks(dag_status);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_file_locks_agent ON file_locks(agent_id);
CREATE INDEX IF NOT EXISTS idx_conversations_agent ON conversations(agent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memory_unique ON agent_memory(lead_id, agent_id, key);
`;

export class Database {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** Run lightweight migrations for schema changes on existing DBs */
  private migrate(): void {
    // Add model column to roles table if missing
    try {
      const cols = this.db.prepare("PRAGMA table_info('roles')").all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'model')) {
        this.db.exec('ALTER TABLE roles ADD COLUMN model TEXT');
      }
    } catch (err) {
      console.warn('Migration warning (roles.model):', (err as Error).message);
    }
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

  /** Get a setting value from the settings table */
  getSetting(key: string): string | undefined {
    const row = this.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return row?.value;
  }

  /** Set a setting value in the settings table (upsert) */
  setSetting(key: string, value: string): void {
    this.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }
}
