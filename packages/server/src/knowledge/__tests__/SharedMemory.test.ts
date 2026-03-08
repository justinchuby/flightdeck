import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database } from '../../db/database.js';
import { KnowledgeStore } from '../KnowledgeStore.js';
import { SharedMemory } from '../SharedMemory.js';
import type { KnowledgeEntry } from '../types.js';

describe('SharedMemory', () => {
  let db: Database;
  let store: KnowledgeStore;
  let shared: SharedMemory;
  const projectId = 'test-project-sm';

  beforeEach(() => {
    db = new Database(':memory:');
    store = new KnowledgeStore(db);
    shared = new SharedMemory(store);
  });

  afterEach(() => {
    db.close();
  });

  describe('share', () => {
    it('creates new shared entries with agent attribution', () => {
      const result = shared.share(projectId, 'agent-1', [
        { category: 'semantic', key: 'api-pattern', content: 'Use REST for public APIs' },
      ]);

      expect(result.created).toBe(1);
      expect(result.merged).toBe(0);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].metadata?.source).toBe('agent-1');
      expect(result.entries[0].metadata?.contributors).toEqual(['agent-1']);
    });

    it('stores entries with shared: key prefix', () => {
      shared.share(projectId, 'agent-1', [
        { category: 'semantic', key: 'naming', content: 'Use camelCase' },
      ]);

      // Direct store access should find it under shared. prefix
      const entry = store.get(projectId, 'semantic', 'shared.naming');
      expect(entry).toBeDefined();
      expect(entry!.content).toBe('Use camelCase');
    });

    it('supports custom confidence and tags', () => {
      const result = shared.share(projectId, 'agent-1', [
        { category: 'procedural', key: 'deploy', content: 'Always run tests first', confidence: 0.9, tags: ['ci', 'testing'] },
      ]);

      expect(result.entries[0].metadata?.confidence).toBe(0.9);
      expect(result.entries[0].metadata?.tags).toEqual(['ci', 'testing']);
    });

    it('creates multiple entries in one call', () => {
      const result = shared.share(projectId, 'agent-1', [
        { category: 'semantic', key: 'fact-1', content: 'Fact 1' },
        { category: 'procedural', key: 'proc-1', content: 'Procedure 1' },
        { category: 'episodic', key: 'ep-1', content: 'Episode 1' },
      ]);

      expect(result.created).toBe(3);
      expect(result.merged).toBe(0);
    });
  });

  describe('deduplication / merge', () => {
    it('merges when two agents share the same key', () => {
      shared.share(projectId, 'agent-1', [
        { category: 'semantic', key: 'pattern', content: 'Use dependency injection', confidence: 0.5 },
      ]);

      const result = shared.share(projectId, 'agent-2', [
        { category: 'semantic', key: 'pattern', content: 'Use dependency injection (updated)', confidence: 0.5 },
      ]);

      expect(result.created).toBe(0);
      expect(result.merged).toBe(1);

      // Contributors should include both agents
      const entry = result.entries[0];
      expect(entry.metadata?.contributors).toEqual(['agent-1', 'agent-2']);

      // Confidence should be boosted
      expect(entry.metadata?.confidence).toBeGreaterThan(0.5);
    });

    it('does not duplicate contributor on re-share by same agent', () => {
      shared.share(projectId, 'agent-1', [
        { category: 'semantic', key: 'fact', content: 'v1' },
      ]);

      shared.share(projectId, 'agent-1', [
        { category: 'semantic', key: 'fact', content: 'v2' },
      ]);

      const insights = shared.getTeamInsights(projectId);
      expect(insights.totalEntries).toBe(1);
      expect(insights.entries[0].metadata?.contributors).toEqual(['agent-1']);
      expect(insights.entries[0].content).toBe('v2');
    });

    it('merges tags from multiple agents', () => {
      shared.share(projectId, 'agent-1', [
        { category: 'semantic', key: 'tech', content: 'Use TypeScript', tags: ['language'] },
      ]);

      shared.share(projectId, 'agent-2', [
        { category: 'semantic', key: 'tech', content: 'Use TypeScript', tags: ['language', 'types'] },
      ]);

      const entry = shared.getSharedKnowledge(projectId, 'agent-3', { includeSelf: true })[0];
      expect(entry.metadata?.tags).toContain('language');
      expect(entry.metadata?.tags).toContain('types');
      // Should be deduplicated
      expect(entry.metadata?.tags?.filter(t => t === 'language')).toHaveLength(1);
    });

    it('caps confidence at 1.0', () => {
      shared.share(projectId, 'agent-1', [
        { category: 'semantic', key: 'high-conf', content: 'known fact', confidence: 0.95 },
      ]);

      // Multiple merges should not exceed 1.0
      for (let i = 2; i <= 5; i++) {
        shared.share(projectId, `agent-${i}`, [
          { category: 'semantic', key: 'high-conf', content: 'known fact' },
        ]);
      }

      const entry = shared.getTeamInsights(projectId).entries[0];
      expect(entry.metadata?.confidence).toBeLessThanOrEqual(1.0);
    });
  });

  describe('getSharedKnowledge', () => {
    beforeEach(() => {
      shared.share(projectId, 'agent-1', [
        { category: 'semantic', key: 'a1-fact', content: 'From agent 1' },
      ]);
      shared.share(projectId, 'agent-2', [
        { category: 'semantic', key: 'a2-fact', content: 'From agent 2' },
      ]);
      shared.share(projectId, 'agent-3', [
        { category: 'procedural', key: 'a3-proc', content: 'From agent 3' },
      ]);
    });

    it('excludes own contributions by default', () => {
      const entries = shared.getSharedKnowledge(projectId, 'agent-1');
      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.metadata?.source !== 'agent-1')).toBe(true);
    });

    it('includes own contributions when includeSelf is true', () => {
      const entries = shared.getSharedKnowledge(projectId, 'agent-1', { includeSelf: true });
      expect(entries).toHaveLength(3);
    });

    it('filters by category', () => {
      const entries = shared.getSharedKnowledge(projectId, 'agent-1', { category: 'procedural' });
      expect(entries).toHaveLength(1);
      expect(entries[0].content).toBe('From agent 3');
    });

    it('applies limit', () => {
      const entries = shared.getSharedKnowledge(projectId, 'agent-1', { limit: 1 });
      expect(entries).toHaveLength(1);
    });

    it('returns empty for agent with no shared knowledge from others', () => {
      const shared2 = new SharedMemory(store);
      // Only one agent has shared
      const freshStore = new KnowledgeStore(db);
      const freshShared = new SharedMemory(freshStore);
      freshShared.share('fresh-proj', 'solo-agent', [
        { category: 'semantic', key: 'lonely', content: 'Only mine' },
      ]);

      const entries = freshShared.getSharedKnowledge('fresh-proj', 'solo-agent');
      expect(entries).toHaveLength(0);
    });

    it('does not return non-shared entries from KnowledgeStore', () => {
      // Add a non-shared entry directly to the store
      store.put(projectId, 'semantic', 'private-key', 'private data');

      const entries = shared.getSharedKnowledge(projectId, 'agent-1', { includeSelf: true });
      // Should only include shared: prefixed entries
      expect(entries.every(e => e.key.startsWith('shared.'))).toBe(true);
    });
  });

  describe('getTeamInsights', () => {
    it('returns aggregated stats across all agents', () => {
      shared.share(projectId, 'agent-1', [
        { category: 'semantic', key: 'f1', content: 'Fact 1' },
        { category: 'semantic', key: 'f2', content: 'Fact 2' },
      ]);
      shared.share(projectId, 'agent-2', [
        { category: 'procedural', key: 'p1', content: 'Proc 1' },
      ]);

      const insights = shared.getTeamInsights(projectId);
      expect(insights.totalEntries).toBe(3);
      expect(insights.contributors).toContain('agent-1');
      expect(insights.contributors).toContain('agent-2');
      expect(insights.byCategory['semantic']).toBe(2);
      expect(insights.byCategory['procedural']).toBe(1);
    });

    it('returns empty insights for project with no shared knowledge', () => {
      const insights = shared.getTeamInsights('empty-project');
      expect(insights.totalEntries).toBe(0);
      expect(insights.contributors).toEqual([]);
      expect(insights.entries).toEqual([]);
    });
  });

  describe('getContributorStats', () => {
    it('returns per-agent contribution stats', () => {
      shared.share(projectId, 'agent-1', [
        { category: 'semantic', key: 'f1', content: 'F1' },
        { category: 'procedural', key: 'p1', content: 'P1' },
      ]);
      shared.share(projectId, 'agent-2', [
        { category: 'semantic', key: 'f2', content: 'F2' },
      ]);

      const stats = shared.getContributorStats(projectId);
      expect(stats).toHaveLength(2);

      const a1 = stats.find(s => s.agentId === 'agent-1')!;
      expect(a1.entryCount).toBe(2);
      expect(a1.categories['semantic']).toBe(1);
      expect(a1.categories['procedural']).toBe(1);

      const a2 = stats.find(s => s.agentId === 'agent-2')!;
      expect(a2.entryCount).toBe(1);
    });
  });

  describe('access control', () => {
    it('allows agent to delete own shared entry', () => {
      shared.share(projectId, 'agent-1', [
        { category: 'semantic', key: 'deletable', content: 'test' },
      ]);

      const deleted = shared.deleteOwnEntry(projectId, 'agent-1', 'semantic', 'deletable');
      expect(deleted).toBe(true);

      const insights = shared.getTeamInsights(projectId);
      expect(insights.totalEntries).toBe(0);
    });

    it('prevents agent from deleting another agent\'s entry', () => {
      shared.share(projectId, 'agent-1', [
        { category: 'semantic', key: 'protected', content: 'mine' },
      ]);

      const deleted = shared.deleteOwnEntry(projectId, 'agent-2', 'semantic', 'protected');
      expect(deleted).toBe(false);

      // Entry should still exist
      expect(shared.getTeamInsights(projectId).totalEntries).toBe(1);
    });

    it('returns false for non-existent entry deletion', () => {
      const deleted = shared.deleteOwnEntry(projectId, 'agent-1', 'semantic', 'nope');
      expect(deleted).toBe(false);
    });
  });

  describe('notifications', () => {
    it('notifies listeners when new shared knowledge is created', () => {
      const listener = vi.fn();
      shared.onShare(listener);

      shared.share(projectId, 'agent-1', [
        { category: 'semantic', key: 'new-fact', content: 'Something new' },
      ]);

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(
        projectId,
        'agent-1',
        expect.objectContaining({ content: 'Something new' }),
      );
    });

    it('does not notify on merge (only new entries)', () => {
      const listener = vi.fn();
      shared.onShare(listener);

      shared.share(projectId, 'agent-1', [
        { category: 'semantic', key: 'existing', content: 'v1' },
      ]);
      expect(listener).toHaveBeenCalledOnce();

      // Merge should NOT trigger notification
      shared.share(projectId, 'agent-2', [
        { category: 'semantic', key: 'existing', content: 'v2' },
      ]);
      expect(listener).toHaveBeenCalledOnce(); // Still 1
    });

    it('can remove listeners with offShare', () => {
      const listener = vi.fn();
      shared.onShare(listener);
      shared.offShare(listener);

      shared.share(projectId, 'agent-1', [
        { category: 'semantic', key: 'quiet', content: 'no notification' },
      ]);
      expect(listener).not.toHaveBeenCalled();
    });

    it('handles listener errors gracefully', () => {
      const badListener = vi.fn(() => { throw new Error('listener crash'); });
      const goodListener = vi.fn();
      shared.onShare(badListener);
      shared.onShare(goodListener);

      // Should not throw
      shared.share(projectId, 'agent-1', [
        { category: 'semantic', key: 'safe', content: 'safe' },
      ]);

      expect(badListener).toHaveBeenCalled();
      expect(goodListener).toHaveBeenCalled();
    });
  });

  describe('project isolation', () => {
    it('knowledge from one project is not visible in another', () => {
      shared.share('proj-A', 'agent-1', [
        { category: 'semantic', key: 'secret', content: 'Project A only' },
      ]);

      const entries = shared.getSharedKnowledge('proj-B', 'agent-2', { includeSelf: true });
      expect(entries).toHaveLength(0);

      const insights = shared.getTeamInsights('proj-B');
      expect(insights.totalEntries).toBe(0);
    });
  });
});
