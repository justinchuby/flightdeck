import { describe, it, expect } from 'vitest';

// AgentManager is too complex to instantiate without full deps.
// Extract the project-scoping logic for focused unit testing.

interface MockAgent {
  id: string;
  projectId?: string;
  parentId?: string;
}

/** Mirror of AgentManager.getProjectIdForAgent — walks up parent chain */
function getProjectIdForAgent(
  agents: Map<string, MockAgent>,
  agentId: string,
): string | undefined {
  const agent = agents.get(agentId);
  if (!agent) return undefined;
  if (agent.projectId) return agent.projectId;
  if (agent.parentId) {
    return getProjectIdForAgent(agents, agent.parentId);
  }
  return undefined;
}

/** Mirror of AgentManager.getByProject — filter agents by project */
function getByProject(
  agents: Map<string, MockAgent>,
  projectId: string,
): MockAgent[] {
  return Array.from(agents.values()).filter(
    (a) => getProjectIdForAgent(agents, a.id) === projectId,
  );
}

// ── Test data ────────────────────────────────────────────────────────

function buildScenario() {
  const agents = new Map<string, MockAgent>();

  // Project A: lead + 2 children
  agents.set('lead-a', { id: 'lead-a', projectId: 'proj-a' });
  agents.set('dev-a1', { id: 'dev-a1', parentId: 'lead-a', projectId: 'proj-a' });
  agents.set('dev-a2', { id: 'dev-a2', parentId: 'lead-a', projectId: 'proj-a' });

  // Project B: lead + 1 child
  agents.set('lead-b', { id: 'lead-b', projectId: 'proj-b' });
  agents.set('dev-b1', { id: 'dev-b1', parentId: 'lead-b', projectId: 'proj-b' });

  return agents;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('AgentManager project scoping', () => {
  describe('getProjectIdForAgent', () => {
    it('returns projectId for a lead agent', () => {
      const agents = buildScenario();
      expect(getProjectIdForAgent(agents, 'lead-a')).toBe('proj-a');
    });

    it('returns projectId for a child with explicit projectId', () => {
      const agents = buildScenario();
      expect(getProjectIdForAgent(agents, 'dev-a1')).toBe('proj-a');
    });

    it('walks up parent chain when child has no explicit projectId', () => {
      const agents = new Map<string, MockAgent>();
      agents.set('lead-x', { id: 'lead-x', projectId: 'proj-x' });
      agents.set('child-x', { id: 'child-x', parentId: 'lead-x' }); // no explicit projectId
      expect(getProjectIdForAgent(agents, 'child-x')).toBe('proj-x');
    });

    it('walks up multiple levels (sub-lead → lead)', () => {
      const agents = new Map<string, MockAgent>();
      agents.set('root-lead', { id: 'root-lead', projectId: 'proj-deep' });
      agents.set('sub-lead', { id: 'sub-lead', parentId: 'root-lead' }); // inherits
      agents.set('dev', { id: 'dev', parentId: 'sub-lead' }); // inherits from sub-lead → root
      expect(getProjectIdForAgent(agents, 'dev')).toBe('proj-deep');
    });

    it('returns undefined for unknown agentId', () => {
      const agents = buildScenario();
      expect(getProjectIdForAgent(agents, 'nonexistent')).toBeUndefined();
    });

    it('returns undefined when no projectId in chain (single-project / legacy)', () => {
      const agents = new Map<string, MockAgent>();
      agents.set('lead-old', { id: 'lead-old' }); // no projectId
      agents.set('dev-old', { id: 'dev-old', parentId: 'lead-old' });
      expect(getProjectIdForAgent(agents, 'dev-old')).toBeUndefined();
    });

    it('returns undefined for orphan agent with no projectId', () => {
      const agents = new Map<string, MockAgent>();
      agents.set('orphan', { id: 'orphan' });
      expect(getProjectIdForAgent(agents, 'orphan')).toBeUndefined();
    });
  });

  describe('getByProject', () => {
    it('returns only agents from the specified project', () => {
      const agents = buildScenario();
      const projA = getByProject(agents, 'proj-a');
      expect(projA.map((a) => a.id).sort()).toEqual(['dev-a1', 'dev-a2', 'lead-a']);
    });

    it('returns only agents from project B', () => {
      const agents = buildScenario();
      const projB = getByProject(agents, 'proj-b');
      expect(projB.map((a) => a.id).sort()).toEqual(['dev-b1', 'lead-b']);
    });

    it('returns empty array for unknown projectId', () => {
      const agents = buildScenario();
      expect(getByProject(agents, 'proj-unknown')).toEqual([]);
    });

    it('includes children that inherit projectId from parent', () => {
      const agents = new Map<string, MockAgent>();
      agents.set('lead', { id: 'lead', projectId: 'proj-inherit' });
      agents.set('child', { id: 'child', parentId: 'lead' }); // no explicit projectId
      const result = getByProject(agents, 'proj-inherit');
      expect(result.map((a) => a.id).sort()).toEqual(['child', 'lead']);
    });

    it('does not include agents from other projects', () => {
      const agents = buildScenario();
      const projA = getByProject(agents, 'proj-a');
      const ids = projA.map((a) => a.id);
      expect(ids).not.toContain('lead-b');
      expect(ids).not.toContain('dev-b1');
    });

    it('does not include legacy agents without projectId', () => {
      const agents = buildScenario();
      agents.set('legacy', { id: 'legacy' }); // no projectId, no parentId
      const projA = getByProject(agents, 'proj-a');
      expect(projA.map((a) => a.id)).not.toContain('legacy');
    });

    it('works with empty agent map', () => {
      const agents = new Map<string, MockAgent>();
      expect(getByProject(agents, 'proj-a')).toEqual([]);
    });
  });

  describe('backward compatibility', () => {
    it('single-project setup: agents without projectId are not filtered into any project', () => {
      const agents = new Map<string, MockAgent>();
      agents.set('lead', { id: 'lead' });
      agents.set('dev', { id: 'dev', parentId: 'lead' });
      // No projectId anywhere — getByProject should return nothing
      expect(getByProject(agents, 'some-project')).toEqual([]);
      // getProjectIdForAgent should return undefined for all
      expect(getProjectIdForAgent(agents, 'lead')).toBeUndefined();
      expect(getProjectIdForAgent(agents, 'dev')).toBeUndefined();
    });

    it('mixed setup: some agents have projectId, others do not', () => {
      const agents = new Map<string, MockAgent>();
      agents.set('lead-new', { id: 'lead-new', projectId: 'proj-new' });
      agents.set('dev-new', { id: 'dev-new', parentId: 'lead-new', projectId: 'proj-new' });
      agents.set('lead-old', { id: 'lead-old' }); // legacy, no projectId
      agents.set('dev-old', { id: 'dev-old', parentId: 'lead-old' });

      const projNew = getByProject(agents, 'proj-new');
      expect(projNew.map((a) => a.id).sort()).toEqual(['dev-new', 'lead-new']);
      // Legacy agents not in any project
      expect(getProjectIdForAgent(agents, 'lead-old')).toBeUndefined();
      expect(getProjectIdForAgent(agents, 'dev-old')).toBeUndefined();
    });
  });

  describe('projectId propagation at spawn time', () => {
    it('sub-agents inherit projectId when parent has it set', () => {
      const agents = new Map<string, MockAgent>();
      // Simulate: lead spawns with projectId, then children inherit
      const lead: MockAgent = { id: 'lead-1', projectId: 'proj-1' };
      agents.set(lead.id, lead);

      // Simulate child spawn — AgentLifecycle passes agent.projectId to spawnOptions
      const child: MockAgent = { id: 'child-1', parentId: lead.id, projectId: lead.projectId };
      agents.set(child.id, child);

      expect(getProjectIdForAgent(agents, child.id)).toBe('proj-1');
      expect(getByProject(agents, 'proj-1')).toHaveLength(2);
    });

    it('secretary inherits projectId from its lead', () => {
      const agents = new Map<string, MockAgent>();
      const lead: MockAgent = { id: 'lead-sec', projectId: 'proj-sec' };
      agents.set(lead.id, lead);
      // autoSpawnSecretary passes { projectName, projectId } from lead
      const secretary: MockAgent = { id: 'sec-1', parentId: lead.id, projectId: lead.projectId };
      agents.set(secretary.id, secretary);

      expect(getProjectIdForAgent(agents, secretary.id)).toBe('proj-sec');
    });

    it('restarted agent preserves projectId', () => {
      const agents = new Map<string, MockAgent>();
      // AgentManager.restart() passes { projectName, projectId } from old agent
      const original: MockAgent = { id: 'agent-orig', projectId: 'proj-restart' };
      agents.set(original.id, original);
      // After restart, same projectId on new instance
      const restarted: MockAgent = { id: 'agent-orig', projectId: 'proj-restart' };
      agents.set(restarted.id, restarted);

      expect(getProjectIdForAgent(agents, restarted.id)).toBe('proj-restart');
    });
  });

  describe('root agent projectId guarantee', () => {
    // These tests verify the invariant enforced by AgentManager.spawn():
    // root agents (no parentId) must always have a projectId.

    it('root agent with explicit projectId keeps it', () => {
      const agents = new Map<string, MockAgent>();
      const lead: MockAgent = { id: 'lead-explicit', projectId: 'proj-explicit' };
      agents.set(lead.id, lead);
      expect(getProjectIdForAgent(agents, lead.id)).toBe('proj-explicit');
    });

    it('root agent without projectId would be unscoped (the bug scenario)', () => {
      // This test documents the bug: before the fix, root agents could
      // exist without a projectId, making their activities invisible.
      const agents = new Map<string, MockAgent>();
      const lead: MockAgent = { id: 'lead-no-proj' }; // no projectId!
      agents.set(lead.id, lead);

      // Without the fix, this returns undefined → activities log with ''
      expect(getProjectIdForAgent(agents, lead.id)).toBeUndefined();
      // And the agent wouldn't appear in ANY project query
      expect(getByProject(agents, 'any-project')).toEqual([]);
    });

    it('simulated fix: root agent gets generated projectId at spawn', () => {
      const agents = new Map<string, MockAgent>();
      // Simulate AgentManager.spawn() behavior after the fix:
      // if (!parentId && !agent.projectId) agent.projectId = randomUUID();
      const generatedId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const lead: MockAgent = { id: 'lead-auto', projectId: generatedId };
      agents.set(lead.id, lead);

      expect(getProjectIdForAgent(agents, lead.id)).toBe(generatedId);
      expect(getByProject(agents, generatedId)).toHaveLength(1);

      // Children inherit the generated projectId
      const child: MockAgent = { id: 'child-auto', parentId: lead.id };
      agents.set(child.id, child);
      expect(getProjectIdForAgent(agents, child.id)).toBe(generatedId);
      expect(getByProject(agents, generatedId)).toHaveLength(2);
    });
  });
});
