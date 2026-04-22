/**
 * Shared crew membership utilities.
 *
 * Domain model:
 *   Project → Sessions → Crews → Agents
 *
 * A **crew** is the set of agents within a single session, led by one
 * lead agent.  A project can have multiple sessions (and therefore
 * multiple crews) over its lifetime.  Sub-leads may exist within a
 * crew; they and their child agents are all part of the same crew.
 *
 * These helpers determine whether an agent belongs to a crew identified
 * by a leadId.  The leadId may be:
 *   - An agent UUID  →  matched via parentId or id
 *   - A project slug →  matched via projectId (includes all sessions)
 *
 * Every call-site that previously used inline `agent.parentId === leadId`
 * checks should use these helpers instead.
 */

/** Minimal agent shape required for crew membership checks */
export interface CrewMemberLike {
  id: string;
  /** Direct parent — the lead (or sub-lead) that spawned this agent */
  parentId?: string;
  /** Project this agent belongs to (spans all sessions) */
  projectId?: string;
}

/**
 * Returns true if `agent` belongs to the crew identified by `leadId`.
 *
 * When leadId is an agent UUID this checks single-session crew membership.
 * When leadId is a project slug this matches all agents in the project
 * (across sessions).
 *
 * Matches when any of these hold:
 *   - agent.id === leadId        (the lead itself)
 *   - agent.parentId === leadId  (direct child of lead / sub-lead)
 *   - agent.projectId === leadId (same project — handles project-slug leadIds)
 */
export function isCrewMember(agent: CrewMemberLike, leadId: string): boolean {
  return agent.id === leadId
    || agent.parentId === leadId
    || agent.projectId === leadId;
}

/**
 * Filter an array of agents to only those belonging to the crew
 * (or project, when leadId is a project slug).
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
