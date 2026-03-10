import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Database } from '../../db/database.js';
import { KnowledgeStore } from '../KnowledgeStore.js';
import { HybridSearchEngine, fuseResults, fitToBudget, estimateTokens } from '../HybridSearchEngine.js';
import type { ScoredKnowledgeEntry, VectorSearchProvider, FusedSearchResult, KnowledgeEntry } from '../types.js';

// ── Helper: create a mock ScoredKnowledgeEntry ──────────────────────

function mockEntry(overrides: Partial<ScoredKnowledgeEntry> & { id: number; key: string }): ScoredKnowledgeEntry {
  return {
    projectId: 'test-proj',
    category: 'semantic',
    content: `Content for ${overrides.key}`,
    metadata: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    score: 0,
    ...overrides,
  };
}

// ── Unit tests: fuseResults (pure function) ─────────────────────────

describe('fuseResults', () => {
  it('ranks entries from a single source by RRF score', () => {
    const fts5: ScoredKnowledgeEntry[] = [
      mockEntry({ id: 1, key: 'a', score: -5.0 }),
      mockEntry({ id: 2, key: 'b', score: -3.0 }),
      mockEntry({ id: 3, key: 'c', score: -1.0 }),
    ];

    const results = fuseResults(fts5, []);
    expect(results).toHaveLength(3);
    // First entry gets rank 1 → 1/(60+1) = highest score
    expect(results[0].entry.key).toBe('a');
    expect(results[1].entry.key).toBe('b');
    expect(results[2].entry.key).toBe('c');
  });

  it('fuses two sources — entry in both gets boosted', () => {
    const fts5: ScoredKnowledgeEntry[] = [
      mockEntry({ id: 1, key: 'common', score: -5.0 }),
      mockEntry({ id: 2, key: 'fts-only', score: -3.0 }),
    ];
    const vector: ScoredKnowledgeEntry[] = [
      mockEntry({ id: 1, key: 'common', score: 0.95 }),
      mockEntry({ id: 3, key: 'vec-only', score: 0.80 }),
    ];

    const results = fuseResults(fts5, vector);
    // 'common' appears in both lists at rank 1 → gets 2 * 1/(60+1)
    expect(results[0].entry.key).toBe('common');
    expect(results[0].fusedScore).toBeGreaterThan(results[1].fusedScore);
  });

  it('deduplicates entries across sources', () => {
    const fts5: ScoredKnowledgeEntry[] = [
      mockEntry({ id: 1, key: 'shared', score: -5 }),
    ];
    const vector: ScoredKnowledgeEntry[] = [
      mockEntry({ id: 1, key: 'shared', score: 0.9 }),
    ];

    const results = fuseResults(fts5, vector);
    expect(results).toHaveLength(1);
  });

  it('applies weights to each source', () => {
    const fts5: ScoredKnowledgeEntry[] = [
      mockEntry({ id: 1, key: 'a', score: -5 }),
    ];
    const vector: ScoredKnowledgeEntry[] = [
      mockEntry({ id: 2, key: 'b', score: 0.9 }),
    ];

    // Give vector 2x weight → entry 'b' from vector should rank higher
    const results = fuseResults(fts5, vector, { fts5Weight: 1.0, vectorWeight: 2.0 });
    expect(results[0].entry.key).toBe('b');
    expect(results[0].fusedScore).toBeCloseTo(2.0 / 61, 6);
  });

  it('handles empty inputs', () => {
    expect(fuseResults([], [])).toEqual([]);
  });

  it('includes estimatedTokens in results', () => {
    const fts5: ScoredKnowledgeEntry[] = [
      mockEntry({ id: 1, key: 'x', content: 'Hello world!!' }), // 13 chars → ceil(13/4)=4 tokens
    ];
    const results = fuseResults(fts5, []);
    expect(results[0].estimatedTokens).toBe(4);
  });

  it('uses custom k parameter', () => {
    const fts5: ScoredKnowledgeEntry[] = [
      mockEntry({ id: 1, key: 'a', score: -5 }),
    ];

    const resultK60 = fuseResults(fts5, [], { k: 60 });
    const resultK10 = fuseResults(fts5, [], { k: 10 });

    // Smaller k → higher score for same rank
    expect(resultK10[0].fusedScore).toBeGreaterThan(resultK60[0].fusedScore);
  });
});

// ── Unit tests: fitToBudget ─────────────────────────────────────────

