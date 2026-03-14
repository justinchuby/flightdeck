/**
 * SharedMemory — multi-agent knowledge sharing within a project.
 *
 * Wraps KnowledgeStore with agent-attribution, deduplication, and
 * access control. Agents publish discoveries that benefit the whole crew.
 * Knowledge is project-scoped: all agents in a project share one pool.
 *
 * Design: entries are stored with a `shared:` key prefix and source
 * agent tracked in metadata. When multiple agents discover the same
 * thing, entries are merged (confidence boosted, contributors accumulated).
 */
import type { KnowledgeStore } from './KnowledgeStore.js';
import { sanitizeContent } from './KnowledgeInjector.js';
import type {
  KnowledgeEntry,
  KnowledgeCategory,
  KnowledgeMetadata,
} from './types.js';

// ── Types ──────────────────────────────────────────────────────────

export interface SharedEntry {
  category: KnowledgeCategory;
  key: string;
  content: string;
  confidence?: number;
  tags?: string[];
}

export interface ShareResult {
  created: number;
  merged: number;
  entries: KnowledgeEntry[];
}

export interface SharedQueryOptions {
  category?: KnowledgeCategory;
  limit?: number;
  /** Include own contributions (default: false) */
  includeSelf?: boolean;
}

export interface CrewInsight {
  totalEntries: number;
  contributors: string[];
  byCategory: Record<string, number>;
  entries: KnowledgeEntry[];
}

export interface ContributorStats {
  agentId: string;
  entryCount: number;
  categories: Record<string, number>;
}

/** Callback invoked when new shared knowledge is published */
export type SharedMemoryListener = (
  projectId: string,
  agentId: string,
  entry: KnowledgeEntry,
) => void;

// ── Helpers ────────────────────────────────────────────────────────

const SHARED_PREFIX = 'shared.';

function sharedKey(userKey: string): string {
  return `${SHARED_PREFIX}${userKey}`;
}

function isSharedKey(key: string): boolean {
  return key.startsWith(SHARED_PREFIX);
}

function _userKey(key: string): string {
  return key.startsWith(SHARED_PREFIX) ? key.slice(SHARED_PREFIX.length) : key;
}

function parseContributors(metadata: KnowledgeMetadata | null): string[] {
  if (!metadata?.contributors) return [];
  return Array.isArray(metadata.contributors) ? metadata.contributors as string[] : [];
}

// ── SharedMemory ───────────────────────────────────────────────────

export class SharedMemory {
  private listeners: SharedMemoryListener[] = [];

  constructor(private readonly store: KnowledgeStore) {}

  /**
   * Publish knowledge entries for the crew.
   * Deduplicates by key: if another agent already shared the same key,
   * the entry is merged (confidence boosted, contributor list updated).
   */
  share(
    projectId: string,
    agentId: string,
    entries: SharedEntry[],
  ): ShareResult {
    let created = 0;
    let merged = 0;
    const result: KnowledgeEntry[] = [];

    for (const entry of entries) {
      const key = sharedKey(entry.key);
      const sanitized = sanitizeContent(entry.content);
      const existing = this.store.get(projectId, entry.category, key);

      if (existing) {
        // Merge: add this agent as contributor, boost confidence
        const existingContributors = parseContributors(existing.metadata);
        const contributors = existingContributors.includes(agentId)
          ? existingContributors
          : [...existingContributors, agentId];

        const existingConfidence = existing.metadata?.confidence ?? 0.5;
        const newConfidence = Math.min(1.0, existingConfidence + 0.1);

        const mergedTags = Array.from(new Set([
          ...(existing.metadata?.tags ?? []),
          ...(entry.tags ?? []),
        ]));

        const updated = this.store.put(projectId, entry.category, key, sanitized, {
          ...existing.metadata,
          source: existing.metadata?.source ?? agentId,
          contributors,
          confidence: newConfidence,
          tags: mergedTags.length > 0 ? mergedTags : undefined,
          lastContributor: agentId,
        });
        result.push(updated);
        merged++;
      } else {
        // New entry
        const created_entry = this.store.put(projectId, entry.category, key, sanitized, {
          source: agentId,
          contributors: [agentId],
          confidence: entry.confidence ?? 0.5,
          tags: entry.tags,
          lastContributor: agentId,
        });
        result.push(created_entry);
        created++;

        // Notify listeners of new shared knowledge
        for (const listener of this.listeners) {
          try { listener(projectId, agentId, created_entry); } catch { /* non-critical */ }
        }
      }
    }

    return { created, merged, entries: result };
  }

