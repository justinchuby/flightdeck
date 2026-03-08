/**
 * MemoryCategoryManager — lifecycle rules for the 4-tier memory system.
 *
 * Wraps KnowledgeStore with category-specific policies:
 * - Core: read-only after setup, max 20 entries
 * - Episodic: auto-pruned by age (30 days) or count (100), newest kept
 * - Procedural: max 200 entries, user-confirmed
 * - Semantic: max 500 entries, deduplication via key matching
 *
 * See docs/research/per-user-project-knowledge.md for design rationale.
 */
import { KnowledgeStore } from './KnowledgeStore.js';
import type { KnowledgeCategory, KnowledgeEntry, KnowledgeMetadata } from './types.js';
import { KNOWLEDGE_CATEGORIES } from './types.js';

// ── Category Limits ─────────────────────────────────────────────────

export interface CategoryLimits {
  maxEntries: number;
  /** Whether entries can be modified after initial creation. */
  readOnlyAfterCreation: boolean;
  /** Max age in milliseconds for auto-pruning (undefined = no age limit). */
  maxAgeMs?: number;
}

export const DEFAULT_CATEGORY_LIMITS: Record<KnowledgeCategory, CategoryLimits> = {
  core: {
    maxEntries: 20,
    readOnlyAfterCreation: true,
  },
  episodic: {
    maxEntries: 100,
    readOnlyAfterCreation: false,
    maxAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
  procedural: {
    maxEntries: 200,
    readOnlyAfterCreation: false,
  },
  semantic: {
    maxEntries: 500,
    readOnlyAfterCreation: false,
  },
};

// ── Category Stats ──────────────────────────────────────────────────

export interface CategoryStats {
  category: KnowledgeCategory;
  count: number;
  maxEntries: number;
  readOnly: boolean;
}

// ── Prune Result ────────────────────────────────────────────────────

export interface PruneResult {
  removedByAge: number;
  removedByCount: number;
  totalRemoved: number;
}

// ── Manager ─────────────────────────────────────────────────────────

export class MemoryCategoryManager {
  private limits: Record<KnowledgeCategory, CategoryLimits>;

  constructor(
    private store: KnowledgeStore,
    limits?: Partial<Record<KnowledgeCategory, Partial<CategoryLimits>>>,
  ) {
    // Merge user-provided limits over defaults
    this.limits = { ...DEFAULT_CATEGORY_LIMITS };
    if (limits) {
      for (const cat of KNOWLEDGE_CATEGORIES) {
        if (limits[cat]) {
          this.limits[cat] = { ...DEFAULT_CATEGORY_LIMITS[cat], ...limits[cat] };
        }
      }
    }
  }

  /**
   * Store a memory entry, enforcing category-specific rules.
   *
   * - Core: rejects updates to existing entries (read-only after creation).
   * - All categories: enforces max entry count (oldest evicted first).
   * @throws Error if the category's rules are violated.
   */
  putMemory(
    projectId: string,
    category: KnowledgeCategory,
    key: string,
    content: string,
    metadata?: KnowledgeMetadata,
  ): KnowledgeEntry {
    const catLimits = this.limits[category];

    // Core read-only enforcement: reject updates to existing entries
    if (catLimits.readOnlyAfterCreation) {
      const existing = this.store.get(projectId, category, key);
      if (existing) {
        throw new Error(
          `Cannot update "${category}" memory "${key}": ` +
            `${category} entries are read-only after creation. Delete and recreate if needed.`,
        );
      }
    }

    // Enforce max entries — evict oldest if at capacity (before inserting)
    const currentCount = this.store.count(projectId, category);
    const isNewEntry = !this.store.get(projectId, category, key);
    if (isNewEntry && currentCount >= catLimits.maxEntries) {
      this.evictOldest(projectId, category, currentCount - catLimits.maxEntries + 1);
    }

    return this.store.put(projectId, category, key, content, metadata);
  }

  /**
   * Get memories for a project + category, with optional filtering.
   */
  getMemories(
    projectId: string,
    category: KnowledgeCategory,
    options?: { limit?: number },
  ): KnowledgeEntry[] {
    const entries = this.store.getByCategory(projectId, category);
    if (options?.limit && entries.length > options.limit) {
      return entries.slice(0, options.limit);
    }
    return entries;
  }

  /**
   * Prune episodic memories by age and count.
   * Removes entries older than maxAge, then trims to maxCount (keeping newest).
   */
  pruneEpisodic(
    projectId: string,
    maxAgeMs?: number,
    maxCount?: number,
  ): PruneResult {
    const catLimits = this.limits.episodic;
    const effectiveMaxAge = maxAgeMs ?? catLimits.maxAgeMs;
    const effectiveMaxCount = maxCount ?? catLimits.maxEntries;

    let removedByAge = 0;
    let removedByCount = 0;

    // Phase 1: Remove entries older than maxAge
    if (effectiveMaxAge !== undefined) {
      const cutoff = new Date(Date.now() - effectiveMaxAge).toISOString();
      const entries = this.store.getByCategory(projectId, 'episodic');
      for (const entry of entries) {
        if (entry.updatedAt < cutoff) {
          this.store.delete(projectId, 'episodic', entry.key);
          removedByAge++;
        }
      }
    }

    // Phase 2: Trim by count (keep newest, getByCategory returns desc by updatedAt)
    const remaining = this.store.getByCategory(projectId, 'episodic');
    if (remaining.length > effectiveMaxCount) {
      const toRemove = remaining.slice(effectiveMaxCount);
      for (const entry of toRemove) {
        this.store.delete(projectId, 'episodic', entry.key);
        removedByCount++;
      }
    }

    return {
      removedByAge,
      removedByCount,
      totalRemoved: removedByAge + removedByCount,
    };
  }

  /**
   * Get stats for all categories in a project.
   */
  getCategoryStats(projectId: string): CategoryStats[] {
    return KNOWLEDGE_CATEGORIES.map((category) => ({
      category,
      count: this.store.count(projectId, category),
      maxEntries: this.limits[category].maxEntries,
      readOnly: this.limits[category].readOnlyAfterCreation,
    }));
  }

  /**
   * Check if a category is read-only (entries cannot be updated after creation).
   */
  isReadOnly(category: KnowledgeCategory): boolean {
    return this.limits[category].readOnlyAfterCreation;
  }

  /**
   * Validate whether a memory can be stored in the given category.
   * Returns null if valid, or an error message string if invalid.
   */
  validateMemory(
    projectId: string,
    category: KnowledgeCategory,
    key: string,
    content: string,
  ): string | null {
    if (!KNOWLEDGE_CATEGORIES.includes(category)) {
      return `Invalid category "${category}". Must be one of: ${KNOWLEDGE_CATEGORIES.join(', ')}`;
    }

    if (!key || key.trim().length === 0) {
      return 'Memory key cannot be empty.';
    }

    if (!content || content.trim().length === 0) {
      return 'Memory content cannot be empty.';
    }

    const catLimits = this.limits[category];

    // Check read-only constraint
    if (catLimits.readOnlyAfterCreation) {
      const existing = this.store.get(projectId, category, key);
      if (existing) {
        return `Cannot update "${category}" memory "${key}": entries are read-only after creation.`;
      }
    }

    return null;
  }

  /**
   * Delete a memory entry. Core entries require explicit deletion.
   */
  deleteMemory(projectId: string, category: KnowledgeCategory, key: string): boolean {
    return this.store.delete(projectId, category, key);
  }

  /**
   * Get the configured limits for a category.
   */
  getLimits(category: KnowledgeCategory): CategoryLimits {
    return { ...this.limits[category] };
  }

  // ── Private helpers ─────────────────────────────────────────────

  /**
   * Evict the oldest entries in a category to make room for new ones.
   * Uses entry ID as a stable tiebreaker when timestamps are identical.
   */
  private evictOldest(projectId: string, category: KnowledgeCategory, count: number): void {
    const entries = this.store.getByCategory(projectId, category);
    // Sort by oldest first: updatedAt ASC, then id ASC as tiebreaker
    const sorted = [...entries].sort((a, b) => {
      const timeDiff = a.updatedAt.localeCompare(b.updatedAt);
      return timeDiff !== 0 ? timeDiff : a.id - b.id;
    });
    const toEvict = sorted.slice(0, count);
    for (const entry of toEvict) {
      this.store.delete(projectId, category, entry.key);
    }
  }
}
