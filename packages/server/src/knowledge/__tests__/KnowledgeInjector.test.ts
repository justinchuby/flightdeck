import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database } from '../../db/database.js';
import { KnowledgeStore } from '../KnowledgeStore.js';
import { MemoryCategoryManager } from '../MemoryCategoryManager.js';
import { HybridSearchEngine } from '../HybridSearchEngine.js';
import { KnowledgeInjector } from '../KnowledgeInjector.js';
import type { InjectionContext } from '../KnowledgeInjector.js';
import type { FusedSearchResult, KnowledgeEntry, VectorSearchProvider } from '../types.js';

describe('KnowledgeInjector', () => {
  let db: Database;
  let store: KnowledgeStore;
  let categoryManager: MemoryCategoryManager;
  let injector: KnowledgeInjector;
  const projectId = 'test-project-injector';

  beforeEach(() => {
    db = new Database(':memory:');
    store = new KnowledgeStore(db);
    categoryManager = new MemoryCategoryManager(store);
    // Create injector without search engine (test fallback path by default)
    injector = new KnowledgeInjector(categoryManager);
  });

  afterEach(() => {
    db.close();
  });

  // ---------------------------------------------------------------------------
  // Helper: seed a populated project
  // ---------------------------------------------------------------------------
  function seedProject(): void {
    // Core entries (always injected)
    categoryManager.putMemory(projectId, 'core', 'stack', 'TypeScript + React + SQLite monorepo');
    categoryManager.putMemory(projectId, 'core', 'style', 'Use explicit types, no any, minimal comments');

    // Procedural entries (corrections/patterns)
    store.put(projectId, 'procedural', 'correction-1', 'Never use any type. Use unknown and narrow.', {
      type: 'correction',
      tags: ['code-style', 'typescript'],
    });
    store.put(projectId, 'procedural', 'correction-2', 'Always run vitest before committing.', {
      type: 'correction',
      tags: ['workflow', 'testing'],
    });

    // Semantic entries (facts)
    store.put(projectId, 'semantic', 'db-choice', 'Database: better-sqlite3 with Drizzle ORM in WAL mode');
    store.put(projectId, 'semantic', 'framework', 'Frontend: React 19 with Vite bundler');

    // Episodic entries (session context)
    store.put(projectId, 'episodic', 'session-001', 'Refactored database layer to use Drizzle ORM');
    store.put(projectId, 'episodic', 'session-002', 'Added knowledge store with FTS5 search');
  }

  // ---------------------------------------------------------------------------
  // injectKnowledge — basic behavior
  // ---------------------------------------------------------------------------
  describe('injectKnowledge', () => {
    it('returns empty text for a project with no knowledge', () => {
      const result = injector.injectKnowledge('empty-project');

      expect(result.text).toBe('');
      expect(result.totalTokens).toBe(0);
      expect(result.entriesIncluded).toBe(0);
    });

    it('injects all categories when knowledge exists', () => {
      seedProject();

      const result = injector.injectKnowledge(projectId);

      expect(result.text).toContain('== Project Context ==');
      expect(result.text).toContain('[Project Rules]');
      expect(result.text).toContain('[Corrections & Patterns]');
      expect(result.text).toContain('[Architecture & Facts]');
      expect(result.text).toContain('[Recent Context]');
      expect(result.entriesIncluded).toBe(8);
    });

    it('includes core entries in the output', () => {
      seedProject();

      const result = injector.injectKnowledge(projectId);

      expect(result.text).toContain('TypeScript + React + SQLite monorepo');
      expect(result.text).toContain('Use explicit types, no any, minimal comments');
    });

    it('includes procedural entries in the output', () => {
      seedProject();

      const result = injector.injectKnowledge(projectId);

      expect(result.text).toContain('Never use any type');
      expect(result.text).toContain('Always run vitest before committing');
    });

    it('returns correct breakdown by category', () => {
      seedProject();

      const result = injector.injectKnowledge(projectId);

      expect(result.breakdown.core).toBeGreaterThan(0);
      expect(result.breakdown.procedural).toBeGreaterThan(0);
      expect(result.breakdown.semantic).toBeGreaterThan(0);
      expect(result.breakdown.episodic).toBeGreaterThan(0);
    });

    it('accepts a custom token budget via context', () => {
      seedProject();

      const result = injector.injectKnowledge(projectId, { tokenBudget: 50 });

      // With 50 tokens (~200 chars), only a few entries should fit
      expect(result.totalTokens).toBeLessThanOrEqual(50);
      expect(result.entriesIncluded).toBeLessThan(8);
    });
  });

  // ---------------------------------------------------------------------------
  // selectKnowledge — priority ordering
  // ---------------------------------------------------------------------------
  describe('selectKnowledge', () => {
    it('always includes core entries first', () => {
      seedProject();

      const selected = injector.selectKnowledge(projectId, {}, 1200);
      const categories = selected.map((s) => s.entry.category);

      // Core entries should come before all others
      const firstNonCore = categories.findIndex((c) => c !== 'core');
      const coreEntries = categories.filter((c) => c === 'core');
      expect(coreEntries).toHaveLength(2);
      if (firstNonCore > 0) {
        expect(categories.slice(0, firstNonCore).every((c) => c === 'core')).toBe(true);
      }
    });

    it('includes entries in priority order: core > procedural > semantic > episodic', () => {
      seedProject();

      const selected = injector.selectKnowledge(projectId, {}, 1200);
      const categories = selected.map((s) => s.entry.category);

      // Find first occurrence of each category
      const firstIndex = (cat: string) => {
        const idx = categories.indexOf(cat as any);
        return idx === -1 ? Infinity : idx;
      };

      expect(firstIndex('core')).toBeLessThan(firstIndex('procedural'));
      expect(firstIndex('procedural')).toBeLessThan(firstIndex('semantic'));
      expect(firstIndex('semantic')).toBeLessThan(firstIndex('episodic'));
    });

    it('respects token budget strictly', () => {
      seedProject();

      const selected = injector.selectKnowledge(projectId, {}, 30);
      const totalTokens = selected.reduce((sum, s) => sum + s.tokens, 0);

      expect(totalTokens).toBeLessThanOrEqual(30);
    });

    it('returns empty array for empty project', () => {
      const selected = injector.selectKnowledge('empty-project', {}, 1200);

      expect(selected).toHaveLength(0);
    });

    it('does not include duplicate entries', () => {
      seedProject();

      const selected = injector.selectKnowledge(projectId, {}, 1200);
      const ids = selected.map((s) => s.entry.id);
      const uniqueIds = new Set(ids);

      expect(ids.length).toBe(uniqueIds.size);
    });
  });

  // ---------------------------------------------------------------------------
  // Token budgeting
  // ---------------------------------------------------------------------------
  describe('token budgeting', () => {
    it('budget 0 returns no entries', () => {
      seedProject();

      const result = injector.injectKnowledge(projectId, { tokenBudget: 0 });

      expect(result.entriesIncluded).toBe(0);
      expect(result.text).toBe('');
    });

    it('very small budget includes at most core entries', () => {
      // Add a very short core entry
      categoryManager.putMemory(projectId, 'core', 'rule', 'Use TS');
      store.put(projectId, 'procedural', 'p1', 'A very long procedural entry that should not be included');
      store.put(projectId, 'semantic', 's1', 'A very long semantic entry that should not be included');

      // Budget for ~2 tokens = 8 chars, enough for "Use TS" (6 chars = 2 tokens)
      const result = injector.injectKnowledge(projectId, { tokenBudget: 2 });

      expect(result.entriesIncluded).toBeLessThanOrEqual(1);
      if (result.entriesIncluded > 0) {
        expect(result.breakdown.core).toBeGreaterThan(0);
      }
    });

    it('default budget is 1200 tokens', () => {
      seedProject();

      const result = injector.injectKnowledge(projectId);

      expect(result.totalTokens).toBeLessThanOrEqual(1200);
    });

    it('handles entries that are individually larger than remaining budget', () => {
      categoryManager.putMemory(projectId, 'core', 'small', 'OK');
      // Create a large entry (~500 tokens = 2000 chars)
      const largeContent = 'x'.repeat(2000);
      store.put(projectId, 'procedural', 'large', largeContent);
      store.put(projectId, 'semantic', 'small', 'Quick fact');

      const result = injector.injectKnowledge(projectId, { tokenBudget: 100 });

      // Should include the small core entry but skip the large procedural one
      expect(result.text).toContain('OK');
      expect(result.text).not.toContain(largeContent);
    });
  });

  // ---------------------------------------------------------------------------
  // formatKnowledge
  // ---------------------------------------------------------------------------
  describe('formatKnowledge', () => {
    it('returns empty string for empty selection', () => {
      const text = injector.formatKnowledge([]);

      expect(text).toBe('');
    });

    it('wraps output in Project Context header', () => {
      categoryManager.putMemory(projectId, 'core', 'rule', 'Test rule');
      const selected = injector.selectKnowledge(projectId, {}, 1200);

      const text = injector.formatKnowledge(selected);

      expect(text.startsWith('== Project Context ==')).toBe(true);
    });

    it('formats entries as bullet points under category sections', () => {
      categoryManager.putMemory(projectId, 'core', 'rule', 'Always use const');

      const selected = injector.selectKnowledge(projectId, {}, 1200);
      const text = injector.formatKnowledge(selected);

      expect(text).toContain('[Project Rules]');
      expect(text).toContain('- Always use const');
    });

    it('emits sections in priority order regardless of selection order', () => {
      store.put(projectId, 'episodic', 'e1', 'Recent session');
      categoryManager.putMemory(projectId, 'core', 'c1', 'Core rule');
      store.put(projectId, 'semantic', 's1', 'Semantic fact');

      const selected = injector.selectKnowledge(projectId, {}, 1200);
      const text = injector.formatKnowledge(selected);

      const corePos = text.indexOf('[Project Rules]');
      const semanticPos = text.indexOf('[Architecture & Facts]');
      const episodicPos = text.indexOf('[Recent Context]');

      expect(corePos).toBeLessThan(semanticPos);
      expect(semanticPos).toBeLessThan(episodicPos);
    });

    it('omits empty category sections', () => {
      categoryManager.putMemory(projectId, 'core', 'rule', 'Only core here');

      const selected = injector.selectKnowledge(projectId, {}, 1200);
      const text = injector.formatKnowledge(selected);

      expect(text).toContain('[Project Rules]');
      expect(text).not.toContain('[Corrections & Patterns]');
      expect(text).not.toContain('[Architecture & Facts]');
      expect(text).not.toContain('[Recent Context]');
    });
  });

  // ---------------------------------------------------------------------------
  // Search engine integration
  // ---------------------------------------------------------------------------
  describe('with HybridSearchEngine', () => {
    let searchEngine: HybridSearchEngine;

    beforeEach(() => {
      searchEngine = new HybridSearchEngine(store);
      injector = new KnowledgeInjector(categoryManager, searchEngine);
    });

    it('still works when search engine returns no results', () => {
      // No data seeded, so search returns nothing
      categoryManager.putMemory(projectId, 'core', 'rule', 'Project rule');

      const result = injector.injectKnowledge(projectId, { task: 'build a feature' });

      expect(result.text).toContain('Project rule');
      expect(result.entriesIncluded).toBe(1);
    });

    it('falls back to direct retrieval when search throws', () => {
      seedProject();

      // Create a mock search engine that throws
      const failingEngine = {
        search: () => {
          throw new Error('Search is broken');
        },
        setVectorProvider: () => {},
        fts5Search: () => [],
        vectorSearch: () => [],
      } as unknown as HybridSearchEngine;

      const failingInjector = new KnowledgeInjector(categoryManager, failingEngine);
      const result = failingInjector.injectKnowledge(projectId, { task: 'something' });

      // Should still return results via fallback
      expect(result.entriesIncluded).toBeGreaterThan(0);
      expect(result.text).toContain('TypeScript + React + SQLite monorepo');
    });
  });

  // ---------------------------------------------------------------------------
  // Context-based query building
  // ---------------------------------------------------------------------------
  describe('context handling', () => {
    it('works with empty context', () => {
      seedProject();

      const result = injector.injectKnowledge(projectId, {});

      expect(result.entriesIncluded).toBeGreaterThan(0);
    });

    it('works with task-only context', () => {
      seedProject();

      const result = injector.injectKnowledge(projectId, {
        task: 'Implement database migrations',
      });

      expect(result.entriesIncluded).toBeGreaterThan(0);
    });

    it('works with role-only context', () => {
      seedProject();

      const result = injector.injectKnowledge(projectId, { role: 'developer' });

      expect(result.entriesIncluded).toBeGreaterThan(0);
    });

    it('works with recent messages', () => {
      seedProject();

      const result = injector.injectKnowledge(projectId, {
        recentMessages: ['Can you fix the TypeScript errors?', 'The tests are failing'],
      });

      expect(result.entriesIncluded).toBeGreaterThan(0);
    });

    it('works with full context', () => {
      seedProject();

      const result = injector.injectKnowledge(projectId, {
        task: 'Fix TypeScript compilation errors',
        role: 'developer',
        recentMessages: ['There are type errors in the knowledge module'],
      });

      expect(result.entriesIncluded).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Project isolation
  // ---------------------------------------------------------------------------
  describe('project isolation', () => {
    it('only injects knowledge from the specified project', () => {
      categoryManager.putMemory('project-alpha', 'core', 'name', 'Alpha Project');
      categoryManager.putMemory('project-beta', 'core', 'name', 'Beta Project');

      const alpha = injector.injectKnowledge('project-alpha');
      const beta = injector.injectKnowledge('project-beta');

      expect(alpha.text).toContain('Alpha Project');
      expect(alpha.text).not.toContain('Beta Project');
      expect(beta.text).toContain('Beta Project');
      expect(beta.text).not.toContain('Alpha Project');
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
  describe('edge cases', () => {
    it('handles project with only core entries', () => {
      categoryManager.putMemory(projectId, 'core', 'only', 'Only core here');

      const result = injector.injectKnowledge(projectId);

      expect(result.entriesIncluded).toBe(1);
      expect(result.breakdown.core).toBeGreaterThan(0);
      expect(result.breakdown.procedural).toBe(0);
    });

    it('handles project with only episodic entries', () => {
      store.put(projectId, 'episodic', 'session-1', 'Did some stuff');

      const result = injector.injectKnowledge(projectId);

      expect(result.entriesIncluded).toBe(1);
      expect(result.breakdown.episodic).toBeGreaterThan(0);
    });

    it('handles many entries exceeding the budget', () => {
      // Add 25 core entries (max 20 in category manager, but let's add many)
      for (let i = 0; i < 15; i++) {
        categoryManager.putMemory(projectId, 'core', `rule-${i}`, `Important rule number ${i} for the project`);
      }
      for (let i = 0; i < 10; i++) {
        store.put(projectId, 'procedural', `pattern-${i}`, `Pattern number ${i} for development`);
      }

      const result = injector.injectKnowledge(projectId, { tokenBudget: 100 });

      expect(result.totalTokens).toBeLessThanOrEqual(100);
    });

    it('handles entries with very long content gracefully', () => {
      categoryManager.putMemory(projectId, 'core', 'short', 'OK');
      const longContent = 'This is a very long entry. '.repeat(200);
      store.put(projectId, 'semantic', 'long', longContent);

      const result = injector.injectKnowledge(projectId, { tokenBudget: 50 });

      // Short core entry should be included, long semantic skipped
      expect(result.text).toContain('OK');
      expect(result.totalTokens).toBeLessThanOrEqual(50);
    });
  });
});
