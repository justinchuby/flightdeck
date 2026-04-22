import { describe, it, expect } from 'vitest';
import { isCrewMember, getCrewAgents, getCrewIds, type CrewMemberLike } from '../crewUtils.js';

function makeAgent(overrides: Partial<CrewMemberLike> & { id: string }): CrewMemberLike {
  return { parentId: undefined, projectId: undefined, ...overrides };
}

describe('crewUtils', () => {
  describe('isCrewMember', () => {
    it('matches agent whose id equals leadId (the lead itself)', () => {
      const agent = makeAgent({ id: 'lead-1' });
      expect(isCrewMember(agent, 'lead-1')).toBe(true);
    });

    it('matches agent whose parentId equals leadId (direct child)', () => {
      const agent = makeAgent({ id: 'dev-1', parentId: 'lead-1' });
      expect(isCrewMember(agent, 'lead-1')).toBe(true);
    });

    it('matches agent whose projectId equals leadId (project slug)', () => {
      const agent = makeAgent({ id: 'dev-1', parentId: 'other-uuid', projectId: 'proj-abc' });
      expect(isCrewMember(agent, 'proj-abc')).toBe(true);
    });

    it('does NOT match unrelated agent', () => {
      const agent = makeAgent({ id: 'foreign-1', parentId: 'other-lead', projectId: 'other-proj' });
      expect(isCrewMember(agent, 'lead-1')).toBe(false);
    });

    it('handles undefined parentId and projectId', () => {
      const agent = makeAgent({ id: 'orphan' });
      expect(isCrewMember(agent, 'lead-1')).toBe(false);
    });
  });

  describe('getCrewAgents', () => {
    const agents = [
      makeAgent({ id: 'lead-1' }),
      makeAgent({ id: 'dev-1', parentId: 'lead-1' }),
      makeAgent({ id: 'dev-2', parentId: 'lead-1', projectId: 'proj-abc' }),
      makeAgent({ id: 'foreign-1', parentId: 'other-lead' }),
    ];

    it('returns only crew members', () => {
      const crew = getCrewAgents(agents, 'lead-1');
      expect(crew.map(a => a.id)).toEqual(['lead-1', 'dev-1', 'dev-2']);
    });

    it('matches by projectId when leadId is a project slug', () => {
      const crew = getCrewAgents(agents, 'proj-abc');
      expect(crew.map(a => a.id)).toEqual(['dev-2']);
    });

    it('returns empty array when no matches', () => {
      expect(getCrewAgents(agents, 'nonexistent')).toEqual([]);
    });
  });

  describe('getCrewIds', () => {
    const agents = [
      makeAgent({ id: 'lead-1' }),
      makeAgent({ id: 'dev-1', parentId: 'lead-1' }),
      makeAgent({ id: 'foreign-1', parentId: 'other-lead' }),
    ];

    it('always includes leadId itself', () => {
      const ids = getCrewIds([], 'lead-1');
      expect(ids.has('lead-1')).toBe(true);
      expect(ids.size).toBe(1);
    });

    it('includes matching agent ids', () => {
      const ids = getCrewIds(agents, 'lead-1');
      expect(ids.has('lead-1')).toBe(true);
      expect(ids.has('dev-1')).toBe(true);
      expect(ids.has('foreign-1')).toBe(false);
      expect(ids.size).toBe(2);
    });

    it('works with project slug leadId', () => {
      const agentsWithProject = [
        makeAgent({ id: 'a1', projectId: 'proj-x' }),
        makeAgent({ id: 'a2', projectId: 'proj-y' }),
      ];
      const ids = getCrewIds(agentsWithProject, 'proj-x');
      expect(ids.has('proj-x')).toBe(true);
      expect(ids.has('a1')).toBe(true);
      expect(ids.has('a2')).toBe(false);
    });
  });
});
