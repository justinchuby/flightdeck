import type { PreActionHook, GovernanceAction, HookContext, HookResult } from '../types.js';

/**
 * Default rate limits per command type.
 */
const DEFAULT_LIMITS: Record<string, { maxPerMinute?: number; maxPerHour?: number }> = {
  CREATE_AGENT: { maxPerMinute: 5, maxPerHour: 20 },
  DELEGATE: { maxPerMinute: 10, maxPerHour: 50 },
  AGENT_MESSAGE: { maxPerMinute: 30 },
  BROADCAST: { maxPerMinute: 3 },
  COMMIT: { maxPerMinute: 5 },
};

interface WindowEntry {
  timestamp: number;
}

export interface RateLimitHookConfig {
  limits?: Record<string, { maxPerMinute?: number; maxPerHour?: number }>;
}

/**
 * RateLimitHook (Priority 300)
 *
 * Prevents agents from spamming commands using a sliding window.
 * Tracks command counts per agent per command type.
 */
export function createRateLimitHook(config: RateLimitHookConfig = {}): PreActionHook {
  const limits = { ...DEFAULT_LIMITS, ...config.limits };
  const commandsWithLimits = new Set(Object.keys(limits));

  // Sliding window: Map<`${agentId}:${commandName}`, timestamps[]>
  const windows = new Map<string, WindowEntry[]>();

  function getKey(agentId: string, commandName: string): string {
    return `${agentId}:${commandName}`;
  }

  function pruneWindow(entries: WindowEntry[], cutoff: number): WindowEntry[] {
    return entries.filter(e => e.timestamp > cutoff);
  }

  return {
    name: 'rate-limit',
    priority: 300,

    match(action: GovernanceAction): boolean {
      return commandsWithLimits.has(action.commandName);
    },

    evaluate(action: GovernanceAction, _context: HookContext): HookResult {
      const limit = limits[action.commandName];
      if (!limit) return { decision: 'allow' };

      const key = getKey(action.agent.id, action.commandName);
      const now = action.timestamp;

      // Get or create sliding window entries
      let entries = windows.get(key) || [];

      // Prune entries older than 1 hour
      const oneHourAgo = now - 60 * 60 * 1000;
      entries = pruneWindow(entries, oneHourAgo);

      // Check per-hour limit
      if (limit.maxPerHour !== undefined && entries.length >= limit.maxPerHour) {
        windows.set(key, entries);
        return {
          decision: 'block',
          reason: `Rate limit exceeded: ${action.commandName} (${limit.maxPerHour}/hour). Wait before retrying.`,
          meta: { limit: 'hourly', count: entries.length, max: limit.maxPerHour },
        };
      }

      // Check per-minute limit
      if (limit.maxPerMinute !== undefined) {
        const oneMinuteAgo = now - 60 * 1000;
        const recentCount = entries.filter(e => e.timestamp > oneMinuteAgo).length;
        if (recentCount >= limit.maxPerMinute) {
          windows.set(key, entries);
          return {
            decision: 'block',
            reason: `Rate limit exceeded: ${action.commandName} (${limit.maxPerMinute}/min). Wait before retrying.`,
            meta: { limit: 'per-minute', count: recentCount, max: limit.maxPerMinute },
          };
        }
      }

      // Record this command and allow
      entries.push({ timestamp: now });
      windows.set(key, entries);
      return { decision: 'allow' };
    },
  };
}
