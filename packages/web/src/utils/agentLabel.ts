/**
 * Agent label formatting utilities — shared across all agent UI components.
 *
 * Provides consistent agent ID shortening and role label formatting.
 * Standard short ID length is 8 characters (enough for uniqueness in UUIDs).
 */

export { shortAgentId, SHORT_ID_LENGTH } from '@flightdeck/shared';
import { shortAgentId } from '@flightdeck/shared';

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
