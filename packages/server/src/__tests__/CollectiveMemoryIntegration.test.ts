import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../db/database.js';
import { CollectiveMemory, KNOWLEDGE_TO_MEMORY_CATEGORY } from '../coordination/knowledge/CollectiveMemory.js';
import type { MemoryCategory } from '../coordination/knowledge/CollectiveMemory.js';

/**
 * Tests for the CollectiveMemory integration with the agent lifecycle.
 *
 * Mirrors the recall logic in AgentManager.spawn() and the remember logic
 * in AgentManager.extractSessionKnowledge() for focused unit testing.
 */

// ── Mirror of recall logic in spawn() ───────────────────────────────

function applyCollectiveMemoryRecall(
  systemPrompt: string,
  collectiveMemory: CollectiveMemory | undefined,
  projectId: string | undefined,
): { prompt: string; memoriesIncluded: number } {
  if (!collectiveMemory || !projectId) return { prompt: systemPrompt, memoriesIncluded: 0 };

  const categories: MemoryCategory[] = ['pattern', 'decision', 'gotcha'];
  const memories = categories.flatMap((cat) =>
    collectiveMemory.recall(cat, undefined, projectId),
  );
  if (memories.length === 0) return { prompt: systemPrompt, memoriesIncluded: 0 };

  const memoriesBlock = memories
    .slice(0, 20)
    .map((m) => `- [${m.category}] ${m.key}: ${m.value}`)
    .join('\n');
  return {
    prompt: `${systemPrompt}\n\n<collective_memory>\n${memoriesBlock}\n</collective_memory>`,
    memoriesIncluded: Math.min(memories.length, 20),
  };
}

// ── Mirror of remember logic in extractSessionKnowledge() ───────────

interface MockExtraction {
  category: string;
  key: string;
  content: string;
}

function rememberExtractedKnowledge(
  collectiveMemory: CollectiveMemory | undefined,
  entries: MockExtraction[],
  agentId: string,
  projectId: string,
): number {
  if (!collectiveMemory) return 0;
  for (const entry of entries) {
    const memCat = KNOWLEDGE_TO_MEMORY_CATEGORY[entry.category] ?? 'pattern';
    collectiveMemory.remember(memCat, entry.key, entry.content, agentId, projectId);
  }
  return entries.length;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('CollectiveMemory lifecycle integration', () => {
  let db: Database;
  let memory: CollectiveMemory;

  beforeEach(() => {
    db = new Database(':memory:');
    memory = new CollectiveMemory(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('recall on spawn', () => {
    it('injects collective memories into system prompt', () => {
      memory.remember('pattern', 'test-pattern', 'Always use factories', 'agent-old', 'proj-1');
      memory.remember('decision', 'arch-choice', 'Use event sourcing', 'agent-old', 'proj-1');

      const { prompt, memoriesIncluded } = applyCollectiveMemoryRecall(
        'You are a developer.',
        memory,
        'proj-1',
      );

      expect(prompt).toContain('<collective_memory>');
      expect(prompt).toContain('[pattern] test-pattern: Always use factories');
      expect(prompt).toContain('[decision] arch-choice: Use event sourcing');
      expect(memoriesIncluded).toBe(2);
    });

    it('skips when no memories exist for project', () => {
      memory.remember('pattern', 'other-pattern', 'Irrelevant', 'agent-x', 'proj-other');

      const { prompt, memoriesIncluded } = applyCollectiveMemoryRecall(
        'You are a developer.',
        memory,
        'proj-1',
      );

      expect(prompt).toBe('You are a developer.');
      expect(memoriesIncluded).toBe(0);
    });

    it('skips when collectiveMemory is undefined', () => {
      const { prompt } = applyCollectiveMemoryRecall('You are a developer.', undefined, 'proj-1');
      expect(prompt).toBe('You are a developer.');
    });

    it('skips when projectId is undefined', () => {
      const { prompt } = applyCollectiveMemoryRecall('You are a developer.', memory, undefined);
      expect(prompt).toBe('You are a developer.');
    });

    it('caps at 20 memories', () => {
      for (let i = 0; i < 25; i++) {
        memory.remember('pattern', `key-${i}`, `value-${i}`, 'agent-x', 'proj-1');
      }

      const { memoriesIncluded } = applyCollectiveMemoryRecall('prompt', memory, 'proj-1');
      expect(memoriesIncluded).toBe(20);
    });
  });

  describe('remember on extraction', () => {
    it('stores extracted entries as collective memories', () => {
      const entries: MockExtraction[] = [
        { category: 'semantic', key: 'use-factories', content: 'Use factory pattern for tests' },
        { category: 'procedural', key: 'build-first', content: 'Always build before testing' },
      ];

      const count = rememberExtractedKnowledge(memory, entries, 'agent-1', 'proj-1');
      expect(count).toBe(2);

      const decisions = memory.recall('decision', undefined, 'proj-1');
      expect(decisions).toHaveLength(1);
      expect(decisions[0].key).toBe('use-factories');

      const patterns = memory.recall('pattern', undefined, 'proj-1');
      expect(patterns).toHaveLength(1);
      expect(patterns[0].key).toBe('build-first');
    });

    it('maps unknown categories to pattern', () => {
      rememberExtractedKnowledge(
        memory,
        [{ category: 'unknown-cat', key: 'misc', content: 'some note' }],
        'agent-1',
        'proj-1',
      );
      const patterns = memory.recall('pattern', undefined, 'proj-1');
      expect(patterns).toHaveLength(1);
      expect(patterns[0].key).toBe('misc');
    });

    it('skips when collectiveMemory is undefined', () => {
      const count = rememberExtractedKnowledge(
        undefined,
        [{ category: 'semantic', key: 'k', content: 'v' }],
        'agent-1',
        'proj-1',
      );
      expect(count).toBe(0);
    });
  });

  describe('full round-trip', () => {
    it('remember then recall works across sessions', () => {
      // Session 1: agent completes and stores learnings
      rememberExtractedKnowledge(
        memory,
        [
          { category: 'semantic', key: 'db-pattern', content: 'Use connection pooling' },
          { category: 'procedural', key: 'deploy-order', content: 'Migrate DB before deploying app' },
        ],
        'agent-session-1',
        'proj-1',
      );

      // Session 2: new agent spawns and recalls
      const { prompt, memoriesIncluded } = applyCollectiveMemoryRecall(
        'You are a developer.',
        memory,
        'proj-1',
      );

      expect(memoriesIncluded).toBe(2);
      expect(prompt).toContain('Use connection pooling');
      expect(prompt).toContain('Migrate DB before deploying app');
    });
  });
});
