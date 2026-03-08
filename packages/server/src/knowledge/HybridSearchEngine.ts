import type { KnowledgeStore } from './KnowledgeStore.js';
import type {
  KnowledgeEntry,
  KnowledgeCategory,
  ScoredKnowledgeEntry,
  HybridSearchOptions,
  FusedSearchResult,
  VectorSearchProvider,
} from './types.js';

/** Default RRF constant — standard value from the literature. */
const DEFAULT_RRF_K = 60;

/** Default token budget for knowledge injection. */
const DEFAULT_TOKEN_BUDGET = 1200;

/** Default max results. */
const DEFAULT_LIMIT = 10;

/** Rough chars-per-token estimate for English text. */
const CHARS_PER_TOKEN = 4;

/**
 * HybridSearchEngine — combines FTS5 keyword search with vector similarity
 * using Reciprocal Rank Fusion (RRF) to produce a single ranked result list.
 *
 * The vector search provider is optional — when absent, results come solely
 * from FTS5 (keyword search). When a VectorSearchProvider is supplied, both
 * sources are fused via RRF scoring.
 *
 * Results respect a configurable token budget (default 1200) to prevent
 * knowledge injection from bloating agent prompts.
 */
export class HybridSearchEngine {
  private vectorProvider: VectorSearchProvider | null;

  constructor(
    private store: KnowledgeStore,
    vectorProvider?: VectorSearchProvider,
  ) {
    this.vectorProvider = vectorProvider ?? null;
  }

  /** Replace or set the vector search provider at runtime. */
  setVectorProvider(provider: VectorSearchProvider | null): void {
    this.vectorProvider = provider;
  }

  /**
   * Hybrid search: FTS5 + vector → RRF fusion → token-budgeted results.
   *
   * Returns results ordered by fused relevance, truncated to fit
   * within the token budget.
   */
  search(projectId: string, query: string, options?: HybridSearchOptions): FusedSearchResult[] {
    const limit = options?.limit ?? DEFAULT_LIMIT;
    const tokenBudget = options?.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
    const rrfK = options?.rrfK ?? DEFAULT_RRF_K;
    const fts5Weight = options?.fts5Weight ?? 1.0;
    const vectorWeight = options?.vectorWeight ?? 1.0;
    const categories = options?.categories;

    // Fetch from both sources (over-fetch to allow for deduplication)
    const fetchLimit = limit * 3;

    // 1. FTS5 keyword search
    const fts5Results = this.fts5Search(projectId, query, fetchLimit, categories);

    // 2. Vector similarity search (empty if no provider)
    const vectorResults = this.vectorSearch(projectId, query, fetchLimit);

    // 3. Fuse with RRF
    const fused = fuseResults(fts5Results, vectorResults, {
      k: rrfK,
      fts5Weight,
      vectorWeight,
    });

    // 4. Filter by categories if specified
    const filtered = categories
      ? fused.filter((r) => categories.includes(r.entry.category))
      : fused;

    // 5. Apply token budget and limit
    return fitToBudget(filtered, tokenBudget, limit);
  }

  /**
   * FTS5 keyword search — wraps KnowledgeStore.searchWithScores.
   * Returns entries in BM25 rank order.
   */
  fts5Search(
    projectId: string,
    query: string,
    limit: number,
    categories?: KnowledgeCategory[],
  ): ScoredKnowledgeEntry[] {
    if (categories && categories.length === 1) {
      return this.store.searchWithScores(projectId, query, {
        limit,
        category: categories[0],
      });
    }

    // For multiple or no categories, search all and filter
    const results = this.store.searchWithScores(projectId, query, { limit });
    if (categories && categories.length > 0) {
      return results.filter((r) => categories.includes(r.category));
    }
    return results;
  }

  /**
   * Vector similarity search — delegates to the pluggable provider.
   * Returns empty if no provider is configured.
   */
  vectorSearch(projectId: string, query: string, limit: number): ScoredKnowledgeEntry[] {
    if (!this.vectorProvider) return [];
    try {
      return this.vectorProvider.search(projectId, query, limit);
    } catch {
      // Graceful degradation — vector failures shouldn't break search
      return [];
    }
  }
}

/**
 * Reciprocal Rank Fusion — combine ranked lists from multiple sources.
 *
 * Formula: `score(d) = Σ (weight_i / (k + rank_i(d)))` for each source i
 * where rank starts at 1 for the most relevant result.
 *
 * @param fts5Results - Results from FTS5 keyword search (ranked by BM25)
 * @param vectorResults - Results from vector similarity search (ranked by cosine)
 * @param options - RRF parameters
 */
export function fuseResults(
  fts5Results: ScoredKnowledgeEntry[],
  vectorResults: ScoredKnowledgeEntry[],
  options?: { k?: number; fts5Weight?: number; vectorWeight?: number },
): FusedSearchResult[] {
  const k = options?.k ?? DEFAULT_RRF_K;
  const fts5Weight = options?.fts5Weight ?? 1.0;
  const vectorWeight = options?.vectorWeight ?? 1.0;

  // Map of entry ID → accumulated RRF score + entry
  const scoreMap = new Map<number, { entry: KnowledgeEntry; score: number }>();

  // Add FTS5 contributions (already ordered by BM25 rank)
  for (let rank = 0; rank < fts5Results.length; rank++) {
    const entry = fts5Results[rank];
    const rrfScore = fts5Weight / (k + rank + 1); // rank is 1-based in RRF
    const existing = scoreMap.get(entry.id);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scoreMap.set(entry.id, { entry, score: rrfScore });
    }
  }

  // Add vector contributions
  for (let rank = 0; rank < vectorResults.length; rank++) {
    const entry = vectorResults[rank];
    const rrfScore = vectorWeight / (k + rank + 1);
    const existing = scoreMap.get(entry.id);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scoreMap.set(entry.id, { entry, score: rrfScore });
    }
  }

  // Sort by fused score (descending — higher is more relevant)
  const sorted = [...scoreMap.values()].sort((a, b) => b.score - a.score);

  return sorted.map(({ entry, score }) => ({
    entry,
    fusedScore: score,
    estimatedTokens: estimateTokens(entry.content),
  }));
}

/**
 * Fit results to a token budget. Greedily includes results until
 * the budget would be exceeded.
 */
export function fitToBudget(
  results: FusedSearchResult[],
  tokenBudget: number,
  maxResults: number,
): FusedSearchResult[] {
  const output: FusedSearchResult[] = [];
  let tokensUsed = 0;

  for (const result of results) {
    if (output.length >= maxResults) break;
    if (tokensUsed + result.estimatedTokens > tokenBudget && output.length > 0) break;
    output.push(result);
    tokensUsed += result.estimatedTokens;
  }

  return output;
}

/** Estimate token count from content string. Rough ~4 chars/token for English. */
export function estimateTokens(content: string): number {
  return Math.ceil(content.length / CHARS_PER_TOKEN);
}
