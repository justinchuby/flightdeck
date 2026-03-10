import type { ActivityLedger, ActivityEntry } from '../activity/ActivityLedger.js';
import type { TaskDAG, DagTask } from '../../tasks/TaskDAG.js';
import type { DecisionLog, Decision } from '../decisions/DecisionLog.js';
import type { FileLockRegistry, FileLock } from '../files/FileLockRegistry.js';

// ── Types ─────────────────────────────────────────────────────────

export interface ReplayAgent {
  id: string;
  role: string;
  status: 'running' | 'completed' | 'failed' | 'terminated' | 'unknown';
  spawnedAt: string;
}

export interface Keyframe {
  timestamp: string;
  label: string;
  type: 'spawn' | 'agent_exit' | 'delegation' | 'task' | 'milestone' | 'decision' | 'progress' | 'error' | 'commit';
  agentId?: string;
}

export interface WorldState {
  timestamp: string;
  agents: ReplayAgent[];
  dagTasks: DagTask[];
  decisions: Decision[];
  locks: FileLock[];
  recentActivity: ActivityEntry[];
}

// ── Cache ─────────────────────────────────────────────────────────

interface CacheEntry {
  state: WorldState;
  expiresAt: number;
}

const CACHE_TTL_MS = 5_000;

/** Maximum number of activity entries to query. Matches buildTimelineData in coordination.ts. */
const ACTIVITY_QUERY_LIMIT = 10_000;

// ── Keyframe event types ──────────────────────────────────────────

const KEYFRAME_TYPES: Record<string, Keyframe['type']> = {
  sub_agent_spawned: 'spawn',
  agent_terminated: 'agent_exit',
  delegated: 'delegation',
  task_started: 'task',
  task_completed: 'milestone',
  task_failed: 'task',
  decision_confirmed: 'decision',
  decision_rejected: 'decision',
  progress_update: 'progress',
  error: 'error',
  commit: 'commit',
};

// ── Minimal interface for team resolution ─────────────────────────
// Only the subset of AgentManager that SessionReplay needs.

export interface ReplayAgentSource {
  getAll(): Array<{ id: string; parentId?: string; projectId?: string }>;
}

// ── SessionReplay ─────────────────────────────────────────────────

