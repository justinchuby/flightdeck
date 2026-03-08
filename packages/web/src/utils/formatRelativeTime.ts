/**
 * Format an ISO timestamp as a human-readable relative time string.
 *
 * Handles edge cases:
 * - Non-UTC timestamps (missing 'Z' suffix)
 * - Space-separated date/time (e.g. "2026-03-08 12:00:00")
 * - Invalid/malformed timestamps (returns the original string)
 *
 * Shared utility — replaces inline copies in HomeDashboard, KanbanBoard,
 * KnowledgePanel, and ProjectsPanel.
 */
export function formatRelativeTime(timestamp: string): string {
  try {
    const normalized = timestamp.endsWith('Z')
      ? timestamp
      : timestamp.replace(' ', 'T') + 'Z';
    const then = new Date(normalized).getTime();
    if (isNaN(then)) return timestamp;

    const diffMs = Date.now() - then;
    if (diffMs < 0) return 'just now';
    if (diffMs < 60_000) return 'just now';
    if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
    return `${Math.floor(diffMs / 86_400_000)}d ago`;
  } catch {
    return timestamp;
  }
}
