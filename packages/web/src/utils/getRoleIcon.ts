import type { Role } from '../types';

/**
 * Canonical fallback map for role icons when agent.role is a plain string
 * (e.g. from APIs that don't return the full Role object).
 *
 * Prefer agent.role.icon when available — this map exists only as a fallback.
 * Kept in sync with RoleRegistry built-in roles on the server.
 */
const FALLBACK_ROLE_ICONS: Record<string, string> = {
  lead: '👑',
  architect: '🏗',
  developer: '👨‍💻',
  'code-reviewer': '🔍',
  'critical-reviewer': '🛡',
  'readability-reviewer': '📖',
  'qa-tester': '🧪',
  designer: '🎨',
  'tech-writer': '📝',
  'product-manager': '📋',
  secretary: '📒',
  'radical-thinker': '💡',
  generalist: '🔧',
  agent: '🤖',
};

/**
 * Get the emoji icon for a role. Accepts either:
 * - A full Role object (uses role.icon directly)
 * - A role ID string (looks up in fallback map)
 * - undefined/null (returns default 🤖)
 */
export function getRoleIcon(role: Role | string | null | undefined): string {
  if (!role) return '🤖';
  if (typeof role === 'object') return role.icon || '🤖';
  return FALLBACK_ROLE_ICONS[role] ?? '🤖';
}
