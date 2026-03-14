import { useCallback, useSyncExternalStore } from 'react';
import { useAppStore } from '../../stores/appStore';

/**
 * Tracks unread message state per agent.
 * Returns `hasUnread(agentId)` to check if an agent has new messages
 * since the Chat tab was last viewed, and `markRead(agentId)` to clear.
 *
 * Usage in profile panel:
 *   const { hasUnread, markRead } = useUnreadMessages();
 *   // Show dot: hasUnread('agent-abc123')
 *   // On tab switch to Chat: markRead('agent-abc123')
 */

/** Module-level map: agentId → timestamp when Chat tab was last viewed */
const lastViewedMap = new Map<string, number>();
let version = 0;
const listeners = new Set<() => void>();

function notify() {
  version++;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return version;
}

export function useUnreadMessages() {
  // Subscribe to version changes so component re-renders on markRead
  useSyncExternalStore(subscribe, getSnapshot);

  const markRead = useCallback((agentId: string) => {
    lastViewedMap.set(agentId, Date.now());
    notify();
  }, []);

  const hasUnread = useCallback((agentId: string): boolean => {
    const lastViewed = lastViewedMap.get(agentId) ?? 0;
    const agent = useAppStore.getState().agents.find((a) => a.id === agentId);
    const messages = agent?.messages;
    if (!messages || messages.length === 0) return false;

    // Find the latest non-system message timestamp
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.sender !== 'user' && msg.timestamp && msg.timestamp > lastViewed) {
        return true;
      }
    }
    return false;
  }, []);

  return { hasUnread, markRead };
}