  /**
   * Get shared knowledge, optionally excluding the requesting agent's
   * own contributions (default: exclude self).
   */
  getSharedKnowledge(
    projectId: string,
    agentId: string,
    options?: SharedQueryOptions,
  ): KnowledgeEntry[] {
    const { category, limit, includeSelf = false } = options ?? {};

    let entries: KnowledgeEntry[];
    if (category) {
      entries = this.store.getByCategory(projectId, category);
    } else {
      entries = this.store.getAll(projectId);
    }

    // Filter to shared entries only
    entries = entries.filter(e => isSharedKey(e.key));

    // Exclude own contributions unless includeSelf is true
    if (!includeSelf) {
      entries = entries.filter(e => {
        const source = e.metadata?.source;
        return source !== agentId;
      });
    }

    // Apply limit
    if (limit && entries.length > limit) {
      // Sort by confidence desc, then recency
      entries.sort((a, b) => {
        const confDiff = (b.metadata?.confidence ?? 0) - (a.metadata?.confidence ?? 0);
        if (confDiff !== 0) return confDiff;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
      entries = entries.slice(0, limit);
    }

    return entries;
  }

  /**
   * Aggregated crew knowledge: all shared entries with contributor stats.
   */
  getCrewInsights(projectId: string): CrewInsight {
    const allEntries = this.store.getAll(projectId).filter(e => isSharedKey(e.key));
    const contributors = new Set<string>();
    const byCategory: Record<string, number> = {};

    for (const entry of allEntries) {
      const entryContributors = parseContributors(entry.metadata);
      for (const c of entryContributors) contributors.add(c);
      if (entry.metadata?.source) contributors.add(entry.metadata.source as string);

      byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
    }

    return {
      totalEntries: allEntries.length,
      contributors: Array.from(contributors),
      byCategory,
      entries: allEntries,
    };
  }

  /**
   * Per-agent contribution statistics.
   */
  getContributorStats(projectId: string): ContributorStats[] {
    const allEntries = this.store.getAll(projectId).filter(e => isSharedKey(e.key));
    const statsMap = new Map<string, { entryCount: number; categories: Record<string, number> }>();

    for (const entry of allEntries) {
      const agentId = entry.metadata?.source as string | undefined;
      if (!agentId) continue;

      if (!statsMap.has(agentId)) {
        statsMap.set(agentId, { entryCount: 0, categories: {} });
      }
      const stats = statsMap.get(agentId)!;
      stats.entryCount++;
      stats.categories[entry.category] = (stats.categories[entry.category] ?? 0) + 1;
    }

    return Array.from(statsMap.entries()).map(([agentId, stats]) => ({
      agentId,
      ...stats,
    }));
  }

  /**
   * Delete an agent's own shared entry. Returns false if the entry
   * doesn't exist or was contributed by a different agent.
   */
  deleteOwnEntry(
    projectId: string,
    agentId: string,
    category: KnowledgeCategory,
    key: string,
  ): boolean {
    const fullKey = sharedKey(key);
    const existing = this.store.get(projectId, category, fullKey);
    if (!existing) return false;

    // Access control: only the original source can delete
    if (existing.metadata?.source !== agentId) return false;

    return this.store.delete(projectId, category, fullKey);
  }

  /**
   * Register a listener for new shared knowledge events.
   */
  onShare(listener: SharedMemoryListener): void {
    this.listeners.push(listener);
  }

  /**
   * Remove a previously registered listener.
   */
  offShare(listener: SharedMemoryListener): void {
    this.listeners = this.listeners.filter(l => l !== listener);
  }
}
