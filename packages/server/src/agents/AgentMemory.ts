import { eq, and, desc } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { agentMemory, utcNow } from '../db/schema.js';

export interface MemoryEntry {
  id: number;
  leadId: string;
  agentId: string;
  key: string;
  value: string;
  createdAt: string;
}

function rowToEntry(row: typeof agentMemory.$inferSelect): MemoryEntry {
  return {
    id: row.id,
    leadId: row.leadId,
    agentId: row.agentId,
    key: row.key,
    value: row.value,
    createdAt: row.createdAt!,
  };
}

export class AgentMemory {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /** Store a fact about an agent under a lead's memory */
  store(leadId: string, agentId: string, key: string, value: string): void {
    // Upsert: if same lead+agent+key exists, update the value
    const existing = this.db.drizzle
      .select({ id: agentMemory.id })
      .from(agentMemory)
      .where(and(
        eq(agentMemory.leadId, leadId),
        eq(agentMemory.agentId, agentId),
        eq(agentMemory.key, key),
      ))
      .get();
    if (existing) {
      this.db.drizzle
        .update(agentMemory)
        .set({ value, createdAt: utcNow })
        .where(eq(agentMemory.id, existing.id))
        .run();
    } else {
      this.db.drizzle
        .insert(agentMemory)
        .values({ leadId, agentId, key, value })
        .run();
    }
  }

  /** Get all memory entries for a lead */
  getByLead(leadId: string): MemoryEntry[] {
    return this.db.drizzle
      .select()
      .from(agentMemory)
      .where(eq(agentMemory.leadId, leadId))
      .orderBy(desc(agentMemory.createdAt))
      .all()
      .map(rowToEntry);
  }

  /** Get memory entries for a specific agent under a lead */
  getByAgent(leadId: string, agentId: string): MemoryEntry[] {
    return this.db.drizzle
      .select()
      .from(agentMemory)
      .where(and(eq(agentMemory.leadId, leadId), eq(agentMemory.agentId, agentId)))
      .orderBy(desc(agentMemory.createdAt))
      .all()
      .map(rowToEntry);
  }

  /** Clear all memory for a lead */
  clearByLead(leadId: string): void {
    this.db.drizzle.delete(agentMemory).where(eq(agentMemory.leadId, leadId)).run();
  }
}
