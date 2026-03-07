import type { KnowledgeEntry, KnowledgeCategory } from './types.js';
import type { HybridSearchEngine } from './HybridSearchEngine.js';
import { estimateTokens } from './HybridSearchEngine.js';
import type { MemoryCategoryManager } from './MemoryCategoryManager.js';

// ── Types ───────────────────────────────────────────────────────────

/** Context provided to the injector to select relevant knowledge. */
export interface InjectionContext {
  /** Current task description — used to search for relevant knowledge. */
  task?: string;
  /** Agent role (e.g., 'developer', 'architect') — used for relevance filtering. */
  role?: string;
  /** Recent messages to extract context from. */
  recentMessages?: string[];
  /** Override the default token budget (default: 1200). */
  tokenBudget?: number;
}

/** Result of knowledge injection. */
export interface InjectionResult {
  /** The formatted text block to inject into the prompt. */
  text: string;
  /** Total estimated tokens used. */
  totalTokens: number;
  /** Number of knowledge entries included. */
  entriesIncluded: number;
  /** Token breakdown by category. */
  breakdown: Record<KnowledgeCategory, number>;
}

/** An entry selected for injection with its token cost. */
interface SelectedEntry {
  entry: KnowledgeEntry;
  tokens: number;
}

// ── Constants ───────────────────────────────────────────────────────

/** Default token budget for the entire injection block. */
const DEFAULT_TOKEN_BUDGET = 1200;

/** Priority order for categories. Lower index = higher priority. */
const CATEGORY_PRIORITY: readonly KnowledgeCategory[] = [
  'core',
  'procedural',
  'semantic',
  'episodic',
] as const;

/** Maximum entries to retrieve per category when falling back to direct retrieval. */
const FALLBACK_LIMIT_PER_CATEGORY = 5;

/** Section header labels for each category. */
const SECTION_LABELS: Record<KnowledgeCategory, string> = {
  core: 'Project Rules',
  procedural: 'Corrections & Patterns',
  semantic: 'Architecture & Facts',
  episodic: 'Recent Context',
};

// ── KnowledgeInjector ───────────────────────────────────────────────

/**
 * KnowledgeInjector — selects and formats relevant knowledge for injection
 * into agent prompts, respecting a token budget.
 *
 * Priority: Core (always) > Procedural (task-relevant) > Semantic > Episodic.
 *
 * Uses HybridSearchEngine for task-relevant search when a query can be
 * built from context. Falls back to recency-based retrieval when search
 * is unavailable or no context is provided.
 */
export class KnowledgeInjector {
  constructor(
    private categoryManager: MemoryCategoryManager,
    private searchEngine?: HybridSearchEngine,
  ) {}

  /**
   * Select and format relevant knowledge for prompt injection.
   *
   * Returns a structured text block with category sections, fitted to
   * the token budget. Returns empty text if no knowledge exists.
   */
  injectKnowledge(projectId: string, context: InjectionContext = {}): InjectionResult {
    const budget = context.tokenBudget ?? DEFAULT_TOKEN_BUDGET;

    const selected = this.selectKnowledge(projectId, context, budget);
    const text = this.formatKnowledge(selected);

    const breakdown: Record<KnowledgeCategory, number> = {
      core: 0,
      procedural: 0,
      semantic: 0,
      episodic: 0,
    };
    let entriesIncluded = 0;

    for (const item of selected) {
      breakdown[item.entry.category] += item.tokens;
      entriesIncluded++;
    }

    const totalTokens = Object.values(breakdown).reduce((sum, t) => sum + t, 0);

    return { text, totalTokens, entriesIncluded, breakdown };
  }

