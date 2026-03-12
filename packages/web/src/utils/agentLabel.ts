/**
 * Agent label formatting utilities — shared across heatmap components.
 *
 * Provides consistent agent ID shortening and role label formatting
 * for AgentHeatmap and CommHeatmap.
 */

/** Shorten an agent UUID to a 5-char alphanumeric string. */
export function shortAgentId(agentId: string): string {
  const compactId = agentId.replace(/[^a-zA-Z0-9]/g, '');
  return (compactId || agentId).slice(0, 5);
}

/** Title-case a string (e.g., 'project_lead' → 'Project Lead'). */
function toTitleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format a role string for display (e.g., 'code_reviewer' → 'Code Reviewer'). */
export function formatRoleLabel(role?: string): string {
  if (!role) return 'Agent';
  return toTitleCase(role.replace(/[_-]+/g, ' ').trim());
}

/** Build a compact agent label like 'Developer a1b2c'. */
export function buildAgentLabel(agent: { id: string; role?: { name?: string } | string }): string {
  const roleName = typeof agent.role === 'string'
    ? agent.role
    : agent.role?.name ?? 'Agent';
  return `${formatRoleLabel(roleName)} ${shortAgentId(agent.id)}`;
}
