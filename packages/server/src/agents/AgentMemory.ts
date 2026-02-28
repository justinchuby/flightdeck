import type { Database } from '../db/database.js';

export interface MemoryEntry {
  id: number;
  leadId: string;
  agentId: string;
  key: string;
  value: string;
  createdAt: string;
}

export class AgentMemory {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /** Store a fact about an agent under a lead's memory */
  store(leadId: string, agentId: string, key: string, value: string): void {
    // Upsert: if same lead+agent+key exists, update the value
    const existing = this.db.get<any>(
      'SELECT id FROM agent_memory WHERE lead_id = ? AND agent_id = ? AND key = ?',
      [leadId, agentId, key],
    );
    if (existing) {
      this.db.run(
        "UPDATE agent_memory SET value = ?, created_at = datetime('now') WHERE id = ?",
        [value, existing.id],
      );
    } else {
      this.db.run(
        'INSERT INTO agent_memory (lead_id, agent_id, key, value) VALUES (?, ?, ?, ?)',
        [leadId, agentId, key, value],
      );
    }
  }

  /** Get all memory entries for a lead */
  getByLead(leadId: string): MemoryEntry[] {
    return this.db
      .all<any>('SELECT * FROM agent_memory WHERE lead_id = ? ORDER BY created_at DESC', [leadId])
      .map(rowToEntry);
  }

  /** Get memory entries for a specific agent under a lead */
  getByAgent(leadId: string, agentId: string): MemoryEntry[] {
    return this.db
      .all<any>(
        'SELECT * FROM agent_memory WHERE lead_id = ? AND agent_id = ? ORDER BY created_at DESC',
        [leadId, agentId],
      )
      .map(rowToEntry);
  }

  /** Clear all memory for a lead */
  clearByLead(leadId: string): void {
    this.db.run('DELETE FROM agent_memory WHERE lead_id = ?', [leadId]);
  }
}

function rowToEntry(row: any): MemoryEntry {
  return {
    id: row.id,
    leadId: row.lead_id,
    agentId: row.agent_id,
    key: row.key,
    value: row.value,
    createdAt: row.created_at,
  };
}
