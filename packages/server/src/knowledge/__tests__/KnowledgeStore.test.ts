import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../db/database.js';
import { KnowledgeStore } from '../KnowledgeStore.js';
import type { KnowledgeCategory, KnowledgeMetadata } from '../types.js';

describe('KnowledgeStore', () => {
  let db: Database;
  let store: KnowledgeStore;
  const projectId = 'test-project-a1b2';

  beforeEach(() => {
    db = new Database(':memory:');
    store = new KnowledgeStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('put', () => {
    it('inserts a new knowledge entry', () => {
      const entry = store.put(projectId, 'core', 'agent-identity', 'I am a test agent');
      expect(entry.id).toBeGreaterThan(0);
      expect(entry.projectId).toBe(projectId);
      expect(entry.category).toBe('core');
      expect(entry.key).toBe('agent-identity');
      expect(entry.content).toBe('I am a test agent');
      expect(entry.metadata).toBeNull();
      expect(entry.createdAt).toBeDefined();
      expect(entry.updatedAt).toBeDefined();
    });

    it('inserts with metadata', () => {
      const meta: KnowledgeMetadata = { source: 'user', confidence: 0.9, tags: ['identity'] };
      const entry = store.put(projectId, 'core', 'prefs', 'Use TypeScript', meta);
      expect(entry.metadata).toEqual(meta);
    });

    it('upserts on duplicate (projectId, category, key)', () => {
      store.put(projectId, 'semantic', 'tech-stack', 'React + Node');
      const updated = store.put(projectId, 'semantic', 'tech-stack', 'React + Bun');
      expect(updated.content).toBe('React + Bun');
      // Should only be 1 entry
      const all = store.getAll(projectId);
      expect(all).toHaveLength(1);
    });

    it('upserts metadata on conflict', () => {
      store.put(projectId, 'core', 'rules', 'Rule 1', { source: 'user' });
      const updated = store.put(projectId, 'core', 'rules', 'Rule 2', { source: 'auto', confidence: 0.8 });
      expect(updated.content).toBe('Rule 2');
      expect(updated.metadata).toEqual({ source: 'auto', confidence: 0.8 });
    });

    it('rejects invalid category', () => {
      expect(() => store.put(projectId, 'invalid' as KnowledgeCategory, 'k', 'v')).toThrow(
        /Invalid knowledge category/,
      );
    });
  });

  describe('get', () => {
    it('returns an entry by (projectId, category, key)', () => {
      store.put(projectId, 'episodic', 'session-001', 'First session summary');
      const entry = store.get(projectId, 'episodic', 'session-001');
      expect(entry).toBeDefined();
      expect(entry!.content).toBe('First session summary');
    });

    it('returns undefined for non-existent entry', () => {
      const entry = store.get(projectId, 'core', 'nonexistent');
      expect(entry).toBeUndefined();
    });

    it('does not return entries from other projects', () => {
      store.put('project-a', 'core', 'rules', 'Project A rules');
      const entry = store.get('project-b', 'core', 'rules');
      expect(entry).toBeUndefined();
    });
  });

  describe('getByCategory', () => {
    it('returns all entries in a category', () => {
      store.put(projectId, 'procedural', 'git-workflow', 'Always rebase');
      store.put(projectId, 'procedural', 'testing', 'Test first');
      store.put(projectId, 'semantic', 'unrelated', 'Not this');

      const results = store.getByCategory(projectId, 'procedural');
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.key).sort()).toEqual(['git-workflow', 'testing']);
    });

    it('returns empty array when no entries exist', () => {
      const results = store.getByCategory(projectId, 'episodic');
      expect(results).toHaveLength(0);
    });
  });

  describe('getAll', () => {
    it('returns all entries for a project', () => {
      store.put(projectId, 'core', 'identity', 'I am me');
      store.put(projectId, 'episodic', 'session-1', 'First');
      store.put(projectId, 'procedural', 'pattern-1', 'Do X');
      store.put(projectId, 'semantic', 'fact-1', 'TypeScript');

      const all = store.getAll(projectId);
      expect(all).toHaveLength(4);
    });

    it('does not return entries from other projects', () => {
      store.put('project-a', 'core', 'x', 'A stuff');
      store.put('project-b', 'core', 'y', 'B stuff');

      expect(store.getAll('project-a')).toHaveLength(1);
      expect(store.getAll('project-b')).toHaveLength(1);
    });
  });

  describe('delete', () => {
    it('removes a specific entry and returns true', () => {
      store.put(projectId, 'semantic', 'fact', 'Old fact');
      const deleted = store.delete(projectId, 'semantic', 'fact');
      expect(deleted).toBe(true);
      expect(store.get(projectId, 'semantic', 'fact')).toBeUndefined();
    });

    it('returns false when entry does not exist', () => {
      const deleted = store.delete(projectId, 'core', 'nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('deleteAll', () => {
    it('removes all entries for a project', () => {
      store.put(projectId, 'core', 'a', 'x');
      store.put(projectId, 'episodic', 'b', 'y');
      store.put(projectId, 'semantic', 'c', 'z');

      const count = store.deleteAll(projectId);
      expect(count).toBe(3);
      expect(store.getAll(projectId)).toHaveLength(0);
    });

    it('does not affect other projects', () => {
      store.put('project-a', 'core', 'x', 'A');
      store.put('project-b', 'core', 'y', 'B');

      store.deleteAll('project-a');
      expect(store.getAll('project-b')).toHaveLength(1);
    });
  });

  describe('count', () => {
    it('counts all entries for a project', () => {
      store.put(projectId, 'core', 'a', 'x');
      store.put(projectId, 'episodic', 'b', 'y');
      expect(store.count(projectId)).toBe(2);
    });

    it('counts entries by category', () => {
      store.put(projectId, 'core', 'a', 'x');
      store.put(projectId, 'core', 'b', 'y');
      store.put(projectId, 'episodic', 'c', 'z');

      expect(store.count(projectId, 'core')).toBe(2);
      expect(store.count(projectId, 'episodic')).toBe(1);
      expect(store.count(projectId, 'procedural')).toBe(0);
    });
  });

  describe('search (FTS5)', () => {
    beforeEach(() => {
      store.put(projectId, 'semantic', 'typescript', 'TypeScript is a typed superset of JavaScript');
      store.put(projectId, 'semantic', 'react', 'React is a UI library for building interfaces');
      store.put(projectId, 'procedural', 'testing-pattern', 'Always write tests first using vitest');
      store.put(projectId, 'core', 'stack', 'We use TypeScript and React with vitest for testing');
    });

    it('finds entries matching a query', () => {
      const results = store.search(projectId, 'TypeScript');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((r) => r.key === 'typescript')).toBe(true);
    });

    it('filters by category when specified', () => {
      const results = store.search(projectId, 'TypeScript', { category: 'semantic' });
      expect(results.every((r) => r.category === 'semantic')).toBe(true);
    });

    it('respects limit option', () => {
      const results = store.search(projectId, 'TypeScript', { limit: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('returns empty array for no matches', () => {
      const results = store.search(projectId, 'Haskell');
      expect(results).toHaveLength(0);
    });

    it('does not return results from other projects', () => {
      store.put('other-project', 'semantic', 'ts', 'TypeScript rocks');
      const results = store.search(projectId, 'TypeScript');
      expect(results.every((r) => r.projectId === projectId)).toBe(true);
    });

    it('finds entries after upsert updates content', () => {
      store.put(projectId, 'semantic', 'typescript', 'TypeScript is awesome and supports generics');
      const results = store.search(projectId, 'generics');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((r) => r.key === 'typescript')).toBe(true);
    });

    it('does not find deleted entries', () => {
      store.delete(projectId, 'semantic', 'typescript');
      const results = store.search(projectId, 'typed superset');
      expect(results.every((r) => r.key !== 'typescript')).toBe(true);
    });

    it('finds entries with multi-word queries (non-phrase, implicit AND)', () => {
      // "React testing" should match 'stack' entry which has both words non-adjacent
      const results = store.search(projectId, 'React testing');
      expect(results.length).toBeGreaterThanOrEqual(1);
      // The 'stack' entry has "TypeScript and React with vitest for testing"
      expect(results.some((r) => r.key === 'stack')).toBe(true);
    });

    it('handles queries with special FTS5 characters', () => {
      store.put(projectId, 'semantic', 'special', 'C++ and C# are programming languages');
      const results = store.search(projectId, 'programming');
      expect(results.some((r) => r.key === 'special')).toBe(true);
    });
  });

  describe('metadata handling', () => {
    it('round-trips complex metadata', () => {
      const meta: KnowledgeMetadata = {
        source: 'agent-review',
        confidence: 0.85,
        tags: ['architecture', 'decisions'],
        customField: { nested: true },
      };
      store.put(projectId, 'episodic', 'decision-001', 'Chose SQLite', meta);
      const entry = store.get(projectId, 'episodic', 'decision-001');
      expect(entry!.metadata).toEqual(meta);
    });

    it('handles null metadata', () => {
      store.put(projectId, 'core', 'simple', 'No metadata');
      const entry = store.get(projectId, 'core', 'simple');
      expect(entry!.metadata).toBeNull();
    });
  });

  describe('project isolation', () => {
    it('keeps knowledge separate between projects', () => {
      store.put('project-alpha', 'core', 'name', 'Alpha Project');
      store.put('project-beta', 'core', 'name', 'Beta Project');

      expect(store.get('project-alpha', 'core', 'name')!.content).toBe('Alpha Project');
      expect(store.get('project-beta', 'core', 'name')!.content).toBe('Beta Project');
      expect(store.count('project-alpha')).toBe(1);
      expect(store.count('project-beta')).toBe(1);
    });
  });
});
