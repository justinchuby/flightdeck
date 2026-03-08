import type { ActivityEntry } from '../activity/ActivityLedger.js';

export interface CommEvent {
  type: 'delegation' | 'message' | 'broadcast' | 'group_message';
  fromAgentId: string;
  toAgentId: string | null;
  groupName?: string;
  summary: string;
  timestamp: string;
}

/**
 * Extract communication data from an activity entry.
 * Returns null if the entry is not a communication event.
 */
export function extractCommFromActivity(entry: ActivityEntry): CommEvent | null {
  if (entry.actionType === 'delegated' && entry.details?.childId) {
    return {
      type: 'delegation',
      fromAgentId: entry.agentId,
      toAgentId: entry.details.childId as string,
      summary: (entry.summary ?? '').slice(0, 120),
      timestamp: entry.timestamp,
    };
  } else if (entry.actionType === 'message_sent' && entry.details?.toAgentId) {
    const isBroadcast = entry.details.toRole === 'broadcast' || entry.details.toAgentId === 'all';
    return {
      type: isBroadcast ? 'broadcast' : 'message',
      fromAgentId: entry.agentId,
      toAgentId: entry.details.toAgentId as string,
      summary: (entry.summary ?? '').slice(0, 120),
      timestamp: entry.timestamp,
    };
  } else if (entry.actionType === 'group_message' && entry.details?.groupName) {
    return {
      type: 'group_message',
      fromAgentId: entry.agentId,
      toAgentId: null,
      groupName: entry.details.groupName as string,
      summary: (entry.summary ?? '').slice(0, 120),
      timestamp: entry.timestamp,
    };
  }
  return null;
}
