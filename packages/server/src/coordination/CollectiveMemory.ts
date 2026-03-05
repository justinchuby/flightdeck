import { eq, and, desc, like, sql } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { collectiveMemory, utcNow } from '../db/schema.js';

// Escape LIKE wildcards to prevent pattern injection
function escapeLike(s: string): string {
  return s.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// ── Types ────────────────────────────────────────────────────────────

export type MemoryCategory = 'pattern' | 'decision' | 'expertise' | 'gotcha';

export interface CollectiveMemoryEntry {
  id: number;
  category: MemoryCategory;
  key: string;
  value: string;
  source: string;
  projectId: string;
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
    projectId: row.projectId ?? '',
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

  /** Store a memory (upsert by category+key+projectId) */
  remember(category: MemoryCategory, key: string, value: string, sourceAgentId: string, projectId = ''): CollectiveMemoryEntry {
    const existing = this.db.drizzle
      .select({ id: collectiveMemory.id })
      .from(collectiveMemory)
      .where(and(
        eq(collectiveMemory.category, category),
        eq(collectiveMemory.key, key),
        eq(collectiveMemory.projectId, projectId),
      ))
      .get();

    if (existing) {
      this.db.drizzle
        .update(collectiveMemory)
        .set({
          value,
          source: sourceAgentId,
          lastUsedAt: utcNow,
          useCount: sql`use_count + 1`,
        })
        .where(eq(collectiveMemory.id, existing.id))
        .run();
      return this.getById(existing.id)!;
    }

    const result = this.db.drizzle
      .insert(collectiveMemory)
      .values({ category, key, value, source: sourceAgentId, projectId })
      .run();

    return this.getById(Number(result.lastInsertRowid))!;
  }

  /** Retrieve memories by category, optionally filtered by key prefix and project. Sorted by useCount desc. */
  recall(category: MemoryCategory, keyPrefix?: string, projectId?: string): CollectiveMemoryEntry[] {
    const conditions = [eq(collectiveMemory.category, category)];
    if (keyPrefix) {
      conditions.push(like(collectiveMemory.key, `${escapeLike(keyPrefix)}%`));
    }
    if (projectId !== undefined) {
      conditions.push(eq(collectiveMemory.projectId, projectId));
    }

    const rows = this.db.drizzle
      .select()
      .from(collectiveMemory)
      .where(and(...conditions))
      .orderBy(desc(collectiveMemory.useCount))
      .all();

    // Bump lastUsedAt for recalled entries (batch update)
    const ids = rows.map(r => r.id);
    if (ids.length > 0) {
      this.db.drizzle
        .update(collectiveMemory)
        .set({ lastUsedAt: utcNow, useCount: sql`use_count + 1` })
        .where(sql`id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`)
        .run();
    }

    return rows.map(rowToEntry);
  }

  /** Retrieve all memories related to a file path (key contains the filepath) */
  recallForFile(filepath: string, projectId?: string): CollectiveMemoryEntry[] {
    const conditions = [like(collectiveMemory.key, `%${escapeLike(filepath)}%`)];
    if (projectId !== undefined) {
      conditions.push(eq(collectiveMemory.projectId, projectId));
    }

    const rows = this.db.drizzle
      .select()
      .from(collectiveMemory)
      .where(and(...conditions))
      .orderBy(desc(collectiveMemory.useCount))
      .all();

    return rows.map(rowToEntry);
  }

  /** Retrieve all memories across all categories, sorted by useCount desc */
  getAll(projectId?: string): CollectiveMemoryEntry[] {
    const condition = projectId !== undefined ? eq(collectiveMemory.projectId, projectId) : undefined;
    return this.db.drizzle
      .select()
      .from(collectiveMemory)
      .where(condition)
      .orderBy(desc(collectiveMemory.useCount))
      .all()
      .map(rowToEntry);
  }

  /** Remove memories not used in the last N days, optionally scoped to a project */
  prune(maxAgeDays: number, projectId?: string): number {
    const conditions = [
      sql`julianday('now') - julianday(${collectiveMemory.lastUsedAt}) > ${maxAgeDays}`,
    ];
    if (projectId !== undefined) {
      conditions.push(eq(collectiveMemory.projectId, projectId));
    }
    const result = this.db.drizzle
      .delete(collectiveMemory)
      .where(and(...conditions))
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