  /**
   * Select knowledge entries within a token budget.
   *
   * Strategy:
   * 1. Always include Core entries first (identity, rules, preferences).
   * 2. Search Procedural for task-relevant corrections/patterns.
   * 3. Search Semantic for relevant facts.
   * 4. Fill remaining budget with recent Episodic entries.
   */
  selectKnowledge(
    projectId: string,
    context: InjectionContext,
    budget: number,
  ): SelectedEntry[] {
    const selected: SelectedEntry[] = [];
    let tokensUsed = 0;

    const addEntries = (entries: KnowledgeEntry[], maxTokens: number): void => {
      for (const entry of entries) {
        const tokens = estimateTokens(entry.content);
        if (tokensUsed + tokens > maxTokens) break;
        // Skip duplicates (same entry could appear in search + fallback)
        if (selected.some((s) => s.entry.id === entry.id)) continue;
        selected.push({ entry, tokens });
        tokensUsed += tokens;
      }
    };

    // 1. Core — always included (identity, rules, preferences)
    const coreEntries = this.categoryManager.getMemories(projectId, 'core');
    addEntries(coreEntries, budget);

    // 2. Procedural — task-relevant corrections and patterns
    const proceduralEntries = this.searchCategory(projectId, 'procedural', context);
    addEntries(proceduralEntries, budget);

    // 3. Semantic — task-relevant facts and relationships
    const semanticEntries = this.searchCategory(projectId, 'semantic', context);
    addEntries(semanticEntries, budget);

    // 4. Episodic — recent session context (no search, just recent)
    const episodicEntries = this.categoryManager.getMemories(projectId, 'episodic', {
      limit: FALLBACK_LIMIT_PER_CATEGORY,
    });
    addEntries(episodicEntries, budget);

    return selected;
  }

  /**
   * Format selected entries into a readable injection block.
   *
   * Groups entries by category and produces a structured text block
   * with section headers.
   */
  formatKnowledge(selected: SelectedEntry[]): string {
    if (selected.length === 0) return '';

    const byCategory = new Map<KnowledgeCategory, KnowledgeEntry[]>();
    for (const { entry } of selected) {
      const list = byCategory.get(entry.category) ?? [];
      list.push(entry);
      byCategory.set(entry.category, list);
    }

    const sections: string[] = [];

    // Emit sections in priority order
    for (const category of CATEGORY_PRIORITY) {
      const entries = byCategory.get(category);
      if (!entries?.length) continue;

      const label = SECTION_LABELS[category];
      const items = entries.map((e) => `- ${e.content}`).join('\n');
      sections.push(`[${label}]\n${items}`);
    }

    return `== Project Context ==\n\n${sections.join('\n\n')}`;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Search a category for relevant entries using HybridSearchEngine,
   * falling back to recency-based retrieval if search is unavailable.
   */
  private searchCategory(
    projectId: string,
    category: KnowledgeCategory,
    context: InjectionContext,
  ): KnowledgeEntry[] {
    const query = this.buildSearchQuery(context);

    if (query && this.searchEngine) {
      try {
        const results = this.searchEngine.search(projectId, query, {
          categories: [category],
          limit: FALLBACK_LIMIT_PER_CATEGORY,
          // Use a large token budget here — overall budget is enforced by selectKnowledge
          tokenBudget: DEFAULT_TOKEN_BUDGET,
        });
        if (results.length > 0) {
          return results.map((r) => r.entry);
        }
      } catch {
        // Search failed — fall through to direct retrieval
      }
    }

    // Fallback: retrieve most recent entries
    return this.categoryManager.getMemories(projectId, category, {
      limit: FALLBACK_LIMIT_PER_CATEGORY,
    });
  }

  /**
   * Build a search query from injection context.
   * Combines task description, role, and recent messages into a query string.
   */
  private buildSearchQuery(context: InjectionContext): string {
    const parts: string[] = [];

    if (context.task) {
      parts.push(context.task);
    }
    if (context.role) {
      parts.push(context.role);
    }
    if (context.recentMessages?.length) {
      // Take at most the last 2 messages to keep the query focused
      const recent = context.recentMessages.slice(-2);
      parts.push(...recent);
    }

    return parts.join(' ').trim();
  }
}