describe('fitToBudget', () => {
  function makeFused(tokens: number, key: string): FusedSearchResult {
    return {
      entry: mockEntry({ id: Math.random() * 1000 | 0, key }),
      fusedScore: 1.0,
      estimatedTokens: tokens,
    };
  }

  it('includes results up to the token budget', () => {
    const results = [
      makeFused(300, 'a'),
      makeFused(300, 'b'),
      makeFused(300, 'c'),
      makeFused(300, 'd'),
      makeFused(300, 'e'),
    ];

    const budgeted = fitToBudget(results, 1200, 10);
    expect(budgeted).toHaveLength(4); // 300*4=1200 fits, 300*5=1500 doesn't
  });

  it('always includes at least one result even if over budget', () => {
    const results = [makeFused(2000, 'huge')];
    const budgeted = fitToBudget(results, 100, 10);
    expect(budgeted).toHaveLength(1);
  });

  it('respects maxResults limit', () => {
    const results = [
      makeFused(10, 'a'),
      makeFused(10, 'b'),
      makeFused(10, 'c'),
    ];
    const budgeted = fitToBudget(results, 10000, 2);
    expect(budgeted).toHaveLength(2);
  });

  it('returns empty for empty input', () => {
    expect(fitToBudget([], 1200, 10)).toEqual([]);
  });
});

// ── Unit tests: estimateTokens ──────────────────────────────────────

