import type { ActivityLedger, ActivityEntry } from './ActivityLedger.js';
import type { TaskDAG, DagTask } from '../tasks/TaskDAG.js';
import type { DecisionLog, Decision } from './DecisionLog.js';
import type { FileLockRegistry, FileLock } from './FileLockRegistry.js';

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
  type: 'spawn' | 'agent_exit' | 'delegation' | 'task' | 'milestone' | 'decision' | 'error' | 'commit';
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
  error: 'error',
  commit: 'commit',
};

// ── SessionReplay ─────────────────────────────────────────────────

export class SessionReplay {
  private cache = new Map<string, CacheEntry>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    private activityLedger: ActivityLedger,
    private taskDAG: TaskDAG,
    private decisionLog: DecisionLog,
    private lockRegistry: FileLockRegistry,
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

  /** Reconstruct the world state at a specific point in time */
  getWorldStateAt(leadId: string, timestamp: string): WorldState {
    const cacheKey = `${leadId}:${timestamp}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.state;
    }

    // Note: leadId is NOT a projectId — don't filter activities by it.
    // Instead, fetch all activities and let downstream consumers scope as needed.
    const activities = this.activityLedger.getUntil(timestamp, undefined, 10_000);
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
    // Fetch all recent activity (not filtered by projectId — leadId ≠ projectId)
    const activities = this.activityLedger.getUntil(
      new Date().toISOString(), undefined, 10_000,
    );

    const keyframes: Keyframe[] = [];
    for (const entry of activities) {
      const type = KEYFRAME_TYPES[entry.actionType];
      if (type) {
        // "Created & delegated to X" means a new agent was spawned AND given a task.
        // Emit both a spawn and a delegation keyframe so the frontend counts agents.
        if (type === 'delegation' && entry.summary.startsWith('Created &')) {
          keyframes.push({
            timestamp: entry.timestamp,
            label: entry.summary.replace('Created & delegated to', 'Spawned').slice(0, 80),
            type: 'spawn',
          });
        }
        keyframes.push({
          timestamp: entry.timestamp,
          label: entry.summary.slice(0, 80),
          type,
        });
      }
    }
    return keyframes;
  }

  /** Get events in a time range, optionally filtered by type */
  getEventsInRange(leadId: string, from: string, to: string, types?: string[]): ActivityEntry[] {
    const allActivities = this.activityLedger.getUntil(to, undefined, 10_000);
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
