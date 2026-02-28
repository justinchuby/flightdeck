import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../db/database.js';
import { CollectiveMemory } from '../coordination/CollectiveMemory.js';
import type { MemoryCategory } from '../coordination/CollectiveMemory.js';

describe('CollectiveMemory', () => {
  let db: Database;
  let memory: CollectiveMemory;

  beforeEach(() => {
    db = new Database(':memory:');
    memory = new CollectiveMemory(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('remember', () => {
    it('stores a new memory and returns it', () => {
      const entry = memory.remember('gotcha', 'visx-peer-deps', 'visx needs --legacy-peer-deps', 'agent-1');
      expect(entry.category).toBe('gotcha');
      expect(entry.key).toBe('visx-peer-deps');
      expect(entry.value).toBe('visx needs --legacy-peer-deps');
      expect(entry.source).toBe('agent-1');
      expect(entry.useCount).toBe(0);
      expect(entry.id).toBeGreaterThan(0);
    });

    it('upserts on same category+key', () => {
      memory.remember('pattern', 'test-setup', 'use Database(:memory:)', 'agent-1');
      const updated = memory.remember('pattern', 'test-setup', 'use in-memory DB', 'agent-2');
      expect(updated.value).toBe('use in-memory DB');
      expect(updated.source).toBe('agent-2');
      expect(updated.useCount).toBe(1); // incremented on upsert

      const all = memory.getAll();
      expect(all).toHaveLength(1);
    });

    it('allows same key in different categories', () => {
      memory.remember('pattern', 'drizzle', 'use drizzle for queries', 'a1');
      memory.remember('gotcha', 'drizzle', 'drizzle-kit generate needs --name flag', 'a2');
      expect(memory.getAll()).toHaveLength(2);
    });
  });

  describe('recall', () => {
    it('retrieves memories by category sorted by useCount', () => {
      memory.remember('gotcha', 'visx', 'peer deps issue', 'a1');
      memory.remember('gotcha', 'drizzle', 'generate quirk', 'a2');
      // Bump visx via upsert
      memory.remember('gotcha', 'visx', 'peer deps issue v2', 'a1');

      const gotchas = memory.recall('gotcha');
      expect(gotchas).toHaveLength(2);
      // visx has higher useCount from upsert
      expect(gotchas[0].key).toBe('visx');
    });

    it('filters by key prefix', () => {
      memory.remember('expertise', 'file:src/index.ts', 'main entry', 'a1');
      memory.remember('expertise', 'file:src/utils.ts', 'utility functions', 'a1');
      memory.remember('expertise', 'role:architect', 'system design', 'a2');

      const fileExpertise = memory.recall('expertise', 'file:');
      expect(fileExpertise).toHaveLength(2);
      expect(fileExpertise.every(e => e.key.startsWith('file:'))).toBe(true);
    });

    it('returns empty array for unknown category data', () => {
      const results = memory.recall('pattern');
      expect(results).toEqual([]);
    });

    it('increments useCount on recall', () => {
      memory.remember('gotcha', 'test', 'value', 'a1');
      expect(memory.getAll()[0].useCount).toBe(0);

      memory.recall('gotcha');
      // After recall, useCount should be incremented
      const all = memory.getAll();
      expect(all[0].useCount).toBeGreaterThan(0);
    });
  });

  describe('recallForFile', () => {
    it('finds memories with filepath in key', () => {
      memory.remember('expertise', 'file:src/agents/Agent.ts', 'agent lifecycle', 'a1');
      memory.remember('gotcha', 'build:src/agents/Agent.ts:line42', 'null check needed', 'a2');
      memory.remember('pattern', 'unrelated-thing', 'nothing to do with files', 'a3');

      const results = memory.recallForFile('src/agents/Agent.ts');
      expect(results).toHaveLength(2);
    });

    it('returns empty for no matches', () => {
      memory.remember('gotcha', 'visx', 'peer deps', 'a1');
      expect(memory.recallForFile('nonexistent.ts')).toEqual([]);
    });
  });

  describe('prune', () => {
    it('removes old memories based on age threshold', () => {
      memory.remember('gotcha', 'old-thing', 'stale info', 'a1');
      // With maxAge=0, even just-created entries have age > 0 (tiny fraction of a day)
      const removed = memory.prune(0);
      expect(removed).toBe(1);
      expect(memory.getAll()).toHaveLength(0);
    });

    it('keeps recent memories when pruning old ones', () => {
      memory.remember('pattern', 'recent', 'fresh knowledge', 'a1');
      const removed = memory.prune(30); // 30 day threshold
      expect(removed).toBe(0);
      expect(memory.getAll()).toHaveLength(1);
    });
  });

  describe('forget', () => {
    it('removes a specific memory by id', () => {
      const entry = memory.remember('gotcha', 'temp', 'temporary', 'a1');
      expect(memory.forget(entry.id)).toBe(true);
      expect(memory.getAll()).toHaveLength(0);
    });

    it('returns false for non-existent id', () => {
      expect(memory.forget(999)).toBe(false);
    });
  });

  describe('getAll', () => {
    it('returns all memories sorted by useCount descending', () => {
      memory.remember('gotcha', 'a', 'val', 'a1');
      memory.remember('pattern', 'b', 'val', 'a2');
      memory.remember('decision', 'c', 'val', 'a3');
      // Bump 'b' twice
      memory.remember('pattern', 'b', 'updated', 'a2');
      memory.remember('pattern', 'b', 'updated2', 'a2');

      const all = memory.getAll();
      expect(all).toHaveLength(3);
      expect(all[0].key).toBe('b'); // highest useCount
    });
  });

  describe('category types', () => {
    const categories: MemoryCategory[] = ['pattern', 'decision', 'expertise', 'gotcha'];

    for (const cat of categories) {
      it(`supports category: ${cat}`, () => {
        const entry = memory.remember(cat, `test-${cat}`, `value for ${cat}`, 'a1');
        expect(entry.category).toBe(cat);
        const recalled = memory.recall(cat);
        expect(recalled).toHaveLength(1);
      });
    }
  });
});
