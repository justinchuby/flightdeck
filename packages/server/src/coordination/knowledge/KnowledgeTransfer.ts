/**
 * KnowledgeTransfer — Cross-project knowledge sharing.
 *
 * Agents can capture reusable patterns, pitfalls, tool tips, architecture
 * notes, and process learnings into a shared knowledge base.  Entries are
 * indexed in-memory and searchable by full-text keyword, category, project,
 * or tag.  `useCount` tracks how often an entry has been referenced so the
 * most valuable knowledge surfaces first.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type KnowledgeCategory = 'pattern' | 'pitfall' | 'tool' | 'architecture' | 'process';

export interface KnowledgeEntry {
  id: string;
  projectId: string;
  category: KnowledgeCategory;
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
  useCount: number;
}

// ── KnowledgeTransfer ─────────────────────────────────────────────────────────

export class KnowledgeTransfer {
  private entries: KnowledgeEntry[] = [];

  /**
   * Capture a new knowledge entry.
   * Automatically assigns a unique ID, timestamp, and useCount = 0.
   */
  capture(entry: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'useCount'>): KnowledgeEntry {
    const full: KnowledgeEntry = {
      ...entry,
      id: `kb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      createdAt: Date.now(),
      useCount: 0,
    };
    this.entries.push(full);
    return full;
  }

  /**
   * Full-text search across title, content, and tags.
   * All query terms must match (AND semantics).
   * Results are sorted by useCount descending (most popular first).
   */
  search(query: string): KnowledgeEntry[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    return this.entries
      .filter(e => {
        const text = `${e.title} ${e.content} ${e.tags.join(' ')}`.toLowerCase();
        return terms.every(t => text.includes(t));
      })
      .sort((a, b) => b.useCount - a.useCount);
  }

  /** Return all entries captured for a specific project */
  getByProject(projectId: string): KnowledgeEntry[] {
    return this.entries.filter(e => e.projectId === projectId);
  }

  /** Return all entries in a specific category */
  getByCategory(category: KnowledgeCategory): KnowledgeEntry[] {
    return this.entries.filter(e => e.category === category);
  }

  /** Return all entries that include the given tag */
  getByTag(tag: string): KnowledgeEntry[] {
    return this.entries.filter(e => e.tags.includes(tag));
  }

  /** Increment the use counter for an entry, marking it as referenced */
  recordUse(id: string): void {
    const entry = this.entries.find(e => e.id === id);
    if (entry) entry.useCount++;
  }

  /**
   * Return the most-referenced entries.
   * @param limit Maximum number of entries to return (default 10)
   */
  getPopular(limit: number = 10): KnowledgeEntry[] {
    return [...this.entries]
      .sort((a, b) => b.useCount - a.useCount)
      .slice(0, limit);
  }

  /** Return all entries (in insertion order) */
  getAll(): KnowledgeEntry[] {
    return [...this.entries];
  }

  /** Look up a single entry by ID */
  getEntry(id: string): KnowledgeEntry | undefined {
    return this.entries.find(e => e.id === id);
  }

  /** Total number of entries in the knowledge base */
  size(): number {
    return this.entries.length;
  }
}
