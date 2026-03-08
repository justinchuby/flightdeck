import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  walkCausalGraph,
  wouldCreateCycle,
  OrphanManager,
  resolveLastSeenEventId,
  type CausalEvent,
} from '../coordination/events/ProjectionUtils.js';

// ── walkCausalGraph ───────────────────────────────────────────────

describe('walkCausalGraph', () => {
  it('traverses a simple tree', () => {
    const graph: Record<string, string[]> = {
      A: ['B', 'C'],
      B: ['D'],
      C: [],
      D: [],
    };
    const visited = walkCausalGraph('A', (id) => graph[id] ?? []);
    expect(visited).toEqual(new Set(['A', 'B', 'C', 'D']));
  });

  it('handles cycles without infinite looping', () => {
    const graph: Record<string, string[]> = {
      A: ['B'],
      B: ['C'],
      C: ['A'], // cycle back to A
    };
    const visited = walkCausalGraph('A', (id) => graph[id] ?? []);
    expect(visited).toEqual(new Set(['A', 'B', 'C']));
  });

  it('handles self-referencing node', () => {
    const graph: Record<string, string[]> = {
      A: ['A'], // self-cycle
    };
    const visited = walkCausalGraph('A', (id) => graph[id] ?? []);
    expect(visited).toEqual(new Set(['A']));
  });

  it('handles isolated node with no children', () => {
    const visited = walkCausalGraph('X', () => []);
    expect(visited).toEqual(new Set(['X']));
  });
});

// ── wouldCreateCycle ──────────────────────────────────────────────

describe('wouldCreateCycle', () => {
  it('detects direct cycle (A→B, B→A)', () => {
    const parents: Record<string, string> = { B: 'A' };
    expect(wouldCreateCycle('A', 'B', (id) => parents[id])).toBe(true);
  });

  it('detects indirect cycle (A→B→C, C→A)', () => {
    const parents: Record<string, string> = { C: 'B', B: 'A' };
    expect(wouldCreateCycle('A', 'C', (id) => parents[id])).toBe(true);
  });

  it('returns false when no cycle exists', () => {
    const parents: Record<string, string> = { C: 'B' };
    expect(wouldCreateCycle('A', 'C', (id) => parents[id])).toBe(false);
  });

  it('returns false for unconnected nodes', () => {
    expect(wouldCreateCycle('X', 'Y', () => undefined)).toBe(false);
  });
});

// ── OrphanManager ─────────────────────────────────────────────────

describe('OrphanManager', () => {
  let manager: OrphanManager;

  beforeEach(() => {
    manager = new OrphanManager({ orphanTtlMs: 100, maxOrphans: 3 });
  });

  function makeEvent(id: string, causedBy?: string): CausalEvent {
    return { id, causedBy, timestamp: new Date().toISOString() };
  }

  it('tracks orphans and reports count', () => {
    manager.addOrphan(makeEvent('e1', 'unknown'));
    manager.addOrphan(makeEvent('e2', 'unknown'));
    expect(manager.orphanCount).toBe(2);
    expect(manager.getOrphanIds()).toEqual(['e1', 'e2']);
  });

  it('resolves an orphan when parent appears', () => {
    manager.addOrphan(makeEvent('e1', 'parent1'));
    const resolved = manager.resolve('e1');
    expect(resolved).toBeDefined();
    expect(resolved!.event.id).toBe('e1');
    expect(manager.orphanCount).toBe(0);
  });

  it('does not duplicate orphans on re-add', () => {
    const event = makeEvent('e1', 'unknown');
    manager.addOrphan(event);
    manager.addOrphan(event);
    expect(manager.orphanCount).toBe(1);
  });

  it('promotes expired orphans after TTL', async () => {
    vi.useFakeTimers();
    try {
      manager.addOrphan(makeEvent('e1', 'unknown'));
      // Not expired yet
      let promoted = manager.promoteExpired();
      expect(promoted).toHaveLength(0);
      expect(manager.orphanCount).toBe(1);

      // Advance past TTL
      vi.advanceTimersByTime(150);
      promoted = manager.promoteExpired();
      expect(promoted).toHaveLength(1);
      expect(promoted[0].id).toBe('e1');
      expect(manager.orphanCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('enforces cap by promoting oldest orphans', () => {
    vi.useFakeTimers();
    try {
      // Add 5 orphans (cap is 3)
      for (let i = 0; i < 5; i++) {
        manager.addOrphan(makeEvent(`e${i}`, 'unknown'));
        vi.advanceTimersByTime(1); // stagger timestamps
      }
      expect(manager.orphanCount).toBe(5);

      const promoted = manager.promoteExpired();
      // 2 should be promoted (5 - 3 = 2 excess, oldest first)
      expect(promoted).toHaveLength(2);
      expect(promoted[0].id).toBe('e0');
      expect(promoted[1].id).toBe('e1');
      expect(manager.orphanCount).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── resolveLastSeenEventId ────────────────────────────────────────

describe('resolveLastSeenEventId', () => {
  it('returns the ID if it exists in the known set', () => {
    const known = new Set(['evt-1', 'evt-2', 'evt-3']);
    expect(resolveLastSeenEventId('evt-2', known)).toBe('evt-2');
  });

  it('returns undefined if the ID was purged', () => {
    const known = new Set(['evt-5', 'evt-6']);
    expect(resolveLastSeenEventId('evt-1', known)).toBeUndefined();
  });

  it('returns undefined for null/undefined input', () => {
    const known = new Set(['evt-1']);
    expect(resolveLastSeenEventId(null, known)).toBeUndefined();
    expect(resolveLastSeenEventId(undefined, known)).toBeUndefined();
  });

  it('works with Map as well as Set', () => {
    const known = new Map<string, unknown>([['evt-1', {}]]);
    expect(resolveLastSeenEventId('evt-1', known)).toBe('evt-1');
    expect(resolveLastSeenEventId('evt-99', known)).toBeUndefined();
  });
});
