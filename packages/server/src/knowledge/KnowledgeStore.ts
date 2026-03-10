import { eq, and, sql, desc } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { knowledge } from '../db/schema.js';
import type { KnowledgeEntry, KnowledgeCategory, KnowledgeMetadata, SearchOptions, ScoredKnowledgeEntry } from './types.js';
import { KNOWLEDGE_CATEGORIES } from './types.js';
import { sanitizeContent } from './sanitize.js';
import { logger } from '../utils/logger.js';

/**
 * KnowledgeStore — CRUD + FTS5 full-text search for per-project knowledge.
 *
 * Uses Drizzle ORM for regular CRUD and raw SQL for FTS5 queries
 * (Drizzle doesn't support virtual tables natively).
 *
 * Knowledge is organized into 4 categories:
 * - core: Agent identity, user preferences, project rules (written once)
 * - episodic: Session summaries, milestones, key decisions (auto-captured)
 * - procedural: Learned patterns, corrections, how-to (from user feedback)
 * - semantic: Facts, entity relationships, technical context (extracted)
 */
export class KnowledgeStore {
  constructor(private db: Database) {}

  /**
   * Upsert a knowledge entry.
   * If (projectId, category, key) already exists, updates content + metadata.
   */
  put(
    projectId: string,
    category: KnowledgeCategory,
    key: string,
    content: string,
    metadata?: KnowledgeMetadata,
  ): KnowledgeEntry {
    this.validateCategory(category);
    validateKey(key);

    // Write-boundary sanitization: strip control chars, injection patterns,
    // and XML boundary escapes before storing. Defense-in-depth with
    // read-time sanitization in KnowledgeInjector.
    const sanitized = sanitizeContent(content);

    const metadataJson = metadata ? JSON.stringify(metadata) : null;
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    const result = this.db.drizzle
      .insert(knowledge)
      .values({
        projectId,
        category,
        key,
        content: sanitized,
        metadata: metadataJson,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [knowledge.projectId, knowledge.category, knowledge.key],
        set: {
          content: sanitized,
          metadata: metadataJson,
          updatedAt: now,
        },
      })
      .returning()
      .get();

    logger.debug({ module: 'project', msg: 'Knowledge entry upserted', projectId, category, key });
    return this.rowToEntry(result);
  }

  /** Get a specific knowledge entry by (projectId, category, key). */
  get(projectId: string, category: KnowledgeCategory, key: string): KnowledgeEntry | undefined {
    const row = this.db.drizzle
      .select()
      .from(knowledge)
      .where(
        and(
          eq(knowledge.projectId, projectId),
          eq(knowledge.category, category),
          eq(knowledge.key, key),
        ),
      )
      .get();

    return row ? this.rowToEntry(row) : undefined;
  }

  /** Get all knowledge entries for a project in a specific category. */
  getByCategory(projectId: string, category: KnowledgeCategory): KnowledgeEntry[] {
    this.validateCategory(category);

    const rows = this.db.drizzle
      .select()
      .from(knowledge)
      .where(
        and(
          eq(knowledge.projectId, projectId),
          eq(knowledge.category, category),
        ),
      )
      .orderBy(desc(knowledge.updatedAt))
      .all();

    return rows.map((r) => this.rowToEntry(r));
  }

  /** Get all knowledge entries for a project across all categories. */
  getAll(projectId: string): KnowledgeEntry[] {
    const rows = this.db.drizzle
      .select()
      .from(knowledge)
      .where(eq(knowledge.projectId, projectId))
      .orderBy(knowledge.category, desc(knowledge.updatedAt))
      .all();

    return rows.map((r) => this.rowToEntry(r));
  }

