import { eq, and, desc, like, sql } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { collectiveMemory } from '../db/schema.js';

// ── Types ────────────────────────────────────────────────────────────

export type MemoryCategory = 'pattern' | 'decision' | 'expertise' | 'gotcha';

export interface CollectiveMemoryEntry {
  id: number;
  category: MemoryCategory;
  key: string;
  value: string;
  source: string;
  createdAt: string;
  lastUsedAt: string;
  useCount: number;
}

function rowToEntry(row: typeof collectiveMemory.$inferSelect): CollectiveMemoryEntry {
  return {
    id: row.id,
    category: row.category as MemoryCategory,
    key: row.key,
    value: row.value,
    source: row.source,
    createdAt: row.createdAt!,
    lastUsedAt: row.lastUsedAt!,
    useCount: row.useCount!,
  };
}

// ── Class ────────────────────────────────────────────────────────────

export class CollectiveMemory {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /** Store a memory (upsert by category+key) */
  remember(category: MemoryCategory, key: string, value: string, sourceAgentId: string): CollectiveMemoryEntry {
    const existing = this.db.drizzle
      .select({ id: collectiveMemory.id })
      .from(collectiveMemory)
      .where(and(
        eq(collectiveMemory.category, category),
        eq(collectiveMemory.key, key),
      ))
      .get();

    if (existing) {
      this.db.drizzle
        .update(collectiveMemory)
        .set({
          value,
          source: sourceAgentId,
          lastUsedAt: sql`datetime('now')`,
          useCount: sql`use_count + 1`,
        })
        .where(eq(collectiveMemory.id, existing.id))
        .run();
      return this.getById(existing.id)!;
    }

    const result = this.db.drizzle
      .insert(collectiveMemory)
      .values({ category, key, value, source: sourceAgentId })
      .run();

    return this.getById(Number(result.lastInsertRowid))!;
  }

  /** Retrieve memories by category, optionally filtered by key prefix. Sorted by useCount desc. */
  recall(category: MemoryCategory, keyPrefix?: string): CollectiveMemoryEntry[] {
    const conditions = [eq(collectiveMemory.category, category)];
    if (keyPrefix) {
      conditions.push(like(collectiveMemory.key, `${keyPrefix}%`));
    }

    const rows = this.db.drizzle
      .select()
      .from(collectiveMemory)
      .where(and(...conditions))
      .orderBy(desc(collectiveMemory.useCount))
      .all();

    // Bump lastUsedAt for recalled entries
    const ids = rows.map(r => r.id);
    if (ids.length > 0) {
      for (const id of ids) {
        this.db.drizzle
          .update(collectiveMemory)
          .set({ lastUsedAt: sql`datetime('now')`, useCount: sql`use_count + 1` })
          .where(eq(collectiveMemory.id, id))
          .run();
      }
    }

    return rows.map(rowToEntry);
  }

  /** Retrieve all memories related to a file path (key contains the filepath) */
  recallForFile(filepath: string): CollectiveMemoryEntry[] {
    const rows = this.db.drizzle
      .select()
      .from(collectiveMemory)
      .where(like(collectiveMemory.key, `%${filepath}%`))
      .orderBy(desc(collectiveMemory.useCount))
      .all();

    return rows.map(rowToEntry);
  }

  /** Retrieve all memories across all categories, sorted by useCount desc */
  getAll(): CollectiveMemoryEntry[] {
    return this.db.drizzle
      .select()
      .from(collectiveMemory)
      .orderBy(desc(collectiveMemory.useCount))
      .all()
      .map(rowToEntry);
  }

  /** Remove memories not used in the last N days */
  prune(maxAgeDays: number): number {
    const result = this.db.drizzle
      .delete(collectiveMemory)
      .where(
        sql`julianday('now') - julianday(${collectiveMemory.lastUsedAt}) > ${maxAgeDays}`,
      )
      .run();
    return result.changes;
  }

  /** Remove a specific memory by id */
  forget(id: number): boolean {
    const result = this.db.drizzle
      .delete(collectiveMemory)
      .where(eq(collectiveMemory.id, id))
      .run();
    return result.changes > 0;
  }

  private getById(id: number): CollectiveMemoryEntry | undefined {
    const row = this.db.drizzle
      .select()
      .from(collectiveMemory)
      .where(eq(collectiveMemory.id, id))
      .get();
    return row ? rowToEntry(row) : undefined;
  }
}
