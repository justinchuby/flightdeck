/**
 * Shared crew membership utilities.
 *
 * Centralizes the logic for determining whether an agent belongs to a
 * crew identified by a leadId.  The leadId may be:
 *   - An agent UUID  →  matched via parentId or id
 *   - A project slug →  matched via projectId
 *
 * Every call-site that previously used inline `agent.parentId === leadId`
 * checks should use these helpers instead.
 */

/** Minimal agent shape required for crew membership checks */
export interface CrewMemberLike {
  id: string;
  parentId?: string;
  projectId?: string;
}

/**
 * Returns true if `agent` belongs to the crew identified by `leadId`.
 *
 * Matches when any of these hold:
 *   - agent.id === leadId        (the lead itself)
 *   - agent.parentId === leadId  (direct child of lead)
 *   - agent.projectId === leadId (same project — handles project-slug leadIds)
 */
export function isCrewMember(agent: CrewMemberLike, leadId: string): boolean {
  return agent.id === leadId
    || agent.parentId === leadId
    || agent.projectId === leadId;
}

/**
 * Filter an array of agents to only those belonging to the crew.
 */
export function getCrewAgents<T extends CrewMemberLike>(agents: T[], leadId: string): T[] {
  return agents.filter(a => isCrewMember(a, leadId));
}

/**
 * Collect the set of agent IDs that belong to a crew.
 * Always includes `leadId` itself.
 */
export function getCrewIds<T extends CrewMemberLike>(agents: T[], leadId: string): Set<string> {
  const ids = new Set<string>([leadId]);
  for (const agent of agents) {
    if (isCrewMember(agent, leadId)) {
      ids.add(agent.id);
    }
  }
  return ids;
}
