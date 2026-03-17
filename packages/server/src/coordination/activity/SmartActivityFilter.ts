/**
 * Smart activity filtering for CREW_UPDATE messages.
 *
 * Reduces noise in agent context windows by:
 * 1. Prioritizing entries: HIGH (errors, completions) > MEDIUM (edits, messages) > LOW (status churn, locks)
 * 2. Deduplicating per-agent status_change entries — only latest per agent
 * 3. Deduplicating per-agent lock events — only latest per agent
 * 4. Composing a balanced list: all HIGH, then MEDIUM, then LOW up to limit
 */
import type { ActivityEntry, ActionType } from './ActivityLedger.js';

type ActivityPriority = 'high' | 'medium' | 'low';

/** Map each action type to a priority tier */
const PRIORITY_MAP: Record<ActionType, ActivityPriority> = {
  // HIGH — always shown, critical for coordination
  error: 'high',
  task_completed: 'high',
  delegated: 'high',
  delegation_cancelled: 'high',
  agent_terminated: 'high',
  sub_agent_spawned: 'high',
  agent_interrupted: 'high',
  heartbeat_halted: 'high',

  // MEDIUM — usually relevant, shown if space permits
  file_edit: 'medium',
  decision_made: 'medium',
  message_sent: 'medium',
  group_message: 'medium',
  task_started: 'medium',
  limit_change_requested: 'medium',

  // LOW — noisy, only shown if space remains
  status_change: 'low',
  lock_acquired: 'low',
  lock_released: 'low',
  lock_denied: 'low',
  file_read: 'low',
  progress_update: 'high',
};

/** Action types where we keep only the latest entry per agent */
const DEDUPLICATE_TYPES = new Set<ActionType>([
  'status_change',
  'lock_acquired',
  'lock_released',
]);

/**
 * Inter-agent DMs and group messages are noise for the lead.
 * Keep: completion reports, delegation acks, broadcasts, messages to lead.
 * Drop: DMs between agents, group chat chatter.
 */
function isInterAgentNoise(entry: ActivityEntry): boolean {
  // All group messages are inter-agent chatter
  if (entry.actionType === 'group_message') return true;

  // For message_sent, check if it's a DM between agents (not a completion/delegation report)
  if (entry.actionType === 'message_sent') {
    const details = typeof entry.details === 'string'
      ? (() => { try { return JSON.parse(entry.details); } catch { return {}; } })()
      : entry.details ?? {};

    // Direct messages between agents
    if (details.type === 'direct_message') return true;
  }

  return false;
}

export function getActivityPriority(actionType: ActionType): ActivityPriority {
  return PRIORITY_MAP[actionType] ?? 'low';
}

export class SmartActivityFilter {
  /**
   * Filter and prioritize activity entries for CREW_UPDATE.
   *
   * @param entries - Raw entries, newest-first (DESC order from DB)
   * @param limit - Max entries to return (default 20)
   * @returns Filtered entries, newest-first
   */
  filter(entries: ActivityEntry[], limit: number = 20): ActivityEntry[] {
    // Step 1: Remove inter-agent DMs and group messages (noise for lead)
    const relevant = entries.filter((e) => !isInterAgentNoise(e));

    // Step 2: Deduplicate — for noisy action types, keep only the latest per agent
    const deduped = this.deduplicatePerAgent(relevant);

    // Step 3: Partition by priority
    const high: ActivityEntry[] = [];
    const medium: ActivityEntry[] = [];
    const low: ActivityEntry[] = [];

    for (const entry of deduped) {
      const priority = getActivityPriority(entry.actionType);
      if (priority === 'high') high.push(entry);
      else if (priority === 'medium') medium.push(entry);
      else low.push(entry);
    }

    // Step 4: Compose result — high first, then medium, then low, up to limit
    const result: ActivityEntry[] = [...high.slice(0, limit)];
    const mediumSlots = Math.max(0, limit - result.length);
    if (mediumSlots > 0) result.push(...medium.slice(0, mediumSlots));
    const lowSlots = Math.max(0, limit - result.length);
    if (lowSlots > 0) result.push(...low.slice(0, lowSlots));

    // Step 5: Re-sort by id desc (preserve newest-first order)
    return result.sort((a, b) => b.id - a.id);
  }

  /**
   * For deduplicatable action types, keep only the first (newest) entry per agent.
   * Non-deduplicatable entries pass through unchanged.
   */
  private deduplicatePerAgent(entries: ActivityEntry[]): ActivityEntry[] {
    // Key: "agentId:actionType" for deduplicatable types
    const seen = new Set<string>();

    return entries.filter((entry) => {
      if (!DEDUPLICATE_TYPES.has(entry.actionType)) return true;

      const key = `${entry.agentId}:${entry.actionType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