describe('estimateTokens', () => {
  it('estimates ~4 chars per token', () => {
    expect(estimateTokens('Hello World!')).toBe(3); // 12 chars / 4 = 3
  });

  it('rounds up', () => {
    expect(estimateTokens('Hi')).toBe(1); // 2 chars / 4 = 0.5 → ceil to 1
  });

  it('handles empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

// ── Integration tests: HybridSearchEngine + real DB ─────────────────

describe('HybridSearchEngine', () => {
  let db: Database;
  let store: KnowledgeStore;
  let engine: HybridSearchEngine;
  const projectId = 'test-hybrid-a1b2';

  beforeEach(() => {
    db = new Database(':memory:');
    store = new KnowledgeStore(db);
    engine = new HybridSearchEngine(store);

    // Seed test data
    store.put(projectId, 'semantic', 'typescript-overview', 'TypeScript is a strongly typed programming language that builds on JavaScript.');
    store.put(projectId, 'semantic', 'react-overview', 'React is a JavaScript library for building user interfaces with components.');
    store.put(projectId, 'procedural', 'testing-workflow', 'Always write tests first using vitest. Run tests with npx vitest run.');
    store.put(projectId, 'core', 'project-stack', 'This project uses TypeScript, React, SQLite, and vitest for testing.');
    store.put(projectId, 'episodic', 'session-summary', 'In this session we refactored the database layer and added new indexes.');
  });

  afterEach(() => {
    db.close();
  });

  it('returns relevant results for a keyword query', () => {
    const results = engine.search(projectId, 'TypeScript');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.entry.key === 'typescript-overview')).toBe(true);
  });

  it('respects token budget', () => {
    const results = engine.search(projectId, 'TypeScript', { tokenBudget: 30 });
    const totalTokens = results.reduce((sum, r) => sum + r.estimatedTokens, 0);
    // First result may exceed budget on its own, but second won't be added
    expect(results.length).toBeLessThanOrEqual(2);
    if (results.length > 1) {
      expect(totalTokens).toBeLessThanOrEqual(30);
    }
  });

  it('respects limit option', () => {
    const results = engine.search(projectId, 'TypeScript', { limit: 1, tokenBudget: 10000 });
    expect(results).toHaveLength(1);
  });

  it('filters by categories', () => {
    const results = engine.search(projectId, 'TypeScript', { categories: ['semantic'] });
    expect(results.every((r) => r.entry.category === 'semantic')).toBe(true);
  });

  it('returns empty array for no matches', () => {
    const results = engine.search(projectId, 'Haskell');
    expect(results).toEqual([]);
  });

  it('works with no vector provider (FTS5 only)', () => {
    const results = engine.search(projectId, 'testing');
    expect(results.length).toBeGreaterThanOrEqual(1);
    // All scores should be from FTS5 only
    expect(results.every((r) => r.fusedScore > 0)).toBe(true);
  });

  it('integrates a vector provider via setVectorProvider', () => {
    const mockVector: VectorSearchProvider = {
      search: (pid, query, limit) => {
        // Return a "semantic" match that FTS5 might not find
        return [
          mockEntry({
            id: 999,
            key: 'vector-match',
            content: 'Semantically related to the query',
            score: 0.92,
          }),
        ];
      },
    };

    engine.setVectorProvider(mockVector);
    const results = engine.search(projectId, 'TypeScript');

    // Should include both FTS5 results and the vector result
    const keys = results.map((r) => r.entry.key);
    expect(keys).toContain('vector-match');
  });

  it('gracefully handles vector provider errors', () => {
    const failingVector: VectorSearchProvider = {
      search: () => { throw new Error('Embedding service down'); },
    };

    engine.setVectorProvider(failingVector);
    // Should not throw — falls back to FTS5 only
    const results = engine.search(projectId, 'TypeScript');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('fusedScore is higher for entries found by both sources', () => {
    // Create a vector provider that returns the same entry as FTS5
    const tsEntry = store.get(projectId, 'semantic', 'typescript-overview')!;
    const mockVector: VectorSearchProvider = {
      search: () => [{ ...tsEntry, score: 0.95 }],
    };

    engine.setVectorProvider(mockVector);
    const results = engine.search(projectId, 'TypeScript');

    // The TypeScript entry should be boosted by appearing in both lists
    const tsResult = results.find((r) => r.entry.key === 'typescript-overview');
    const otherResults = results.filter((r) => r.entry.key !== 'typescript-overview');

    if (tsResult && otherResults.length > 0) {
      expect(tsResult.fusedScore).toBeGreaterThan(otherResults[0].fusedScore);
    }
  });

  describe('fetchLimit capping', () => {
    it('uses DEFAULT_FETCH_LIMIT (100) when no limit option is provided', () => {
      const searchSpy = vi.spyOn(engine, 'fts5Search');
      engine.search(projectId, 'TypeScript');
      expect(searchSpy).toHaveBeenCalledWith(projectId, 'TypeScript', 100, undefined);
      searchSpy.mockRestore();
    });

    it('caps fetchLimit at MAX_FETCH_LIMIT (500) for large limit values', () => {
      const searchSpy = vi.spyOn(engine, 'fts5Search');
      engine.search(projectId, 'TypeScript', { limit: 1000 });
      // 1000 * 3 = 3000, but should be clamped to 500
      expect(searchSpy).toHaveBeenCalledWith(projectId, 'TypeScript', 500, undefined);
      searchSpy.mockRestore();
    });

    it('allows fetchLimit below MAX_FETCH_LIMIT without clamping', () => {
      const searchSpy = vi.spyOn(engine, 'fts5Search');
      engine.search(projectId, 'TypeScript', { limit: 50 });
      // 50 * 3 = 150, which is below 500
      expect(searchSpy).toHaveBeenCalledWith(projectId, 'TypeScript', 150, undefined);
      searchSpy.mockRestore();
    });

    it('clamps exactly at boundary (limit=167 → 501 → 500)', () => {
      const searchSpy = vi.spyOn(engine, 'fts5Search');
      engine.search(projectId, 'TypeScript', { limit: 167 });
      // 167 * 3 = 501, clamped to 500
      expect(searchSpy).toHaveBeenCalledWith(projectId, 'TypeScript', 500, undefined);
      searchSpy.mockRestore();
    });

    it('passes capped fetchLimit to vectorSearch as well', () => {
      const vectorSpy = vi.spyOn(engine, 'vectorSearch');
      engine.search(projectId, 'TypeScript', { limit: 1000 });
      expect(vectorSpy).toHaveBeenCalledWith(projectId, 'TypeScript', 500);
      vectorSpy.mockRestore();
    });
  });

  describe('searchWithScores on KnowledgeStore', () => {
    it('returns entries with BM25 scores', () => {
      const results = store.searchWithScores(projectId, 'TypeScript');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].score).toBeDefined();
      expect(typeof results[0].score).toBe('number');
      // BM25 scores are negative in SQLite FTS5 (more negative = more relevant)
      expect(results[0].score).toBeLessThanOrEqual(0);
    });

    it('filters by category', () => {
      const results = store.searchWithScores(projectId, 'TypeScript', { category: 'core' });
      expect(results.every((r) => r.category === 'core')).toBe(true);
    });

    it('returns empty for no matches', () => {
      const results = store.searchWithScores(projectId, 'Haskell');
      expect(results).toHaveLength(0);
    });
  });
});
