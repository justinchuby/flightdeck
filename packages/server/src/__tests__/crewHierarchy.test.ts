import { describe, it, expect } from 'vitest';
import {
  getCrewDescendants,
  getCrewMembers,
  isCrewDescendant,
  type HierarchyAgent,
} from '@flightdeck/shared';

function agent(id: string, parentId?: string): HierarchyAgent {
  return { id, parentId };
}

describe('getCrewDescendants', () => {
  it('returns direct children', () => {
    const agents = [
      agent('lead'),
      agent('child1', 'lead'),
      agent('child2', 'lead'),
    ];
    const result = getCrewDescendants('lead', agents);
    expect(result.map(a => a.id).sort()).toEqual(['child1', 'child2']);
  });

  it('returns nested sub-agents (2 levels)', () => {
    const agents = [
      agent('lead'),
      agent('sub-lead', 'lead'),
      agent('worker', 'sub-lead'),
    ];
    const result = getCrewDescendants('lead', agents);
    expect(result.map(a => a.id).sort()).toEqual(['sub-lead', 'worker']);
  });

  it('returns deeply nested agents (3+ levels)', () => {
    const agents = [
      agent('lead'),
      agent('sub-lead', 'lead'),
      agent('sub-sub-lead', 'sub-lead'),
      agent('deep-worker', 'sub-sub-lead'),
    ];
    const result = getCrewDescendants('lead', agents);
    expect(result.map(a => a.id).sort()).toEqual([
      'deep-worker', 'sub-lead', 'sub-sub-lead',
    ]);
  });

  it('handles flat crew (no children)', () => {
    const agents = [agent('lead'), agent('other', 'other-lead')];
    const result = getCrewDescendants('lead', agents);
    expect(result).toEqual([]);
  });

  it('handles empty agent list', () => {
    const result = getCrewDescendants('lead', []);
    expect(result).toEqual([]);
  });

  it('handles nonexistent lead', () => {
    const agents = [agent('a', 'b'), agent('b')];
    const result = getCrewDescendants('nonexistent', agents);
    expect(result).toEqual([]);
  });

  it('handles circular references without infinite loop', () => {
    const agents = [
      agent('a', 'b'),
      agent('b', 'a'),
    ];
    const result = getCrewDescendants('a', agents);
    // Should find b (child of a), then stop since a is already visited
    expect(result.map(a => a.id)).toEqual(['b']);
  });

  it('does not include agents from a different crew', () => {
    const agents = [
      agent('lead1'),
      agent('child1', 'lead1'),
      agent('lead2'),
      agent('child2', 'lead2'),
    ];
    const result = getCrewDescendants('lead1', agents);
    expect(result.map(a => a.id)).toEqual(['child1']);
  });

  it('handles mixed parentId types (null and undefined)', () => {
    const agents: HierarchyAgent[] = [
      { id: 'lead', parentId: null },
      { id: 'child', parentId: 'lead' },
      { id: 'orphan', parentId: undefined },
    ];
    const result = getCrewDescendants('lead', agents);
    expect(result.map(a => a.id)).toEqual(['child']);
  });
});

describe('getCrewMembers', () => {
  it('returns lead plus all descendants', () => {
    const agents = [
      agent('lead'),
      agent('child', 'lead'),
      agent('grandchild', 'child'),
    ];
    const result = getCrewMembers('lead', agents);
    expect(result.map(a => a.id)).toEqual(['lead', 'child', 'grandchild']);
  });

  it('returns just descendants if lead not in list', () => {
    const agents = [
      agent('child', 'lead'),
      agent('grandchild', 'child'),
    ];
    const result = getCrewMembers('lead', agents);
    expect(result.map(a => a.id)).toEqual(['child', 'grandchild']);
  });

  it('returns only lead when no children', () => {
    const agents = [agent('lead')];
    const result = getCrewMembers('lead', agents);
    expect(result.map(a => a.id)).toEqual(['lead']);
  });
});

describe('isCrewDescendant', () => {
  it('returns true for direct child', () => {
    const agents = [agent('lead'), agent('child', 'lead')];
    expect(isCrewDescendant('child', 'lead', agents)).toBe(true);
  });

  it('returns true for deeply nested descendant', () => {
    const agents = [
      agent('lead'),
      agent('mid', 'lead'),
      agent('deep', 'mid'),
      agent('deepest', 'deep'),
    ];
    expect(isCrewDescendant('deepest', 'lead', agents)).toBe(true);
  });

  it('returns false for unrelated agent', () => {
    const agents = [
      agent('lead'),
      agent('child', 'lead'),
      agent('other', 'other-lead'),
    ];
    expect(isCrewDescendant('other', 'lead', agents)).toBe(false);
  });

  it('returns false when agentId equals leadId', () => {
    const agents = [agent('lead')];
    expect(isCrewDescendant('lead', 'lead', agents)).toBe(false);
  });

  it('returns false for nonexistent agent', () => {
    const agents = [agent('lead')];
    expect(isCrewDescendant('ghost', 'lead', agents)).toBe(false);
  });

  it('handles circular references without infinite loop', () => {
    const agents = [agent('a', 'b'), agent('b', 'a')];
    expect(isCrewDescendant('a', 'b', agents)).toBe(true);
    // Doesn't hang
  });
});
