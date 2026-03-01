/**
 * ProjectionUtils — hardening utilities for causal graph projections.
 *
 * Provides cycle detection, orphan management, and lastSeenEventId
 * fallback logic for the timeline projection layer.
 */

// ── Types ─────────────────────────────────────────────────────────

export interface CausalEvent {
  id: string;
  causedBy?: string;
  timestamp: string;
}

export interface OrphanEntry {
  event: CausalEvent;
  firstSeenAt: number;
}

// ── Cycle-safe graph traversal ────────────────────────────────────

/**
 * Walk a causal graph depth-first with cycle detection.
 * Returns the set of visited node IDs. Silently stops at cycles.
 */
export function walkCausalGraph(
  startId: string,
  getChildren: (id: string) => string[],
): Set<string> {
  const visited = new Set<string>();
  const stack = [startId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const child of getChildren(current)) {
      if (!visited.has(child)) {
        stack.push(child);
      }
    }
  }
  return visited;
}

/**
 * Detect if adding an edge from `childId` → `parentId` (causedBy)
 * would create a cycle in the causal graph.
 */
export function wouldCreateCycle(
  childId: string,
  parentId: string,
  getParent: (id: string) => string | undefined,
): boolean {
  const visited = new Set<string>();
  let current: string | undefined = parentId;
  while (current) {
    if (current === childId) return true;
    if (visited.has(current)) return false; // already a cycle elsewhere
    visited.add(current);
    current = getParent(current);
  }
  return false;
}

// ── Orphan manager ────────────────────────────────────────────────

const DEFAULT_ORPHAN_TTL_MS = 60_000;
const DEFAULT_MAX_ORPHANS = 500;

export interface OrphanManagerOptions {
  orphanTtlMs?: number;
  maxOrphans?: number;
}

/**
 * Manages events whose `causedBy` points to an unknown parent.
 * After a TTL, orphans are promoted to roots. Excess orphans beyond
 * the cap are also promoted (oldest first).
 */
export class OrphanManager {
  private orphans = new Map<string, OrphanEntry>();
  private readonly ttlMs: number;
  private readonly maxOrphans: number;

  constructor(options?: OrphanManagerOptions) {
    this.ttlMs = options?.orphanTtlMs ?? DEFAULT_ORPHAN_TTL_MS;
    this.maxOrphans = options?.maxOrphans ?? DEFAULT_MAX_ORPHANS;
  }

  /** Register an event as orphaned (its causedBy target is unknown). */
  addOrphan(event: CausalEvent): void {
    if (!this.orphans.has(event.id)) {
      this.orphans.set(event.id, { event, firstSeenAt: Date.now() });
    }
  }

  /** Remove an orphan (e.g. its parent appeared). */
  resolve(eventId: string): OrphanEntry | undefined {
    const entry = this.orphans.get(eventId);
    if (entry) this.orphans.delete(eventId);
    return entry;
  }

  /**
   * Promote expired orphans to roots and enforce the cap.
   * Returns the list of events that should become root events.
   */
  promoteExpired(): CausalEvent[] {
    const now = Date.now();
    const promoted: CausalEvent[] = [];

    // Promote TTL-expired orphans
    const expiredIds: string[] = [];
    for (const [id, entry] of this.orphans) {
      if (now - entry.firstSeenAt >= this.ttlMs) {
        promoted.push(entry.event);
        expiredIds.push(id);
      }
    }
    for (const id of expiredIds) {
      this.orphans.delete(id);
    }

    // Enforce cap: promote oldest orphans beyond limit
    if (this.orphans.size > this.maxOrphans) {
      const sorted = [...this.orphans.entries()].sort(
        (a, b) => a[1].firstSeenAt - b[1].firstSeenAt,
      );
      const excess = this.orphans.size - this.maxOrphans;
      for (let i = 0; i < excess; i++) {
        promoted.push(sorted[i][1].event);
        this.orphans.delete(sorted[i][0]);
      }
    }

    return promoted;
  }

  get orphanCount(): number {
    return this.orphans.size;
  }

  /** Get all current orphan IDs (for diagnostics). */
  getOrphanIds(): string[] {
    return [...this.orphans.keys()];
  }
}

// ── lastSeenEventId fallback ──────────────────────────────────────

/**
 * Resolve a lastSeenEventId against a known set of event IDs.
 * If the ID has been purged (not found), returns undefined — callers
 * should treat this as "first visit" (graceful fallback).
 */
export function resolveLastSeenEventId(
  lastSeenEventId: string | undefined | null,
  knownEventIds: Set<string> | Map<string, unknown>,
): string | undefined {
  if (!lastSeenEventId) return undefined;
  if (knownEventIds.has(lastSeenEventId)) return lastSeenEventId;
  // ID was purged or invalid — fallback to undefined (treat as first visit)
  return undefined;
}
