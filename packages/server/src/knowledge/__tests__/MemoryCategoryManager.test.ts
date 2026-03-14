import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../db/database.js';
import { KnowledgeStore } from '../KnowledgeStore.js';
import {
  MemoryCategoryManager,
  DEFAULT_CATEGORY_LIMITS,
} from '../MemoryCategoryManager.js';

describe('MemoryCategoryManager', () => {
  let db: Database;
  let store: KnowledgeStore;
  let manager: MemoryCategoryManager;
  const projectId = 'test-project-mem';

  beforeEach(() => {
    db = new Database(':memory:');
    store = new KnowledgeStore(db);
    manager = new MemoryCategoryManager(store);
  });

  afterEach(() => {
    db.close();
  });

  // ── Basic CRUD ──────────────────────────────────────────────────

  describe('putMemory', () => {
    it('stores a memory entry', () => {
      const entry = manager.putMemory(projectId, 'semantic', 'tech-stack', 'React + Node');
      expect(entry.category).toBe('semantic');
      expect(entry.key).toBe('tech-stack');
      expect(entry.content).toBe('React + Node');
    });

    it('stores with metadata', () => {
      const entry = manager.putMemory(projectId, 'procedural', 'git-flow', 'Use feature branches', {
        source: 'user',
        confidence: 0.95,
      });
      expect(entry.metadata?.source).toBe('user');
      expect(entry.metadata?.confidence).toBe(0.95);
    });

    it('allows updates for non-read-only categories', () => {
      manager.putMemory(projectId, 'semantic', 'framework', 'React');
      const updated = manager.putMemory(projectId, 'semantic', 'framework', 'Vue');
      expect(updated.content).toBe('Vue');
    });
  });

  // ── Core: Read-Only After Creation ────────────────────────────

  describe('core category (read-only)', () => {
    it('allows initial creation of core entries', () => {
      const entry = manager.putMemory(projectId, 'core', 'identity', 'I am the architect');
      expect(entry.content).toBe('I am the architect');
    });

    it('rejects updates to existing core entries', () => {
      manager.putMemory(projectId, 'core', 'identity', 'I am the architect');
      expect(() =>
        manager.putMemory(projectId, 'core', 'identity', 'I am the developer'),
      ).toThrow(/read-only after creation/);
    });

    it('allows different core keys', () => {
      manager.putMemory(projectId, 'core', 'identity', 'architect');
      manager.putMemory(projectId, 'core', 'preferences', 'explicit types');
      expect(store.count(projectId, 'core')).toBe(2);
    });

    it('enforces max 20 entries (default)', () => {
      for (let i = 0; i < 20; i++) {
        manager.putMemory(projectId, 'core', `key-${i}`, `content-${i}`);
      }
      expect(store.count(projectId, 'core')).toBe(20);

      // 21st entry evicts the oldest
      manager.putMemory(projectId, 'core', 'key-20', 'content-20');
      expect(store.count(projectId, 'core')).toBe(20);
    });

    it('isReadOnly returns true for core', () => {
      expect(manager.isReadOnly('core')).toBe(true);
    });

    it('isReadOnly returns false for other categories', () => {
      expect(manager.isReadOnly('episodic')).toBe(false);
      expect(manager.isReadOnly('procedural')).toBe(false);
      expect(manager.isReadOnly('semantic')).toBe(false);
    });
  });

  // ── Episodic: Time-Based Pruning ──────────────────────────────

  describe('episodic category (pruning)', () => {
    it('stores episodic entries', () => {
      const entry = manager.putMemory(projectId, 'episodic', 'session-1', 'Built the login page');
      expect(entry.category).toBe('episodic');
    });

    it('allows updates to episodic entries', () => {
      manager.putMemory(projectId, 'episodic', 'session-1', 'First draft');
      const updated = manager.putMemory(projectId, 'episodic', 'session-1', 'Final summary');
      expect(updated.content).toBe('Final summary');
    });

    it('pruneEpisodic removes entries older than maxAge', () => {
      // Insert entries with timestamps in the past
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const _recentDate = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

      // Use store directly to set old timestamps
      store.put(projectId, 'episodic', 'old-session', 'Old session summary');
      store.put(projectId, 'episodic', 'new-session', 'New session summary');

      // Manually set the old entry's timestamp via raw SQL
      db.run(
        `UPDATE knowledge SET updated_at = ? WHERE key = ? AND project_id = ?`,
        [oldDate, 'old-session', projectId],
      );

      const result = manager.pruneEpisodic(projectId);
      expect(result.removedByAge).toBe(1);
      expect(store.get(projectId, 'episodic', 'old-session')).toBeUndefined();
      expect(store.get(projectId, 'episodic', 'new-session')).toBeDefined();
    });

    it('pruneEpisodic trims by count keeping newest', () => {
      for (let i = 0; i < 10; i++) {
        manager.putMemory(projectId, 'episodic', `session-${i}`, `Summary ${i}`);
      }

      const result = manager.pruneEpisodic(projectId, undefined, 5);
      expect(result.removedByCount).toBe(5);
      expect(store.count(projectId, 'episodic')).toBe(5);
    });

    it('pruneEpisodic with no entries returns zero', () => {
      const result = manager.pruneEpisodic(projectId);
      expect(result.totalRemoved).toBe(0);
    });

    it('pruneEpisodic respects custom maxAge', () => {
      store.put(projectId, 'episodic', 'recent', 'Recent session');
      // Set to 2 hours ago
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      db.run(
        `UPDATE knowledge SET updated_at = ? WHERE key = ? AND project_id = ?`,
        [twoHoursAgo, 'recent', projectId],
      );

      // Prune with 1-hour maxAge
      const result = manager.pruneEpisodic(projectId, 1 * 60 * 60 * 1000);
      expect(result.removedByAge).toBe(1);
    });
  });

  // ── Procedural: Max Entry Limit ───────────────────────────────

  describe('procedural category (limits)', () => {
    it('stores procedural entries', () => {
      const entry = manager.putMemory(projectId, 'procedural', 'git-workflow', 'Use feature branches');
      expect(entry.category).toBe('procedural');
    });

    it('evicts oldest when at max capacity', () => {
      // Use a small limit for testing
      const smallManager = new MemoryCategoryManager(store, {
        procedural: { maxEntries: 3 },
      });

      smallManager.putMemory(projectId, 'procedural', 'p1', 'Pattern 1');
      smallManager.putMemory(projectId, 'procedural', 'p2', 'Pattern 2');
      smallManager.putMemory(projectId, 'procedural', 'p3', 'Pattern 3');
      expect(store.count(projectId, 'procedural')).toBe(3);

      // 4th entry should evict oldest
      smallManager.putMemory(projectId, 'procedural', 'p4', 'Pattern 4');
      expect(store.count(projectId, 'procedural')).toBe(3);
      expect(store.get(projectId, 'procedural', 'p1')).toBeUndefined();
      expect(store.get(projectId, 'procedural', 'p4')).toBeDefined();
    });

    it('does not evict when updating existing entry', () => {
      const smallManager = new MemoryCategoryManager(store, {
        procedural: { maxEntries: 2 },
      });

      smallManager.putMemory(projectId, 'procedural', 'p1', 'v1');
      smallManager.putMemory(projectId, 'procedural', 'p2', 'v1');

      // Update existing — should not evict
      smallManager.putMemory(projectId, 'procedural', 'p1', 'v2');
      expect(store.count(projectId, 'procedural')).toBe(2);
      expect(store.get(projectId, 'procedural', 'p1')?.content).toBe('v2');
      expect(store.get(projectId, 'procedural', 'p2')).toBeDefined();
    });
  });

  // ── Semantic: Max Entries + Dedup ─────────────────────────────

  describe('semantic category', () => {
    it('stores semantic entries', () => {
      const entry = manager.putMemory(projectId, 'semantic', 'tech-stack', 'React + Node');
      expect(entry.category).toBe('semantic');
    });

    it('deduplicates by key (upsert)', () => {
      manager.putMemory(projectId, 'semantic', 'framework', 'React');
      manager.putMemory(projectId, 'semantic', 'framework', 'React 19');
      expect(store.count(projectId, 'semantic')).toBe(1);
      expect(store.get(projectId, 'semantic', 'framework')?.content).toBe('React 19');
    });

    it('evicts oldest when at max capacity', () => {
      const smallManager = new MemoryCategoryManager(store, {
        semantic: { maxEntries: 3 },
      });

      smallManager.putMemory(projectId, 'semantic', 's1', 'Fact 1');
      smallManager.putMemory(projectId, 'semantic', 's2', 'Fact 2');
      smallManager.putMemory(projectId, 'semantic', 's3', 'Fact 3');
      smallManager.putMemory(projectId, 'semantic', 's4', 'Fact 4');
      expect(store.count(projectId, 'semantic')).toBe(3);
      expect(store.get(projectId, 'semantic', 's1')).toBeUndefined();
    });
  });

  // ── getMemories ───────────────────────────────────────────────

  describe('getMemories', () => {
    it('returns entries for a category', () => {
      manager.putMemory(projectId, 'semantic', 'fact-1', 'Fact one');
      manager.putMemory(projectId, 'semantic', 'fact-2', 'Fact two');
      manager.putMemory(projectId, 'core', 'identity', 'I am an agent');

      const semanticEntries = manager.getMemories(projectId, 'semantic');
      expect(semanticEntries).toHaveLength(2);
    });

    it('respects limit option', () => {
      for (let i = 0; i < 10; i++) {
        manager.putMemory(projectId, 'episodic', `session-${i}`, `Summary ${i}`);
      }

      const limited = manager.getMemories(projectId, 'episodic', { limit: 3 });
      expect(limited).toHaveLength(3);
    });

    it('returns empty array when no entries exist', () => {
      const entries = manager.getMemories(projectId, 'procedural');
      expect(entries).toHaveLength(0);
    });
  });

  // ── getCategoryStats ──────────────────────────────────────────

  describe('getCategoryStats', () => {
    it('returns stats for all 4 categories', () => {
      const stats = manager.getCategoryStats(projectId);
      expect(stats).toHaveLength(4);
      expect(stats.map((s) => s.category)).toEqual(['core', 'episodic', 'procedural', 'semantic']);
    });

    it('reflects current entry counts', () => {
      manager.putMemory(projectId, 'core', 'id', 'agent');
      manager.putMemory(projectId, 'semantic', 'f1', 'fact');
      manager.putMemory(projectId, 'semantic', 'f2', 'fact');

      const stats = manager.getCategoryStats(projectId);
      const coreStats = stats.find((s) => s.category === 'core')!;
      const semanticStats = stats.find((s) => s.category === 'semantic')!;

      expect(coreStats.count).toBe(1);
      expect(coreStats.maxEntries).toBe(20);
      expect(coreStats.readOnly).toBe(true);
      expect(semanticStats.count).toBe(2);
      expect(semanticStats.maxEntries).toBe(500);
      expect(semanticStats.readOnly).toBe(false);
    });
  });

  // ── validateMemory ────────────────────────────────────────────

  describe('validateMemory', () => {
    it('returns null for valid entries', () => {
      expect(manager.validateMemory(projectId, 'semantic', 'key', 'content')).toBeNull();
    });

    it('rejects empty key', () => {
      expect(manager.validateMemory(projectId, 'semantic', '', 'content')).toContain('key cannot be empty');
    });

    it('rejects whitespace-only key', () => {
      expect(manager.validateMemory(projectId, 'semantic', '   ', 'content')).toContain('key cannot be empty');
    });

    it('rejects empty content', () => {
      expect(manager.validateMemory(projectId, 'semantic', 'key', '')).toContain('content cannot be empty');
    });

    it('rejects update to existing core entry', () => {
      manager.putMemory(projectId, 'core', 'identity', 'agent');
      const error = manager.validateMemory(projectId, 'core', 'identity', 'new identity');
      expect(error).toContain('read-only after creation');
    });

    it('allows new core entry', () => {
      expect(manager.validateMemory(projectId, 'core', 'new-key', 'content')).toBeNull();
    });
  });

  // ── deleteMemory ──────────────────────────────────────────────

  describe('deleteMemory', () => {
    it('deletes an existing entry', () => {
      manager.putMemory(projectId, 'semantic', 'fact', 'to delete');
      expect(manager.deleteMemory(projectId, 'semantic', 'fact')).toBe(true);
      expect(store.get(projectId, 'semantic', 'fact')).toBeUndefined();
    });

    it('returns false for non-existent entry', () => {
      expect(manager.deleteMemory(projectId, 'semantic', 'nonexistent')).toBe(false);
    });

    it('allows deletion of core entries (explicit delete)', () => {
      manager.putMemory(projectId, 'core', 'identity', 'agent');
      expect(manager.deleteMemory(projectId, 'core', 'identity')).toBe(true);
    });

    it('allows re-creation of deleted core entry', () => {
      manager.putMemory(projectId, 'core', 'identity', 'v1');
      manager.deleteMemory(projectId, 'core', 'identity');
      const entry = manager.putMemory(projectId, 'core', 'identity', 'v2');
      expect(entry.content).toBe('v2');
    });
  });

  // ── Custom Limits ─────────────────────────────────────────────

  describe('custom limits', () => {
    it('accepts custom max entries per category', () => {
      const custom = new MemoryCategoryManager(store, {
        core: { maxEntries: 5 },
        semantic: { maxEntries: 10 },
      });

      expect(custom.getLimits('core').maxEntries).toBe(5);
      expect(custom.getLimits('semantic').maxEntries).toBe(10);
      // Unspecified categories keep defaults
      expect(custom.getLimits('episodic').maxEntries).toBe(100);
      expect(custom.getLimits('procedural').maxEntries).toBe(200);
    });

    it('accepts custom maxAgeMs for episodic', () => {
      const custom = new MemoryCategoryManager(store, {
        episodic: { maxAgeMs: 7 * 24 * 60 * 60 * 1000 }, // 7 days
      });

      expect(custom.getLimits('episodic').maxAgeMs).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('enforces custom limits', () => {
      const custom = new MemoryCategoryManager(store, {
        semantic: { maxEntries: 2 },
      });

      custom.putMemory(projectId, 'semantic', 's1', 'one');
      custom.putMemory(projectId, 'semantic', 's2', 'two');
      custom.putMemory(projectId, 'semantic', 's3', 'three');

      expect(store.count(projectId, 'semantic')).toBe(2);
      expect(store.get(projectId, 'semantic', 's1')).toBeUndefined();
    });
  });

  // ── getLimits ─────────────────────────────────────────────────

  describe('getLimits', () => {
    it('returns a copy (not the internal reference)', () => {
      const limits = manager.getLimits('core');
      limits.maxEntries = 999;
      expect(manager.getLimits('core').maxEntries).toBe(20);
    });

    it('returns correct defaults for all categories', () => {
      expect(manager.getLimits('core')).toEqual(DEFAULT_CATEGORY_LIMITS.core);
      expect(manager.getLimits('episodic')).toEqual(DEFAULT_CATEGORY_LIMITS.episodic);
      expect(manager.getLimits('procedural')).toEqual(DEFAULT_CATEGORY_LIMITS.procedural);
      expect(manager.getLimits('semantic')).toEqual(DEFAULT_CATEGORY_LIMITS.semantic);
    });
  });

  // ── Project Isolation ─────────────────────────────────────────

  describe('project isolation', () => {
    it('entries from different projects do not interfere', () => {
      manager.putMemory('project-a', 'core', 'identity', 'Agent A');
      manager.putMemory('project-b', 'core', 'identity', 'Agent B');

      expect(store.get('project-a', 'core', 'identity')?.content).toBe('Agent A');
      expect(store.get('project-b', 'core', 'identity')?.content).toBe('Agent B');
    });

    it('stats are per-project', () => {
      manager.putMemory('project-a', 'semantic', 'f1', 'fact');
      manager.putMemory('project-b', 'semantic', 'f1', 'fact');
      manager.putMemory('project-b', 'semantic', 'f2', 'fact');

      const statsA = manager.getCategoryStats('project-a');
      const statsB = manager.getCategoryStats('project-b');

      expect(statsA.find((s) => s.category === 'semantic')!.count).toBe(1);
      expect(statsB.find((s) => s.category === 'semantic')!.count).toBe(2);
    });

    it('pruning only affects the target project', () => {
      manager.putMemory('project-a', 'episodic', 's1', 'summary');
      manager.putMemory('project-b', 'episodic', 's1', 'summary');

      // Set project-a's entry to be old
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      db.run(
        `UPDATE knowledge SET updated_at = ? WHERE key = ? AND project_id = ?`,
        [oldDate, 's1', 'project-a'],
      );

      manager.pruneEpisodic('project-a');
      expect(store.get('project-a', 'episodic', 's1')).toBeUndefined();
      expect(store.get('project-b', 'episodic', 's1')).toBeDefined();
    });
  });
});