export class SessionReplay {
  private cache = new Map<string, CacheEntry>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    private activityLedger: ActivityLedger,
    private taskDAG: TaskDAG,
    private decisionLog: DecisionLog,
    private lockRegistry: FileLockRegistry,
    private agentSource?: ReplayAgentSource,
  ) {
    // Evict expired cache entries every 60s to prevent unbounded growth
    this.cleanupTimer = setInterval(() => this.evictExpired(), 60_000);
  }

  /** Stop the cache cleanup timer */
  destroy(): void {
    clearInterval(this.cleanupTimer);
    this.cache.clear();
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
  }

  /**
   * Resolve activities scoped to a lead's session.
   *
   * Uses the same team-resolution pattern as `buildTimelineData` in
   * `packages/server/src/routes/coordination.ts`:
   *  1. Try projectId-based SQL filter (works for historical sessions).
   *  2. If empty, resolve the team via AgentManager and filter in-memory.
   *  3. If no team can be resolved, return [] — never unscoped data.
   */
  resolveActivities(leadId: string, timestamp: string, limit: number): ActivityEntry[] {
    // Tier 1: projectId-based SQL filter (historical sessions with real project UUIDs)
    const byProject = this.activityLedger.getUntil(timestamp, leadId, limit);
    if (byProject.length > 0) return byProject;

    // Tier 2: Resolve team membership from live agent roster
    if (this.agentSource) {
      const teamIds = new Set<string>([leadId]);
      for (const agent of this.agentSource.getAll()) {
        if (agent.parentId === leadId || agent.id === leadId) {
          teamIds.add(agent.id);
        }
      }

      const allActivities = this.activityLedger.getUntil(timestamp, undefined, limit);

      // If we found live team members, filter to their events
      if (teamIds.size > 1) {
        return allActivities.filter(
          a => teamIds.has(a.agentId) || a.projectId === leadId,
        );
      }

      // Tier 3 — Historical replay without live agents: the lead was active
      // in this session but has since disconnected. Discover the team from
      // projectId references and delegation chains in the event log.
      // First check if leadId appears as a projectId on any events
      const projectEvents = allActivities.filter(a => a.projectId === leadId);
      if (projectEvents.length > 0) {
        const discoveredIds = new Set<string>();
        for (const ev of projectEvents) discoveredIds.add(ev.agentId);
        return allActivities.filter(
          a => discoveredIds.has(a.agentId) || a.projectId === leadId,
        );
      }

      // Fall back to delegation chain discovery from lead's own events
      const hasLeadEvents = allActivities.some(a => a.agentId === leadId);
      if (hasLeadEvents) {
        const discoveredIds = new Set<string>([leadId]);
        for (const ev of allActivities) {
          if (ev.actionType === 'delegated' && discoveredIds.has(ev.agentId)) {
            const childId = (ev.details as Record<string, unknown>)?.childId ??
              (ev.details as Record<string, unknown>)?.spawnedAgentId;
            if (typeof childId === 'string') discoveredIds.add(childId);
          }
        }
        return allActivities.filter(a => discoveredIds.has(a.agentId));
      }
    }

    // No agentSource and no projectId match → empty, NOT everything
    return [];
  }

  /** Reconstruct the world state at a specific point in time */
  getWorldStateAt(leadId: string, timestamp: string): WorldState {
    const cacheKey = `${leadId}:${timestamp}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.state;
    }

    // Try projectId filtering first, fall back to team-resolution for live agent IDs
    const activities = this.resolveActivities(leadId, timestamp, ACTIVITY_QUERY_LIMIT);
    const dagTasks = this.taskDAG.getTasksAt(leadId, timestamp);
    const decisions = this.decisionLog.getDecisionsAt(leadId, timestamp);
    const locks = this.lockRegistry.getLocksAt(timestamp);

    const agents = this.extractAgentRoster(activities);
    const recentActivity = activities.slice(-20);

    const state: WorldState = { timestamp, agents, dagTasks, decisions, locks, recentActivity };

    this.cache.set(cacheKey, { state, expiresAt: Date.now() + CACHE_TTL_MS });
    return state;
  }

  /** Get significant moments for scrubber markers */
  getKeyframes(leadId: string): Keyframe[] {
    const activities = this.resolveActivities(
      leadId, new Date().toISOString(), ACTIVITY_QUERY_LIMIT,
    );

    const keyframes: Keyframe[] = [];
    for (const entry of activities) {
      const type = KEYFRAME_TYPES[entry.actionType];
      if (type) {
        const details = (entry.details ?? {}) as Record<string, string>;
        // "Created & delegated to X" means a new agent was spawned AND given a task.
        // Emit both a spawn and a delegation keyframe so the frontend counts agents.
        if (type === 'delegation' && entry.summary.startsWith('Created &')) {
          const spawnedId = details.spawnedAgentId ?? details.agentId ?? entry.agentId;
          keyframes.push({
            timestamp: entry.timestamp,
            label: entry.summary.replace('Created & delegated to', 'Spawned'),
            type: 'spawn',
            agentId: spawnedId,
          });
        }
        keyframes.push({
          timestamp: entry.timestamp,
          label: entry.summary,
          type,
          agentId: entry.agentId,
        });
      }
    }
    return keyframes;
  }

  /** Get events in a time range, optionally filtered by type */
  getEventsInRange(leadId: string, from: string, to: string, types?: string[]): ActivityEntry[] {
    const allActivities = this.resolveActivities(leadId, to, ACTIVITY_QUERY_LIMIT);
    let filtered = allActivities.filter(a => a.timestamp >= from);
    if (types && types.length > 0) {
      filtered = filtered.filter(a => types.includes(a.actionType));
    }
    return filtered;
  }

  /** Reconstruct agent roster from activity events */
  private extractAgentRoster(activities: ActivityEntry[]): ReplayAgent[] {
    const agentMap = new Map<string, ReplayAgent>();

    for (const entry of activities) {
      // "Created & delegated to X" means a new agent was spawned
      if (entry.actionType === 'delegated' && entry.summary.startsWith('Created &')) {
        const details = entry.details as Record<string, string>;
        const agentId = details.spawnedAgentId ?? details.agentId ?? entry.agentId;
        const role = details.role ?? entry.agentRole;
        agentMap.set(agentId, {
          id: agentId,
          role,
          status: 'running',
          spawnedAt: entry.timestamp,
        });
      }
      // Legacy: support sub_agent_spawned if it exists
      if (entry.actionType === 'sub_agent_spawned') {
        const agentId = (entry.details as Record<string, string>).spawnedAgentId ?? entry.agentId;
        const role = (entry.details as Record<string, string>).role ?? entry.agentRole;
        agentMap.set(agentId, {
          id: agentId,
          role,
          status: 'running',
          spawnedAt: entry.timestamp,
        });
      }

      // Auto-discover agents from non-spawn events (status_change, message_sent, etc.)
      if (entry.actionType !== 'sub_agent_spawned' && !agentMap.has(entry.agentId)) {
        agentMap.set(entry.agentId, {
          id: entry.agentId,
          role: entry.agentRole,
          status: 'running',
          spawnedAt: entry.timestamp,
        });
      }

      // Update status based on terminal events
      if (entry.actionType === 'task_completed') {
        const existing = agentMap.get(entry.agentId);
        if (existing) existing.status = 'completed';
      }
      if (entry.actionType === 'agent_terminated') {
        const existing = agentMap.get(entry.agentId);
        if (existing) existing.status = 'terminated';
      }
      if (entry.actionType === 'error') {
        const existing = agentMap.get(entry.agentId);
        if (existing) existing.status = 'failed';
      }
    }

    return [...agentMap.values()];
  }
}
