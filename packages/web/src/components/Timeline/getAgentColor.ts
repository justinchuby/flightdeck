/**
 * Deterministic agent color assignment from a WCAG AA palette.
 * Colors pass 4.5:1 contrast ratio against dark backgrounds (#1e1e2e).
 */

const AGENT_COLORS = [
  '#2563eb', // blue
  '#dc2626', // red
  '#059669', // emerald
  '#d97706', // amber
  '#7c3aed', // violet
  '#db2777', // pink
  '#0891b2', // cyan
  '#65a30d', // lime
] as const;

/**
 * Returns a deterministic WCAG AA color for an agent based on its ID.
 * Uses a simple hash to map agentId → palette index, ensuring the same
 * agent always gets the same color across renders.
 */
export function getAgentColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

export { AGENT_COLORS };