  /**
   * Full-text search using FTS5.
   * Returns entries ranked by relevance (BM25 scoring).
   */
  search(projectId: string, query: string, options?: SearchOptions): KnowledgeEntry[] {
    if (!query.trim()) return [];
    const limit = options?.limit ?? 20;
    const category = options?.category;
    const ftsQuery = sanitizeFts5Query(query);

    let results: Array<{ id: number }>;
    if (category) {
      results = this.db.all<{ id: number }>(
        `SELECT k.id FROM knowledge k
         JOIN knowledge_fts fts ON k.id = fts.rowid
         WHERE knowledge_fts MATCH ?
           AND k.project_id = ?
           AND k.category = ?
         ORDER BY bm25(knowledge_fts)
         LIMIT ?`,
        [ftsQuery, projectId, category, limit],
      );
    } else {
      results = this.db.all<{ id: number }>(
        `SELECT k.id FROM knowledge k
         JOIN knowledge_fts fts ON k.id = fts.rowid
         WHERE knowledge_fts MATCH ?
           AND k.project_id = ?
         ORDER BY bm25(knowledge_fts)
         LIMIT ?`,
        [ftsQuery, projectId, limit],
      );
    }

    if (results.length === 0) return [];

    // Fetch full rows by ID
    const ids = results.map((r) => r.id);
    const rows = this.db.drizzle
      .select()
      .from(knowledge)
      .where(
        and(
          eq(knowledge.projectId, projectId),
          sql`${knowledge.id} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`,
        ),
      )
      .all();

    // Preserve FTS5 rank ordering
    const rowMap = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => rowMap.get(id)).filter(Boolean).map((r) => this.rowToEntry(r!));
  }

  /**
   * Full-text search returning entries with BM25 scores.
   * Lower BM25 score = more relevant (SQLite FTS5 convention).
   */
  searchWithScores(projectId: string, query: string, options?: SearchOptions): ScoredKnowledgeEntry[] {
    if (!query.trim()) return [];
    const limit = options?.limit ?? 20;
    const category = options?.category;
    const ftsQuery = sanitizeFts5Query(query);

    let results: Array<{ id: number; score: number }>;
    if (category) {
      results = this.db.all<{ id: number; score: number }>(
        `SELECT k.id, bm25(knowledge_fts) AS score FROM knowledge k
         JOIN knowledge_fts fts ON k.id = fts.rowid
         WHERE knowledge_fts MATCH ?
           AND k.project_id = ?
           AND k.category = ?
         ORDER BY bm25(knowledge_fts)
         LIMIT ?`,
        [ftsQuery, projectId, category, limit],
      );
    } else {
      results = this.db.all<{ id: number; score: number }>(
        `SELECT k.id, bm25(knowledge_fts) AS score FROM knowledge k
         JOIN knowledge_fts fts ON k.id = fts.rowid
         WHERE knowledge_fts MATCH ?
           AND k.project_id = ?
         ORDER BY bm25(knowledge_fts)
         LIMIT ?`,
        [ftsQuery, projectId, limit],
      );
    }

    if (results.length === 0) return [];

    const scoreMap = new Map(results.map((r) => [r.id, r.score]));
    const ids = results.map((r) => r.id);
    const rows = this.db.drizzle
      .select()
      .from(knowledge)
      .where(
        and(
          eq(knowledge.projectId, projectId),
          sql`${knowledge.id} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`,
        ),
      )
      .all();

    const rowMap = new Map(rows.map((r) => [r.id, r]));
    return ids
      .map((id) => {
        const row = rowMap.get(id);
        if (!row) return null;
        return { ...this.rowToEntry(row), score: scoreMap.get(id) ?? 0 };
      })
      .filter(Boolean) as ScoredKnowledgeEntry[];
  }

  /** Delete a specific knowledge entry. Returns true if an entry was deleted. */
  delete(projectId: string, category: KnowledgeCategory, key: string): boolean {
    const result = this.db.drizzle
      .delete(knowledge)
      .where(
        and(
          eq(knowledge.projectId, projectId),
          eq(knowledge.category, category),
          eq(knowledge.key, key),
        ),
      )
      .run();

    return result.changes > 0;
  }

  /** Delete all knowledge for a project. Returns number of entries deleted. */
  deleteAll(projectId: string): number {
    const result = this.db.drizzle
      .delete(knowledge)
      .where(eq(knowledge.projectId, projectId))
      .run();

    return result.changes;
  }

  /** Count entries by project + optional category. */
  count(projectId: string, category?: KnowledgeCategory): number {
    if (category) {
      const row = this.db.drizzle
        .select({ count: sql<number>`count(*)` })
        .from(knowledge)
        .where(
          and(
            eq(knowledge.projectId, projectId),
            eq(knowledge.category, category),
          ),
        )
        .get();
      return row?.count ?? 0;
    }

    const row = this.db.drizzle
      .select({ count: sql<number>`count(*)` })
      .from(knowledge)
      .where(eq(knowledge.projectId, projectId))
      .get();
    return row?.count ?? 0;
  }

  private validateCategory(category: string): asserts category is KnowledgeCategory {
    if (!KNOWLEDGE_CATEGORIES.includes(category as KnowledgeCategory)) {
      throw new Error(`Invalid knowledge category '${category}'. Must be one of: ${KNOWLEDGE_CATEGORIES.join(', ')}`);
    }
  }

  private rowToEntry(row: typeof knowledge.$inferSelect): KnowledgeEntry {
    return {
      id: row.id,
      projectId: row.projectId,
      category: row.category as KnowledgeCategory,
      key: row.key,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

/**
 * Sanitize a user query for FTS5.
 * Splits into individual terms, quotes each to prevent syntax errors,
 * and joins with implicit AND (FTS5 default operator).
 * Multi-word queries like "React testing" match entries containing both words
 * anywhere (not just as an exact phrase).
 */
function sanitizeFts5Query(query: string): string {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
  return terms.join(' ') || '""';
}

/** Allowlist regex for knowledge keys — safe as filenames on all platforms. */
const VALID_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9_. -]*$/;

/**
 * Validate that a knowledge key is safe for use as a filename in sync paths.
 * Uses an allowlist approach — only alphanumeric, underscores, dots, hyphens, spaces.
 */
function validateKey(key: string): void {
  if (!key || !VALID_KEY_RE.test(key)) {
    throw new Error(`Invalid knowledge key '${key}': must match ${VALID_KEY_RE} (alphanumeric, _, ., -, space)`);
  }
}
